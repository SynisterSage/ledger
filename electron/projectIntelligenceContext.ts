import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import {
  buildProjectIntelligenceContext,
  type BuildProjectIntelligenceContextInput,
  type ProjectIntelligenceContext,
} from '../src/features/projects/projectIntelligenceContext.ts';
import type { ProjectSignal } from '../src/features/projects/projectSignals.ts';
import type { LedgerRetrievalService } from './ledgerRetrievalService.ts';

export type ProjectSemanticContextItem = AskLedgerContextItem & {
  metadata: Record<string, unknown> & {
    workspace_id: string;
    project_id: string | null;
    resource_type: string;
    resource_id: string;
    context_scope: 'linked_project_context' | 'workspace_related_context';
  };
};

export type RetrieveProjectSemanticContextInput = {
  workspaceId: string;
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  signals?: ProjectSignal[];
  retrieval: LedgerRetrievalService;
  documents: AskLedgerContextItem[];
  limit?: number;
  semantic?: boolean;
};

const isProjectRelated = (item: AskLedgerContextItem, projectId: string) =>
  item.resourceType === 'project'
    ? item.resourceId === projectId
    : item.projectId === projectId || item.relationships?.some((relationship) => relationship.resourceType === 'project' && relationship.resourceId === projectId);

export const retrieveProjectSemanticContext = async (input: RetrieveProjectSemanticContextInput): Promise<ProjectSemanticContextItem[]> => {
  const limit = Math.max(1, Math.min(input.limit ?? 8, 12));
  const scopedDocuments = input.documents.filter((item) => !item.workspaceId || item.workspaceId === input.workspaceId);
  const signalText = (input.signals ?? []).filter((signal) => signal.kind !== 'project_state').slice(0, 6).map((signal) => signal.title).join('; ');
  const query = [
    `Project: ${input.projectName}`,
    input.projectDescription?.trim(),
    signalText ? `Signals: ${signalText}` : null,
    'Find the most relevant project objective, notes, tasks, milestones, events, reminders, and recent activity.',
  ].filter(Boolean).join('\n');
  const result = await input.retrieval.retrieve(input.workspaceId, query, [], limit, {
    documents: scopedDocuments,
    boostResourceKeys: [`project:${input.projectId}`],
    skipSemantic: input.semantic === false,
  });
  const linked: ProjectSemanticContextItem[] = [];
  const wider: ProjectSemanticContextItem[] = [];
  for (const item of result.items) {
    if (item.workspaceId && item.workspaceId !== input.workspaceId) continue;
    const linkedToProject = isProjectRelated(item, input.projectId);
    const metadata = {
      ...(item.metadata ?? {}),
      workspace_id: input.workspaceId,
      project_id: linkedToProject ? input.projectId : null,
      resource_type: item.resourceType,
      resource_id: item.resourceId,
      context_scope: linkedToProject ? 'linked_project_context' as const : 'workspace_related_context' as const,
    };
    const normalized = { ...item, workspaceId: input.workspaceId, metadata } as ProjectSemanticContextItem;
    (linkedToProject ? linked : wider).push(normalized);
  }
  return [...linked, ...wider].slice(0, limit);
};

export const buildProjectIntelligenceContextWithSemanticSearch = async (
  input: BuildProjectIntelligenceContextInput & {
    retrieval: LedgerRetrievalService;
    semanticDocuments?: AskLedgerContextItem[];
  },
): Promise<ProjectIntelligenceContext> => {
  const base = buildProjectIntelligenceContext(input);
  const semanticContext = await retrieveProjectSemanticContext({
    workspaceId: input.workspaceId,
    projectId: input.project.id,
    projectName: input.project.name,
    projectDescription: input.project.description,
    signals: base.signals,
    retrieval: input.retrieval,
    documents: input.semanticDocuments ?? [],
    limit: input.maxSemanticContext,
  });
  return buildProjectIntelligenceContext({ ...input, semanticContext });
};
