import { randomUUID } from 'node:crypto';
import { buildAskLedgerPrompt } from './askLedgerPrompt.ts';
import { ASK_LEDGER_ABSTENTION } from './askLedgerPrompt.ts';
import { LedgerContextBuilder } from './askLedgerContext.ts';
import { LocalAIService, type LocalAIStreamEvent } from './localAIService.ts';
import {
  EmbeddingIndexService,
  LedgerRetrievalService,
  LocalEmbeddingProvider,
  type LexicalCandidate,
} from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import type { AskLedgerSource } from '../src/types/askLedgerContext.ts';
import type { LocalAIAssetManager } from './localAIAssets.ts';

export type AskLedgerRetrievalRequest = {
  workspaceId: string;
  question: string;
  documents: AskLedgerContextItem[];
  lexicalResults: LexicalCandidate[];
  conversation?: {
    previousQuestion?: string;
    previousAnswer?: string;
    previousSources?: AskLedgerSource[];
  };
};

type AskLedgerStreamCallbacks = {
  onEvent: (event: LocalAIStreamEvent) => void;
};

export class AskLedgerService {
  private readonly retrieval: LedgerRetrievalService;
  private readonly localAI: LocalAIService;

  constructor(
    retrieval: LedgerRetrievalService,
    localAI: LocalAIService,
  ) {
    this.retrieval = retrieval;
    this.localAI = localAI;
  }

  start(request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    const requestId = randomUUID();
    queueMicrotask(() => {
      void this.run(requestId, request, callbacks);
    });
    return requestId;
  }

  cancel(requestId: string) {
    return this.localAI.cancel(requestId);
  }

  async shutdown() {
    await this.retrieval.shutdown();
    await this.localAI.shutdown();
  }

  async shutdownRuntimes() {
    await this.retrieval.shutdown();
    await this.localAI.shutdown();
  }

  private async run(requestId: string, request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    try {
      await this.retrieval.indexWorkspace(request.workspaceId, request.documents);
      const retrievalQuestion = [
        request.question,
        request.conversation?.previousQuestion ? `Previous question: ${request.conversation.previousQuestion}` : '',
        request.conversation?.previousAnswer ? `Previous grounded answer: ${request.conversation.previousAnswer.slice(0, 1200)}` : '',
        request.conversation?.previousSources?.length ? `Previous sources: ${request.conversation.previousSources.slice(0, 8).map((source) => source.title).join('; ')}` : '',
      ].filter(Boolean).join('\n');
      const retrieval = await this.retrieval.retrieve(request.workspaceId, retrievalQuestion, request.lexicalResults, 20);
      const normalized = new LedgerContextBuilder().normalize(retrieval.items, { maxContextTokens: 2400, maxItemTokens: 700 });
      const sourceByKey = new Map<string, AskLedgerSource>();
      normalized.items.forEach((item) => sourceByKey.set(`${item.resourceType}:${item.resourceId}`, {
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          title: item.title,
          route: item.route,
          projectId: item.projectId,
          projectName: item.projectName,
          sourceLabel: item.sourceLabel,
          updatedAt: item.updatedAt,
          parentResourceId: item.parentResourceId,
        }));
      const sources = [...sourceByKey.values()];
      console.info('[local-ai] Ask Ledger retrieval', {
        workspaceId: request.workspaceId,
        question: request.question,
        candidates: retrieval.debug,
        selectedContext: normalized.items.map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title })),
        droppedContext: Math.max(0, retrieval.items.length - normalized.items.length),
        promptTokens: normalized.estimatedTokens,
      });
      callbacks.onEvent({ type: 'sources', requestId, sources });
      const topScore = retrieval.debug[0]?.score ?? 0;
      const hasSignal = retrieval.debug[0]?.why.some((reason) => reason.startsWith('lexical:') || reason.startsWith('semantic:') || reason === 'title');
      if (!retrieval.items.length || !hasSignal || topScore < 0.18 || !normalized.items.length) {
        callbacks.onEvent({ type: 'delta', requestId, text: ASK_LEDGER_ABSTENTION });
        callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 0 } });
        return;
      }
      this.localAI.start(
        { question: request.question, context: buildAskLedgerPrompt({ question: request.question, context: normalized, recentConversation: request.conversation }) },
        callbacks,
        requestId,
      );
    } catch (error) {
      callbacks.onEvent({
        type: 'error',
        requestId,
        error: {
          code: 'retrieval_failed',
          message: error instanceof Error ? error.message : 'Ledger retrieval failed.',
        },
      });
    }
  }
}

export const createAskLedgerService = (localAI: LocalAIService, assets?: LocalAIAssetManager) => {
  const provider = (assets || process.env.LEDGER_LOCAL_AI_EMBEDDING_URL?.trim() || process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL_PATH?.trim())
    ? new LocalEmbeddingProvider(assets)
    : undefined;
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  return new AskLedgerService(retrieval, localAI);
};
