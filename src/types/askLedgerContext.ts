export type AskLedgerResourceType =
  | 'project'
  | 'task'
  | 'milestone'
  | 'note'
  | 'event'
  | 'reminder'
  | 'transcript'
  | 'intake'
  | 'person'
  | 'team'
  | 'external'
  | 'attachment'
  | 'activity'
  | 'notification'
  | 'linked_resource';

export type AskLedgerRelationship = {
  relationshipType: AskLedgerRelationshipType;
  resourceType: AskLedgerResourceType;
  resourceId: string;
  direction?: 'inbound' | 'outbound';
  metadata?: Record<string, unknown>;
};

export type AskLedgerRelationshipType =
  | 'belongs_to_project'
  | 'belongs_to_milestone'
  | 'belongs_to_note'
  | 'linked_project'
  | 'linked_note'
  | 'linked_event'
  | 'linked_milestone'
  | 'linked_task'
  | 'linked_resource'
  | 'created_from_meeting'
  | 'has_meeting_note'
  | 'has_transcript'
  | 'has_task'
  | 'has_milestone'
  | 'has_note'
  | 'has_event'
  | 'has_reminder'
  | 'has_external_resource'
  | 'has_person'
  | 'linked_notification'
  | 'has_notification'
  | 'linked_activity'
  | 'has_activity'
  | 'belongs_to_team'
  | 'member_of_team'
  | 'assigned_to'
  | 'linked_reminder';

export type AskLedgerInitialContext = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  /** Optional one-shot question for contextual entry points. */
  initialQuestion?: string;
  handoff?: {
    kind: 'overview_focus';
    workspaceId: string;
    overviewDate: string;
    insights: Array<{ title: string; summary: string }>;
    resourceRefs: Array<{ resourceType: AskLedgerResourceType; resourceId: string; title: string }>;
  };
};

export type AskLedgerContextItem = {
  workspaceId?: string;
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  content: string;
  projectId?: string;
  milestoneId?: string;
  taskId?: string;
  noteId?: string;
  teamId?: string;
  assigneeId?: string;
  integrationProvider?: string;
  integrationResourceType?: string;
  externalId?: string;
  parentExternalId?: string;
  explicitIntegrationLink?: boolean;
  projectName?: string;
  status?: string;
  timestamp?: string;
  dueAt?: string;
  endAt?: string;
  priority?: string;
  severity?: string;
  read?: boolean;
  actorId?: string;
  recipientId?: string;
  alertType?: string;
  activityType?: string;
  taskHorizon?: string;
  /** Canonical name for task planning semantics; taskHorizon remains for compatibility. */
  horizon?: string;
  provenance?: string;
  updatedAt?: string;
  createdAt?: string;
  sourceLabel?: string;
  containerName?: string;
  route?: string | Record<string, unknown>;
  parentResourceId?: string;
  relationships?: AskLedgerRelationship[];
  metadata?: Record<string, unknown>;
  attachmentSource?: import('./askLedgerAttachments').AskLedgerAttachmentSource;
};

export type AskLedgerSource = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  route?: string | Record<string, unknown>;
  projectName?: string;
  projectId?: string;
  taskId?: string;
  noteId?: string;
  teamId?: string;
  integrationProvider?: string;
  integrationResourceType?: string;
  externalId?: string;
  explicitIntegrationLink?: boolean;
  sourceLabel?: string;
  updatedAt?: string;
  parentResourceId?: string;
  relationships?: AskLedgerRelationship[];
  attachmentSource?: import('./askLedgerAttachments').AskLedgerAttachmentSource;
};
