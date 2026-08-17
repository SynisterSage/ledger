import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { LocalAIAssetManager, resolveLocalAIRuntime } from './localAIAssets.ts';

export type LedgerIndexDocument = AskLedgerContextItem & {
  workspaceId: string;
  chunkId: string;
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

export class EmbeddingUnavailableError extends Error {
  constructor(message = 'A local embedding provider is not configured.') {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL?.trim() || 'configured-local-embedding-model';
  readonly version = process.env.LEDGER_LOCAL_AI_EMBEDDING_VERSION?.trim() || '1';
  private readonly endpoint = process.env.LEDGER_LOCAL_AI_EMBEDDING_URL?.trim() || '';
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
  private readonly provider?: EmbeddingProvider;

  constructor(provider?: EmbeddingProvider) {
    this.provider = provider;
  }

  async replaceWorkspace(workspaceId: string, items: AskLedgerContextItem[]) {
    const existing = this.workspaces.get(workspaceId) ?? new Map<string, LedgerIndexDocument>();
    const next = new Map<string, LedgerIndexDocument>();
    const pending: Array<{ key: string; document: LedgerIndexDocument }> = [];

    for (const item of items) {
      if (item.workspaceId && item.workspaceId !== workspaceId) continue;
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
        const vectors = await this.provider.embed(pending.map(({ document }) => `${document.title}\n${document.content}`));
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

  deleteWorkspace(workspaceId: string) {
    this.workspaces.delete(workspaceId);
  }

  documents(workspaceId: string) {
    return [...(this.workspaces.get(workspaceId)?.values() ?? [])];
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

  async shutdown() {
    await this.index.shutdown();
  }

  async retrieve(workspaceId: string, question: string, lexicalResults: LexicalCandidate[] = [], limit = 8): Promise<LedgerRetrievalResult> {
    const documents = this.index.documents(workspaceId).filter((document) => document.workspaceId === workspaceId);
    const lexicalByResource = new Map(lexicalResults.map((result, position) => [`${result.type}:${result.id}`, { result, position }]));
    let queryVector: number[] | undefined;
    if (this.provider && documents.some((document) => document.embedding)) {
      try { queryVector = (await this.provider.embed([question]))[0]; } catch { queryVector = undefined; }
    }
    const questionTokens = tokenize(question);
    const ranked = documents.map((document) => {
      const key = `${document.resourceType}:${document.resourceId}`;
      const lexical = lexicalByResource.get(key);
      const titleOverlap = [...tokenize(document.title)].filter((token) => questionTokens.has(token)).length;
      const semantic = queryVector && document.embedding ? cosineSimilarity(queryVector, document.embedding) : 0;
      const lexicalScore = lexical ? 1 - Math.min(0.8, lexical.position / 25) : 0;
      const score = semantic * 0.62 + lexicalScore * 0.28 + Math.min(0.1, titleOverlap * 0.04);
      const why = [
        ...(lexical ? [`lexical:${lexical.result.match_source ?? 'match'}`] : []),
        ...(semantic > 0 ? [`semantic:${semantic.toFixed(3)}`] : []),
        ...(titleOverlap ? ['title'] : []),
      ];
      return { document, score, why };
    }).filter(({ score, why }) => score > 0 || why.length > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return {
      items: ranked.map(({ document }) => ({ ...document, content: document.content })),
      debug: ranked.map(({ document, score, why }) => ({ resourceType: document.resourceType, resourceId: document.resourceId, title: document.title, score, why })),
    };
  }
}
