import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AskLedgerSource } from '../src/types/askLedgerContext.ts';
import type { AskLedgerAnswerValidationDiagnostics, AskLedgerDocumentDiagnostics } from '../src/types/askLedgerResourceContract.ts';
import { LEGACY_MINISTRAL_MODEL_ID, LEGACY_POWERFUL_MODEL_ID, LocalAIAssetManager, resolveLocalAIRuntime, resolveLocalAIRuntimeVersion, type GenerationTier } from './localAIAssets.ts';
import { applyQwenReasoningControl, resolveGenerationBudgets, resolveReasoningDecision, type ReasoningMode, type ReasoningRequestSignals } from './localAIReasoningPolicy.ts';
import { resolveAskLedgerModelRoute, type AskLedgerModelRoutingSignals, type AskLedgerModelRoute } from './askLedgerModelRouting.ts';
import type { AskLedgerPerformanceTrace } from './askLedgerPerformance.ts';

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
  generationBudget?: number;
  /** Mode-specific upper bound for the model HTTP stream. */
  timeoutMs?: number;
  reasoningSignals?: Omit<ReasoningRequestSignals, 'question'>;
  performance?: AskLedgerPerformanceTrace;
}

export interface LocalAIMetrics {
  startupMs?: number;
  firstTokenMs?: number;
  totalMs: number;
  tokensPerSecond?: number;
  generationBudget?: number;
  reasoningEnabled?: boolean;
  reasoningContentObserved?: boolean;
  visibleContentChars?: number;
  finishReason?: string | null;
  failureReason?: 'reasoning_budget_exhausted' | 'model_returned_empty_content' | 'stream_parser_failure';
  reasoningChunks?: number;
  contentChunks?: number;
  reasoningTokens?: number;
  reasoningDurationMs?: number;
  reasoningBudget?: number;
  visibleAnswerBudget?: number;
  predictedTokens?: number;
  serverTimings?: Record<string, unknown>;
  performance?: Record<string, unknown>;
}

export type AskLedgerActivity =
  | { type: 'starting_runtime' }
  | { type: 'searching' }
  | { type: 'sources_found'; count: number; sources: AskLedgerSource[] }
  | { type: 'reading_context'; count: number; sources: AskLedgerSource[] }
  | { type: 'preparing_answer' }
  | { type: 'reasoning' }
  | { type: 'generating' };

export type AskLedgerSkillResult = {
  skillId: string;
  sections: Array<{ title: string; content: string }>;
  actionProposals: Array<{ id: string; type: string; payload: Record<string, unknown>; sourceMessageId: string }>;
};

export interface LocalAIStreamEvent {
  type: 'start' | 'activity' | 'sources' | 'delta' | 'replace' | 'done' | 'error';
  requestId: string;
  activity?: AskLedgerActivity;
  text?: string;
  sources?: AskLedgerSource[];
  diagnostics?: AskLedgerDocumentDiagnostics;
  validation?: AskLedgerAnswerValidationDiagnostics;
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
  maxTokens?: number | (() => number);
  modelFamily?: string;
  modelTier?: GenerationTier;
  reasoningMode?: ReasoningMode;
  idleTimeoutMs?: number;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: { completion_tokens?: unknown; prompt_tokens?: unknown; total_tokens?: unknown };
  timings?: Record<string, unknown>;
};

export type ParsedThinkingStream = {
  visibleText: string;
  reasoningContentObserved: boolean;
  finishReason: string | null;
  reasoningChunks: number;
  contentChunks: number;
  reasoningTokens: number;
  predictedTokens?: number;
  serverTimings?: Record<string, unknown>;
  doneMarkerReceived?: boolean;
};

const DEFAULT_PORT = 39281;
const REQUEST_TIMEOUT_MS = 90_000;
export const DEFAULT_LOCAL_AI_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const readErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const parseRuntimeDiagnostics = (diagnostics: string) => {
  const lines = diagnostics.split('\n').map((line) => line.trim()).filter((line) => /metal|offload|backend|gpu|layer/i.test(line)).slice(-20);
  const metalConfirmed = /ggml[_ -]?metal|metal backend|using metal|ggml_metal_init|\[metal\]/i.test(diagnostics) ? true : undefined;
  const offloadMatch = diagnostics.match(/(?:offload(?:ed|ing)?|gpu\s+layers?)[^\d]{0,100}(\d+)(?:\s*\/\s*(\d+))?\s*layers?/i);
  const metalMemoryMiB = diagnostics.match(/MTL\d+[^|]*\|\s*\d+\s*=\s*\d+\s*\+\s*\(\s*([\d.]+)\s*=\s*([\d.]+)\s*\+\s*([\d.]+)\s*\+\s*([\d.]+)/i);
  const kvBufferMiB = diagnostics.match(/MTL\d+ KV buffer size\s*=\s*([\d.]+)\s*MiB/i);
  const cpuFallbackDetected = /cpu fallback|falling back to cpu|no gpu|offloaded\s+0\s*\/|offloaded\s+0\s+layers/i.test(diagnostics)
    ? true
    : offloadMatch && Number(offloadMatch[1]) > 0 ? false : undefined;
  return {
    metalConfirmed,
    gpuLayersOffloaded: offloadMatch ? offloadMatch[2] ? `${offloadMatch[1]}/${offloadMatch[2]}` : offloadMatch[1] : undefined,
    cpuFallbackDetected,
    metalMemoryMiB: metalMemoryMiB ? Number(metalMemoryMiB[1]) : undefined,
    modelBufferMiB: metalMemoryMiB ? Number(metalMemoryMiB[2]) : undefined,
    contextBufferMiB: metalMemoryMiB ? Number(metalMemoryMiB[3]) : undefined,
    computeBufferMiB: metalMemoryMiB ? Number(metalMemoryMiB[4]) : undefined,
    kvBufferMiB: kvBufferMiB ? Number(kvBufferMiB[1]) : undefined,
    runtimeDiagnosticLines: lines,
  };
};

const partialTagAtEnd = (value: string, tag: string) => {
  const lower = value.toLowerCase();
  const lowerTag = tag.toLowerCase();
  for (let length = Math.min(lowerTag.length - 1, lower.length); length > 0; length -= 1) {
    if (lower.endsWith(lowerTag.slice(0, length))) return value.length - length;
  }
  return -1;
};

export const parseThinkingChunk = (chunk: ChatCompletionChunk, state: ParsedThinkingStream): string => {
  const choice = chunk.choices?.[0];
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  if (finishReason) state.finishReason = finishReason;
  const reasoning = choice?.delta?.reasoning_content;
  if (typeof reasoning === 'string' && reasoning.length) {
    state.reasoningContentObserved = true;
    state.reasoningChunks += 1;
    state.reasoningTokens += reasoning.trim().split(/\s+/).filter(Boolean).length;
  }
  const content = choice?.delta?.content;
  if (typeof content === 'string' && content.length) state.contentChunks += 1;
  if (typeof chunk.usage?.completion_tokens === 'number') state.predictedTokens = chunk.usage.completion_tokens;
  if (chunk.timings) state.serverTimings = chunk.timings;
  if (typeof content !== 'string' || !content) return '';
  return content;
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

  async ensureReady(trace?: AskLedgerPerformanceTrace) {
    this.clearIdleTimer();
    trace?.mark('generationRuntimeHealthCheck');
    if (await this.isHealthy()) {
      trace?.set('generationRuntimeReused', true);
      trace?.set('modelWasAlreadyLoaded', true);
      trace?.mark('generationRuntimeReady');
      return { startupMs: 0, owned: this.ownedRuntime, reused: true };
    }
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

      const runtimeVersion = resolveLocalAIRuntimeVersion(serverPath);
      console.info('[local-ai] starting generation runtime', {
        runtimeVersion,
        selectedModelId: modelId,
        modelFamily: typeof modelId === 'string' ? modelId.startsWith('qwen3-') ? 'Qwen3' : modelId.startsWith('ministral-') ? 'Ministral 3' : 'unknown' : 'unknown',
        modelPath,
        installationState: 'installed',
      });

      const child = spawn(serverPath, [
        '--model', modelPath,
        '--host', '127.0.0.1',
        '--port', String(this.config.port),
        '--ctx-size', String(contextSize),
        '--jinja',
        ...(process.env.LEDGER_LLAMA_VERBOSE === '1' ? ['--verbosity', '4'] : []),
        ...(runtimeArgs ?? []),
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      this.ownedRuntime = true;
      trace?.mark('generationRuntimeSpawned');
      trace?.set('generationRuntimeReused', false);
      trace?.set('modelWasAlreadyLoaded', false);

      let diagnostics = '';
      let exitCode: number | null = null;
      let exitSignal: NodeJS.Signals | null = null;
      const collectDiagnostics = (chunk: Buffer) => {
        // Keep enough of the startup log to retain Metal/offload lines. The
        // runtime can print those before the final readiness lines.
        diagnostics = `${diagnostics}${String(chunk)}`.slice(-12000);
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
        exitCode = code;
        exitSignal = signal;
        if (code !== 0 && code !== null) {
          console.warn('[local-ai] llama-server exited', { code, signal, diagnostics });
        }
      });

      const waitForReady = async () => {
        const startupFailureMessage = () => {
          const detail = diagnostics.toLowerCase();
          if (/unsupported|unknown architecture|no model loader|invalid gguf|unknown model/.test(detail)) return 'The bundled Local AI runtime does not support this model architecture.';
          if (/out of memory|failed to allocate|cannot allocate|memory map|mmap/.test(detail)) return 'The model could not be loaded with the available memory.';
          const compactDiagnostics = diagnostics.replace(/\s+/g, ' ').trim();
          if (compactDiagnostics) return `Local AI runtime could not load the model: ${compactDiagnostics.slice(-420)}`;
          if (exitCode !== null || exitSignal) return `Local AI runtime exited before it became ready${exitCode !== null ? ` (code ${exitCode})` : ` (${exitSignal})`}.`;
          return 'Local AI runtime exited before it became ready.';
        };
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          if (await this.isHealthy()) {
            const runtimeDiagnostics = parseRuntimeDiagnostics(diagnostics);
            trace?.set('metalConfirmed', runtimeDiagnostics.metalConfirmed);
            trace?.set('gpuLayersOffloaded', runtimeDiagnostics.gpuLayersOffloaded ?? 'unknown_until_runtime_report');
            trace?.set('cpuFallbackDetected', runtimeDiagnostics.cpuFallbackDetected);
            for (const key of ['metalMemoryMiB', 'modelBufferMiB', 'contextBufferMiB', 'computeBufferMiB', 'kvBufferMiB'] as const) {
              trace?.set(key, runtimeDiagnostics[key]);
            }
            console.info('[local-ai] generation runtime diagnostics', runtimeDiagnostics);
            trace?.mark('generationRuntimeReady');
            resolve({ startupMs: Date.now() - startedAt, owned: true });
            return;
          }
          if (!this.child) {
            reject(new LocalAIError('runtime_start_failed', startupFailureMessage(), { cause: diagnostics || undefined }));
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
    const runtime = await this.ensureReady(request.performance);
    const reasoningDecision = resolveReasoningDecision(
      this.config.modelTier ?? 'fast',
      this.config.reasoningMode ?? 'off',
      { question: request.question, ...request.reasoningSignals },
    );
    console.info('[local-ai] reasoning policy', {
      modelTier: this.config.modelTier,
      modelFamily: this.config.modelFamily,
      reasoningMode: reasoningDecision.mode,
      reasoningEnabled: reasoningDecision.enabled,
      reason: reasoningDecision.reason,
    });
    callbacks.onEvent({ type: 'activity', requestId, activity: { type: reasoningDecision.enabled ? 'reasoning' : 'generating' } });
    const startedAt = Date.now();
    const configuredMaxTokens = request.generationBudget ?? (typeof this.config.maxTokens === 'function' ? this.config.maxTokens() : this.config.maxTokens);
    const contextSize = typeof this.config.contextSize === 'function' ? this.config.contextSize() : this.config.contextSize;
    const budgets = resolveGenerationBudgets(this.config.modelTier ?? 'fast', configuredMaxTokens, contextSize, { question: request.question, ...request.reasoningSignals }, reasoningDecision.enabled);
    const initialBudget = budgets.initial;
    const maxRetryBudget = budgets.retry;
    const reasoningPathActive = reasoningDecision.enabled;
    const prompt = applyQwenReasoningControl(this.config.modelFamily, reasoningDecision.enabled, request.context);
    const modelId = typeof this.config.modelId === 'function' ? this.config.modelId() : this.config.modelId;
    const runtimeArgs = typeof this.config.runtimeArgs === 'function' ? this.config.runtimeArgs() : this.config.runtimeArgs;
    const modelQuant = modelId?.match(/(q[468]_[a-z0-9]+|q8_0|q6_k)/i)?.[1]?.toUpperCase();
    request.performance?.set('modelId', modelId);
    request.performance?.set('loadedTier', this.config.modelTier);
    request.performance?.set('modelQuant', modelQuant);
    request.performance?.set('contextSize', contextSize);
    request.performance?.set('generationBudget', initialBudget);
    request.performance?.set('reasoningEnabled', reasoningDecision.enabled);
    request.performance?.set('reasoningMode', reasoningDecision.mode);
    request.performance?.set('reasoningReason', reasoningDecision.reason);
    request.performance?.set('reasoningBudget', budgets.reasoning);
    request.performance?.set('visibleAnswerBudget', budgets.visible);
    const metalRequested = process.platform === 'darwin' && Boolean(runtimeArgs?.includes('--n-gpu-layers'));
    request.performance?.set('gpuLayersRequested', runtimeArgs?.includes('--n-gpu-layers') ? runtimeArgs[runtimeArgs.indexOf('--n-gpu-layers') + 1] : undefined);
    request.performance?.set('metalRequested', metalRequested);
    request.performance?.set('backend', metalRequested ? 'metal_requested' : 'unknown');
    request.performance?.set('metalAvailable', process.platform === 'darwin');
    request.performance?.set('metalConfirmed', undefined);
    request.performance?.set('gpuLayersOffloaded', 'unknown_until_runtime_report');
    request.performance?.set('cpuFallbackDetected', undefined);

    const streamAttempt = async (generationBudget: number, allowVisibleDeltas: boolean) => {
      let firstTokenMs: number | undefined;
      let generatedTokens = 0;
      let response: Response;
      const timeoutSignal = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
      const requestSignal = AbortSignal.any([signal, timeoutSignal]);
      try {
        request.performance?.mark('promptRequestSent');
        response = await fetch(`${this.baseUrl()}/v1/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          signal: requestSignal,
          body: JSON.stringify({
            stream: true,
            // llama-server reuses the common KV prefix between requests. The
            // first request is unchanged; follow-ups can skip re-evaluating
            // the stable Ask Ledger instructions and style contract.
            cache_prompt: true,
            max_tokens: generationBudget,
            n_predict: generationBudget,
            temperature: 0.2,
            top_p: 0.95,
            top_k: 40,
            min_p: 0.05,
            ...(reasoningPathActive ? { reasoning_budget: budgets.reasoning } : {}),
            ...(this.config.modelFamily === 'Qwen3' && reasoningPathActive ? { reasoning_format: 'deepseek' } : {}),
            messages: [{ role: 'user', content: prompt }],
          }),
        });
      } catch (error) {
        if (signal.aborted) {
          request.performance?.mark('fetchAborted');
          throw new LocalAIError('cancelled', 'Generation cancelled.', { cause: error });
        }
        if (timeoutSignal.aborted) throw new LocalAIError('request_timeout', 'Local AI did not respond in time.', { cause: error });
        throw new LocalAIError('request_timeout', 'Local AI did not respond in time.', { cause: error });
      }
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        const code: LocalAIErrorCode = response.status >= 500 ? 'model_load_failed' : 'malformed_response';
        throw new LocalAIError(code, body.slice(0, 300) || 'Local AI returned an invalid response.');
      }
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      const cancelReader = () => { void reader.cancel().catch(() => undefined); };
      if (requestSignal.aborted) cancelReader();
      else requestSignal.addEventListener('abort', cancelReader, { once: true });
      const state: ParsedThinkingStream = { visibleText: '', reasoningContentObserved: false, finishReason: null, reasoningChunks: 0, contentChunks: 0, reasoningTokens: 0 };
      let buffer = '';
      let hidingReasoning = false;
      let reasoningTagBuffer = '';
      const emitContent = (rawText: string) => {
        let pending = `${reasoningTagBuffer}${rawText}`;
        reasoningTagBuffer = '';
        let visible = '';
        while (pending) {
          const tag = hidingReasoning ? '</think>' : '<think>';
          const index = pending.toLowerCase().indexOf(tag);
          if (index < 0) {
            const partialIndex = partialTagAtEnd(pending, tag);
            if (partialIndex >= 0) { if (!hidingReasoning) visible += pending.slice(0, partialIndex); reasoningTagBuffer = pending.slice(partialIndex); }
            else if (!hidingReasoning) visible += pending;
            break;
          }
          if (!hidingReasoning) visible += pending.slice(0, index);
          else state.reasoningContentObserved = true;
          pending = pending.slice(index + tag.length);
          hidingReasoning = !hidingReasoning;
          if (hidingReasoning) state.reasoningContentObserved = true;
        }
        return visible;
      };
      let responseByteMarked = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (signal.aborted) throw new LocalAIError('cancelled', 'Generation cancelled.');
          if (timeoutSignal.aborted) throw new LocalAIError('request_timeout', 'Local AI did not respond in time.');
          if (done) break;
          if (!responseByteMarked) {
            responseByteMarked = true;
            request.performance?.mark('firstResponseByte');
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim(); if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              state.doneMarkerReceived = true;
              request.performance?.mark('doneMarkerReceived');
              continue;
            }
            let parsed: ChatCompletionChunk;
            try { parsed = JSON.parse(data) as ChatCompletionChunk; }
            catch (error) { throw new LocalAIError('malformed_response', 'Local AI returned malformed streaming data.', { cause: error }); }
            const rawText = parseThinkingChunk(parsed, state);
            const text = emitContent(rawText);
            if (!text) continue;
            state.visibleText += text;
            if (!allowVisibleDeltas) continue;
            if (firstTokenMs === undefined) {
              firstTokenMs = Date.now() - startedAt;
              request.performance?.mark('firstTokenGenerated');
            }
            request.performance?.mark('lastTokenGenerated');
            generatedTokens += text.trim().split(/\s+/).filter(Boolean).length;
            callbacks.onEvent({ type: 'delta', requestId, text });
          }
        }
      } catch (error) {
        if (signal.aborted) throw new LocalAIError('cancelled', 'Generation cancelled.', { cause: error });
        if (timeoutSignal.aborted) throw new LocalAIError('request_timeout', 'Local AI did not respond in time.', { cause: error });
        throw error;
      } finally {
        requestSignal.removeEventListener('abort', cancelReader);
        if (requestSignal.aborted) cancelReader();
      }
      request.performance?.mark('httpBodyClosed');
      return { state, firstTokenMs, generatedTokens, totalMs: Date.now() - startedAt };
    };

    let attempt = await streamAttempt(initialBudget, true);
    const shouldRetry = reasoningPathActive && this.config.modelTier !== 'fast' && attempt.state.visibleText.trim().length === 0
      && attempt.state.reasoningContentObserved && attempt.state.finishReason === 'length' && maxRetryBudget > initialBudget;
    if (shouldRetry) {
      console.warn('[local-ai] reasoning budget exhausted; retrying once', { modelTier: this.config.modelTier, generationBudget: initialBudget, retryBudget: maxRetryBudget });
      attempt = await streamAttempt(maxRetryBudget, true);
    }
    const failureReason = attempt.state.visibleText.trim().length === 0
      ? reasoningPathActive && attempt.state.reasoningContentObserved && attempt.state.finishReason === 'length'
        ? 'reasoning_budget_exhausted' as const
        : attempt.state.contentChunks > 0
          ? 'stream_parser_failure' as const
          : 'model_returned_empty_content' as const
      : undefined;
    console.info('[local-ai] generation diagnostics', {
      modelTier: this.config.modelTier,
      modelId,
      reasoningEnabled: reasoningDecision.enabled,
      reasoningMode: reasoningDecision.mode,
      reasoningReason: reasoningDecision.reason,
      reasoningBudget: budgets.reasoning,
      visibleAnswerBudget: budgets.visible,
      reasoningFormat: this.config.modelFamily === 'Qwen3' ? 'deepseek' : undefined,
      generationBudget: shouldRetry ? maxRetryBudget : initialBudget,
      contextSize,
      temperature: 0.2,
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      stream: true,
      reasoningContentObserved: attempt.state.reasoningContentObserved,
      reasoningChunks: attempt.state.reasoningChunks,
      reasoningTokens: attempt.state.reasoningTokens,
      contentChunks: attempt.state.contentChunks,
      visibleContentChars: attempt.state.visibleText.length,
      finishReason: attempt.state.finishReason,
      predictedTokens: attempt.state.predictedTokens,
      serverTimings: attempt.state.serverTimings,
      ...(failureReason ? { failureReason } : {}),
    });
    const serverTimings = attempt.state.serverTimings;
    if (typeof serverTimings?.prompt_n === 'number') {
      const cacheTokens = typeof serverTimings.cache_n === 'number' ? serverTimings.cache_n : 0;
      request.performance?.set('promptTokens', serverTimings.prompt_n + cacheTokens);
      request.performance?.set('promptCacheTokens', cacheTokens);
    }
    if (typeof serverTimings?.prompt_per_second === 'number') request.performance?.set('promptTokensPerSecond', serverTimings.prompt_per_second);
    if (typeof serverTimings?.predicted_per_second === 'number') request.performance?.set('serverReportedTokensPerSecond', serverTimings.predicted_per_second);
    if (typeof serverTimings?.predicted_ms === 'number') request.performance?.set('serverGenerationMs', serverTimings.predicted_ms);
    request.performance?.mark('generationCompleted');
    callbacks.onEvent({ type: 'done', requestId, metrics: {
      startupMs: runtime.startupMs || undefined, firstTokenMs: attempt.firstTokenMs, totalMs: attempt.totalMs,
      tokensPerSecond: attempt.generatedTokens > 0 ? attempt.generatedTokens / (attempt.totalMs / 1000) : undefined,
      generationBudget: shouldRetry ? maxRetryBudget : initialBudget, reasoningEnabled: reasoningDecision.enabled,
      reasoningContentObserved: attempt.state.reasoningContentObserved, visibleContentChars: attempt.state.visibleText.length,
      finishReason: attempt.state.finishReason, failureReason, reasoningChunks: attempt.state.reasoningChunks,
      contentChunks: attempt.state.contentChunks, reasoningTokens: attempt.state.reasoningTokens,
      predictedTokens: attempt.state.predictedTokens, serverTimings: attempt.state.serverTimings,
      performance: request.performance?.snapshot({
        generatedTokens: attempt.state.predictedTokens ?? attempt.generatedTokens,
        generationBudget: shouldRetry ? maxRetryBudget : initialBudget,
        tokensPerSecond: attempt.generatedTokens > 0 ? attempt.generatedTokens / (attempt.totalMs / 1000) : undefined,
        finishReason: attempt.state.finishReason,
        doneMarkerReceived: attempt.state.doneMarkerReceived === true,
      }),
    } });
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
    const timeout = this.config.idleTimeoutMs ?? DEFAULT_LOCAL_AI_IDLE_TIMEOUT_MS;
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
  private readonly requests = new Map<string, { controller: AbortController; completion: Promise<void>; performance?: AskLedgerPerformanceTrace; started: boolean }>();

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
    const requestState = { controller, completion, performance: request.performance, started: false };
    this.requests.set(requestId, requestState);
    queueMicrotask(() => {
      void (async () => {
        if (this.switchPromise) await this.switchPromise;
        if (controller.signal.aborted) throw new LocalAIError('cancelled', 'Generation cancelled.');
        requestState.started = true;
        await this.runtime.stream(request, callbacks, controller.signal, requestId);
        this.loadedModelId = this.runtimeModelId;
        this.switchState = { ...this.switchState, ready: true, failure: null };
      })()
      .catch((error) => {
          const localError = controller.signal.aborted
            ? new LocalAIError('cancelled', 'Generation cancelled.', { cause: error })
            : error instanceof LocalAIError
            ? error
            : new LocalAIError('runtime_exited', readErrorMessage(error), { cause: error });
          if (localError.code === 'cancelled') request.performance?.mark('fetchAborted');
          callbacks.onEvent({ type: 'error', requestId, error: { code: localError.code, message: localError.message } });
        })
        .finally(() => { if (controller.signal.aborted) request.performance?.mark('generationStopped'); this.requests.delete(requestId); resolveCompletion(); });
    });
    return requestId;
  }

  cancel(requestId: string) {
    const request = this.requests.get(requestId);
    request?.performance?.mark('cancelRequestedAt');
    request?.performance?.set('requestIdAvailable', true);
    request?.controller.abort();
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

  getSelectedGenerationTier(): GenerationTier {
    return this.assets.getSelectedGenerationTier();
  }

  getRequestedGenerationTier(): GenerationTier {
    return this.assets.getRequestedGenerationTier();
  }

  getMeetingRecapGenerationTier(): 'balanced' | 'fast' {
    const balanced = this.assets.getAvailableGenerationModels().find((model) => model.tier === 'balanced');
    return balanced && this.assets.getGenerationModelStatus(balanced.id).installed ? 'balanced' : 'fast';
  }

  getModelRouting(signals: AskLedgerModelRoutingSignals): AskLedgerModelRoute {
    const requestedTier = this.assets.getGenerationTierResolution?.().requestedTier ?? this.assets.getSelectedGenerationTier();
    const installedTiers = this.assets.getAvailableGenerationModels()
      .filter((model) => this.assets.getGenerationModelStatus(model.id).installed)
      .map((model) => model.tier);
    return resolveAskLedgerModelRoute({ requestedTier, installedTiers, signals });
  }

  onGenerationRuntimeState(listener: (state: GenerationRuntimeState) => void) {
    this.runtimeStateListeners.add(listener);
    return () => this.runtimeStateListeners.delete(listener);
  }

  private emitGenerationRuntimeState() {
    const state = this.getGenerationRuntimeState();
    this.runtimeStateListeners.forEach((listener) => listener(state));
  }

  switchGenerationTier(targetTier: unknown, options: { persistSelection?: boolean } = {}): Promise<GenerationModelSwitchResult> {
    if (targetTier !== 'fast' && targetTier !== 'balanced' && targetTier !== 'powerful') {
      return Promise.reject(new Error('Invalid generation tier.'));
    }
    const normalizedTargetTier: GenerationTier = targetTier === 'powerful' ? 'balanced' : targetTier;
    // Queue a later request behind the active switch instead of returning the
    // earlier request's result. This keeps rapid Balanced -> Fast interactions
    // deterministic: every requested target is handled, and the last request
    // becomes the final loaded/persisted tier.
    if (this.switchPromise) {
      console.info('[local-ai] generation model switch queued', { requestedTier: normalizedTargetTier });
      const activeSwitch = this.switchPromise;
      const queuedSwitch = activeSwitch.then(() => this.performGenerationSwitch(normalizedTargetTier, options.persistSelection !== false));
      let trackedSwitch!: Promise<GenerationModelSwitchResult>;
      trackedSwitch = queuedSwitch.finally(() => { if (this.switchPromise === trackedSwitch) this.switchPromise = null; });
      this.switchPromise = trackedSwitch;
      return trackedSwitch;
    }
    this.switchPromise = this.performGenerationSwitch(normalizedTargetTier, options.persistSelection !== false).finally(() => { if (this.switchPromise) this.switchPromise = null; });
    return this.switchPromise;
  }

  async removeGenerationModel(modelId: string) {
    const model = this.assets.generationModel(modelId);
    if (!model) {
      if (modelId === LEGACY_POWERFUL_MODEL_ID || modelId === LEGACY_MINISTRAL_MODEL_ID) return { ok: true as const, state: 'legacy_removed' as const, status: this.assets.removeLegacyGenerationModel(modelId) };
      throw new Error('Invalid generation model.');
    }
    if (model.tier === 'fast') throw new Error('The Fast generation model is protected.');
    if (this.assets.getSelectedGenerationTier() === model.tier) {
      const fallback = await this.switchGenerationTier('fast');
      if (!fallback.ok) return { ok: false as const, state: 'fallback_failed' as const, fallback };
    }
    return { ok: true as const, status: await this.assets.removeGeneration(modelId) };
  }

  private async performGenerationSwitch(targetTier: GenerationTier, persistSelection = true): Promise<GenerationModelSwitchResult> {
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
      const activeRequests = [...this.requests.values()].filter((request) => request.started);
      const pendingRequests = [...this.requests.values()].filter((request) => !request.started);
      pendingRequests.forEach(({ controller }) => controller.abort());
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
      if (persistSelection) this.assets.setSelectedGenerationTier(targetTier);
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

export const createLocalAIService = (assets = new LocalAIAssetManager(), overrides: { contextSize?: number; runtimeArgs?: string[] } = {}) => {
  // Dev Electron restarts can leave an older llama-server alive on the
  // default port. Reusing it silently preserves its old --ctx-size and makes
  // the new runtime configuration ineffective. Use a process-scoped port by
  // default; explicit ports remain available for packaged/integration setups.
  const configuredPort = process.env.LEDGER_LOCAL_AI_PORT ? Number(process.env.LEDGER_LOCAL_AI_PORT) : undefined;
  const port = configuredPort ?? DEFAULT_PORT + (process.pid % 1000);
  const runtimeFactory = (modelId: string) => {
    const model = assets.generationModel(modelId);
    if (!model) throw new Error('Invalid generation model.');
    return new LocalModelRuntime({
      modelPath: () => assets.getGenerationModelPath(model.id),
      modelId: model.id,
      modelFamily: model.modelFamily,
      modelTier: model.tier,
      reasoningMode: model.tier === 'balanced' ? 'auto' : model.reasoningMode,
      serverPath: () => resolveLocalAIRuntime() || process.env.LEDGER_LLAMA_SERVER_PATH?.trim() || '',
      port: Number.isFinite(port) ? port : DEFAULT_PORT,
      contextSize: overrides.contextSize ?? model.contextSize ?? 4096,
      runtimeArgs: overrides.runtimeArgs ?? model.runtimeArgs ?? [],
      maxTokens: model.maxTokens ?? 256,
      idleTimeoutMs: Number(process.env.LEDGER_LOCAL_AI_IDLE_MS || DEFAULT_LOCAL_AI_IDLE_TIMEOUT_MS),
    });
  };
  return new LocalAIService(assets, runtimeFactory);
};
