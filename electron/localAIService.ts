import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AskLedgerSource } from '../src/types/askLedgerContext.ts';
import { LocalAIAssetManager, resolveLocalAIRuntime } from './localAIAssets.ts';

export type LocalAIErrorCode =
  | 'model_missing'
  | 'llama_unavailable'
  | 'runtime_start_failed'
  | 'model_load_failed'
  | 'runtime_exited'
  | 'request_timeout'
  | 'cancelled'
  | 'malformed_response'
  | 'retrieval_failed';

export class LocalAIError extends Error {
  readonly code: LocalAIErrorCode;

  constructor(code: LocalAIErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.code = code;
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = 'LocalAIError';
  }
}

export interface LocalAIRequest {
  question: string;
  context: string;
}

export interface LocalAIMetrics {
  startupMs?: number;
  firstTokenMs?: number;
  totalMs: number;
  tokensPerSecond?: number;
}

export type AskLedgerActivity =
  | { type: 'starting_runtime' }
  | { type: 'searching' }
  | { type: 'sources_found'; count: number; sources: AskLedgerSource[] }
  | { type: 'reading_context'; count: number; sources: AskLedgerSource[] }
  | { type: 'preparing_answer' }
  | { type: 'generating' };

export type AskLedgerSkillResult = {
  skillId: string;
  sections: Array<{ title: string; content: string }>;
  actionProposals: Array<{ id: string; type: string; payload: Record<string, unknown>; sourceMessageId: string }>;
};

export interface LocalAIStreamEvent {
  type: 'start' | 'activity' | 'sources' | 'delta' | 'done' | 'error';
  requestId: string;
  activity?: AskLedgerActivity;
  text?: string;
  sources?: AskLedgerSource[];
  error?: { code: LocalAIErrorCode; message: string };
  metrics?: LocalAIMetrics;
  skillResult?: AskLedgerSkillResult;
}

type StreamCallbacks = {
  onEvent: (event: LocalAIStreamEvent) => void;
};

type RuntimeConfig = {
  modelPath: string | (() => string);
  serverPath: string | (() => string);
  port: number;
  contextSize: number;
  idleTimeoutMs?: number;
};

const DEFAULT_PORT = 39281;
const REQUEST_TIMEOUT_MS = 90_000;

const readErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const partialTagAtEnd = (value: string, tag: string) => {
  const lower = value.toLowerCase();
  const lowerTag = tag.toLowerCase();
  for (let length = Math.min(lowerTag.length - 1, lower.length); length > 0; length -= 1) {
    if (lower.endsWith(lowerTag.slice(0, length))) return value.length - length;
  }
  return -1;
};

export class LocalModelRuntime {
  private child: ChildProcess | null = null;
  private startupPromise: Promise<{ startupMs: number; owned: boolean }> | null = null;
  private ownedRuntime = false;
  private idleTimer: NodeJS.Timeout | null = null;

  private readonly config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  private baseUrl() {
    return `http://127.0.0.1:${this.config.port}`;
  }

  private async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(750) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureReady() {
    this.clearIdleTimer();
    if (await this.healthCheck()) return { startupMs: 0, owned: this.ownedRuntime };
    if (this.startupPromise) return this.startupPromise;

    const startedAt = Date.now();
    this.startupPromise = new Promise<{ startupMs: number; owned: boolean }>((resolve, reject) => {
      const modelPath = typeof this.config.modelPath === 'function' ? this.config.modelPath() : this.config.modelPath;
      const serverPath = typeof this.config.serverPath === 'function' ? this.config.serverPath() : this.config.serverPath;
      if (!modelPath || !fs.existsSync(modelPath)) {
        reject(new LocalAIError('model_missing', 'The configured local AI model was not found.'));
        return;
      }
      if (!serverPath || !fs.existsSync(serverPath) && !process.env.LEDGER_LLAMA_SERVER_PATH) {
        reject(new LocalAIError('llama_unavailable', 'The Ledger local AI runtime is not installed.'));
        return;
      }

      const child = spawn(serverPath, [
        '--model', modelPath,
        '--host', '127.0.0.1',
        '--port', String(this.config.port),
        '--ctx-size', String(this.config.contextSize),
        '--jinja',
        '--reasoning', 'off',
        '--log-disable',
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      this.ownedRuntime = true;

      let diagnostics = '';
      const collectDiagnostics = (chunk: Buffer) => {
        diagnostics = `${diagnostics}${String(chunk)}`.slice(-4000);
      };
      child.stdout?.on('data', collectDiagnostics);
      child.stderr?.on('data', collectDiagnostics);
      child.once('error', (error) => {
        this.child = null;
        reject(new LocalAIError('llama_unavailable', 'llama-server could not be started.', { cause: error }));
      });
      child.once('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        if (code !== 0 && code !== null) {
          console.warn('[local-ai] llama-server exited', { code, signal, diagnostics });
        }
      });

      const waitForReady = async () => {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          if (await this.healthCheck()) {
            resolve({ startupMs: Date.now() - startedAt, owned: true });
            return;
          }
          if (!this.child) {
            reject(new LocalAIError('runtime_start_failed', 'Local AI runtime exited before it became ready.'));
            return;
          }
          await new Promise((waitResolve) => setTimeout(waitResolve, 250));
        }
        reject(new LocalAIError('runtime_start_failed', 'Local AI runtime did not become ready in time.'));
      };
      void waitForReady();
    }).finally(() => {
      this.startupPromise = null;
    });

    return this.startupPromise;
  }

  async stream(request: LocalAIRequest, callbacks: StreamCallbacks, signal: AbortSignal, requestId: string) {
    if (!(await this.healthCheck())) callbacks.onEvent({ type: 'activity', requestId, activity: { type: 'starting_runtime' } });
    const runtime = await this.ensureReady();
    callbacks.onEvent({ type: 'activity', requestId, activity: { type: 'generating' } });
    const startedAt = Date.now();
    let firstTokenMs: number | undefined;
    let generatedTokens = 0;
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        body: JSON.stringify({
          stream: true,
          temperature: 0.2,
          max_tokens: 256,
          messages: [{ role: 'user', content: request.context }],
        }),
      });
    } catch (error) {
      if (signal.aborted) throw new LocalAIError('cancelled', 'Generation cancelled.', { cause: error });
      throw new LocalAIError('request_timeout', 'Local AI did not respond in time.', { cause: error });
    }

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      const code: LocalAIErrorCode = response.status >= 500 ? 'model_load_failed' : 'malformed_response';
      throw new LocalAIError(code, body.slice(0, 300) || 'Local AI returned an invalid response.');
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let hidingReasoning = false;
    let reasoningTagBuffer = '';
    const removeReasoning = (rawText: string) => {
      let pending = `${reasoningTagBuffer}${rawText}`;
      reasoningTagBuffer = '';
      let visible = '';
      while (pending) {
        const tag = hidingReasoning ? '</think>' : '<think>';
        const index = pending.toLowerCase().indexOf(tag);
        if (index < 0) {
          const partialIndex = partialTagAtEnd(pending, tag);
          if (partialIndex >= 0) {
            if (!hidingReasoning) visible += pending.slice(0, partialIndex);
            reasoningTagBuffer = pending.slice(partialIndex);
          } else if (!hidingReasoning) {
            visible += pending;
          }
          break;
        }
        if (!hidingReasoning) visible += pending.slice(0, index);
        pending = pending.slice(index + tag.length);
        hidingReasoning = !hidingReasoning;
      }
      return visible;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        let parsed: { choices?: Array<{ delta?: { content?: unknown } }> };
        try {
          parsed = JSON.parse(data) as typeof parsed;
        } catch (error) {
          throw new LocalAIError('malformed_response', 'Local AI returned malformed streaming data.', { cause: error });
        }
        const rawText = parsed.choices?.[0]?.delta?.content;
        if (typeof rawText !== 'string' || !rawText) continue;
        const text = removeReasoning(rawText);
        if (!text) continue;
        if (firstTokenMs === undefined) firstTokenMs = Date.now() - startedAt;
        generatedTokens += text.trim().split(/\s+/).filter(Boolean).length;
        callbacks.onEvent({ type: 'delta', requestId, text });
      }
    }

    const totalMs = Date.now() - startedAt;
    callbacks.onEvent({
      type: 'done',
      requestId,
      metrics: {
        startupMs: runtime.startupMs || undefined,
        firstTokenMs,
        totalMs,
        tokensPerSecond: generatedTokens > 0 ? generatedTokens / (totalMs / 1000) : undefined,
      },
    });
    this.armIdleTimer();
  }

  async shutdown() {
    this.clearIdleTimer();
    if (!this.child || !this.ownedRuntime) return;
    const child = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  private clearIdleTimer() { if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = null; }
  private armIdleTimer() {
    this.clearIdleTimer();
    const timeout = this.config.idleTimeoutMs ?? 5 * 60 * 1000;
    if (timeout > 0) this.idleTimer = setTimeout(() => { void this.shutdown(); }, timeout);
  }
}

export class LocalAIService {
  private readonly runtime: LocalModelRuntime;
  private readonly requests = new Map<string, AbortController>();

  constructor(config: RuntimeConfig) {
    this.runtime = new LocalModelRuntime(config);
  }

  start(request: LocalAIRequest, callbacks: StreamCallbacks, requestedRequestId: string = randomUUID()) {
    const requestId = requestedRequestId;
    const controller = new AbortController();
    this.requests.set(requestId, controller);
    queueMicrotask(() => {
      void this.runtime.stream(request, callbacks, controller.signal, requestId)
        .catch((error) => {
          const localError = error instanceof LocalAIError
            ? error
            : new LocalAIError('runtime_exited', readErrorMessage(error), { cause: error });
          callbacks.onEvent({ type: 'error', requestId, error: { code: localError.code, message: localError.message } });
        })
        .finally(() => this.requests.delete(requestId));
    });
    return requestId;
  }

  cancel(requestId: string) {
    this.requests.get(requestId)?.abort();
    return { ok: true };
  }

  async shutdown() {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    await this.runtime.shutdown();
  }
}

export const createLocalAIService = (assets = new LocalAIAssetManager()) => {
  const port = Number(process.env.LEDGER_LOCAL_AI_PORT || DEFAULT_PORT);
  return new LocalAIService({
    modelPath: () => assets.pathFor('generation'),
    serverPath: () => resolveLocalAIRuntime() || process.env.LEDGER_LLAMA_SERVER_PATH?.trim() || '',
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    contextSize: 4096,
    idleTimeoutMs: Number(process.env.LEDGER_LOCAL_AI_IDLE_MS || 300_000),
  });
};
