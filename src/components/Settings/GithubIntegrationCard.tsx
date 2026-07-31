import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';

export type GithubIntegrationStatus = {
  connected: boolean;
  account?: { login?: string; type?: string } | null;
  repository_selection?: 'all' | 'selected' | null;
  installation_status?: string;
  last_synced_at?: string | null;
  management_url?: string | null;
  health?: { state?: string; label?: string; last_successful_sync_at?: string | null; last_successful_webhook_at?: string | null; error_message?: string | null } | null;
  can_manage?: boolean;
  repositories?: Array<{ id: string | number; full_name: string; name: string; html_url: string; is_private: boolean; is_archived?: boolean }>;
};

type Props = { workspaceId: string | null; canManage: boolean; onManage: () => void };

export const GithubIntegrationCard = ({ workspaceId, canManage, onManage }: Props) => {
  const api = useApi();
  const [status, setStatus] = useState<GithubIntegrationStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    void api.getGithubIntegrationStatus(workspaceId).then((result) => {
      if (!cancelled) setStatus(result as GithubIntegrationStatus);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load GitHub connection.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, workspaceId]);

  useEffect(() => {
    const handleGithubCallback = () => {
      if (!workspaceId) return;
      void api.getGithubIntegrationStatus(workspaceId).then((result) => setStatus(result as GithubIntegrationStatus)).catch(() => undefined);
    };
    window.ipcRenderer?.on('settings:github-callback', handleGithubCallback as any);
    return () => { window.ipcRenderer?.off('settings:github-callback', handleGithubCallback as any); };
  }, [api, workspaceId]);

  const connect = async () => {
    if (!workspaceId || !canManage) return;
    setBusy(true); setError(null);
    try {
      const result = await api.connectGithubIntegration(workspaceId) as { url: string };
      if (window.desktopWindow?.openExternal) await window.desktopWindow.openExternal(result.url);
      else window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start GitHub connection.'); }
    finally { setBusy(false); }
  };

  const repositoryCount = status.repositories?.length ?? 0;
  const account = status.account?.login || 'GitHub';
  const description = status.connected ? `${account} · ${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}` : loading ? 'Checking status' : 'Not connected';

  return <div aria-label="GitHub integration">
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]"><img src={`${import.meta.env.BASE_URL}github-mark.svg`} alt="" className="h-4 w-4 dark:invert" /></span>
      <div className="min-w-0 flex-1"><p className="text-[13px] font-medium text-[var(--ledger-text-primary)]">GitHub <span className="ml-1 text-[11px] font-normal text-[var(--ledger-text-muted)]">{description}</span></p><p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Connect repositories and development work to Ledger.</p></div>
      <button type="button" onClick={() => status.connected ? onManage() : void connect()} disabled={!canManage || busy} className="h-8 shrink-0 rounded-lg border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50">{busy ? 'Opening…' : status.connected ? 'Manage' : 'Connect'}</button>
    </div>
    {error && <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ledger-danger)]" role="alert"><CircleAlert size={13} />{error}</p>}
  </div>;
};
