import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

type ServerSegment = { text?: string; start?: number; end?: number; avg_logprob?: number; no_speech_prob?: number };

export type WhisperRuntimeResult = {
  segments: ServerSegment[];
  runtimeStartupMs: number;
  inferenceWallMs: number;
};

export type WhisperBackend = 'cpu' | 'metal';

const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

function requestTimeoutMs() {
  const configured = Number(process.env.LEDGER_WHISPER_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REQUEST_TIMEOUT_MS;
}

export class PersistentWhisperRuntime {
  private readonly executable: string;
  private readonly modelPath: string;
  private readonly log: (event: string, detail?: Record<string, unknown>) => void;
  private readonly backend: WhisperBackend;
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private readyPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private startupCountValue = 0;
  private totalStartupMsValue = 0;
  private lastStartupMsValue = 0;
  private healthy = false;

  constructor(executable: string, modelPath: string, log: (event: string, detail?: Record<string, unknown>) => void = () => {}, backend: WhisperBackend = 'cpu') {
    this.executable = executable;
    this.modelPath = modelPath;
    this.log = log;
    this.backend = backend;
  }

  get available() { return Boolean(this.executable && fs.existsSync(this.executable)); }
  stats() { return { backend: this.backend, executable: this.executable, startupCount: this.startupCountValue, totalStartupMs: this.totalStartupMsValue, lastStartupMs: this.lastStartupMsValue, healthy: this.healthy, port: this.port }; }

  async start() {
    if (this.healthy && this.process && !this.process.killed) return this.lastStartupMsValue;
    if (this.readyPromise) { await this.readyPromise; return this.lastStartupMsValue; }
    if (!this.available) throw new Error('The persistent Whisper runtime is not installed.');
    const startedAt = Date.now();
    const port = await findFreePort();
    this.port = port;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const backendArgs = this.backend === 'cpu' ? ['-ng'] : [];
      const child = spawn(this.executable, [...backendArgs, '-m', this.modelPath, '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.process = child;
      let diagnostics = '';
      let settled = false;
      const markReady = (source: 'port' | 'stdout') => {
        if (settled || this.process !== child) return;
        settled = true;
        this.healthy = true;
        this.lastStartupMsValue = Date.now() - startedAt;
        this.totalStartupMsValue += this.lastStartupMsValue;
        this.startupCountValue += 1;
        this.log('runtime_ready', { startupMs: this.lastStartupMsValue, startupCount: this.startupCountValue, source });
        resolve();
      };
      const failBeforeReady = (error: Error) => {
        if (settled) return;
        settled = true;
        this.healthy = false;
        this.readyPromise = null;
        reject(error);
      };
      const collect = (chunk: Buffer) => {
        diagnostics = `${diagnostics}${String(chunk)}`.slice(-4000);
        if (/whisper server listening at http:\/\/127\.0\.0\.1:/i.test(diagnostics)) markReady('stdout');
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('error', (error) => { failBeforeReady(error); });
      child.once('exit', (code, signal) => {
        const wasReady = this.healthy;
        this.healthy = false;
        this.readyPromise = null;
        this.process = null;
        if (!wasReady) failBeforeReady(new Error(diagnostics.trim() || `Whisper runtime exited with code ${code ?? signal ?? 'unknown'}.`));
        else this.log('runtime_exit', { code, signal });
      });
      void waitForTcpPort(port, 30_000).then(() => markReady('port'), failBeforeReady);
    });
    try { await this.readyPromise; return this.lastStartupMsValue; } finally { this.readyPromise = null; }
  }

  async transcribe(filePath: string): Promise<WhisperRuntimeResult> {
    let restarted = false;
    while (true) {
      let requestTimedOut = false;
      try {
        const runtimeStartupMs = await this.start();
        const startedAt = Date.now();
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'audio/wav' }), path.basename(filePath));
        form.append('response_format', 'verbose_json'); form.append('language', 'en'); form.append('temperature', '0'); form.append('temperature_inc', '0');
        this.abortController = new AbortController();
        const timeout = setTimeout(() => { requestTimedOut = true; this.abortController?.abort(); }, requestTimeoutMs());
        let response: Response;
        try {
          response = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form, signal: this.abortController.signal });
          if (!response.ok) throw new Error(`Whisper runtime returned HTTP ${response.status}.`);
          const payload = await response.json() as { segments?: ServerSegment[] };
          this.abortController = null;
          return { segments: Array.isArray(payload.segments) ? payload.segments : [], runtimeStartupMs, inferenceWallMs: Date.now() - startedAt };
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        this.abortController = null;
        const aborted = error instanceof Error && error.name === 'AbortError';
        if (aborted && requestTimedOut) {
          error = new Error(`Whisper runtime timed out after ${Math.round(requestTimeoutMs() / 1000)} seconds.`);
        } else if (aborted) {
          throw error;
        }
        this.log('runtime_request_failed', { backend: this.backend, error: error instanceof Error ? error.message : String(error), restarted });
        await this.stop();
        if (restarted) throw error;
        restarted = true;
      }
    }
  }

  cancelCurrent() { this.abortController?.abort(); }
  async stop() { this.cancelCurrent(); const child = this.process; this.process = null; this.healthy = false; this.readyPromise = null; if (child && !child.killed) child.kill('SIGTERM'); this.port = null; }
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; await new Promise<void>((resolve) => server.close(() => resolve())); if (!port) throw new Error('Could not allocate a loopback port for Whisper.'); return port;
}

async function waitForTcpPort(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  await new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        socket.destroy();
        if (error) {
          if (Date.now() >= deadline) reject(error);
          else setTimeout(attempt, 50);
        } else resolve();
      };
      socket.once('connect', () => finish());
      socket.once('error', (error) => finish(error));
      socket.setTimeout(Math.min(250, Math.max(1, deadline - Date.now())), () => finish(new Error('Whisper runtime did not start listening before the startup timeout.')));
    };
    attempt();
  });
}
