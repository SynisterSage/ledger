import { Check, CircleAlert, Loader2, Plug2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';

type AuthorizationSession = {
  client_name: string;
  requested_scopes: string[];
  requested_workspace_id?: string | null;
  status: string;
};

type Workspace = { id: string; name: string; is_personal?: boolean };

const scopeLabels: Record<string, string> = {
  'workspace:read': 'View workspace context',
  'projects:read': 'View projects',
  'tasks:read': 'View tasks',
  'notes:read': 'View notes',
  'calendar:read': 'View calendar items',
  'daily:read': 'View daily planning data',
  'intake:write': 'Send items to Intake',
  'tasks:write': 'Create and update tasks',
  'notes:write': 'Create notes',
  'daily:write': 'Update Today’s focus',
  'projects:write': 'Create projects',
};

export const McpAuthorizationPage = ({ sessionId, code }: { sessionId: string; code: string }) => {
  const { user } = useAuthContext();
  const api = useApi();
  const [session, setSession] = useState<AuthorizationSession | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'busy' | 'approved' | 'error'>('loading');

  useEffect(() => {
    if (!user) return;
    void Promise.all([api.getMcpAuthorizationSession(sessionId), api.getWorkspaces()]).then(([sessionPayload, workspacePayload]) => {
      const nextSession = sessionPayload as AuthorizationSession;
      const nextWorkspaces = (workspacePayload as Workspace[]) ?? [];
      setSession(nextSession);
      setWorkspaces(nextWorkspaces);
      setWorkspaceId(nextSession.requested_workspace_id ?? nextWorkspaces[0]?.id ?? '');
      setState(nextSession.status === 'pending' ? 'ready' : 'error');
    }).catch(() => setState('error'));
  }, [api, sessionId, user]);

  const approve = async () => {
    if (!workspaceId) return;
    setState('busy');
    try {
      await api.approveMcpAuthorization(sessionId, code, workspaceId);
      setState('approved');
    } catch {
      setState('error');
    }
  };

  const cancel = async () => {
    await api.cancelMcpAuthorization(sessionId).catch(() => undefined);
    setState('error');
  };

  if (!user) return null;
  const requestedScopes = session?.requested_scopes ?? [];
  return <main className="flex min-h-screen items-center justify-center bg-[var(--ledger-surface)] p-6"><section className="w-full max-w-sm rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)]" aria-labelledby="mcp-auth-title"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]"><Plug2 size={18} /></div><h1 id="mcp-auth-title" className="mt-4 text-xl font-semibold text-[var(--ledger-text-primary)]">Connect an AI client</h1>{state === 'approved' ? <p className="mt-2 flex items-center gap-2 text-sm text-[var(--ledger-text-secondary)]" role="status"><Check size={15} className="text-[var(--ledger-success)]" />Connected. Return to your AI client.</p> : state === 'loading' ? <p className="mt-3 text-sm text-[var(--ledger-text-secondary)]">Loading authorization request…</p> : state === 'error' ? <p className="mt-3 flex items-center gap-2 text-sm text-[var(--ledger-danger)]" role="alert"><CircleAlert size={14} />This authorization request is invalid, expired, or already used.</p> : <><p className="mt-2 text-sm leading-6 text-[var(--ledger-text-secondary)]"><strong className="text-[var(--ledger-text-primary)]">{session?.client_name}</strong> is requesting read-only access to one Ledger workspace.</p><label className="mt-5 block text-xs font-medium text-[var(--ledger-text-muted)]" htmlFor="mcp-workspace">Workspace</label><select id="mcp-workspace" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={Boolean(session?.requested_workspace_id)} className="mt-2 h-9 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-sm text-[var(--ledger-text-primary)]">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><p className="mt-5 text-xs font-medium text-[var(--ledger-text-muted)]">Permissions</p><ul className="mt-2 space-y-1.5 text-sm text-[var(--ledger-text-secondary)]">{requestedScopes.map((scope) => <li key={scope}>• {scopeLabels[scope] ?? 'Read Ledger context'}</li>)}</ul><p className="mt-4 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-text-muted)]">Verification code <strong className="text-[var(--ledger-text-primary)]">{code}</strong></p><div className="mt-5 flex gap-2"><button type="button" onClick={() => void cancel()} disabled={state === 'busy'} className="h-9 flex-1 rounded-full border border-[color:var(--ledger-border-subtle)] px-4 text-sm text-[var(--ledger-text-secondary)]">Cancel</button><button type="button" onClick={() => void approve()} disabled={state === 'busy' || !workspaceId} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--ledger-accent)] px-4 text-sm font-medium text-white disabled:opacity-60">{state === 'busy' && <Loader2 size={14} className="animate-spin" />}Approve</button></div></>}</section></main>;
};
