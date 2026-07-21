import { Check, CircleAlert, Loader2, Plug2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';

type UpgradeSession = { client_name: string; current_scopes: string[]; requested_scopes: string[]; status: string };

const labels: Record<string, string> = {
  'intake:write': 'Send items to Intake',
  'tasks:write': 'Create and update tasks',
  'notes:write': 'Create notes',
  'daily:write': 'Update Today’s focus',
};

export const McpScopeUpgradeAuthorizationPage = ({ sessionId, code }: { sessionId: string; code: string }) => {
  const { user } = useAuthContext();
  const api = useApi();
  const [session, setSession] = useState<UpgradeSession | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'busy' | 'approved' | 'error'>('loading');

  useEffect(() => {
    if (!user) return;
    void api.getMcpScopeUpgradeSession(sessionId).then((payload) => {
      const next = payload as UpgradeSession;
      setSession(next);
      setState(next.status === 'pending' ? 'ready' : 'error');
    }).catch(() => setState('error'));
  }, [api, sessionId, user]);

  const approve = async () => {
    setState('busy');
    try { await api.approveMcpScopeUpgrade(sessionId, code); setState('approved'); } catch { setState('error'); }
  };
  const cancel = async () => { await api.cancelMcpScopeUpgrade(sessionId).catch(() => undefined); setState('error'); };
  if (!user) return null;
  return <main className="flex min-h-screen items-center justify-center bg-[var(--ledger-surface)] p-6"><section className="w-full max-w-sm rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)]" aria-labelledby="mcp-upgrade-title"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]"><Plug2 size={18} /></div><h1 id="mcp-upgrade-title" className="mt-4 text-xl font-semibold text-[var(--ledger-text-primary)]">Update AI access</h1>{state === 'approved' ? <p className="mt-2 flex items-center gap-2 text-sm text-[var(--ledger-text-secondary)]"><Check size={15} className="text-[var(--ledger-success)]" />Additional permissions approved.</p> : state === 'loading' ? <p className="mt-3 text-sm text-[var(--ledger-text-secondary)]">Loading permission request…</p> : state === 'error' ? <p className="mt-3 flex items-center gap-2 text-sm text-[var(--ledger-danger)]"><CircleAlert size={14} />This permission request is invalid, expired, or already used.</p> : <><p className="mt-2 text-sm leading-6 text-[var(--ledger-text-secondary)]"><strong className="text-[var(--ledger-text-primary)]">{session?.client_name}</strong> is requesting additional access.</p><p className="mt-5 text-xs font-medium text-[var(--ledger-text-muted)]">Already approved</p><ul className="mt-2 space-y-1 text-sm text-[var(--ledger-text-secondary)]">{(session?.current_scopes ?? []).map((scope) => <li key={scope}>• {labels[scope] ?? scope}</li>)}</ul><p className="mt-5 text-xs font-medium text-[var(--ledger-text-muted)]">Additional permissions</p><ul className="mt-2 space-y-1 text-sm text-[var(--ledger-text-secondary)]">{(session?.requested_scopes ?? []).map((scope) => <li key={scope}>• {labels[scope] ?? scope}</li>)}</ul><p className="mt-4 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-text-muted)]">Verification code <strong className="text-[var(--ledger-text-primary)]">{code}</strong></p><div className="mt-5 flex gap-2"><button type="button" onClick={() => void cancel()} disabled={state === 'busy'} className="h-9 flex-1 rounded-full border border-[color:var(--ledger-border-subtle)] px-4 text-sm text-[var(--ledger-text-secondary)]">Cancel</button><button type="button" onClick={() => void approve()} disabled={state === 'busy'} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--ledger-accent)] px-4 text-sm font-medium text-white disabled:opacity-60">{state === 'busy' && <Loader2 size={14} className="animate-spin" />}Approve</button></div></>}</section></main>;
};
