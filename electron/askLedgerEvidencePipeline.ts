import type { AskLedgerContextItem, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';
import type {
  AskLedgerEvidenceDiagnostics,
  AskLedgerEvidencePackage,
  AskLedgerEvidenceScore,
  AskLedgerEvidenceSource,
  AskLedgerEvidenceSection,
  AskLedgerIntegrationDiagnostics,
  AskLedgerOrchestrationDiagnostics,
} from '../src/types/askLedgerResourceContract.ts';
import type { LedgerRetrievalResult, RetrievalDebugCandidate } from './ledgerRetrievalService.ts';

export type AskLedgerEvidenceBudget = {
  maxResources: number;
  maxTokens: number;
  maxItemTokens: number;
  maxTranscriptSegmentsPerParent: number;
};

export type RankedEvidence = {
  resource: AskLedgerContextItem;
  source: AskLedgerEvidenceSource;
  score: AskLedgerEvidenceScore;
};

export interface AskLedgerReranker {
  rank(query: string, evidence: RankedEvidence[]): RankedEvidence[];
}

const DEFAULT_BUDGETS: Record<'quick' | 'standard' | 'research', AskLedgerEvidenceBudget> = {
  quick: { maxResources: 6, maxTokens: 1800, maxItemTokens: 420, maxTranscriptSegmentsPerParent: 2 },
  standard: { maxResources: 12, maxTokens: 2800, maxItemTokens: 600, maxTranscriptSegmentsPerParent: 2 },
  research: { maxResources: 20, maxTokens: 4200, maxItemTokens: 720, maxTranscriptSegmentsPerParent: 3 },
};

const keyFor = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) => `${item.resourceType}:${item.resourceId}`;
const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const categoryFor = (type: AskLedgerResourceType) => type === 'event' ? 'meetings' : type === 'transcript' ? 'transcripts' : type === 'activity' ? 'activity' : `${type}s`;
const estimatedTokens = (value: string) => Math.ceil(value.length / 4);

const compactResourceText = (item: AskLedgerContextItem, maxTokens: number) => {
  const details = [
    item.title,
    item.status ? `Status: ${item.status}` : '',
    item.projectName ? `Project: ${item.projectName}` : '',
    item.dueAt ? `Due: ${item.dueAt}` : '',
    item.timestamp ? `Time: ${item.timestamp}` : '',
    item.horizon || item.taskHorizon ? `Horizon: ${item.horizon ?? item.taskHorizon}` : '',
    item.read !== undefined ? `Read: ${item.read ? 'yes' : 'no'}` : '',
    item.priority ? `Priority: ${item.priority}` : '',
    item.severity ? `Severity: ${item.severity}` : '',
    item.activityType ? `Activity: ${item.activityType}` : '',
    item.teamId ? `Teamspace: ${item.teamId}` : '',
    item.integrationProvider ? `Source: ${item.integrationProvider}${item.integrationResourceType ? ` ${item.integrationResourceType}` : ''}` : '',
    item.content,
  ].filter(Boolean).join(' — ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const maxCharacters = Math.max(80, maxTokens * 4);
  return details.length > maxCharacters ? `${details.slice(0, maxCharacters).trim()}…` : details;
};

const debugSignals = (debug: RetrievalDebugCandidate[], item: AskLedgerContextItem) => {
  const matches = debug.filter((candidate) => candidate.resourceType === item.resourceType && candidate.resourceId === item.resourceId);
  const best = matches.sort((left, right) => right.score - left.score)[0];
  return { best, matches };
};

const scoreEvidence = (item: AskLedgerContextItem, debug: RetrievalDebugCandidate[], source: AskLedgerEvidenceSource, requested: Set<string>): AskLedgerEvidenceScore => {
  const { best, matches } = debugSignals(debug, item);
  const retrievalRelevance = Math.min(1, Math.max(0, (best?.score ?? 0) / 2));
  const pathDepth = Math.max(0, source.relationshipPath.length - 1);
  const directRelationship = pathDepth === 1 || Boolean(item.projectId || item.milestoneId);
  const structuralRelevance = Math.min(1, (directRelationship ? 0.88 : pathDepth === 2 ? 0.72 : pathDepth > 2 ? 0.48 : 0.58) + (best?.structuredMatch ? 0.12 : 0));
  const timestamp = Date.parse(item.updatedAt ?? item.timestamp ?? item.dueAt ?? '');
  const ageDays = Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 86_400_000) : 30;
  const temporalRelevance = Math.max(0.1, Math.min(1, 1 - ageDays / 90)) + (item.resourceType === 'task' && (item.horizon ?? item.taskHorizon) === 'today' ? 0.25 : 0);
  const objectiveRelevance = requested.has(categoryFor(item.resourceType)) ? 1 : matches.some((candidate) => candidate.why.some((reason) => reason.startsWith('objective:'))) ? 0.72 : 0.35;
  const authority = item.resourceType === 'project' || item.resourceType === 'milestone' || item.resourceType === 'task' || item.resourceType === 'event' ? 0.92 : item.resourceType === 'note' || item.resourceType === 'transcript' || item.resourceType === 'activity' || item.resourceType === 'notification' ? 0.8 : item.resourceType === 'external' && item.explicitIntegrationLink ? 0.82 : 0.62;
  const attentionBoost = item.resourceType === 'notification' && item.read === false ? 0.16 : ['high', 'urgent', 'critical'].includes(String(item.priority ?? item.severity ?? '').toLowerCase()) ? 0.12 : item.resourceType === 'external' && item.explicitIntegrationLink ? 0.08 : 0;
  const reasons = [
    requested.has(categoryFor(item.resourceType)) ? `requested-category:${categoryFor(item.resourceType)}` : '',
    directRelationship ? 'direct-ledger-relationship' : pathDepth ? `relationship-distance:${pathDepth}` : '',
    best?.structuredMatch ? 'structured-match' : '',
    best?.exactEntityMatch ? 'exact-entity-match' : '',
    item.resourceType === 'task' && (item.horizon ?? item.taskHorizon) === 'today' ? 'horizon:today' : '',
    item.resourceType === 'task' && !['completed', 'complete', 'done', 'cancelled', 'canceled'].includes(String(item.status ?? '').toLowerCase()) ? 'open' : '',
    item.resourceType === 'notification' && item.read === false ? 'unread' : '',
    ['high', 'urgent', 'critical'].includes(String(item.priority ?? item.severity ?? '').toLowerCase()) ? `priority:${String(item.priority ?? item.severity).toLowerCase()}` : '',
    item.resourceType === 'activity' && item.sourceLabel === 'Circle' ? 'teamspace-activity' : '',
    item.explicitIntegrationLink ? 'explicit-integration-link' : item.resourceType === 'external' ? 'integration-context' : '',
    source.objectiveId ? `discovered-by:${source.objectiveId}` : '',
  ].filter(Boolean);
  const finalScore = Math.min(1, retrievalRelevance * 0.3 + structuralRelevance * 0.28 + temporalRelevance * 0.1 + objectiveRelevance * 0.17 + authority * 0.15 + attentionBoost);
  return { retrievalRelevance, structuralRelevance, temporalRelevance, objectiveRelevance, authority, finalScore, reasons };
};

const sourceFor = (item: AskLedgerContextItem, orchestration?: AskLedgerOrchestrationDiagnostics): AskLedgerEvidenceSource => {
  const provenance = orchestration?.provenance.find((entry) => entry.resourceKey === keyFor(item));
  return { resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, objectiveId: provenance?.objectiveId, relationshipPath: provenance?.path ?? [keyFor(item)], score: { retrievalRelevance: 0, structuralRelevance: 0, temporalRelevance: 0, objectiveRelevance: 0, authority: 0, finalScore: 0, reasons: [] } };
};

const requestedCategoriesFor = (result: LedgerRetrievalResult & { orchestration?: AskLedgerOrchestrationDiagnostics }) => {
  const requested = Object.keys(result.orchestration?.coverage ?? {});
  if (requested.length) return requested;
  return [...new Set((result.primaryItems?.length ? result.primaryItems : result.items).map((item) => categoryFor(item.resourceType)))];
};

const sectionTitle = (category: string) => category.charAt(0).toUpperCase() + category.slice(1);

export class DeterministicAskLedgerReranker implements AskLedgerReranker {
  rank(_query: string, evidence: RankedEvidence[]) {
    return [...evidence].sort((left, right) => right.score.finalScore - left.score.finalScore || left.resource.resourceType.localeCompare(right.resource.resourceType) || left.resource.resourceId.localeCompare(right.resource.resourceId));
  }
}

export type AskLedgerEvidencePipelineResult = {
  package: AskLedgerEvidencePackage;
  selectedItems: AskLedgerContextItem[];
  ranked: RankedEvidence[];
  diagnostics: AskLedgerEvidenceDiagnostics;
};

export const compileAskLedgerEvidence = (input: {
  question: string;
  result: LedgerRetrievalResult & { mode?: 'quick' | 'research'; orchestration?: AskLedgerOrchestrationDiagnostics; integrationRetrieval?: AskLedgerIntegrationDiagnostics };
  items?: AskLedgerContextItem[];
  budget?: Partial<AskLedgerEvidenceBudget>;
}): AskLedgerEvidencePipelineResult => {
  const mode = input.result.mode ?? input.result.orchestration?.mode ?? 'standard';
  const budget = { ...DEFAULT_BUDGETS[mode], ...input.budget };
  const rawItems = input.items ?? input.result.items;
  const requested = new Set(requestedCategoriesFor(input.result));
  const dropReasons: Record<string, number> = {};
  const uniqueItems: AskLedgerContextItem[] = [];
  const fingerprints = new Set<string>();
  for (const item of rawItems) {
    const key = keyFor(item);
    if (uniqueItems.some((candidate) => keyFor(candidate) === key)) { dropReasons.duplicate = (dropReasons.duplicate ?? 0) + 1; continue; }
    const providerIdentity = item.integrationProvider && item.externalId ? `${item.integrationProvider}:${item.externalId}` : undefined;
    if (providerIdentity && uniqueItems.some((candidate) => candidate.integrationProvider && candidate.externalId && `${candidate.integrationProvider}:${candidate.externalId}` === providerIdentity)) { dropReasons.duplicate_external_identity = (dropReasons.duplicate_external_identity ?? 0) + 1; continue; }
    const fingerprint = normalize(item.content);
    if (item.resourceType === 'transcript' && fingerprint && fingerprints.has(fingerprint)) { dropReasons.redundant_transcript = (dropReasons.redundant_transcript ?? 0) + 1; continue; }
    if (item.resourceType === 'transcript' && fingerprint) fingerprints.add(fingerprint);
    const underlying = item.metadata?.dedupeKey ?? (item.metadata?.sourceType && item.metadata?.sourceId ? `${item.metadata.sourceType}:${item.metadata.sourceId}:${item.metadata.notificationType ?? item.activityType ?? ''}` : undefined);
    if (underlying && uniqueItems.some((candidate) => candidate.metadata?.dedupeKey === underlying || `${candidate.metadata?.sourceType ?? ''}:${candidate.metadata?.sourceId ?? ''}:${candidate.metadata?.notificationType ?? candidate.activityType ?? ''}` === underlying)) { dropReasons.duplicate_activity_notification = (dropReasons.duplicate_activity_notification ?? 0) + 1; continue; }
    uniqueItems.push(item);
  }
  const ranked = new DeterministicAskLedgerReranker().rank(input.question, uniqueItems.map((item) => {
    const source = sourceFor(item, input.result.orchestration);
    const score = scoreEvidence(item, input.result.debug, source, requested);
    return { resource: item, source: { ...source, score }, score };
  }));

  const selected: RankedEvidence[] = [];
  const selectedKeys = new Set<string>();
  const transcriptCounts = new Map<string, number>();
  let usedTokens = 0;
  const trySelect = (candidate: RankedEvidence, required = false) => {
    const key = keyFor(candidate.resource);
    if (selectedKeys.has(key)) return false;
    const parent = candidate.resource.parentResourceId ?? candidate.resource.projectId ?? 'unparented';
    if (candidate.resource.resourceType === 'transcript' && (transcriptCounts.get(parent) ?? 0) >= budget.maxTranscriptSegmentsPerParent) { dropReasons.redundant_transcript = (dropReasons.redundant_transcript ?? 0) + 1; return false; }
    const tokens = estimatedTokens(compactResourceText(candidate.resource, budget.maxItemTokens));
    if (!required && (selected.length >= budget.maxResources || usedTokens + tokens > budget.maxTokens)) return false;
    if (required && selected.length >= budget.maxResources) return false;
    selected.push(candidate); selectedKeys.add(key); usedTokens += tokens;
    if (candidate.resource.resourceType === 'transcript') transcriptCounts.set(parent, (transcriptCounts.get(parent) ?? 0) + 1);
    return true;
  };
  for (const category of requested) {
    const candidate = ranked.find((entry) => categoryFor(entry.resource.resourceType) === category);
    if (candidate) trySelect(candidate, true);
  }
  for (const candidate of ranked) trySelect(candidate);
  ranked.filter((candidate) => !selectedKeys.has(keyFor(candidate.resource))).forEach((candidate) => {
    const reason = selected.length >= budget.maxResources || usedTokens >= budget.maxTokens ? 'context_budget' : candidate.score.finalScore < 0.24 ? 'weak_relevance' : 'coverage_selection';
    dropReasons[reason] = (dropReasons[reason] ?? 0) + 1;
  });

  const selectedByCategory = new Map<string, RankedEvidence[]>();
  selected.forEach((entry) => selectedByCategory.set(categoryFor(entry.resource.resourceType), [...(selectedByCategory.get(categoryFor(entry.resource.resourceType)) ?? []), entry]));
  const sections: AskLedgerEvidenceSection[] = [...selectedByCategory.entries()].map(([category, entries]) => ({ category, title: sectionTitle(category), items: entries.sort((left, right) => left.resource.resourceType === 'transcript' && right.resource.resourceType === 'transcript' ? (Date.parse(left.resource.timestamp ?? '') || 0) - (Date.parse(right.resource.timestamp ?? '') || 0) : right.score.finalScore - left.score.finalScore).map((entry) => ({ resource: entry.resource, source: entry.source })) }));
  const found = [...new Set(sections.map((section) => section.category))];
  const missing = [...requested].filter((category) => !found.includes(category) && input.result.orchestration?.coverage[category] !== 'truncated');
  const truncated = [...requested].filter((category) => input.result.orchestration?.coverage[category] === 'truncated' || (found.includes(category) && ranked.filter((entry) => categoryFor(entry.resource.resourceType) === category).length > selected.filter((entry) => categoryFor(entry.resource.resourceType) === category).length));
  const sourceLines = selected.map((entry) => `${entry.resource.title} [${keyFor(entry.resource)}]${entry.source.relationshipPath.length > 1 ? ` via ${entry.source.relationshipPath.join(' → ')}` : ''}`);
  const textParts = [
    `REQUEST\n${input.question}`,
    `COVERAGE\nRequested: ${[...requested].join(', ') || 'workspace evidence'}\nFound: ${found.join(', ') || 'none'}\nMissing: ${missing.join(', ') || 'none'}${truncated.length ? `\nTruncated: ${truncated.join(', ')}` : ''}`,
    ...sections.map((section) => `${section.title.toUpperCase()}\n${section.items.map(({ resource, source }) => `- ${compactResourceText(resource, budget.maxItemTokens)}\n  Source: ${source.resourceType}:${source.resourceId}${source.objectiveId ? ` · ${source.objectiveId}` : ''}${source.relationshipPath.length > 1 ? `\n  Path: ${source.relationshipPath.join(' → ')}` : ''}`).join('\n')}`),
    sourceLines.length ? `RELATIONSHIPS AND SOURCES\n${sourceLines.join('\n')}` : '',
  ].filter(Boolean);
  const text = textParts.join('\n\n');
  const unavailable = [...new Set((input.result.integrationRetrieval?.failures ?? []).filter((failure) => /unavailable|failed|denied|timeout|error/i.test(failure.status)).map((failure) => failure.provider))];
  const notConnected = [...new Set((input.result.integrationRetrieval?.failures ?? []).filter((failure) => /not_connected|not connected|no_cached_context/i.test(failure.status)).map((failure) => failure.provider))];
  const packageValue: AskLedgerEvidencePackage = { request: input.question, coverage: { requested: [...requested], found, missing, truncated, ...(unavailable.length ? { unavailable } : {}), ...(notConnected.length ? { notConnected } : {}) }, sections, sources: selected.map((entry) => entry.source), stats: { retrieved: rawItems.length, selected: selected.length, dropped: Math.max(0, rawItems.length - selected.length), estimatedTokens: estimatedTokens(text), estimatedTokensBefore: rawItems.reduce((sum, item) => sum + estimatedTokens(compactResourceText(item, budget.maxItemTokens)), 0) }, text };
  const selectedNotifications = selected.filter((entry) => entry.resource.resourceType === 'notification');
  const selectedActivity = selected.filter((entry) => entry.resource.resourceType === 'activity');
  return { package: packageValue, selectedItems: selected.map((entry) => entry.resource), ranked, diagnostics: { inputResources: rawItems.length, selectedResources: selected.length, droppedResources: Math.max(0, rawItems.length - selected.length), estimatedTokens: { before: packageValue.stats.estimatedTokensBefore, after: packageValue.stats.estimatedTokens }, selectedByType: selected.reduce<Record<string, number>>((counts, entry) => { counts[entry.resource.resourceType] = (counts[entry.resource.resourceType] ?? 0) + 1; return counts; }, {}), dropReasons, topScores: ranked.slice(0, 8).map((entry) => ({ resourceKey: keyFor(entry.resource), score: entry.score.finalScore, reasons: entry.score.reasons.slice(0, 5) })), notificationState: selectedNotifications.reduce((state, entry) => { entry.resource.read ? state.read += 1 : state.unread += 1; return state; }, { unread: 0, read: 0 }), activitySignals: selectedActivity.reduce((state, entry) => { const priority = String(entry.resource.priority ?? entry.resource.severity ?? '').toLowerCase(); if (['high', 'urgent', 'critical'].includes(priority)) state.highPriority += 1; else state.standard += 1; return state; }, { highPriority: 0, standard: 0 }), duplicateActivityNotificationCollapses: dropReasons.duplicate_activity_notification ?? 0 } };
};
