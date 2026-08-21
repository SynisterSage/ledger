import { performance as nodePerformance } from 'node:perf_hooks';

export type AskLedgerPerformanceIdentifiers = {
  requestId: string;
  messageId?: string;
  skillId?: string;
  route?: string;
  retrievalMode?: string;
  generationDepth?: string;
  requestedTier?: string;
  loadedTier?: string | null;
  modelId?: string;
};

/** Monotonic, request-scoped diagnostics. Content is intentionally excluded. */
export class AskLedgerPerformanceTrace {
  readonly startedAt = nodePerformance.now();
  readonly startedWallMs = Date.now();
  private readonly marks = new Map<string, number>();
  private readonly values = new Map<string, unknown>();
  readonly identifiers: AskLedgerPerformanceIdentifiers;

  constructor(identifiers: AskLedgerPerformanceIdentifiers) { this.identifiers = identifiers; }

  mark(name: string) {
    const elapsedMs = nodePerformance.now() - this.startedAt;
    if (!this.marks.has(name)) this.marks.set(name, elapsedMs);
    return elapsedMs;
  }

  set(name: string, value: unknown) { this.values.set(name, value); }

  get(name: string) { return this.marks.get(name); }

  duration(start: string, end: string) {
    const startMs = this.marks.get(start);
    const endMs = this.marks.get(end);
    return startMs === undefined || endMs === undefined ? undefined : Math.max(0, endMs - startMs);
  }

  snapshot(extra: Record<string, unknown> = {}) {
    const marks = Object.fromEntries(this.marks);
    const durations = {
      routingMs: this.duration('routingStarted', 'routingCompleted'),
      indexingMs: this.duration('indexingStarted', 'indexingCompleted'),
      embeddingStartupMs: this.duration('embeddingRuntimeStart', 'embeddingRuntimeReady'),
      embeddingRuntimeStartupMs: this.duration('embeddingRuntimeStart', 'embeddingRuntimeReady'),
      retrievalMs: this.duration('retrievalStarted', 'retrievalCompleted'),
      evidenceBuildMs: this.duration('evidenceBuildStarted', 'evidenceBuildCompleted'),
      runtimeStartupMs: this.duration('generationRuntimeHealthCheck', 'generationRuntimeReady'),
      modelLoadMs: this.duration('generationRuntimeSpawned', 'generationRuntimeReady'),
      promptEvalMs: this.duration('promptRequestSent', 'firstTokenGenerated'),
      firstTokenMs: this.get('firstTokenGenerated'),
      firstModelDeltaMs: this.get('firstTokenGenerated'),
      lastModelDeltaMs: this.get('lastTokenGenerated'),
      doneMarkerMs: this.get('doneMarkerReceived'),
      bodyCloseMs: this.get('httpBodyClosed'),
      firstForwardedDeltaMs: this.get('firstDeltaForwarded'),
      generationMs: this.duration('firstTokenGenerated', 'generationCompleted'),
      streamCloseMs: this.duration('doneMarkerReceived', 'httpBodyClosed'),
      doneToCloseMs: this.duration('doneMarkerReceived', 'httpBodyClosed'),
      totalMs: nodePerformance.now() - this.startedAt,
    };
    return { ...this.identifiers, ...Object.fromEntries(this.values), marks, ...durations, ...extra };
  }
}

export const performanceWarning = (snapshot: Record<string, unknown>) => {
  const warnings: string[] = [];
  if (typeof snapshot.firstTokenMs === 'number' && snapshot.firstTokenMs > 15_000) warnings.push('first_token_over_15s');
  if (typeof snapshot.generationMs === 'number' && snapshot.generationMs > 60_000) warnings.push('generation_over_60s');
  if (typeof snapshot.tokensPerSecond === 'number' && snapshot.tokensPerSecond < 2) warnings.push('low_tokens_per_second');
  if (typeof snapshot.doneToCloseMs === 'number' && snapshot.doneToCloseMs > 3_000) warnings.push('done_to_close_over_3s');
  if (typeof snapshot.indexingMs === 'number' && snapshot.indexingMs > 10_000) warnings.push('indexing_over_10s');
  if (typeof snapshot.retrievalMs === 'number' && snapshot.retrievalMs > 10_000) warnings.push('retrieval_over_10s');
  return warnings;
};
