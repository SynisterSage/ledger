import { CircleAlert, ExternalLink, LockKeyhole, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { ModalOverlay } from '../Common/ModalOverlay';

export type GithubIntegrationStatus = {
  connected: boolean;
  account?: { login?: string; type?: string } | null;
  repository_selection?: 'all' | 'selected' | null;
  installation_status?: string;
  management_url?: string | null;
  last_synced_at?: string | null;
  can_manage?: boolean;
  repositories?: Array<{ id: string | number; full_name: string; name: string; html_url: string; is_private: boolean }>;
};

type Props = { workspaceId: string | null; canManage: boolean };
export const GithubIntegrationCard = ({ workspaceId, canManage }: Props) => {
  const api = useApi();
  const [status, setStatus] = useState<GithubIntegrationStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'refresh' | 'disconnect' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { if (!workspaceId) return; setLoading(true); try { setStatus(await api.getGithubIntegrationStatus(workspaceId) as GithubIntegrationStatus); setError(null); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load GitHub connection.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [workspaceId]);
  const connect = async () => { if (!workspaceId) return; setBusy('connect'); setError(null); try { const result = await api.connectGithubIntegration(workspaceId) as { url: string }; if (window.desktopWindow?.openExternal) await window.desktopWindow.openExternal(result.url); else window.open(result.url, '_blank', 'noopener,noreferrer'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not start GitHub connection.'); } finally { setBusy(null); } };
  const refresh = async () => { if (!workspaceId) return; setBusy('refresh'); setMenuOpen(false); try { setStatus(await api.refreshGithubIntegration(workspaceId) as GithubIntegrationStatus); setError(null); } catch (err) { setError(err instanceof Error ? err.message : 'Could not refresh GitHub access.'); } finally { setBusy(null); } };
  const disconnect = async () => { if (!workspaceId) return; setBusy('disconnect'); try { await api.disconnectGithubIntegration(workspaceId); setStatus({ connected: false }); setConfirmOpen(false); setError(null); } catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect GitHub.'); } finally { setBusy(null); } };
  const repos = status.repositories ?? [];
  const visible = repos.slice(0, 5);
  return <section className="border-t border-[color:var(--ledger-border-subtle)] px-4 py-3" aria-label="GitHub integration">
    <div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]"><img src="/github-mark.svg" alt="" className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-[var(--ledger-text-primary)]">GitHub <span className="ml-1 font-normal text-[11px] text-[var(--ledger-text-muted)]">{loading ? 'Checking status' : status.connected ? `Connected to ${status.account?.login ?? 'GitHub'}` : 'Not connected'}</span></p><p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Connect repositories and development work to Ledger.</p></div>{!status.connected && <button type="button" onClick={() => void connect()} disabled={!canManage || busy === 'connect'} className="h-8 shrink-0 rounded-lg bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white disabled:opacity-50">{busy === 'connect' ? 'Opening…' : 'Connect GitHub'}</button>}</div>
    {error && <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ledger-danger)]" role="alert"><CircleAlert size={13} />{error}</p>}
    {status.connected && <div className="mt-3 pl-11"><p className="text-[11px] text-[var(--ledger-text-muted)]">{repos.length} {repos.length === 1 ? 'repository' : 'repositories'} · {status.repository_selection === 'all' ? 'All repositories' : 'Selected repositories'}</p><div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ledger-text-secondary)]">{visible.map((repo) => <a key={repo.id} href={repo.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--ledger-text-primary)]">{repo.is_private && <LockKeyhole size={11} />}{repo.name}</a>)}{repos.length > 5 && <span className="text-[var(--ledger-text-muted)]">and {repos.length - 5} more</span>}</div><div className="mt-3 flex items-center gap-2"><a href={status.management_url ?? '#'} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Manage repositories <ExternalLink size={12} /></a>{canManage && <div className="relative"><button type="button" aria-label="GitHub actions" onClick={() => setMenuOpen((open) => !open)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><MoreHorizontal size={15} /></button>{menuOpen && <div className="absolute right-0 top-8 z-20 w-44 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"><button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"><RefreshCw size={13} />Refresh access</button><button type="button" onClick={() => { setMenuOpen(false); setConfirmOpen(true); }} className="w-full rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]">Disconnect from Ledger</button></div>}</div>}</div></div>}
    <ModalOverlay isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-sm rounded-2xl border p-5"><h3 className="text-base font-semibold text-[var(--ledger-text-primary)]">Disconnect GitHub?</h3><p className="mt-2 text-sm leading-5 text-[var(--ledger-text-secondary)]">This removes the Ledger workspace connection and approved repository metadata. It does not uninstall the GitHub App.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmOpen(false)} className="h-8 rounded-lg px-3 text-xs text-[var(--ledger-text-secondary)]">Cancel</button><button type="button" onClick={() => void disconnect()} disabled={busy === 'disconnect'} className="h-8 rounded-lg bg-[var(--ledger-danger)] px-3 text-xs font-medium text-white">{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button></div></ModalOverlay>
  </section>;
};
