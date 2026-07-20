import { Check, CircleAlert, Loader2, Plug2 } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';

export const FigmaPluginAuthorizationPage = ({ sessionId, code }: { sessionId: string; code: string }) => {
  const { user } = useAuthContext();
  const api = useApi();
  const [state, setState] = useState<'ready' | 'busy' | 'approved' | 'error'>('ready');
  const approve = async () => {
    setState('busy');
    try { await api.approveFigmaPluginAuthorization(sessionId, code); setState('approved'); }
    catch { setState('error'); }
  };
  if (!user) return null;
  return <main className="flex min-h-screen items-center justify-center bg-[var(--ledger-surface)] p-6"><section className="w-full max-w-sm rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)]" aria-labelledby="figma-plugin-auth-title"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]"><Plug2 size={18} /></div><h1 id="figma-plugin-auth-title" className="mt-4 text-xl font-semibold text-[var(--ledger-text-primary)]">Connect Ledger to Figma</h1>{state === 'approved' ? <p className="mt-2 flex items-center gap-2 text-sm text-[var(--ledger-text-secondary)]" role="status"><Check size={15} className="text-[var(--ledger-success)]" />Connected. Return to the Figma plugin.</p> : <><p className="mt-2 text-sm leading-6 text-[var(--ledger-text-secondary)]">Approve this Ledger plugin connection to view your workspaces and current Figma selection context.</p><p className="mt-4 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-text-muted)]">Verification code <strong className="text-[var(--ledger-text-primary)]">{code}</strong></p>{state === 'error' && <p className="mt-3 flex items-center gap-2 text-xs text-[var(--ledger-danger)]" role="alert"><CircleAlert size={14} />This authorization request is invalid or expired.</p>}<button type="button" onClick={() => void approve()} disabled={state === 'busy'} className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-[var(--ledger-accent)] px-4 text-sm font-medium text-white disabled:opacity-60">{state === 'busy' && <Loader2 size={14} className="animate-spin" />}Approve plugin access</button></>}</section></main>;
};
