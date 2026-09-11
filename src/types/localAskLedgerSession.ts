export type LocalAskLedgerSession = {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: unknown[];
  summary?: string;
  initialContext?: unknown;
  skillId?: unknown;
  privacyScope: 'device';
};
