import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { LocalAIAssetManager, resolveLocalAIRuntime } from './localAIAssets.ts';
import { detectAskLedgerQueryIntent, resourceTypesForAskLedgerIntent } from './askLedgerQueryIntent.ts';

export type LedgerIndexDocument = AskLedgerContextItem & {
  workspaceId: string;
  chunkId: string;
  conversationId?: string;
  contentHash: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  embedding?: number[];
};

export type LexicalCandidate = {
  type?: string;
  id?: string;
  title?: string;
  preview?: string;
  score?: number;
  match_source?: string | null;
  route?: unknown;
  updated_at?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  source_label?: string | null;
};

export type RetrievalDebugCandidate = {
  resourceType: string;
  resourceId: string;
  title: string;
  why: string[];
  score: number;
};

export type LedgerRetrievalResult = {
  items: AskLedgerContextItem[];
  debug: RetrievalDebugCandidate[];
};

export interface EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  embed(texts: string[]): Promise<number[][]>;
  shutdown?(): Promise<void>;
}

export const formatEmbeddingInput = (text: string, mode: 'query' | 'document', model = '') =>
  /nomic[-_ ]?embed/i.test(model)
    ? `${mode === 'query' ? 'search_query' : 'search_document'}: ${text}`
    : text;

export class EmbeddingUnavailableError extends Error {
  constructor(message = 'A local embedding provider is not configured.') {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL?.trim()
    || (process.env.LEDGER_LOCAL_AI_EMBEDDING_URL?.match(/nomic[-_a-z0-9.]*embed[-_a-z0-9.]*/i)?.[0] ?? 'configured-local-embedding-model');
  readonly version = process.env.LEDGER_LOCAL_AI_EMBEDDING_VERSION?.trim() || '1';
  // The manifest URL is a model download source, not an embeddings API.
  // An API endpoint is only useful for an explicit development override.
  private readonly endpoint = process.env.LEDGER_LOCAL_AI_EMBEDDING_ENDPOINT?.trim() || '';
  private readonly modelPath = process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL_PATH?.trim() || '';
  private readonly port = Number(process.env.LEDGER_LOCAL_AI_EMBEDDING_PORT || 39282);
  private child: ChildProcess | null = null;
  private startupPromise: Promise<string> | null = null;

  private readonly assets?: LocalAIAssetManager;

  constructor(assets?: LocalAIAssetManager) { this.assets = assets; }

  private baseUrl() {
    return this.endpoint || `http://127.0.0.1:${Number.isFinite(this.port) ? this.port : 39282}`;
  }

  private async ensureReady() {
    if (this.endpoint) return this.endpoint;
    if (this.startupPromise) return this.startupPromise;
    this.startupPromise = (async () => {
      const url = this.baseUrl();
      try {
        if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) })).ok) return url;
      } catch {}
      const modelPath = this.modelPath || this.assets?.pathFor('embedding') || '';
      const serverPath = resolveLocalAIRuntime() || process.env.LEDGER_LLAMA_SERVER_PATH?.trim() || '';
      if (!modelPath || !fs.existsSync(modelPath)) throw new EmbeddingUnavailableError('The Ledger semantic-search model is not installed.');
      if (!serverPath || !fs.existsSync(serverPath)) throw new EmbeddingUnavailableError('The Ledger local AI runtime is not installed.');
      this.child = spawn(serverPath, [
        '--model', path.resolve(modelPath),
        '--host', '127.0.0.1',
        '--port', String(Number.isFinite(this.port) ? this.port : 39282),
        '--ctx-size', '2048',
        '--embedding',
        '--pooling', 'mean',
        '--log-disable',
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      this.child.stderr?.on('data', (chunk) => console.warn('[local-embedding]', String(chunk).trim().slice(-500)));
      this.child.once('error', () => { this.child = null; });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(750) })).ok) return url;
        } catch {}
        if (!this.child) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new EmbeddingUnavailableError('Local embedding runtime did not become ready.');
    })().finally(() => { this.startupPromise = null; });
    return this.startupPromise;
  }

  async embed(texts: string[]) {
    const endpoint = await this.ensureReady();
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new EmbeddingUnavailableError(`Local embedding provider returned ${response.status}.`);
    const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vectors = (payload.data ?? []).map((row) => Array.isArray(row.embedding) ? row.embedding.filter((value): value is number => typeof value === 'number') : []);
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) throw new EmbeddingUnavailableError('Local embedding provider returned malformed vectors.');
    return vectors;
  }

  async shutdown() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

const clean = (value: unknown) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenize = (value: string) => new Set(clean(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1));

const chunkContent = (item: AskLedgerContextItem) => {
  const content = clean(item.content);
  const headingParts = content.split(/(?=\b(?:Decision|Status|Blocker|Next action|Discussion|Summary|Notes?):\s)/i).map((part) => part.trim()).filter(Boolean);
  const parts = headingParts.length > 1 ? headingParts : content.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
  const maxCharacters = item.resourceType === 'transcript' ? 900 : 1200;
  const chunks: string[] = [];
  let current = '';
  for (const part of parts.length ? parts : [content]) {
    if (!current) { current = part; continue; }
    if ((current.length + part.length + 1) <= maxCharacters) current = `${current} ${part}`;
    else { chunks.push(current); current = part; }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
};

export class EmbeddingIndexService {
  private readonly workspaces = new Map<string, Map<string, LedgerIndexDocument>>();
  private readonly conversations = new Map<string, Map<string, LedgerIndexDocument>>();
  private readonly provider?: EmbeddingProvider;

  constructor(provider?: EmbeddingProvider) {
    this.provider = provider;
  }

  async replaceWorkspace(workspaceId: string, items: AskLedgerContextItem[]) {
    const existing = this.workspaces.get(workspaceId) ?? new Map<string, LedgerIndexDocument>();
    const next = new Map<string, LedgerIndexDocument>();
    const pending: Array<{ key: string; document: LedgerIndexDocument }> = [];

    for (const item of items) {
      if (item.resourceType === 'attachment' || (item.workspaceId && item.workspaceId !== workspaceId)) continue;
      for (const [chunkIndex, content] of chunkContent(item).entries()) {
        const chunkId = `${item.resourceType}:${item.resourceId}:${chunkIndex}`;
        const contentHash = hash(`${item.title}\n${content}\n${item.updatedAt ?? ''}`);
        const key = `${workspaceId}:${chunkId}`;
        const previous = existing.get(key);
        const document: LedgerIndexDocument = { ...item, workspaceId, chunkId, content, contentHash };
        if (previous?.contentHash === contentHash && previous.embedding && previous.embeddingModel === this.provider?.model && previous.embeddingVersion === this.provider?.version) {
          document.embedding = previous.embedding;
          document.embeddingModel = previous.embeddingModel;
          document.embeddingVersion = previous.embeddingVersion;
        } else if (this.provider) {
          pending.push({ key, document });
        }
        next.set(key, document);
      }
    }

    if (this.provider && pending.length) {
      try {
        const vectors = await this.provider.embed(pending.map(({ document }) => formatEmbeddingInput(`${document.title}\n${document.content}`, 'document', this.provider?.model)));
        pending.forEach(({ key, document }, index) => {
          document.embedding = vectors[index];
          document.embeddingModel = this.provider?.model;
          document.embeddingVersion = this.provider?.version;
          next.set(key, document);
        });
      } catch (error) {
        console.warn('[local-embedding] Semantic index unavailable; continuing with lexical retrieval.', error instanceof Error ? error.message : error);
      }
    }
    this.workspaces.set(workspaceId, next);
    return { indexed: next.size, embedded: pending.length, removed: Math.max(0, existing.size - next.size) };
  }

  async replaceConversation(conversationId: string, workspaceId: string, items: AskLedgerContextItem[]) {
    const existing = this.conversations.get(conversationId) ?? new Map<string, LedgerIndexDocument>();
    const next = new Map(existing);
    const pending: Array<{ key: string; document: LedgerIndexDocument }> = [];
    for (const item of items) {
      if (item.resourceType !== 'attachment') continue;
      const chunkId = `${item.resourceType}:${item.resourceId}`;
      const contentHash = hash(`${item.title}\n${item.content}`);
      const key = `${conversationId}:${chunkId}`;
      const previous = existing.get(key);
      const document: LedgerIndexDocument = { ...item, workspaceId, conversationId, chunkId, contentHash };
      if (previous?.contentHash === contentHash && previous.embedding && previous.embeddingModel === this.provider?.model && previous.embeddingVersion === this.provider?.version) {
        document.embedding = previous.embedding;
        document.embeddingModel = previous.embeddingModel;
        document.embeddingVersion = previous.embeddingVersion;
      } else if (this.provider) pending.push({ key, document });
      next.set(key, document);
    }
    if (this.provider && pending.length) {
      try {
        const vectors = await this.provider.embed(pending.map(({ document }) => formatEmbeddingInput(`${document.title}\n${document.content}`, 'document', this.provider?.model)));
        pending.forEach(({ key, document }, index) => { document.embedding = vectors[index]; document.embeddingModel = this.provider?.model; document.embeddingVersion = this.provider?.version; next.set(key, document); });
      } catch (error) {
        console.warn('[local-embedding] Attachment semantic index unavailable; continuing with lexical retrieval.', error instanceof Error ? error.message : error);
      }
    }
    this.conversations.set(conversationId, next);
    return { indexed: next.size, embedded: pending.length, removed: Math.max(0, existing.size - next.size) };
  }

  deleteWorkspace(workspaceId: string) {
    this.workspaces.delete(workspaceId);
  }

  deleteConversation(conversationId: string, attachmentIds?: string[]) {
    if (!attachmentIds?.length) { this.conversations.delete(conversationId); return; }
    const current = this.conversations.get(conversationId);
    if (!current) return;
    for (const key of [...current.keys()]) if (attachmentIds.some((id) => key.includes(`attachment:${id}:`))) current.delete(key);
  }

  documents(workspaceId: string, conversationId?: string) {
    return [...(this.workspaces.get(workspaceId)?.values() ?? []), ...(conversationId ? [...(this.conversations.get(conversationId)?.values() ?? [])].filter((document) => document.workspaceId === workspaceId) : [])];
  }

  async shutdown() {
    await this.provider?.shutdown?.();
  }
}

const cosineSimilarity = (left: number[], right: number[]) => {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)) : 0;
};

export class LedgerRetrievalService {
  private readonly index: EmbeddingIndexService;
  private readonly provider?: EmbeddingProvider;

  constructor(
    index: EmbeddingIndexService,
    provider?: EmbeddingProvider,
  ) {
    this.index = index;
    this.provider = provider;
  }

  indexWorkspace(workspaceId: string, items: AskLedgerContextItem[]) {
    return this.index.replaceWorkspace(workspaceId, items);
  }

  indexAttachments(conversationId: string, workspaceId: string, items: AskLedgerContextItem[]) {
    return this.index.replaceConversation(conversationId, workspaceId, items);
  }

  deleteAttachments(conversationId: string, attachmentIds?: string[]) { this.index.deleteConversation(conversationId, attachmentIds); }

  async shutdown() {
    await this.index.shutdown();
  }

  async retrieve(workspaceId: string, question: string, lexicalResults: LexicalCandidate[] = [], limit = 8, options?: { boostResourceKeys?: string[]; conversationId?: string }): Promise<LedgerRetrievalResult> {
    const documents = this.index.documents(workspaceId, options?.conversationId).filter((document) => document.workspaceId === workspaceId);
    const lexicalByResource = new Map(lexicalResults.map((result, position) => [`${result.type}:${result.id}`, { result, position }]));
    let queryVector: number[] | undefined;
    if (this.provider && documents.some((document) => document.embedding)) {
      try { queryVector = (await this.provider.embed([formatEmbeddingInput(question, 'query', this.provider.model)]))[0]; } catch { queryVector = undefined; }
    }
    const questionTokens = tokenize(question);
    const intent = detectAskLedgerQueryIntent(question);
    const allowedResourceTypes = resourceTypesForAskLedgerIntent(intent);
    const rankedByResource = new Map<string, { document: LedgerIndexDocument; score: number; why: string[] }>();
    documents.forEach((document) => {
      if (allowedResourceTypes && !allowedResourceTypes.includes(document.resourceType as never)) return;
      const key = `${document.resourceType}:${document.resourceId}`;
      const lexical = lexicalByResource.get(key);
      const titleOverlap = [...tokenize(document.title)].filter((token) => questionTokens.has(token)).length;
      const semantic = queryVector && document.embedding ? cosineSimilarity(queryVector, document.embedding) : 0;
      const lexicalScore = lexical ? 1 - Math.min(0.8, lexical.position / 25) : 0;
      let score = semantic * 0.62 + lexicalScore * 0.28 + Math.min(0.1, titleOverlap * 0.04);
      const why = [
        ...(lexical ? [`lexical:${lexical.result.match_source ?? 'match'}`] : []),
        ...(semantic > 0 ? [`semantic:${semantic.toFixed(3)}`] : []),
        ...(titleOverlap ? ['title'] : []),
      ];
      if (options?.boostResourceKeys?.includes(key)) {
        score += 0.8;
        why.push('explicit-context');
      }
      if (document.resourceType === 'attachment' && options?.conversationId) {
        score += 0.12;
        why.push('conversation-attachment');
      }
      if (allowedResourceTypes && !['deadlines', 'time_window', 'team_members'].includes(intent.kind)) {
        score += 0.25;
        why.push('entity-resource');
      }
      const scheduledAt = document.dueAt ?? document.timestamp;
      const scheduledDate = scheduledAt ? Date.parse(scheduledAt) : NaN;
      const hasScheduledDate = Number.isFinite(scheduledDate);
      if (intent.kind === 'deadlines') {
        if (['task', 'milestone', 'project', 'event', 'reminder'].includes(document.resourceType)) {
          score += 0.16;
          why.push('deadline-resource');
        }
        if (document.dueAt) { score += 0.14; why.push('due-date'); }
        if (['note', 'transcript'].includes(document.resourceType) && !document.dueAt) score -= 0.08;
      }
      if (intent.kind === 'team_members') {
        if (document.resourceType === 'person' || document.resourceType === 'team') {
          score += 0.42;
          why.push('team-members-resource');
        }
        if (['task', 'note', 'transcript', 'event', 'reminder'].includes(document.resourceType)) {
          score -= 0.18;
          why.push('non-team-resource');
        }
      }
      if (intent.kind === 'blockers') {
        if (['project', 'task'].includes(document.resourceType)) {
          score += 0.18;
          why.push('blocker-resource');
        }
        if (['note', 'transcript'].includes(document.resourceType)) {
          score += 0.04;
          why.push('supporting-context');
        }
      }
      if (intent.kind === 'project_review') {
        if (document.resourceType === 'project') {
          score += 0.35;
          why.push('project-review-root');
        } else if (document.projectId) {
          score += 0.08;
          why.push('project-review-linked');
        }
      }
      if (intent.kind === 'recent_updates') {
        const updatedAt = document.updatedAt ? Date.parse(document.updatedAt) : NaN;
        const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / 86_400_000) : Infinity;
        if (Number.isFinite(updatedAt)) {
          score += Math.max(0, 0.42 - Math.min(0.42, ageDays * 0.014));
          why.push(`recent:${Math.round(ageDays)}d`);
        } else {
          score -= 0.12;
          why.push('missing-updated-at');
        }
        if (['project', 'milestone', 'event', 'reminder'].includes(document.resourceType)) {
          score += 0.04;
          why.push('workspace-update-resource');
        }
      }
      if (intent.kind === 'meeting_prep') {
        if (['note', 'transcript'].includes(document.resourceType)) {
          score += 0.2;
          why.push('meeting-prep-context');
        } else if (['task', 'reminder', 'event', 'milestone'].includes(document.resourceType)) {
          score += 0.12;
          why.push('meeting-prep-work');
        }
        const updatedAt = document.updatedAt ? Date.parse(document.updatedAt) : NaN;
        if (Number.isFinite(updatedAt)) {
          const ageDays = Math.max(0, (Date.now() - updatedAt) / 86_400_000);
          score += Math.max(0, 0.28 - Math.min(0.28, ageDays * 0.009));
          why.push(`meeting-prep-recent:${Math.round(ageDays)}d`);
        }
      }
      if (intent.kind === 'integration') {
        if (document.resourceType === 'external') {
          score += 0.5;
          why.push('integration-resource');
        } else if (document.resourceType === 'intake') {
          score += 0.22;
          why.push('integration-capture');
        }
        const providerTokens = tokenize(`${document.sourceLabel ?? ''} ${document.provenance ?? ''} ${document.content}`);
        const providerOverlap = [...providerTokens].filter((token) => questionTokens.has(token)).length;
        if (providerOverlap) {
          score += Math.min(0.24, providerOverlap * 0.08);
          why.push('integration-provider');
        }
      }
      if (intent.kind === 'followups') {
        if (['task', 'reminder', 'event'].includes(document.resourceType)) {
          score += 0.12;
          why.push('follow-up-resource');
        }
        if (['note', 'transcript'].includes(document.resourceType)) {
          score += 0.04;
          why.push('follow-up-context');
        }
      }
      if (intent.kind === 'time_window') {
        if (['task', 'event', 'reminder'].includes(document.resourceType)) { score += 0.1; why.push('schedule-resource'); }
        if (intent.window && hasScheduledDate) {
          const start = Date.parse(`${intent.window.start}T00:00:00`);
          const end = Date.parse(`${intent.window.end}T23:59:59.999`);
          if (scheduledDate >= start && scheduledDate <= end) { score += 0.35; why.push('in-time-window'); }
          else if (scheduledDate < start || scheduledDate > end) { score -= 0.14; why.push('outside-time-window'); }
        } else if (['note', 'transcript'].includes(document.resourceType)) {
          score -= 0.06;
        }
      }
      const existing = rankedByResource.get(key);
      if (!existing || score > existing.score) rankedByResource.set(key, { document, score, why });
    });
    const ranked = [...rankedByResource.values()].filter(({ score, why }) => score > 0 || why.length > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return {
      items: ranked.map(({ document }) => ({ ...document, content: document.content })),
      debug: ranked.map(({ document, score, why }) => ({ resourceType: document.resourceType, resourceId: document.resourceId, title: document.title, score, why })),
    };
  }
}
