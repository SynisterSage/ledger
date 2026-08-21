import type { AskLedgerContextItem, AskLedgerRelationshipType, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';
import type { AskLedgerGraphExpansionDiagnostics, AskLedgerIntegrationDiagnostics, AskLedgerOrchestrationDiagnostics } from '../src/types/askLedgerResourceContract.ts';
import { buildRetrievalPlan, type RetrievalPlan } from './askLedgerRetrievalPlan.ts';
import { LedgerRetrievalService, type LedgerRetrievalResult } from './ledgerRetrievalService.ts';
import { CachedAskLedgerIntegrationRetriever } from './askLedgerIntegrationRetrieval.ts';
import type { AskLedgerSkillId } from '../src/types/askLedgerSkills.ts';

export type AskLedgerRetrievalMode = 'quick' | 'research';

export type RetrievalObjective = {
  id: string;
  purpose: string;
  resourceTypes: AskLedgerResourceType[];
  entityQuery?: string;
  constraints?: RetrievalPlan['structuredConstraints'];
  expandRelationships: boolean;
  dependsOn: string[];
  graphRelationshipTypes?: readonly AskLedgerRelationshipType[];
};

export type AskLedgerOrchestrationLimits = {
  maxObjectives?: number;
  maxRounds?: number;
  maxDiscoveredEntities?: number;
  maxEvidenceResources?: number;
};

export type AskLedgerOrchestrationResult = LedgerRetrievalResult & {
  mode: AskLedgerRetrievalMode;
  orchestration: AskLedgerOrchestrationDiagnostics;
  integrationRetrieval?: AskLedgerIntegrationDiagnostics;
};

export type RetrievalObjectiveTiming = {
  objectiveId: string;
  resourceTypes: AskLedgerResourceType[];
  startedAt: number;
  completedAt: number;
  durationMs: number;
  candidateCount: number;
  selectedCount: number;
};

const DEFAULT_LIMITS: Required<AskLedgerOrchestrationLimits> = {
  maxObjectives: 8,
  maxRounds: 4,
  maxDiscoveredEntities: 8,
  maxEvidenceResources: 48,
};

const keyFor = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) => `${item.resourceType}:${item.resourceId}`;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const resourceCategory = (type: AskLedgerResourceType) => type === 'event' ? 'meetings' : type === 'transcript' ? 'transcripts' : type === 'activity' ? 'activity' : `${type}s`;

export const classifyAskLedgerRetrievalMode = (question: string): AskLedgerRetrievalMode => {
  const normalized = normalize(question);
  const requestedCategories = [
    /\bmeetings?\b/.test(normalized),
    /\bprojects?\b/.test(normalized),
    /\bmilestones?\b/.test(normalized),
    /\b(?:tasks?|next actions?)\b/.test(normalized),
    /\bnotes?|transcripts?\b/.test(normalized),
    /\breminders?\b/.test(normalized),
  ].filter(Boolean).length;
  const compoundSignal = /\b(connect|tie|tying|across|everything stands|what(?:'s| is) going on|what still needs|where .* stands|look through|summari[sz]e .* and|and (?:tell|what|how|where))\b/.test(normalized);
  const narrowSignal = /^(?:when|what time|show|get|who owns|who is responsible|find my latest|latest)\b/.test(normalized);
  return requestedCategories >= 2 || (compoundSignal && !narrowSignal) ? 'research' : 'quick';
};

const addObjective = (objectives: RetrievalObjective[], objective: RetrievalObjective) => {
  if (!objectives.some((candidate) => candidate.id === objective.id)) objectives.push(objective);
};

type PlanMyWeekQuery = { id: string; label: string; query: string; resourceTypes: AskLedgerResourceType[]; constraints: RetrievalPlan['structuredConstraints'] };
const planMyWeekQueries: PlanMyWeekQuery[] = [
  { id: 'week-open-tasks', label: 'Open tasks due this week', query: 'tasks this week', resourceTypes: ['task'] as AskLedgerResourceType[], constraints: { openOnly: true } },
  { id: 'week-completed-tasks', label: 'Completed tasks due this week', query: 'completed tasks this week', resourceTypes: ['task'] as AskLedgerResourceType[], constraints: { statuses: ['completed', 'complete', 'done', 'finished'] } },
  { id: 'overdue-tasks', label: 'Overdue open tasks', query: 'overdue open tasks', resourceTypes: ['task'] as AskLedgerResourceType[], constraints: { overdue: true, openOnly: true } },
  { id: 'today-tasks', label: 'Today tasks', query: 'today tasks', resourceTypes: ['task'] as AskLedgerResourceType[], constraints: { horizon: 'today' as const, openOnly: true } },
  { id: 'week-milestones', label: 'Milestones due this week', query: 'milestones this week', resourceTypes: ['milestone'] as AskLedgerResourceType[], constraints: {} },
  { id: 'week-events', label: 'Events this week', query: 'events this week', resourceTypes: ['event'] as AskLedgerResourceType[], constraints: {} },
  { id: 'week-reminders', label: 'Reminders this week', query: 'reminders this week', resourceTypes: ['reminder'] as AskLedgerResourceType[], constraints: {} },
];

export const decomposeRetrievalObjectives = (question: string): RetrievalObjective[] => {
  const normalized = normalize(question);
  const base = buildRetrievalPlan(question);
  const hasMeetings = /\bmeetings?\b/.test(normalized);
  const hasProjects = /\bprojects?\b|\bproject work\b/.test(normalized) || /\bwhat(?:'s| is) going on with\b|\bwhat still needs to happen\b/.test(normalized);
  const hasMilestones = /\bmilestones?\b/.test(normalized);
  const hasTasks = /\b(?:tasks?|next actions?)\b/.test(normalized);
  const hasNotes = /\bnotes?|transcripts?\b/.test(normalized);
  const hasReminders = /\breminders?\b/.test(normalized);
  const hasActivity = /\b(?:activity|what changed|changes|happening)\b/.test(normalized);
  const hasNotifications = /\bnotifications?\b/.test(normalized);
  const hasAttention = /\bwhat needs my attention\b|\balerts?\b|\bteamspace\b|\bcircle\b/.test(normalized);
  const integrationProviders = base.integrationProviders ?? [];
  const hasInternalLedger = integrationProviders.length > 0 && /\bledger\b/.test(normalized);
  const includesProjectContext = hasProjects || hasInternalLedger;
  const objectives: RetrievalObjective[] = [];

  integrationProviders.forEach((provider) => addObjective(objectives, {
    id: `integration-${provider}`,
    purpose: `Find relevant ${provider} context from the authorized integration cache`,
    resourceTypes: ['external'],
    entityQuery: base.entityQuery,
    constraints: base.structuredConstraints,
    expandRelationships: true,
    dependsOn: [],
    graphRelationshipTypes: ['linked_project', 'linked_task', 'linked_note', 'linked_event', 'linked_resource'],
  }));

  if (hasNotifications || hasAttention) {
    addObjective(objectives, { id: 'notifications', purpose: 'Find relevant notifications and unread attention signals', resourceTypes: ['notification'], entityQuery: base.entityQuery, constraints: { ...base.structuredConstraints, ...(hasAttention ? { attentionOnly: true } : {}) }, expandRelationships: true, dependsOn: [], graphRelationshipTypes: ['linked_project', 'linked_task', 'linked_note', 'linked_milestone', 'linked_event', 'belongs_to_team'] });
  }
  if (hasActivity || hasAttention) {
    addObjective(objectives, { id: 'activity', purpose: 'Find meaningful recent workspace and teamspace activity', resourceTypes: ['activity'], entityQuery: base.entityQuery, constraints: { ...base.structuredConstraints, ...(hasAttention ? { attentionOnly: true } : {}) }, expandRelationships: true, dependsOn: [], graphRelationshipTypes: ['linked_project', 'linked_task', 'linked_note', 'linked_milestone', 'belongs_to_team'] });
  }

  if (hasMeetings) {
    addObjective(objectives, {
      id: 'meetings', purpose: 'Find relevant meetings and calendar evidence', resourceTypes: ['event'], entityQuery: base.entityQuery,
      constraints: base.structuredConstraints, expandRelationships: true, dependsOn: [],
      graphRelationshipTypes: ['has_meeting_note', 'linked_note', 'linked_project', 'belongs_to_project', 'has_note', 'has_transcript', 'belongs_to_note'],
    });
    addObjective(objectives, {
      id: 'meeting-context', purpose: 'Retrieve meeting notes and transcripts', resourceTypes: ['note', 'transcript'], entityQuery: base.entityQuery,
      constraints: base.structuredConstraints, expandRelationships: true, dependsOn: ['meetings'],
      graphRelationshipTypes: ['has_meeting_note', 'linked_note', 'has_transcript', 'belongs_to_note', 'linked_project', 'belongs_to_project'],
    });
  }

  if (includesProjectContext && !hasMeetings) {
    addObjective(objectives, { id: 'projects', purpose: 'Find authoritative project records', resourceTypes: ['project'], entityQuery: base.entityQuery, expandRelationships: true, dependsOn: [] });
  } else if (hasMeetings || /\bwhat(?:'s| is) going on\b|\bconnect .*project\b/.test(normalized)) {
    addObjective(objectives, { id: 'linked-projects', purpose: 'Retrieve projects discovered through meeting evidence', resourceTypes: ['project'], expandRelationships: true, dependsOn: hasMeetings ? ['meetings', 'meeting-context'] : [], graphRelationshipTypes: ['linked_project', 'belongs_to_project', 'has_milestone', 'has_task', 'has_note', 'has_event', 'has_reminder', 'has_external_resource'] });
  }

  const projectDependency = objectives.some((objective) => ['projects', 'linked-projects'].includes(objective.id)) ? [objectives.some((objective) => objective.id === 'linked-projects') ? 'linked-projects' : 'projects'] : [];
  if (hasMilestones || includesProjectContext || hasMeetings) {
    addObjective(objectives, { id: 'project-milestones', purpose: 'Retrieve milestones for discovered projects', resourceTypes: ['milestone'], constraints: base.structuredConstraints, expandRelationships: false, dependsOn: projectDependency });
  }
  if (hasTasks || includesProjectContext || hasMeetings) {
    const constraints = { ...base.structuredConstraints, openOnly: true };
    addObjective(objectives, { id: 'project-open-tasks', purpose: 'Retrieve open project tasks and horizons', resourceTypes: ['task'], constraints, expandRelationships: false, dependsOn: projectDependency });
  }
  if (hasReminders || includesProjectContext || hasMeetings) {
    addObjective(objectives, { id: 'linked-reminders', purpose: 'Retrieve reminders and follow-up context', resourceTypes: ['reminder'], constraints: base.structuredConstraints, expandRelationships: false, dependsOn: projectDependency });
  }
  if (hasAttention) {
    addObjective(objectives, { id: 'attention-tasks', purpose: 'Find overdue, blocked, and today work requiring attention', resourceTypes: ['task', 'milestone'], constraints: { ...base.structuredConstraints, attentionOnly: true }, expandRelationships: false, dependsOn: projectDependency });
  }
  if (hasNotes && !hasMeetings) addObjective(objectives, { id: 'notes', purpose: 'Find requested notes and transcripts', resourceTypes: ['note'], entityQuery: base.entityQuery, constraints: base.structuredConstraints, expandRelationships: true, dependsOn: [] });
  if (!objectives.length) addObjective(objectives, { id: 'primary', purpose: 'Retrieve the primary workspace evidence', resourceTypes: base.primaryResourceTypes, entityQuery: base.entityQuery, constraints: base.structuredConstraints, expandRelationships: base.expandRelatedContext, dependsOn: [] });
  return objectives;
};

const buildObjectivePlan = (question: string, objective: RetrievalObjective, projectIds: string[]): RetrievalPlan => {
  const base = buildRetrievalPlan(question);
  return {
    ...base,
    primaryResourceTypes: objective.resourceTypes,
    entityQuery: objective.entityQuery,
    structuredConstraints: { ...objective.constraints, ...(projectIds.length ? { projectIds } : {}) },
    semanticQuery: `${objective.purpose}: ${question}`,
    expandRelatedContext: objective.expandRelationships,
    retrievalStrategies: { semantic: true, lexical: true, exactEntity: true, structured: true },
  };
};

export class AskLedgerRetrievalOrchestrator {
  private readonly retrieval: LedgerRetrievalService;
  private readonly limits: AskLedgerOrchestrationLimits;

  constructor(retrieval: LedgerRetrievalService, limits: AskLedgerOrchestrationLimits = {}) {
    this.retrieval = retrieval;
    this.limits = limits;
  }

  private async retrievePlanMyWeek(workspaceId: string, lexicalResults: Parameters<LedgerRetrievalService['retrieve']>[2], limit: number, options?: { conversationId?: string; boostResourceKeys?: string[]; documents?: AskLedgerContextItem[]; onObjectiveTiming?: (timing: RetrievalObjectiveTiming) => void }) {
    const collected = new Map<string, AskLedgerContextItem>();
    const debug: LedgerRetrievalResult['debug'] = [];
    const objectives: AskLedgerOrchestrationDiagnostics['objectives'] = [];
    let retrievalRounds = 0;
    const corpus = options?.documents;
    if (corpus) {
      // Weekly planning is a structured scope. One in-memory pass is enough;
      // do not turn each resource category into a separate retrieval round.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const todayIso = iso(today);
      const isClosed = (item: AskLedgerContextItem) => ['completed', 'complete', 'done', 'finished', 'cancelled', 'canceled'].includes(String(item.status ?? '').toLowerCase());
      const dateOf = (item: AskLedgerContextItem) => item.dueAt ?? item.timestamp ?? '';
      retrievalRounds = 1;
      const eligible = (query: PlanMyWeekQuery, item: AskLedgerContextItem) => {
        if (item.resourceType !== query.resourceTypes[0]) return false;
        const constraints = query.constraints;
        const date = dateOf(item).slice(0, 10);
        if (constraints.openOnly && isClosed(item)) return false;
        if (constraints.statuses?.length && !constraints.statuses.some((status) => status.toLowerCase() === String(item.status ?? '').toLowerCase())) return false;
        if (constraints.overdue && (!date || date >= todayIso || isClosed(item))) return false;
        if (constraints.horizon && (item.horizon ?? item.taskHorizon) !== constraints.horizon) return false;
        const basePlan = buildRetrievalPlan(query.query);
        if (basePlan.structuredConstraints.dueAfter && (!date || date < basePlan.structuredConstraints.dueAfter)) return false;
        if (basePlan.structuredConstraints.dueBefore && (!date || date > basePlan.structuredConstraints.dueBefore)) return false;
        return true;
      };
      for (const query of planMyWeekQueries) {
        const objectiveStartedAt = Date.now();
        const items = corpus.filter((item) => eligible(query, item)).slice(0, Math.min(20, limit));
        options?.onObjectiveTiming?.({ objectiveId: query.id, resourceTypes: [...query.resourceTypes], startedAt: objectiveStartedAt, completedAt: Date.now(), durationMs: Date.now() - objectiveStartedAt, candidateCount: items.length, selectedCount: items.length });
        items.forEach((item) => { if (!collected.has(keyFor(item)) && collected.size < Math.min(DEFAULT_LIMITS.maxEvidenceResources, limit)) collected.set(keyFor(item), item); });
        items.forEach((item) => debug.push({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, score: 1, why: [`objective:${query.id}`, 'structured'] }));
        objectives.push({ id: query.id, resourceTypes: [...query.resourceTypes], dependsOn: [], strategy: 'structured', graphExpansion: false, status: items.length ? 'found' : 'not_found', resourcesCollected: items.length });
      }
    }
    for (const query of planMyWeekQueries) {
      if (corpus) break;
      if (collected.size >= Math.min(DEFAULT_LIMITS.maxEvidenceResources, limit)) break;
      retrievalRounds += 1;
      const basePlan = buildRetrievalPlan(query.query);
      const plan: RetrievalPlan = {
        ...basePlan,
        primaryResourceTypes: [...query.resourceTypes],
        structuredConstraints: { ...basePlan.structuredConstraints, ...query.constraints, ...(query.constraints.statuses ? { statuses: [...query.constraints.statuses] } : {}) },
        semanticQuery: query.query,
        expandRelatedContext: false,
        retrievalStrategies: { semantic: false, lexical: true, exactEntity: false, structured: true },
      };
      const objectiveStartedAt = Date.now();
      const result = await this.retrieval.retrieve(workspaceId, query.query, lexicalResults, Math.min(20, limit), { conversationId: options?.conversationId, boostResourceKeys: options?.boostResourceKeys, plan, skipSemantic: true });
      const items = [...(result.primaryItems ?? result.items)].filter((item) => item.resourceType === query.resourceTypes[0]);
      options?.onObjectiveTiming?.({ objectiveId: query.id, resourceTypes: [...query.resourceTypes], startedAt: objectiveStartedAt, completedAt: Date.now(), durationMs: Date.now() - objectiveStartedAt, candidateCount: result.debug.length, selectedCount: items.length });
      items.forEach((item) => { if (!collected.has(keyFor(item)) && collected.size < Math.min(DEFAULT_LIMITS.maxEvidenceResources, limit)) collected.set(keyFor(item), item); });
      debug.push(...result.debug.map((candidate) => ({ ...candidate, why: [`objective:${query.id}`, ...candidate.why] })));
      objectives.push({ id: query.id, resourceTypes: [...query.resourceTypes], dependsOn: [], strategy: 'structured', graphExpansion: false, status: items.length ? 'found' : 'not_found', resourcesCollected: items.length });
    }
    const items = [...collected.values()].sort((left, right) => {
      const leftClosed = ['completed', 'complete', 'done', 'finished', 'cancelled', 'canceled'].includes(String(left.status ?? '').toLowerCase()) ? 1 : 0;
      const rightClosed = ['completed', 'complete', 'done', 'finished', 'cancelled', 'canceled'].includes(String(right.status ?? '').toLowerCase()) ? 1 : 0;
      if (leftClosed !== rightClosed) return leftClosed - rightClosed;
      return Date.parse(left.dueAt ?? left.timestamp ?? left.updatedAt ?? '') - Date.parse(right.dueAt ?? right.timestamp ?? right.updatedAt ?? '');
    });
    const provenance = items.map((item) => ({ resourceKey: keyFor(item), objectiveId: planMyWeekQueries.find((query) => query.resourceTypes.includes(item.resourceType))?.id ?? 'plan-my-week', path: [keyFor(item)] }));
    return {
      items,
      debug: debug.slice(0, limit),
      primaryItems: items,
      relatedItems: [],
      relatedCandidateCount: 0,
      mode: 'research' as const,
      orchestration: {
        mode: 'research' as const,
        objectives,
        retrievalRounds,
        discoveredEntities: [],
        coverage: Object.fromEntries([...new Set(planMyWeekQueries.map((query) => resourceCategory(query.resourceTypes[0])))].map((category) => [category, items.some((item) => resourceCategory(item.resourceType) === category) ? 'found' : 'not_found'])) as AskLedgerOrchestrationDiagnostics['coverage'],
        resourcesCollected: items.length,
        resourcesDiscarded: Math.max(0, debug.length - items.length),
        stopReason: 'objectives_satisfied' as const,
        provenance,
      },
    };
  }

  async retrieve(workspaceId: string, question: string, lexicalResults: Parameters<LedgerRetrievalService['retrieve']>[2] = [], limit = 20, options?: { conversationId?: string; boostResourceKeys?: string[]; resolvedResourceKeys?: string[]; documents?: AskLedgerContextItem[]; retrievalQuestion?: string; skillId?: AskLedgerSkillId; attachmentFocus?: boolean; skipSemantic?: boolean; onObjectiveTiming?: (timing: RetrievalObjectiveTiming) => void }): Promise<AskLedgerOrchestrationResult> {
    if (options?.skillId === 'plan_my_week') return this.retrievePlanMyWeek(workspaceId, lexicalResults, limit, options) as Promise<AskLedgerOrchestrationResult>;
    const skillSeedQuestion = options?.skillId === 'project_health_check'
      ? 'Look through the project work and tell me what is happening, blocked, and what still needs to happen.'
      : options?.skillId === 'meeting_follow_up' || options?.skillId === 'prepare_for_meeting'
        ? 'Look through the meetings and connected context, decisions, follow-ups, projects, tasks, and reminders.'
        : undefined;
    const orchestrationQuestion = skillSeedQuestion ?? question;
    const mode = options?.attachmentFocus ? 'quick' : classifyAskLedgerRetrievalMode(orchestrationQuestion);
    const searchQuestion = skillSeedQuestion || options?.retrievalQuestion?.trim() || orchestrationQuestion;
    if (mode === 'quick') {
      const plan = buildRetrievalPlan(question);
      const resolvedProjectIds = (options?.resolvedResourceKeys ?? []).filter((key) => key.startsWith('project:')).map((key) => key.slice('project:'.length));
      if (!plan.primaryResourceTypes.length && resolvedProjectIds.length) plan.primaryResourceTypes = ['project'];
      if (resolvedProjectIds.length) plan.structuredConstraints = { ...plan.structuredConstraints, projectIds: resolvedProjectIds };
      const quickCorpus = options?.documents ?? (typeof this.retrieval.indexedResources === 'function' ? this.retrieval.indexedResources(workspaceId, options?.conversationId) : []);
      const quickIntegration = new CachedAskLedgerIntegrationRetriever();
      const quickIntegrationResult = plan.integrationProviders?.length
        ? await quickIntegration.search({ workspaceId, query: plan.entityQuery ?? question, providers: plan.integrationProviders, limit, documents: quickCorpus })
        : undefined;
      const result = await this.retrieval.retrieve(workspaceId, searchQuestion, lexicalResults, limit, { conversationId: options?.conversationId, documents: options?.documents, boostResourceKeys: [...(options?.boostResourceKeys ?? []), ...(quickIntegrationResult?.results ?? []).map((entry) => keyFor(entry.item))], plan, skipSemantic: options?.skipSemantic ?? true, attachmentFocus: options?.attachmentFocus });
      return { ...result, mode, integrationRetrieval: quickIntegrationResult?.diagnostics, orchestration: { mode, objectives: [], retrievalRounds: 1, discoveredEntities: [], coverage: {}, resourcesCollected: result.items.length, resourcesDiscarded: 0, stopReason: 'quick_path', provenance: result.items.map((item) => ({ resourceKey: keyFor(item), objectiveId: 'quick', path: [keyFor(item)] })) } };
    }

    const limits = { ...DEFAULT_LIMITS, ...this.limits };
    const objectives = decomposeRetrievalObjectives(orchestrationQuestion).slice(0, limits.maxObjectives);
    if (options?.skillId === 'project_health_check' || options?.skillId === 'meeting_follow_up' || options?.skillId === 'prepare_for_meeting') {
      // The selected resource ID is the authoritative seed. Synthetic skill
      // wording must not turn words such as "project work" into a title filter.
      objectives.forEach((objective) => { objective.entityQuery = undefined; });
    }
    const corpus = options?.documents ?? (typeof this.retrieval.indexedResources === 'function' ? this.retrieval.indexedResources(workspaceId, options?.conversationId) : []);
    const collected = new Map<string, AskLedgerContextItem>();
    const provenance = new Map<string, { objectiveId: string; path: string[] }>();
    const statuses = new Map<string, AskLedgerOrchestrationDiagnostics['objectives'][number]['status']>();
    const completed = new Set<string>();
    const discoveredProjects = new Set<string>((options?.resolvedResourceKeys ?? []).filter((key) => key.startsWith('project:')).map((key) => key.slice('project:'.length)));
    const debug: LedgerRetrievalResult['debug'] = [];
    const primaryItems: AskLedgerContextItem[] = [];
    const relatedItems: AskLedgerContextItem[] = [];
    const graphSeedResources = new Set<string>();
    const integration = new CachedAskLedgerIntegrationRetriever();
    const integrationState: AskLedgerIntegrationDiagnostics = { requestedSources: [], availableSources: [], candidates: 0, selected: 0, localCacheCandidates: 0, remoteAttempts: 0, failures: [], explicitLinks: 0, discovered: 0, duplicateCollapses: 0 };
    const graphDepthCounts: Record<string, Record<string, number>> = {};
    const graphPaths: AskLedgerGraphExpansionDiagnostics['paths'] = [];
    let graphDeduplicated = 0;
    let graphCyclePrevented = 0;
    let graphTruncated = 0;
    let rounds = 0;
    let stopReason: AskLedgerOrchestrationDiagnostics['stopReason'] = 'objectives_satisfied';

    while (rounds < limits.maxRounds && completed.size < objectives.length && collected.size < limits.maxEvidenceResources) {
      rounds += 1;
      let progressed = false;
      for (const objective of objectives) {
        if (completed.has(objective.id) || objective.dependsOn.some((dependency) => !completed.has(dependency))) continue;
        const projectIds = objective.resourceTypes.some((type) => ['project', 'task', 'milestone', 'reminder'].includes(type)) ? [...discoveredProjects].slice(0, limits.maxDiscoveredEntities) : [];
        if (objective.dependsOn.length && !projectIds.length && objective.resourceTypes.some((type) => ['project', 'task', 'milestone', 'reminder'].includes(type))) {
          statuses.set(objective.id, 'not_found');
          completed.add(objective.id);
          continue;
        }
        const plan = buildObjectivePlan(searchQuestion, objective, projectIds);
        const objectiveStartedAt = Date.now();
        const provider = objective.id.startsWith('integration-') ? objective.id.slice('integration-'.length) : null;
        const integrationBoostKeys: string[] = [];
        if (provider && integration.supports(provider)) {
          const startedAt = Date.now();
          const integrationResult = await integration.search({ workspaceId, query: objective.entityQuery ?? searchQuestion, providers: [provider as never], limit: Math.min(limit, limits.maxEvidenceResources), documents: corpus });
          integrationResult.results.forEach((result) => integrationBoostKeys.push(keyFor(result.item)));
          integrationState.requestedSources = [...new Set([...integrationState.requestedSources, ...integrationResult.diagnostics.requestedSources])];
          integrationState.availableSources = [...new Set([...integrationState.availableSources, ...integrationResult.diagnostics.availableSources])];
          integrationState.candidates += integrationResult.diagnostics.candidates;
          integrationState.selected += integrationResult.diagnostics.selected;
          integrationState.localCacheCandidates += integrationResult.diagnostics.localCacheCandidates;
          integrationState.remoteAttempts += integrationResult.diagnostics.remoteAttempts;
          integrationState.explicitLinks += integrationResult.diagnostics.explicitLinks;
          integrationState.discovered += integrationResult.diagnostics.discovered;
          integrationState.latencyMs = (integrationState.latencyMs ?? 0) + Date.now() - startedAt;
        }
        const result = await this.retrieval.retrieve(workspaceId, plan.semanticQuery, lexicalResults, Math.min(limit, Math.max(8, limits.maxEvidenceResources)), {
          conversationId: options?.conversationId,
          documents: options?.documents,
          boostResourceKeys: [...(options?.boostResourceKeys ?? []), ...integrationBoostKeys],
          plan,
          graphLimits: { maxTotal: Math.min(20, limits.maxEvidenceResources) },
          graphRelationshipTypes: objective.graphRelationshipTypes,
          // Supplied corpora are authoritative structured inputs and have no
          // embedding vectors. Indexed research corpora retain semantic search.
          skipSemantic: options?.skipSemantic ?? (options?.documents ? true : undefined),
          attachmentFocus: options?.attachmentFocus,
        });
        if (result.graphExpansion) {
          result.graphExpansion.seedResources.forEach((seed) => graphSeedResources.add(seed));
          Object.entries(result.graphExpansion.depthCounts).forEach(([depth, counts]) => {
            graphDepthCounts[depth] ??= {};
            Object.entries(counts).forEach(([type, count]) => { graphDepthCounts[depth][type] = (graphDepthCounts[depth][type] ?? 0) + count; });
          });
          graphPaths.push(...result.graphExpansion.paths);
          graphDeduplicated += result.graphExpansion.deduplicated;
          graphCyclePrevented += result.graphExpansion.cyclePrevented;
          graphTruncated += result.graphExpansion.truncated;
        }
        const objectiveItems = [...(result.primaryItems ?? []), ...(result.relatedItems ?? [])];
        options?.onObjectiveTiming?.({ objectiveId: objective.id, resourceTypes: [...objective.resourceTypes], startedAt: objectiveStartedAt, completedAt: Date.now(), durationMs: Date.now() - objectiveStartedAt, candidateCount: result.debug.length, selectedCount: objectiveItems.length });
        objectiveItems.forEach((item) => {
          const key = keyFor(item);
          if (!collected.has(key) && collected.size < limits.maxEvidenceResources) {
            collected.set(key, item);
            const path = result.graphExpansion?.paths.find((candidate) => keyFor(candidate) === key)?.path ?? [key];
            provenance.set(key, { objectiveId: objective.id, path });
            if (item.resourceType === 'project') discoveredProjects.add(item.resourceId);
            progressed = true;
          }
        });
        primaryItems.push(...(result.primaryItems ?? []));
        relatedItems.push(...(result.relatedItems ?? []));
        debug.push(...result.debug.map((candidate) => ({ ...candidate, why: [`objective:${objective.id}`, ...candidate.why] })));
        statuses.set(objective.id, objectiveItems.length ? (result.graphExpansion?.truncated ? 'truncated' : 'found') : 'not_found');
        completed.add(objective.id);
      }
      if (!progressed && completed.size < objectives.length) {
        stopReason = 'no_new_entities';
        break;
      }
    }
    if (collected.size >= limits.maxEvidenceResources) stopReason = 'evidence_budget';
    else if (rounds >= limits.maxRounds && completed.size < objectives.length) stopReason = 'round_limit';
    else if (objectives.length >= limits.maxObjectives) stopReason = 'objective_limit';

    const unique = [...collected.values()];
    const objectiveDiagnostics = objectives.map((objective) => ({ id: objective.id, resourceTypes: objective.resourceTypes, dependsOn: objective.dependsOn, strategy: objective.constraints ? 'hybrid + structured' : 'hybrid', graphExpansion: objective.expandRelationships, status: statuses.get(objective.id) ?? 'skipped', resourcesCollected: unique.filter((item) => provenance.get(keyFor(item))?.objectiveId === objective.id).length }));
    const requestedTypes = [...new Set(objectives.flatMap((objective) => objective.resourceTypes))];
    const coverage = Object.fromEntries(requestedTypes.map((type) => [resourceCategory(type), unique.some((item) => item.resourceType === type) ? 'found' : 'not_found'])) as AskLedgerOrchestrationDiagnostics['coverage'];
    const orchestration: AskLedgerOrchestrationDiagnostics = { mode, objectives: objectiveDiagnostics, retrievalRounds: rounds, discoveredEntities: [...discoveredProjects].slice(0, limits.maxDiscoveredEntities).map((id) => corpus.find((item) => item.resourceType === 'project' && item.resourceId === id)?.title ?? id), coverage, resourcesCollected: unique.length, resourcesDiscarded: Math.max(0, debug.length - unique.length), stopReason, provenance: [...provenance.entries()].map(([resourceKey, value]) => ({ resourceKey, ...value })) };
    const graphExpansion: AskLedgerGraphExpansionDiagnostics | undefined = graphSeedResources.size || graphPaths.length ? {
      seedResources: [...graphSeedResources].sort(), depthCounts: graphDepthCounts, deduplicated: graphDeduplicated, cyclePrevented: graphCyclePrevented, truncated: graphTruncated, paths: graphPaths,
    } : undefined;
    return { items: unique, debug: debug.slice(0, limits.maxEvidenceResources), primaryItems: [...new Map(primaryItems.map((item) => [keyFor(item), item])).values()], relatedItems: [...new Map(relatedItems.map((item) => [keyFor(item), item])).values()], relatedCandidateCount: relatedItems.length, graphExpansion, mode, orchestration, integrationRetrieval: integrationState.requestedSources.length ? integrationState : undefined };
  }
}
