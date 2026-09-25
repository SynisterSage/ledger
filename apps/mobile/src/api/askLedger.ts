import { mobileRequest } from './client';

export type MobileAskLedgerMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  actions?: MobileAskLedgerAction[];
};

export type MobileAskLedgerAction = {
  id: string;
  type: 'create_task' | 'create_note' | 'create_reminder';
  payload: Record<string, unknown>;
  sourceMessageId: string;
  status: 'pending' | 'created' | 'failed' | 'rejected';
  idempotencyKey: string;
  resultResourceId?: string;
  resultTitle?: string;
  error?: string;
};

export type MobileAskLedgerSession = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: MobileAskLedgerMessage[];
};

export async function listMobileAskLedgerSessions(workspaceId: string, limit = 10) {
  return mobileRequest<{ sessions: MobileAskLedgerSession[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask-ledger/sessions?limit=${limit}`);
}

export async function getMobileAskLedgerSession(workspaceId: string, sessionId: string) {
  return mobileRequest<{ session: MobileAskLedgerSession }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask-ledger/sessions/${encodeURIComponent(sessionId)}`);
}

export async function createMobileAskLedgerSession(workspaceId: string, payload: { title: string; messages: MobileAskLedgerMessage[] }) {
  return mobileRequest<{ session: MobileAskLedgerSession }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask-ledger/sessions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMobileAskLedgerSession(workspaceId: string, sessionId: string, messages: MobileAskLedgerMessage[]) {
  return mobileRequest<{ session: MobileAskLedgerSession }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask-ledger/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ messages }),
  });
}

export async function deleteMobileAskLedgerSession(workspaceId: string, sessionId: string) {
  return mobileRequest<{ deleted: boolean }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ask-ledger/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function executeMobileAskLedgerAction(workspaceId: string, action: MobileAskLedgerAction) {
  return mobileRequest<{ resourceType: string; resource: { id?: string; title?: string } }>('/api/agent/actions', {
    method: 'POST',
    headers: {
      'x-workspace-id': workspaceId,
      'Idempotency-Key': action.idempotencyKey,
    },
    body: JSON.stringify({
      confirmed: true,
      action_type: action.type,
      idempotency_key: action.idempotencyKey,
      payload: action.payload,
    }),
  });
}
