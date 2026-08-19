import type { AskLedgerResourceType, AskLedgerSource } from './askLedgerContext.ts';

export type AskLedgerGroundedEntity = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  projectId?: string;
  integrationProvider?: string;
  updatedAt?: string;
};

export type AskLedgerConversationCoverage = {
  requested: string[];
  found: string[];
  missing: string[];
  unavailable?: string[];
  truncated?: string[];
};

export type AskLedgerConversationState = {
  workspaceId: string;
  activeEntities: AskLedgerGroundedEntity[];
  activeResources: AskLedgerGroundedEntity[];
  activeTopics: string[];
  previousRequest?: string;
  previousEvidenceSourceIds: string[];
  previousCoverage?: AskLedgerConversationCoverage;
  updatedAt: string;
};

export type AskLedgerFollowUpMode = 'reuse_identity' | 'refresh_state' | 'extend_research' | 'switch_entity' | 'switch_provider' | 'new_topic';

export type AskLedgerResolvedConversation = {
  isFollowUp: boolean;
  mode: AskLedgerFollowUpMode;
  resolvedReferences: Record<string, string>;
  reusedEntities: AskLedgerGroundedEntity[];
  resourceKeys: string[];
  projectIds: string[];
  provider?: string;
  retrievalQuestion?: string;
  contextReset: boolean;
  unresolvedReferences: string[];
};

const keyFor = (entity: Pick<AskLedgerGroundedEntity, 'resourceType' | 'resourceId'>) => `${entity.resourceType}:${entity.resourceId}`;
const normalize = (value: string) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const providerPattern = /\b(slack|github|figma|google drive|drive|google calendar|apple calendar|apple reminders|mcp)\b/i;
const referencePattern = /\b(?:it|its|that|those|these|the project|the meeting|the other (?:one|project)|them|they)\b|\bwhat about\b|\band\s+(?:watercolor|alfa)\b/i;
const temporalPattern = /\b(?:today|tomorrow|yesterday|this week|last week|this month|recent|latest|overdue|long[- ]term|completed|open|blocked)\b/i;
const workspacePattern = /\b(?:ledger|workspace|project|task|milestone|meeting|event|calendar|note|transcript|reminder|notification|activity|slack|github|figma|teamspace|circle)\b/i;

const entityMatchesQuestion = (entity: AskLedgerGroundedEntity, normalizedQuestion: string) => {
  const title = normalize(entity.title);
  const titleTokens = title.split(' ').filter((token) => token.length >= 4);
  return title.length >= 3 && (normalizedQuestion.includes(title) || titleTokens.slice(0, 2).some((token) => normalizedQuestion.includes(token)));
};

export const deriveAskLedgerConversationState = (workspaceId: string, question: string, sources: AskLedgerSource[], previous?: AskLedgerConversationState, coverage?: AskLedgerConversationCoverage): AskLedgerConversationState => {
  const seen = new Set<string>();
  const activeResources = sources
    .filter((source) => source.resourceId && source.title)
    .map((source) => ({ resourceType: source.resourceType, resourceId: source.resourceId, title: source.title, projectId: source.projectId, integrationProvider: source.integrationProvider, updatedAt: source.updatedAt }))
    .filter((entity) => { const key = keyFor(entity); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 16);
  const normalizedQuestion = normalize(question);
  const byType = (resourceType: AskLedgerResourceType) => activeResources.filter((entity) => entity.resourceType === resourceType);
  const activeEntities = [
    ...activeResources.filter((entity) => entityMatchesQuestion(entity, normalizedQuestion)),
    ...([ 'project', 'event', 'note', 'milestone', 'task', 'team', 'external' ] as AskLedgerResourceType[]).flatMap((type) => byType(type).slice(0, 2)),
  ].filter((entity, index, all) => all.findIndex((candidate) => keyFor(candidate) === keyFor(entity)) === index).slice(0, 12);
  const activeTopics = [
    ...new Set([
      ...activeEntities.filter((entity) => entity.resourceType === 'project').map((entity) => entity.title),
      ...activeEntities.filter((entity) => entity.resourceType === 'external' && entity.integrationProvider).map((entity) => entity.integrationProvider as string),
    ]),
  ].slice(0, 8);
  return {
    workspaceId,
    activeEntities,
    activeResources,
    activeTopics,
    previousRequest: question,
    previousEvidenceSourceIds: activeResources.map(keyFor).slice(0, 16),
    previousCoverage: coverage,
    updatedAt: new Date().toISOString(),
    ...(previous && previous.workspaceId === workspaceId ? { previousRequest: question } : {}),
  };
};

export const resolveAskLedgerConversation = (question: string, state?: AskLedgerConversationState, workspaceId?: string): AskLedgerResolvedConversation => {
  if (!state || (workspaceId && state.workspaceId !== workspaceId)) return { isFollowUp: false, mode: 'new_topic', resolvedReferences: {}, reusedEntities: [], resourceKeys: [], projectIds: [], contextReset: Boolean(state), unresolvedReferences: [] };
  const normalizedQuestion = normalize(question);
  const stateAge = Date.parse(state.updatedAt);
  if (Number.isFinite(stateAge) && Date.now() - stateAge > 30 * 60 * 1000) return { isFollowUp: false, mode: 'new_topic', resolvedReferences: {}, reusedEntities: [], resourceKeys: [], projectIds: [], contextReset: true, unresolvedReferences: [] };
  const activeProjects = state.activeEntities.filter((entity) => entity.resourceType === 'project');
  const explicitEntity = state.activeEntities.find((entity) => entityMatchesQuestion(entity, normalizedQuestion));
  const referenceMentioned = referencePattern.test(normalizedQuestion);
  const providerMatch = normalizedQuestion.match(providerPattern);
  const provider = providerMatch?.[1]?.replace('google drive', 'google_drive').replace('google calendar', 'google_calendar').replace('apple calendar', 'apple_calendar').replace('apple reminders', 'apple_reminders');
  const priorProvider = state.activeEntities.find((entity) => entity.integrationProvider)?.integrationProvider;
  const switchedEntity = Boolean(explicitEntity && (!activeProjects.length || explicitEntity.resourceId !== activeProjects[0]?.resourceId));
  const reusedEntities = explicitEntity
    ? [explicitEntity]
    : referenceMentioned
      ? state.activeEntities.filter((entity) => ['project', 'event', 'note', 'milestone', 'task', 'external'].includes(entity.resourceType)).slice(0, 8)
      : [];
  const projects = reusedEntities.filter((entity) => entity.resourceType === 'project').map((entity) => entity.resourceId);
  const projectIds = projects.length ? projects : reusedEntities.map((entity) => entity.projectId).filter((id): id is string => Boolean(id));
  const resourceKeys = reusedEntities.map(keyFor);
  const mutableQuestion = temporalPattern.test(normalizedQuestion) || /\b(?:is|are|did|does|do|has|have|which|what)\b/i.test(normalizedQuestion);
  const isFollowUp = referenceMentioned || Boolean(explicitEntity) || Boolean(state.previousRequest && (provider || temporalPattern.test(normalizedQuestion)));
  const mode: AskLedgerFollowUpMode = provider && priorProvider && provider !== priorProvider
      ? 'switch_provider'
      : switchedEntity
        ? 'switch_entity'
      : mutableQuestion && resourceKeys.length
        ? 'refresh_state'
        : isFollowUp && resourceKeys.length
          ? 'reuse_identity'
          : isFollowUp
            ? 'extend_research'
            : 'new_topic';
  const resolvedReferences: Record<string, string> = {};
  if (reusedEntities.length) {
    if (/\b(?:it|its|that|the project)\b/.test(normalizedQuestion)) resolvedReferences.it = keyFor(reusedEntities[0]);
    if (/\b(?:meeting|it)\b/.test(normalizedQuestion)) {
      const meeting = reusedEntities.find((entity) => entity.resourceType === 'event' || entity.resourceType === 'note');
      if (meeting) resolvedReferences.meeting = keyFor(meeting);
    }
    if (/\b(?:those|these|them|they|which one|the other)\b/.test(normalizedQuestion)) resolvedReferences.those = resourceKeys.join(',');
  }
  return { isFollowUp, mode, resolvedReferences, reusedEntities, resourceKeys, projectIds: [...new Set(projectIds)].slice(0, 8), ...(provider ? { provider } : {}), contextReset: !isFollowUp && !workspacePattern.test(normalizedQuestion), unresolvedReferences: referenceMentioned && !reusedEntities.length ? ['referent'] : [] };
};
