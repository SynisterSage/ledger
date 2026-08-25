#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { normalizeWavForTranscription } from '../electron/transcriptionAudio.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const model = process.env.LEDGER_WHISPER_MODEL || path.join(os.homedir(), 'Library/Application Support/ledger/models/whisper/ggml-base.en.bin');
const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value.slice(2), values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : 'true'] : [String(index), value]));
const requestedBackend = args.get('backend') || 'cpu';
const runs = Math.max(1, Number(args.get('runs') || 1));
const threadCount = Math.max(1, Number(args.get('threads') || process.env.LEDGER_WHISPER_THREADS || 4));
const fixtureDir = args.get('fixture-dir') || fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-whisper-benchmark-'));
const reportPath = args.get('output') || null;

if (!fs.existsSync(model)) throw new Error(`Missing Whisper model: ${model}`);
const fixtures = loadFixtures(args.get('fixtures'), fixtureDir);
const backends = requestedBackend === 'both' ? ['cpu', 'metal'] : [requestedBackend];
const reports = [];
for (const backend of backends) reports.push(await benchmarkBackend(backend));
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, model, requestedBackend, threads: threadCount, fixtures, reports };
if (reportPath) { fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));

function loadFixtures(value, directory) {
  const supplied = value ? value.split(',').map((item) => path.resolve(item)).filter((item) => fs.existsSync(item)) : [];
  if (supplied.length) return supplied.map((filePath) => ({ id: path.basename(filePath), path: filePath, generated: false }));
  const generated = [
    ['short-speech', 5],
    ['continuous-30s', 30],
    ['silence-heavy-60s', 60],
    ['continuous-180s', 180],
  ].map(([id, seconds]) => { const filePath = path.join(directory, `${id}.wav`); writeFixture(filePath, Number(seconds), id === 'silence-heavy-60s'); return { id, path: filePath, generated: true, durationSeconds: Number(seconds) }; });
  return generated;
}

function writeFixture(filePath, seconds, silenceHeavy) {
  const sampleRate = 16_000; const frames = sampleRate * seconds; const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 2, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index += 1) { const second = index / sampleRate; const active = !silenceHeavy || (second % 8 >= 2 && second % 8 < 4); const value = active ? Math.sin(index / 18) * 0.08 : 0; buffer.writeInt16LE(value * 0x7fff, 44 + index * 2); }
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
}

async function benchmarkBackend(backend) {
  const executable = backend === 'metal' ? process.env.LEDGER_WHISPER_SERVER_METAL : process.env.LEDGER_WHISPER_SERVER_CPU || path.join(root, 'native', process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server');
  const available = fs.existsSync(executable) && backendAvailable(executable, backend);
  if (!available) return { backend, executable, available: false, reason: backend === 'metal' ? 'No Metal-capable whisper-server was supplied.' : 'CPU whisper-server is missing.' };
  const port = await freePort();
  const serverArgs = ['-t', String(threadCount), '-m', model, '--host', '127.0.0.1', '--port', String(port)];
  if (backend === 'cpu') serverArgs.push('-ng');
  const child = spawn(executable, serverArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; let peakRssMiB = 0;
  const collect = (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-12000); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const startupStarted = performance.now();
  try {
    await waitForReady(child, port, () => diagnostics);
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    return { backend, executable, available: true, startupFailed: true, startupMs: performance.now() - startupStarted, startupCount: 0, peakRssMiB: processRssMiB(child.pid) || null, diagnostics: diagnostics.split(/\r?\n/).filter(Boolean).slice(-40), failure: error instanceof Error ? error.message : String(error) };
  }
  const startupMs = performance.now() - startupStarted;
  const sampleTimer = setInterval(() => { peakRssMiB = Math.max(peakRssMiB, processRssMiB(child.pid)); }, 50);
  const cases = [];
  try {
    for (let run = 1; run <= runs; run += 1) for (const fixture of fixtures) { console.error(`[whisper-benchmark] ${backend} run ${run}: ${fixture.id}`); cases.push(await runFixture(port, fixture, run)); }
  } finally {
    clearInterval(sampleTimer); peakRssMiB = Math.max(peakRssMiB, processRssMiB(child.pid)); child.kill('SIGTERM');
  }
  const inference = cases.map((item) => item.inferenceMs).filter(Number.isFinite);
  return { backend, executable, available: true, threads: threadCount, startupMs, startupCount: 1, peakRssMiB: peakRssMiB || null, diagnostics: diagnostics.split(/\r?\n/).filter((line) => /metal|backend|model|load|thread|time/i.test(line)).slice(-30), cases, summary: { medianInferenceMs: percentile(inference, 0.5), p95InferenceMs: percentile(inference, 0.95), averageRtf: average(cases.map((item) => item.rtf)), failures: cases.filter((item) => item.error).length } };
}

async function runFixture(port, fixture, run) {
  const normalizedRoot = path.join(fixtureDir, 'normalized');
  const prepared = normalizeWavForTranscription(fixture.path, normalizedRoot);
  const started = performance.now();
  try {
    const form = new FormData(); form.append('file', new Blob([fs.readFileSync(prepared.path)], { type: 'audio/wav' }), path.basename(prepared.path)); form.append('response_format', 'verbose_json'); form.append('language', 'en'); form.append('temperature', '0'); form.append('temperature_inc', '0');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(process.env.LEDGER_WHISPER_BENCHMARK_TIMEOUT_MS || 10 * 60 * 1000));
    const response = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json(); const durationSeconds = Number(payload.duration) || prepared.originalDurationSeconds; const inferenceMs = performance.now() - started;
    return { fixture: fixture.id, run, audioDurationSeconds: durationSeconds, preprocessingMs: prepared.preprocessingMs, inferenceMs, rtf: inferenceMs / 1000 / Math.max(0.001, durationSeconds), segments: Array.isArray(payload.segments) ? payload.segments.length : 0, error: null };
  } catch (error) { return { fixture: fixture.id, run, audioDurationSeconds: prepared.originalDurationSeconds, preprocessingMs: prepared.preprocessingMs, inferenceMs: null, rtf: null, segments: 0, error: error instanceof Error ? error.message : String(error) }; }
}

function backendAvailable(executable, backend) {
  if (backend !== 'metal' || process.platform !== 'darwin') return true;
  try { return /Metal\.framework/i.test(execFileSync('otool', ['-L', executable], { encoding: 'utf8' })); } catch { return false; }
}
function waitForReady(child, port, diagnostics) { return new Promise((resolve, reject) => { let checking = false; const timer = setInterval(async () => { if (checking) return; checking = true; try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) { clearInterval(timer); resolve(); } } catch {} finally { checking = false; } }, 50); child.once('error', (error) => { clearInterval(timer); reject(error); }); child.once('exit', (code, signal) => { clearInterval(timer); reject(new Error(`Whisper server exited before ready (${code ?? signal}): ${diagnostics()}`)); }); }); }
function freePort() { const server = net.createServer(); return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close(() => resolve(port)); }); }); }
function processRssMiB(pid) { if (!pid) return 0; try { const value = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim(); return Number(value) / 1024 || 0; } catch { return 0; } }
function average(values) { const usable = values.filter(Number.isFinite); return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null; }
function percentile(values, p) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null; }
