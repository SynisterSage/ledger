import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AskLedgerSource } from '../src/types/askLedgerContext.ts';
import { LocalAIAssetManager, resolveLocalAIRuntime, type GenerationTier } from './localAIAssets.ts';

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
  modelId?: string | (() => string);
  serverPath: string | (() => string);
  port: number;
  contextSize: number | (() => number);
  runtimeArgs?: string[] | (() => string[]);
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

  async isHealthy() {
    try {
      const response = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(750) });
      return response.ok;
    } catch {
      return false;
    }
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed);
  }

  async ensureReady() {
    this.clearIdleTimer();
    if (await this.isHealthy()) return { startupMs: 0, owned: this.ownedRuntime };
    if (this.startupPromise) return this.startupPromise;

    const startedAt = Date.now();
    this.startupPromise = new Promise<{ startupMs: number; owned: boolean }>((resolve, reject) => {
      const modelPath = typeof this.config.modelPath === 'function' ? this.config.modelPath() : this.config.modelPath;
      const modelId = typeof this.config.modelId === 'function' ? this.config.modelId() : this.config.modelId;
      const contextSize = typeof this.config.contextSize === 'function' ? this.config.contextSize() : this.config.contextSize;
      const runtimeArgs = typeof this.config.runtimeArgs === 'function' ? this.config.runtimeArgs() : this.config.runtimeArgs;
      const serverPath = typeof this.config.serverPath === 'function' ? this.config.serverPath() : this.config.serverPath;
      if (!modelPath || !fs.existsSync(modelPath)) {
        reject(new LocalAIError('model_missing', 'The configured local AI model was not found.'));
        return;
      }
      if (!serverPath || !fs.existsSync(serverPath) && !process.env.LEDGER_LLAMA_SERVER_PATH) {
        reject(new LocalAIError('llama_unavailable', 'The Ledger local AI runtime is not installed.'));
        return;
      }

      console.info('[local-ai] starting generation runtime', { selectedModelId: modelId, modelPath, installationState: 'installed' });

      const child = spawn(serverPath, [
        '--model', modelPath,
        '--host', '127.0.0.1',
        '--port', String(this.config.port),
        '--ctx-size', String(contextSize),
        '--jinja',
        '--reasoning', 'off',
        '--log-disable',
        ...(runtimeArgs ?? []),
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
          if (await this.isHealthy()) {
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
    if (!(await this.isHealthy())) callbacks.onEvent({ type: 'activity', requestId, activity: { type: 'starting_runtime' } });
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
  private runtime: LocalModelRuntime;
  private readonly runtimeFactory: (modelId: string) => LocalModelRuntime;
  private readonly assets: LocalAIAssetManager;
  private runtimeModelId: string;
  private loadedModelId: string | null = null;
  private switchPromise: Promise<GenerationModelSwitchResult> | null = null;
  private switchState: GenerationRuntimeState = { switching: false, targetTier: null, ready: false, failure: null };
  private readonly runtimeStateListeners = new Set<(state: GenerationRuntimeState) => void>();
  private readonly requests = new Map<string, { controller: AbortController; completion: Promise<void> }>();

  constructor(assets: LocalAIAssetManager, runtimeFactory: (modelId: string) => LocalModelRuntime) {
    this.assets = assets;
    this.runtimeFactory = runtimeFactory;
    this.runtimeModelId = assets.getSelectedGenerationModel().id;
    this.runtime = runtimeFactory(this.runtimeModelId);
  }

  start(request: LocalAIRequest, callbacks: StreamCallbacks, requestedRequestId: string = randomUUID()) {
    const requestId = requestedRequestId;
    const controller = new AbortController();
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    queueMicrotask(() => {
      void (async () => {
        if (this.switchPromise) await this.switchPromise;
        // Register only after a switch has settled. Registering beforehand
        // would make the switch wait for a request that is itself waiting for
        // the switch, deadlocking generation startup.
        this.requests.set(requestId, { controller, completion });
        await this.runtime.stream(request, callbacks, controller.signal, requestId);
        this.loadedModelId = this.runtimeModelId;
        this.switchState = { ...this.switchState, ready: true, failure: null };
      })()
        .catch((error) => {
          const localError = error instanceof LocalAIError
            ? error
            : new LocalAIError('runtime_exited', readErrorMessage(error), { cause: error });
          callbacks.onEvent({ type: 'error', requestId, error: { code: localError.code, message: localError.message } });
        })
        .finally(() => { this.requests.delete(requestId); resolveCompletion(); });
    });
    return requestId;
  }

  cancel(requestId: string) {
    this.requests.get(requestId)?.controller.abort();
    return { ok: true };
  }

  async shutdown() {
    for (const request of this.requests.values()) request.controller.abort();
    await Promise.all([...this.requests.values()].map((request) => request.completion));
    await this.runtime.shutdown();
  }

  getGenerationRuntimeState(): GenerationRuntimeState {
    const runtimeReady = typeof this.runtime.isRunning === 'function' ? this.runtime.isRunning() : this.switchState.ready;
    return {
      ...this.switchState,
      loadedTier: this.loadedModelId ? this.assets.generationModel(this.loadedModelId)?.tier ?? null : null,
      selectedTier: this.assets.getSelectedGenerationTier(),
      ready: this.switchState.ready && runtimeReady,
    };
  }

  onGenerationRuntimeState(listener: (state: GenerationRuntimeState) => void) {
    this.runtimeStateListeners.add(listener);
    return () => this.runtimeStateListeners.delete(listener);
  }

  private emitGenerationRuntimeState() {
    const state = this.getGenerationRuntimeState();
    this.runtimeStateListeners.forEach((listener) => listener(state));
  }

  switchGenerationTier(targetTier: unknown): Promise<GenerationModelSwitchResult> {
    if (targetTier !== 'fast' && targetTier !== 'balanced' && targetTier !== 'powerful') {
      return Promise.reject(new Error('Invalid generation tier.'));
    }
    if (this.switchPromise) return this.switchPromise;
    this.switchPromise = this.performGenerationSwitch(targetTier).finally(() => { this.switchPromise = null; });
    return this.switchPromise;
  }

  async removeGenerationModel(modelId: string) {
    const model = this.assets.generationModel(modelId);
    if (!model) throw new Error('Invalid generation model.');
    if (model.tier === 'fast') throw new Error('The Fast generation model is protected.');
    if (this.assets.getSelectedGenerationTier() === model.tier) {
      const fallback = await this.switchGenerationTier('fast');
      if (!fallback.ok) return { ok: false as const, state: 'fallback_failed' as const, fallback };
    }
    return { ok: true as const, status: await this.assets.removeGeneration(modelId) };
  }

  private async performGenerationSwitch(targetTier: GenerationTier): Promise<GenerationModelSwitchResult> {
    const target = this.assets.getAvailableGenerationModels().find((model) => model.tier === targetTier)!;
    const targetStatus = this.assets.getGenerationModelStatus(target.id);
    if (!targetStatus.installed) {
      const result: GenerationModelSwitchResult = { ok: false, state: 'requires_download', tier: targetTier, modelId: target.id, expectedSize: target.expectedSize };
      const currentReady = this.loadedModelId !== null && await this.runtime.isHealthy();
      this.switchState = { switching: false, targetTier: null, ready: currentReady, failure: result };
      this.emitGenerationRuntimeState();
      return result;
    }

    const currentTier = this.assets.getSelectedGenerationTier();
    if (currentTier === targetTier && this.loadedModelId === target.id && await this.runtime.isHealthy()) {
      const result: GenerationModelSwitchResult = { ok: true, state: 'noop', tier: targetTier, modelId: target.id };
      this.switchState = { switching: false, targetTier: null, ready: true, failure: null };
      this.emitGenerationRuntimeState();
      return result;
    }

    const previousModelId = this.loadedModelId;
    const startedAt = Date.now();
    this.switchState = { switching: true, targetTier, ready: false, failure: null };
    this.emitGenerationRuntimeState();
    console.info('[local-ai] generation model switch started', { requestedTier: targetTier, previousLoadedTier: previousModelId ? this.assets.generationModel(previousModelId)?.tier : null });
    let nextRuntime: LocalModelRuntime | null = null;
    try {
      const activeRequests = [...this.requests.values()];
      if (activeRequests.length) {
        console.info('[local-ai] cancelling active generation for model switch', { count: activeRequests.length });
        activeRequests.forEach(({ controller }) => controller.abort());
        await Promise.all(activeRequests.map((request) => request.completion));
      }
      const shutdownStartedAt = Date.now();
      await this.runtime.shutdown();
      console.info('[local-ai] generation runtime stopped for switch', { durationMs: Date.now() - shutdownStartedAt });
      nextRuntime = this.runtimeFactory(target.id);
      const startup = await nextRuntime.ensureReady();
      this.runtime = nextRuntime;
      this.runtimeModelId = target.id;
      this.loadedModelId = target.id;
      this.assets.setSelectedGenerationTier(targetTier);
      this.switchState = { switching: false, targetTier: null, ready: true, failure: null, selectedTier: targetTier, loadedTier: targetTier };
      this.emitGenerationRuntimeState();
      console.info('[local-ai] generation model switch ready', { requestedTier: targetTier, modelId: target.id, startupMs: startup.startupMs, totalMs: Date.now() - startedAt });
      return { ok: true, state: 'ready', tier: targetTier, modelId: target.id, startupMs: startup.startupMs };
    } catch (error) {
      const failure = { code: error instanceof LocalAIError ? error.code : 'runtime_start_failed', message: error instanceof Error ? error.message : String(error) };
      if (nextRuntime) await nextRuntime.shutdown().catch(() => undefined);
      this.loadedModelId = null;
      this.switchState = { switching: false, targetTier: null, ready: false, failure };
      this.emitGenerationRuntimeState();
      if (previousModelId) {
        try {
          const recoveryRuntime = this.runtimeFactory(previousModelId);
          await recoveryRuntime.ensureReady();
          this.runtime = recoveryRuntime;
          this.runtimeModelId = previousModelId;
          this.loadedModelId = previousModelId;
          this.switchState = { switching: false, targetTier: null, ready: true, failure };
          this.emitGenerationRuntimeState();
          console.info('[local-ai] recovered previous generation runtime after failed switch', { modelId: previousModelId });
        } catch (recoveryError) {
          console.warn('[local-ai] previous generation runtime recovery failed', { reason: recoveryError instanceof Error ? recoveryError.message : String(recoveryError) });
        }
      }
      console.warn('[local-ai] generation model switch failed', { requestedTier: targetTier, reason: failure.message, totalMs: Date.now() - startedAt });
      return { ok: false, state: 'failed', tier: targetTier, modelId: target.id, error: failure };
    }
  }
}

export type GenerationRuntimeState = {
  selectedTier?: GenerationTier;
  loadedTier?: GenerationTier | null;
  switching: boolean;
  targetTier: GenerationTier | null;
  ready: boolean;
  failure: unknown;
};

export type GenerationModelSwitchResult =
  | { ok: true; state: 'ready' | 'noop'; tier: GenerationTier; modelId: string; startupMs?: number }
  | { ok: false; state: 'requires_download'; tier: GenerationTier; modelId: string; expectedSize?: number }
  | { ok: false; state: 'failed'; tier: GenerationTier; modelId: string; error: { code: string; message: string } };

export const createLocalAIService = (assets = new LocalAIAssetManager()) => {
  const port = Number(process.env.LEDGER_LOCAL_AI_PORT || DEFAULT_PORT);
  const runtimeFactory = (modelId: string) => {
    const model = assets.generationModel(modelId);
    if (!model) throw new Error('Invalid generation model.');
    return new LocalModelRuntime({
      modelPath: () => assets.getGenerationModelPath(model.id),
      modelId: model.id,
      serverPath: () => resolveLocalAIRuntime() || process.env.LEDGER_LLAMA_SERVER_PATH?.trim() || '',
      port: Number.isFinite(port) ? port : DEFAULT_PORT,
      contextSize: model.contextSize ?? 4096,
      runtimeArgs: model.runtimeArgs ?? [],
      idleTimeoutMs: Number(process.env.LEDGER_LOCAL_AI_IDLE_MS || 300_000),
    });
  };
  return new LocalAIService(assets, runtimeFactory);
};
