import type { AskLedgerContextItem, AskLedgerRelationship, AskLedgerResourceType } from './askLedgerContext.ts';

export type AskLedgerResourceInventoryEntry = {
  resourceType: AskLedgerResourceType;
  source: string;
  searchable: boolean;
  currentlyIndexed: boolean;
  primaryTextFields: readonly string[];
  metadataFields: readonly string[];
  relationshipFields: readonly string[];
  temporalFields: readonly string[];
  notes?: string;
};

/** The repository-backed resource contract. A missing runtime document is intentional and auditable. */
export const ASK_LEDGER_RESOURCE_INVENTORY: readonly AskLedgerResourceInventoryEntry[] = [
  { resourceType: 'project', source: 'projects', searchable: true, currentlyIndexed: true, primaryTextFields: ['name', 'description'], metadataFields: ['status', 'completeness'], relationshipFields: ['id -> task.project_id', 'id -> project_milestones.project_id', 'id -> project_note_links.project_id'], temporalFields: ['start_date', 'end_date', 'updated_at'] },
  { resourceType: 'milestone', source: 'project_milestones', searchable: true, currentlyIndexed: true, primaryTextFields: ['title', 'note'], metadataFields: ['type', 'completed', 'project_id'], relationshipFields: ['project_id', 'task.milestone_id'], temporalFields: ['milestone_date', 'updated_at'] },
  { resourceType: 'task', source: 'tasks', searchable: true, currentlyIndexed: true, primaryTextFields: ['title', 'description'], metadataFields: ['status', 'priority', 'task_horizon', 'source', 'assigned_to'], relationshipFields: ['project_id', 'milestone_id', 'meeting_transcript_links'], temporalFields: ['due_date', 'due_time', 'created_at', 'updated_at'], notes: 'Next action, short-term, long-term, future, overdue, blocked, and completed are semantics of task fields/status, not separate resource rows.' },
  { resourceType: 'note', source: 'notes', searchable: true, currentlyIndexed: true, primaryTextFields: ['title', 'content', 'content_html'], metadataFields: ['section_id', 'mode'], relationshipFields: ['project_note_links.project_id', 'meeting_note_metadata.calendar_event_id'], temporalFields: ['created_at', 'updated_at'] },
  { resourceType: 'event', source: 'events', searchable: true, currentlyIndexed: true, primaryTextFields: ['title', 'notes'], metadataFields: ['status', 'source', 'source_platform'], relationshipFields: ['project_id', 'note_id', 'meeting_note_metadata.note_id'], temporalFields: ['start_at', 'end_at', 'created_at', 'updated_at'] },
  { resourceType: 'reminder', source: 'reminders', searchable: true, currentlyIndexed: true, primaryTextFields: ['title', 'body'], metadataFields: ['status', 'source', 'linked_type', 'linked_id'], relationshipFields: ['project_id', 'note_id', 'linked_id'], temporalFields: ['remind_at', 'created_at', 'updated_at'] },
  { resourceType: 'transcript', source: 'meeting_note_transcript_segments', searchable: true, currentlyIndexed: true, primaryTextFields: ['transcript_text', 'speaker_label'], metadataFields: ['audio_source', 'start_ms'], relationshipFields: ['note_id', 'meeting_transcript_links'], temporalFields: ['start_ms', 'updated_at'] },
  { resourceType: 'intake', source: 'inbox_items', searchable: true, currentlyIndexed: true, primaryTextFields: ['title', 'body', 'source'], metadataFields: ['converted_type', 'converted_id', 'source_provider'], relationshipFields: ['converted_id'], temporalFields: ['created_at', 'updated_at'] },
  { resourceType: 'team', source: 'workspace_teams', searchable: true, currentlyIndexed: true, primaryTextFields: ['name', 'identifier', 'description'], metadataFields: [], relationshipFields: ['workspace_team_members.team_id'], temporalFields: ['created_at', 'updated_at'] },
  { resourceType: 'person', source: 'workspace_team_members + users', searchable: true, currentlyIndexed: true, primaryTextFields: ['full_name', 'email'], metadataFields: ['role'], relationshipFields: ['team_id'], temporalFields: ['created_at'] },
  { resourceType: 'external', source: 'external_references + integration snapshots', searchable: true, currentlyIndexed: true, primaryTextFields: ['metadata.title', 'metadata.body', 'metadata.description', 'message_text', 'reason'], metadataFields: ['provider', 'external_type', 'external_id', 'access_status', 'metadata'], relationshipFields: ['external_reference_links.target_id'], temporalFields: ['message_created_at', 'last_seen_at', 'created_at', 'updated_at'], notes: 'Provider and external subtype are preserved; external remains the workspace contract type.' },
  { resourceType: 'attachment', source: 'conversation attachment service', searchable: true, currentlyIndexed: true, primaryTextFields: ['extracted text'], metadataFields: ['fileName', 'mimeType', 'pageNumber', 'section', 'rowStart'], relationshipFields: [], temporalFields: [], notes: 'Conversation-scoped; not part of the workspace ai-documents endpoint.' },
  { resourceType: 'activity', source: 'workspace_audit_logs / integration activity', searchable: true, currentlyIndexed: true, primaryTextFields: ['action', 'metadata'], metadataFields: ['actor_user_id', 'target_type', 'target_id', 'metadata'], relationshipFields: ['target_id', 'metadata.project_id', 'metadata.task_id', 'metadata.milestone_id', 'metadata.note_id', 'metadata.team_id'], temporalFields: ['created_at'], notes: 'Only human-meaningful activity is indexed; low-value audit noise remains excluded.' },
  { resourceType: 'notification', source: 'notification_events', searchable: true, currentlyIndexed: true, primaryTextFields: ['metadata.title', 'metadata.body', 'metadata.context'], metadataFields: ['notification_type', 'read_at', 'dismissed_at', 'action_taken', 'metadata', 'user_id'], relationshipFields: ['source_type/source_id'], temporalFields: ['scheduled_for', 'delivered_in_app_at', 'created_at', 'updated_at'], notes: 'User-recipient notifications are workspace-scoped and remain distinct from reminders.' },
  { resourceType: 'linked_resource', source: 'ledger_context_links / external_reference_links / project_note_links', searchable: false, currentlyIndexed: false, primaryTextFields: [], metadataFields: ['relationship_type', 'link_metadata'], relationshipFields: ['resource_a_id', 'resource_b_id', 'target_type', 'target_id'], temporalFields: ['created_at'], notes: 'Relationships are partially copied onto documents, but link rows are not independently indexed.' },
] as const;

export type AskLedgerResource = AskLedgerContextItem;

export type AskLedgerDocumentInventory = Record<string, number>;

export type AskLedgerDocumentDiagnostics = {
  available: AskLedgerDocumentInventory;
  indexed: AskLedgerDocumentInventory;
  retrieved: AskLedgerDocumentInventory;
  selected: AskLedgerDocumentInventory;
  notIndexed: AskLedgerDocumentInventory;
  notRetrieved: AskLedgerDocumentInventory;
  droppedFromContext: AskLedgerDocumentInventory;
  graphExpansion?: AskLedgerGraphExpansionDiagnostics;
  hybridRetrieval?: AskLedgerHybridRetrievalDiagnostics;
  orchestration?: AskLedgerOrchestrationDiagnostics;
  evidence?: AskLedgerEvidenceDiagnostics;
  attention?: AskLedgerAttentionDiagnostics;
  integrationRetrieval?: AskLedgerIntegrationDiagnostics;
  generation?: AskLedgerGenerationDiagnostics;
};

export type AskLedgerGenerationDiagnostics = {
  answerDepth: 'quick' | 'standard' | 'deep';
  depthReason: string;
  evidenceResources: number;
  evidenceTokens: number;
  modelTier?: string;
  reasoningMode?: 'off' | 'thinking';
  reasoningReason?: string;
  reasoningEnabled?: boolean;
  reasoningBudget?: number;
  reasoningTokens?: number;
  reasoningDurationMs?: number;
  visibleAnswerBudget?: number;
  visibleTokens?: number;
  outputTokens?: number;
  generationMs?: number;
  truncated?: boolean;
  missingEvidence: string[];
  modelRouting?: {
    requestedTier: string;
    recommendedTier: string;
    resolvedTier: string;
    reasoningMode?: string;
    reasoningReason?: string;
    fallbackReason?: string;
    reason: string;
  };
  performance?: AskLedgerPerformanceDiagnostics;
};

export type AskLedgerPerformanceDiagnostics = {
  totalMs?: number;
  routingMs?: number;
  indexingMs?: number;
  retrievalMs?: number;
  orchestrationMs?: number;
  evidenceMs?: number;
  generationMs?: number;
  validationMs?: number;
  repairMs?: number;
  evidenceTokens?: number;
  outputTokens?: number;
  retrievalRounds?: number;
  graphResources?: number;
  providerCalls?: number;
  cacheHits?: number;
};

export type AskLedgerIntegrationDiagnostics = {
  requestedSources: string[];
  availableSources: string[];
  candidates: number;
  selected: number;
  localCacheCandidates: number;
  remoteAttempts: number;
  failures: Array<{ provider: string; status: string }>;
  explicitLinks: number;
  discovered: number;
  duplicateCollapses: number;
  latencyMs?: number;
};

export type AskLedgerAttentionDiagnostics = {
  activityInventory: number;
  notificationInventory: number;
  activityRetrieved: number;
  notificationRetrieved: number;
  activitySelected: number;
  notificationSelected: number;
  notificationState: { unread: number; read: number };
  alertState: { highPriority: number; standard: number };
  duplicateActivityNotificationCollapses: number;
  temporalFilter?: string;
  teamspaceFilter?: string;
};

export type AskLedgerEvidenceScore = {
  retrievalRelevance: number;
  structuralRelevance: number;
  temporalRelevance: number;
  objectiveRelevance: number;
  authority: number;
  finalScore: number;
  reasons: string[];
};

export type AskLedgerEvidenceSource = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  objectiveId?: string;
  relationshipPath: string[];
  score: AskLedgerEvidenceScore;
};

export type AskLedgerEvidenceSection = {
  category: string;
  title: string;
  items: Array<{ resource: AskLedgerContextItem; source: AskLedgerEvidenceSource }>;
};

export type AskLedgerEvidencePackage = {
  request: string;
  coverage: {
    requested: string[];
    found: string[];
    missing: string[];
    truncated: string[];
    unavailable?: string[];
    notConnected?: string[];
  };
  sections: AskLedgerEvidenceSection[];
  sources: AskLedgerEvidenceSource[];
  stats: { retrieved: number; selected: number; dropped: number; estimatedTokens: number; estimatedTokensBefore: number };
  text: string;
};

export type AskLedgerEvidenceDiagnostics = {
  inputResources: number;
  selectedResources: number;
  droppedResources: number;
  estimatedTokens: { before: number; after: number };
  selectedByType: AskLedgerDocumentInventory;
  dropReasons: Record<string, number>;
  topScores: Array<{ resourceKey: string; score: number; reasons: string[] }>;
  notificationState?: { unread: number; read: number };
  activitySignals?: { highPriority: number; standard: number };
  duplicateActivityNotificationCollapses?: number;
  structuredValues?: {
    rawIsoDateObserved: boolean;
    raw24HourTimeObserved: boolean;
    invalidDateDetected: boolean;
    invalidTimeDetected: boolean;
    dateNormalizationFailure: boolean;
    relativeDateAvailableButUnused: boolean;
    dueStateMismatchDetected: boolean;
  };
};

export type AskLedgerAnswerValidationDiagnostics = {
  validationTriggered?: boolean;
  validationReason?: string;
  repairRequired?: boolean;
  passed: boolean;
  coverageIssues: number;
  groundednessIssues: number;
  contradictionIssues: number;
  missingEvidenceIssues: number;
  repairAttempted: boolean;
  repairSucceeded?: boolean;
  sourcesUsed: number;
  durationMs: number;
  repairDurationMs?: number;
  repairGenerationMs?: number;
  repairTokens?: number;
  outputGuard?: import('./askLedgerOutputGuard').AskLedgerOutputGuardDiagnostics;
};

export type AskLedgerOrchestrationDiagnostics = {
  mode: 'quick' | 'research';
  objectives: Array<{
    id: string;
    resourceTypes: AskLedgerResourceType[];
    dependsOn: string[];
    strategy: string;
    graphExpansion: boolean;
    status: 'found' | 'not_found' | 'truncated' | 'skipped';
    resourcesCollected: number;
  }>;
  retrievalRounds: number;
  discoveredEntities: string[];
  coverage: Record<string, 'found' | 'not_found' | 'not_requested' | 'truncated'>;
  resourcesCollected: number;
  resourcesDiscarded: number;
  stopReason: 'quick_path' | 'objectives_satisfied' | 'no_new_entities' | 'evidence_budget' | 'round_limit' | 'objective_limit';
  provenance: Array<{ resourceKey: string; objectiveId: string; path: string[] }>;
};

export type AskLedgerHybridRetrievalDiagnostics = {
  retrievalStrategies: { semantic: boolean; lexical: boolean; exactEntity: boolean; structured: boolean };
  candidateCounts: { semantic: number; lexical: number; exact: number; structured: number };
  candidatesRemoved: { resourceType: number; structured: number };
  duplicateCandidateMerges: number;
  authoritativeZeroMatches: boolean;
  finalSeedCount: number;
  selectedSeeds: string[];
  selectionReasons: string[];
};

export type AskLedgerGraphExpansionDiagnostics = {
  seedResources: string[];
  depthCounts: Record<string, Record<string, number>>;
  deduplicated: number;
  cyclePrevented: number;
  truncated: number;
  paths: Array<{ resourceType: AskLedgerResourceType; resourceId: string; depth: number; path: string[] }>;
};

const countByType = (items: Array<Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>>) => {
  const seen = new Set<string>();
  return items.reduce<AskLedgerDocumentInventory>((counts, item) => {
    const key = `${item.resourceType}:${item.resourceId}`;
    if (seen.has(key)) return counts;
    seen.add(key);
    counts[item.resourceType] = (counts[item.resourceType] ?? 0) + 1;
    return counts;
  }, {});
};

const positiveDifference = (left: AskLedgerDocumentInventory, right: AskLedgerDocumentInventory) =>
  Object.fromEntries(Object.entries(left).flatMap(([type, count]) => {
    const difference = count - (right[type] ?? 0);
    return difference > 0 ? [[type, difference]] : [];
  }));

export const buildAskLedgerDocumentDiagnostics = (input: {
  available: AskLedgerContextItem[];
  indexed: AskLedgerContextItem[];
  retrieved: AskLedgerContextItem[];
  selected: AskLedgerContextItem[];
}): AskLedgerDocumentDiagnostics => {
  const available = countByType(input.available);
  const indexed = countByType(input.indexed);
  const retrieved = countByType(input.retrieved);
  const selected = countByType(input.selected);
  return {
    available,
    indexed,
    retrieved,
    selected,
    notIndexed: positiveDifference(available, indexed),
    notRetrieved: positiveDifference(indexed, retrieved),
    droppedFromContext: positiveDifference(retrieved, selected),
  };
};

export type { AskLedgerRelationship };
