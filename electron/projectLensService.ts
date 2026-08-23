import { randomUUID } from 'node:crypto';
import type { ProjectIntelligenceContext } from '../src/features/projects/projectIntelligenceContext.ts';
import {
  buildProjectLensActionPrompt,
  buildProjectLensPrompt,
  buildProjectLensRequest,
  type ProjectLensAction,
  type ProjectLensActionResult,
  type ProjectLensTiming,
  validateProjectLensResult,
  validateProjectLensActionResult,
  type ProjectLensResult,
} from '../src/features/projects/projectLens.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { retrieveProjectSemanticContext } from './projectIntelligenceContext.ts';
import type { LedgerRetrievalService } from './ledgerRetrievalService.ts';
import type { LocalAIService, LocalAIStreamEvent } from './localAIService.ts';

export type ProjectLensGenerationInput = {
  workspaceId: string;
  context: ProjectIntelligenceContext;
  semanticDocuments?: AskLedgerContextItem[];
};

export type ProjectLensActionInput = ProjectLensGenerationInput & { action: ProjectLensAction };

export type ProjectLensGenerationResult =
  | { status: 'ready'; tier: 'balanced' | 'fast'; result: ProjectLensResult; rejectionReasons?: string[] }
  | { status: 'unavailable'; reason: 'model_unavailable' | 'generation_failed' | 'invalid_context' | 'superseded' };

export type ProjectLensActionResultResponse =
  | { status: 'ready'; tier: 'balanced' | 'fast' | 'retrieval'; result: ProjectLensActionResult; rejectionReasons?: string[] }
  | { status: 'unavailable'; reason: 'model_unavailable' | 'generation_failed' | 'retrieval_unavailable' | 'invalid_context' | 'superseded' };

const MAX_SEMANTIC_DOCUMENTS = 180;
const SEMANTIC_INDEX_WAIT_MS = 2_500;
class ProjectLensSupersededError extends Error {
  constructor() { super('Project Lens request superseded.'); }
}

export class ProjectLensService {
  private readonly localAI: LocalAIService;
  private readonly retrieval: LedgerRetrievalService;
  private activeRequestId: string | null = null;
  private requestEpoch = 0;
  private semanticIndexPromise: Promise<unknown> | null = null;

  constructor(
    localAI: LocalAIService,
    retrieval: LedgerRetrievalService,
  ) {
    this.localAI = localAI;
    this.retrieval = retrieval;
  }

  private beginRequest() {
    this.requestEpoch += 1;
    if (this.activeRequestId) this.localAI.cancel(this.activeRequestId);
    this.activeRequestId = null;
    return this.requestEpoch;
  }

  private isCurrent(epoch: number) { return epoch === this.requestEpoch; }

  private async prepareSemanticIndex(workspaceId: string, documents: AskLedgerContextItem[]) {
    if (!this.semanticIndexPromise) {
      this.semanticIndexPromise = this.retrieval.indexWorkspace(workspaceId, documents).finally(() => {
        this.semanticIndexPromise = null;
      });
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.semanticIndexPromise,
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Semantic indexing timed out; using lexical retrieval.')), SEMANTIC_INDEX_WAIT_MS); }),
      ]);
      return true;
    } catch (error) {
      console.warn('[project-lens] semantic index wait exceeded; using lexical retrieval', error instanceof Error ? error.message : error);
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async generate(input: ProjectLensGenerationInput): Promise<ProjectLensGenerationResult> {
    if (!input.workspaceId || input.context.workspaceId !== input.workspaceId || input.context.projectId !== input.context.project.id) {
      return { status: 'unavailable', reason: 'invalid_context' };
    }
    const requestEpoch = this.beginRequest();

    let context = input.context;
    const retrievalStartedAt = Date.now();
    let retrievalMs = 0;
    let semanticEnabled = true;
    const semanticDocuments = (input.semanticDocuments ?? []).filter((item) => !item.workspaceId || item.workspaceId === input.workspaceId).slice(0, MAX_SEMANTIC_DOCUMENTS);
    if (semanticDocuments.length) {
      try {
        semanticEnabled = await this.prepareSemanticIndex(input.workspaceId, semanticDocuments);
        const semanticContext = await retrieveProjectSemanticContext({
          workspaceId: input.workspaceId,
          projectId: context.projectId,
          projectName: context.project.name,
          projectDescription: context.project.description,
          signals: context.signals,
          retrieval: this.retrieval,
          documents: semanticDocuments,
          limit: 8,
          semantic: semanticEnabled,
        });
        context = { ...context, semanticContext };
        retrievalMs = Date.now() - retrievalStartedAt;
      } catch (error) {
        retrievalMs = Date.now() - retrievalStartedAt;
        console.warn('[project-lens] semantic context unavailable; continuing with exact context', error instanceof Error ? error.message : error);
      }
    }

    const request = buildProjectLensRequest(context);
    let modelWasAvailable = false;
    for (const tier of ['fast', 'balanced'] as const) {
      if (!this.isCurrent(requestEpoch)) return { status: 'unavailable', reason: 'superseded' };
      const switchResult = await this.localAI.switchGenerationTier(tier).catch((error) => ({ ok: false, error }));
      if (!switchResult || switchResult.ok !== true) {
        continue;
      }
      modelWasAvailable = true;
      try {
        const prompt = buildProjectLensPrompt(request);
        const generated = await this.generateWithTier(prompt, requestEpoch);
        const validation = validateProjectLensResult(generated.text, request, context);
        if (!validation.result) {
          console.warn('[project-lens] output rejected', { workspaceId: input.workspaceId, projectId: context.projectId, modelTier: tier, rejectionReasons: validation.rejectionReasons });
          continue;
        }
        console.info('[project-lens] served', { workspaceId: input.workspaceId, projectId: context.projectId, modelTier: tier, semanticEvidenceCount: request.semanticEvidence.length, promptChars: prompt.length, retrievalMs, ...generated.timing, rejectionReasons: validation.rejectionReasons });
        return { status: 'ready', tier, result: validation.result, rejectionReasons: validation.rejectionReasons };
      } catch (error) {
        if (!this.isCurrent(requestEpoch)) return { status: 'unavailable', reason: 'superseded' };
        console.warn('[project-lens] generation failed', { tier, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const reason = modelWasAvailable ? 'generation_failed' : 'model_unavailable';
    console.info('[project-lens] unavailable', { workspaceId: input.workspaceId, projectId: context.projectId, reason });
    return { status: 'unavailable', reason };
  }

  async generateAction(input: ProjectLensActionInput): Promise<ProjectLensActionResultResponse> {
    if (!input.workspaceId || input.context.workspaceId !== input.workspaceId || input.context.projectId !== input.context.project.id) {
      return { status: 'unavailable', reason: 'invalid_context' };
    }
    const requestEpoch = this.beginRequest();
    let context = input.context;
    const semanticDocuments = (input.semanticDocuments ?? []).filter((item) => !item.workspaceId || item.workspaceId === input.workspaceId).slice(0, MAX_SEMANTIC_DOCUMENTS);
    try {
      if (semanticDocuments.length) {
        const semanticEnabled = await this.prepareSemanticIndex(input.workspaceId, semanticDocuments);
        const semanticContext = await retrieveProjectSemanticContext({ workspaceId: input.workspaceId, projectId: context.projectId, projectName: context.project.name, projectDescription: context.project.description, signals: context.signals, retrieval: this.retrieval, documents: semanticDocuments, limit: input.action === 'find_context' ? 12 : 8, semantic: semanticEnabled });
        context = { ...context, semanticContext };
      }
    } catch (error) {
      console.warn('[project-lens] action retrieval unavailable', { action: input.action, message: error instanceof Error ? error.message : String(error) });
      if (input.action === 'find_context') return { status: 'unavailable', reason: 'retrieval_unavailable' };
    }
    const request = buildProjectLensRequest(context);
    if (input.action === 'find_context') {
      const relatedResources = context.semanticContext
        .filter((item) => item.metadata?.context_scope === 'workspace_related_context')
        .slice(0, 5)
        .map((item) => ({ resourceType: item.resourceType as ProjectLensActionResult['sources'][number]['resourceType'], resourceId: item.resourceId }));
      return { status: 'ready', tier: 'retrieval', result: { action: input.action, summary: relatedResources.length ? 'Possibly related workspace context found.' : 'No high-confidence additional context found.', relatedResources, sources: relatedResources } };
    }
    let modelWasAvailable = false;
    for (const tier of ['fast', 'balanced'] as const) {
      if (!this.isCurrent(requestEpoch)) return { status: 'unavailable', reason: 'superseded' };
      const switchResult = await this.localAI.switchGenerationTier(tier).catch(() => ({ ok: false }));
      if (!switchResult || switchResult.ok !== true) continue;
      modelWasAvailable = true;
      try {
        const prompt = buildProjectLensActionPrompt(input.action, request);
        const generated = await this.generateWithTier(prompt, requestEpoch);
        const validation = validateProjectLensActionResult(generated.text, input.action, context);
        if (!validation.result) {
          console.warn('[project-lens] action output rejected', { workspaceId: input.workspaceId, projectId: context.projectId, action: input.action, modelTier: tier, rejectionReasons: validation.rejectionReasons });
          continue;
        }
        console.info('[project-lens] action served', { workspaceId: input.workspaceId, projectId: context.projectId, action: input.action, modelTier: tier, promptChars: prompt.length, semanticEvidenceCount: request.semanticEvidence.length, ...generated.timing });
        return { status: 'ready', tier, result: validation.result, rejectionReasons: validation.rejectionReasons };
      } catch (error) {
        if (!this.isCurrent(requestEpoch)) return { status: 'unavailable', reason: 'superseded' };
        console.warn('[project-lens] action generation failed', { action: input.action, tier, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const reason = modelWasAvailable ? 'generation_failed' : 'model_unavailable';
    console.info('[project-lens] action unavailable', { workspaceId: input.workspaceId, projectId: context.projectId, action: input.action, reason });
    return { status: 'unavailable', reason };
  }

  private generateWithTier(prompt: string, requestEpoch: number): Promise<{ text: string; timing: ProjectLensTiming }> {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(requestEpoch)) { reject(new ProjectLensSupersededError()); return; }
      const requestId = randomUUID();
      this.activeRequestId = requestId;
      let output = '';
      let settled = false;
      const startedAt = Date.now();
      let firstTokenAt: number | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.localAI.cancel(requestId);
        if (this.activeRequestId === requestId) this.activeRequestId = null;
        reject(new Error('Project Lens generation timed out.'));
      }, 45_000);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.activeRequestId === requestId) this.activeRequestId = null;
        callback();
      };
      this.localAI.start({ question: 'Project Lens', context: prompt, generationBudget: 420, timeoutMs: 45_000, reasoningSignals: { answerDepth: 'brief', generationDepth: 'quick', retrievalRequired: true, sourceCount: 8, routeReason: 'project_lens' } }, {
        onEvent: (event: LocalAIStreamEvent) => {
          if (event.type === 'delta') {
            firstTokenAt ??= Date.now();
            output += event.text ?? '';
          }
          if (event.type === 'done') finish(() => {
            const finishedAt = Date.now();
            if (!output.trim() || event.metrics?.failureReason) {
              reject(new Error(event.metrics?.failureReason ?? 'Project Lens returned empty output.'));
              return;
            }
            resolve({ text: output, timing: { timeToFirstTokenMs: firstTokenAt ? firstTokenAt - startedAt : undefined, generationMs: finishedAt - startedAt, totalMs: finishedAt - startedAt } });
          });
          if (event.type === 'error') finish(() => reject(requestEpoch === this.requestEpoch ? new Error(event.error?.message ?? 'Project Lens generation failed.') : new ProjectLensSupersededError()));
        },
      }, requestId);
    });
  }
}
