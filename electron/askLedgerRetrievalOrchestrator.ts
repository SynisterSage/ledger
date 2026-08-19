import type { AskLedgerContextItem, AskLedgerRelationshipType, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';
import type { AskLedgerGraphExpansionDiagnostics, AskLedgerIntegrationDiagnostics, AskLedgerOrchestrationDiagnostics } from '../src/types/askLedgerResourceContract.ts';
import { buildRetrievalPlan, type RetrievalPlan } from './askLedgerRetrievalPlan.ts';
import { LedgerRetrievalService, type LedgerRetrievalResult } from './ledgerRetrievalService.ts';
import { CachedAskLedgerIntegrationRetriever } from './askLedgerIntegrationRetrieval.ts';

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

  async retrieve(workspaceId: string, question: string, lexicalResults: Parameters<LedgerRetrievalService['retrieve']>[2] = [], limit = 20, options?: { conversationId?: string; boostResourceKeys?: string[]; resolvedResourceKeys?: string[]; documents?: AskLedgerContextItem[]; retrievalQuestion?: string }): Promise<AskLedgerOrchestrationResult> {
    const mode = classifyAskLedgerRetrievalMode(question);
    const searchQuestion = options?.retrievalQuestion?.trim() || question;
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
      const result = await this.retrieval.retrieve(workspaceId, searchQuestion, lexicalResults, limit, { conversationId: options?.conversationId, boostResourceKeys: [...(options?.boostResourceKeys ?? []), ...(quickIntegrationResult?.results ?? []).map((entry) => keyFor(entry.item))], plan });
      return { ...result, mode, integrationRetrieval: quickIntegrationResult?.diagnostics, orchestration: { mode, objectives: [], retrievalRounds: 1, discoveredEntities: [], coverage: {}, resourcesCollected: result.items.length, resourcesDiscarded: 0, stopReason: 'quick_path', provenance: result.items.map((item) => ({ resourceKey: keyFor(item), objectiveId: 'quick', path: [keyFor(item)] })) } };
    }

    const limits = { ...DEFAULT_LIMITS, ...this.limits };
    const objectives = decomposeRetrievalObjectives(question).slice(0, limits.maxObjectives);
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
          boostResourceKeys: [...(options?.boostResourceKeys ?? []), ...integrationBoostKeys],
          plan,
          graphLimits: { maxTotal: Math.min(20, limits.maxEvidenceResources) },
          graphRelationshipTypes: objective.graphRelationshipTypes,
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
