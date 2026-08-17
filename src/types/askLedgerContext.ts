export type AskLedgerResourceType =
  | 'project'
  | 'task'
  | 'note'
  | 'event'
  | 'reminder'
  | 'transcript'
  | 'intake'
  | 'person'
  | 'team'
  | 'external';

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
  updatedAt?: string;
  sourceLabel?: string;
  route?: string | Record<string, unknown>;
  parentResourceId?: string;
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
};
