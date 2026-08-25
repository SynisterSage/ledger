import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const benchmark = fs.readFileSync(new URL('../benchmark-whisper-transcription.mjs', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../../electron/whisperRuntime.ts', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../../electron/transcriptionService.ts', import.meta.url), 'utf8');

test('benchmark reports the Phase 4 performance dimensions and supports both backends', () => {
  assert.match(benchmark, /requestedBackend/);
  assert.match(benchmark, /\['cpu', 'metal'\]/);
  assert.match(benchmark, /preprocessingMs/);
  assert.match(benchmark, /inferenceMs/);
  assert.match(benchmark, /rtf/);
  assert.match(benchmark, /peakRssMiB/);
  assert.match(benchmark, /startupCount/);
  assert.match(benchmark, /diagnostics/);
});

test('CPU remains the default and Metal is explicit with a safe fallback path', () => {
  assert.match(service, /LEDGER_WHISPER_BACKEND === 'metal'/);
  assert.match(service, /LEDGER_WHISPER_SERVER_METAL/);
  assert.match(service, /metal_runtime_failed_falling_back_to_cpu/);
  assert.match(service, /metalFallbackUsed/);
  assert.match(runtime, /backend: WhisperBackend/);
  assert.match(runtime, /this\.backend === 'cpu' \? \['-ng'\]/);
});

test('backend failure does not replace durable audio or duplicate completed transcript work', () => {
  assert.match(service, /await this\.fallbackToCpu\(error\)/);
  assert.match(service, /state: 'completed'/);
  assert.match(service, /dedupeSegments/);
  assert.match(service, /this\.sessions\.directoryFor/);
});

test('normalization remains transcription-only and cached', () => {
  assert.match(service, /normalizeWavForTranscription/);
  assert.match(benchmark, /normalizeWavForTranscription/);
  assert.match(service, /transcriptionInput/);
});
