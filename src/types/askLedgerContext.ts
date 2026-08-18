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
  | 'attachment';

export type AskLedgerInitialContext = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
};

export type AskLedgerContextItem = {
  workspaceId?: string;
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  content: string;
  projectId?: string;
  projectName?: string;
  status?: string;
  timestamp?: string;
  dueAt?: string;
  endAt?: string;
  priority?: string;
  taskHorizon?: string;
  provenance?: string;
  updatedAt?: string;
  sourceLabel?: string;
  containerName?: string;
  route?: string | Record<string, unknown>;
  parentResourceId?: string;
  attachmentSource?: import('./askLedgerAttachments').AskLedgerAttachmentSource;
};

export type AskLedgerSource = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  title: string;
  route?: string | Record<string, unknown>;
  projectName?: string;
  projectId?: string;
  sourceLabel?: string;
  updatedAt?: string;
  parentResourceId?: string;
  attachmentSource?: import('./askLedgerAttachments').AskLedgerAttachmentSource;
};
