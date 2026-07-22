import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { ModalOverlay } from '../Common/ModalOverlay';

export type GithubIntegrationStatus = {
  connected: boolean;
  account?: { login?: string; type?: string } | null;
  repository_selection?: 'all' | 'selected' | null;
  installation_status?: string;
  management_url?: string | null;
  last_synced_at?: string | null;
  health?: {
    state?: 'connected' | 'syncing' | 'delayed' | 'suspended' | 'access_changed' | 'action_required' | 'disconnected';
    label?: string;
    last_successful_sync_at?: string | null;
    last_successful_webhook_at?: string | null;
    error_message?: string | null;
  } | null;
  can_manage?: boolean;
  repositories?: Array<{
    id: string | number;
    full_name: string;
    name: string;
    html_url: string;
    is_private: boolean;
    is_archived?: boolean;
  }>;
};

type Props = { workspaceId: string | null; canManage: boolean };

type GithubCaptureRule = {
  id: string;
  name: string;
  event_type: string;
  enabled: boolean;
  repository_scope: 'all_approved' | 'selected';
  repository_ids: string[];
  create_notification: boolean;
  create_intake_item: boolean;
};

type GithubCaptureDraft = {
  issueIntake: boolean;
  pullRequestIntake: boolean;
  reviewNotification: boolean;
  checksNotification: boolean;
  repositoryScope: 'all_approved' | 'selected';
  repositoryIds: string[];
};

const formatShortDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return 'Not synced yet';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Not synced yet';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

const repositoryStatus = (repository: NonNullable<GithubIntegrationStatus['repositories']>[number]) =>
  repository.is_archived ? 'Archived' : repository.is_private ? 'Private' : 'Public';

export const GithubIntegrationCard = ({ workspaceId, canManage }: Props) => {
  const api = useApi();
  const [status, setStatus] = useState<GithubIntegrationStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'refresh' | 'disconnect' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [captureRules, setCaptureRules] = useState<GithubCaptureRule[]>([]);
  const [captureDraft, setCaptureDraft] = useState<GithubCaptureDraft>({ issueIntake: false, pullRequestIntake: false, reviewNotification: true, checksNotification: true, repositoryScope: 'all_approved', repositoryIds: [] });
  const [captureRulesOpen, setCaptureRulesOpen] = useState(false);
  const [captureRulesLoading, setCaptureRulesLoading] = useState(false);
  const [captureRulesSaving, setCaptureRulesSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      setStatus(await api.getGithubIntegrationStatus(workspaceId) as GithubIntegrationStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GitHub connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspaceId]);

  useEffect(() => {
    const handleGithubCallback = () => { void load(); };
    window.ipcRenderer?.on('settings:github-callback', handleGithubCallback as any);
    return () => { window.ipcRenderer?.off('settings:github-callback', handleGithubCallback as any); };
  }, [workspaceId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const connect = async () => {
    if (!workspaceId) return;
    setBusy('connect');
    setError(null);
    try {
      const result = await api.connectGithubIntegration(workspaceId) as { url: string };
      if (window.desktopWindow?.openExternal) await window.desktopWindow.openExternal(result.url);
      else window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start GitHub connection.');
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    if (!workspaceId) return;
    setBusy('refresh');
    setMenuOpen(false);
    try {
      setStatus(await api.refreshGithubIntegration(workspaceId) as GithubIntegrationStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh GitHub access.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!workspaceId) return;
    setBusy('disconnect');
    try {
      await api.disconnectGithubIntegration(workspaceId);
      setStatus({ connected: false });
      setExpanded(false);
      setConfirmOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect GitHub.');
    } finally {
      setBusy(null);
    }
  };

  const openCaptureRules = async () => {
    if (!canManage) return;
    setCaptureRulesOpen(true);
    setCaptureRulesLoading(true);
    try {
      const rules = await api.getGithubCaptureRules() as GithubCaptureRule[];
      const byEvent = new Map((rules ?? []).map((rule) => [rule.event_type, rule]));
      const issue = byEvent.get('issue_opened');
      const pullRequest = byEvent.get('pull_request_opened');
      const review = byEvent.get('review_requested');
      const checks = byEvent.get('checks_failing');
      setCaptureRules(rules ?? []);
      setCaptureDraft({
        issueIntake: Boolean(issue?.enabled && issue.create_intake_item),
        pullRequestIntake: Boolean(pullRequest?.enabled && pullRequest.create_intake_item),
        reviewNotification: review ? Boolean(review.enabled && review.create_notification) : true,
        checksNotification: checks ? Boolean(checks.enabled && checks.create_notification) : true,
        repositoryScope: issue?.repository_scope ?? pullRequest?.repository_scope ?? 'all_approved',
        repositoryIds: issue?.repository_ids ?? pullRequest?.repository_ids ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GitHub capture rules.');
    } finally {
      setCaptureRulesLoading(false);
    }
  };

  const saveCaptureRules = async () => {
    if (!canManage) return;
    setCaptureRulesSaving(true);
    setError(null);
    const definitions = [
      { event_type: 'issue_opened', name: 'New issues', enabled: captureDraft.issueIntake, create_intake_item: captureDraft.issueIntake, create_notification: false },
      { event_type: 'pull_request_opened', name: 'New pull requests', enabled: captureDraft.pullRequestIntake, create_intake_item: captureDraft.pullRequestIntake, create_notification: false },
      { event_type: 'review_requested', name: 'Review requests', enabled: captureDraft.reviewNotification, create_intake_item: false, create_notification: captureDraft.reviewNotification },
      { event_type: 'checks_failing', name: 'Failing checks', enabled: captureDraft.checksNotification, create_intake_item: false, create_notification: captureDraft.checksNotification },
    ];
    try {
      const nextRules: GithubCaptureRule[] = [];
      for (const definition of definitions) {
        const existing = captureRules.find((rule) => rule.event_type === definition.event_type);
        const payload = { ...definition, repository_scope: captureDraft.repositoryScope, repository_ids: captureDraft.repositoryScope === 'selected' ? captureDraft.repositoryIds : [], label_filters: [] };
        const saved = existing
          ? await api.updateGithubCaptureRule(existing.id, payload) as GithubCaptureRule
          : await api.createGithubCaptureRule(payload) as GithubCaptureRule;
        nextRules.push(saved);
      }
      setCaptureRules(nextRules);
      setCaptureRulesOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save GitHub capture rules.');
    } finally {
      setCaptureRulesSaving(false);
    }
  };

  const repositories = status.repositories ?? [];
  const visibleRepositories = showAll ? repositories : repositories.slice(0, 5);
  const repositoryCount = repositories.length === 1 ? '1 repository' : `${repositories.length} repositories`;
  const accountLogin = status.account?.login || 'GitHub';
  const syncDate = formatRelativeTime(status.last_synced_at);
  const connectedDate = formatShortDate(status.last_synced_at) ?? 'recently';
  const isUnavailable = ['suspended', 'deleted'].includes(String(status.installation_status ?? '').toLowerCase());
  const healthState = status.health?.state ?? (isUnavailable ? 'suspended' : 'connected');
  const rowDescription = useMemo(
    () => `${accountLogin} · ${repositoryCount}`,
    [accountLogin, repositoryCount]
  );

  if (!status.connected) {
    return <div aria-label="GitHub integration">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]">
          <img src="/github-mark.svg" alt="" className="h-4 w-4 dark:invert" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--ledger-text-primary)]">
            GitHub <span className="ml-1 font-normal text-[11px] text-[var(--ledger-text-muted)]">{loading ? 'Checking status' : 'Not connected'}</span>
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Connect repositories and development work to Ledger.</p>
        </div>
        <button type="button" onClick={() => void connect()} disabled={!canManage || busy === 'connect'} className="h-8 shrink-0 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60">
          {busy === 'connect' ? 'Opening…' : 'Connect GitHub'}
        </button>
      </div>
      {error && <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ledger-danger)]" role="alert"><CircleAlert size={13} />{error}</p>}
    </div>;
  }

  return <div aria-label="GitHub integration" className={`transition ${expanded ? '' : 'hover:bg-[var(--ledger-surface-muted)]'}`}>
    <div className="relative">
      <div className="flex min-h-0 items-center gap-2.5 rounded-lg px-0 py-0">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { setExpanded((value) => !value); setMenuOpen(false); }} aria-expanded={expanded}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]" aria-hidden="true">
            <img src="/github-mark.svg" alt="" className="h-4 w-4 dark:invert" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">GitHub</span>
              <span className="truncate text-[11px] text-[var(--ledger-text-muted)]">{rowDescription}</span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">
              {isUnavailable ? 'Connection unavailable' : status.repository_selection === 'all' ? 'All repositories' : 'Selected repositories'}
            </span>
          </span>
        </button>
        {canManage && <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
          <button type="button" aria-label="More GitHub actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]">
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && <div className="absolute bottom-8 right-0 z-20 w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[0_12px_30px_rgba(15,23,42,0.14)]">
            <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><RefreshCw size={13} />Refresh access</button>
            <button type="button" onClick={() => { setMenuOpen(false); setConfirmOpen(true); }} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]">Disconnect from Ledger</button>
          </div>}
        </div>}
        <button type="button" aria-label={expanded ? 'Collapse GitHub repositories' : 'Expand GitHub repositories'} aria-expanded={expanded} onClick={() => { setExpanded((value) => !value); setMenuOpen(false); }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && <div className="pb-1 pt-2.5">
        <div className="mb-1 flex items-center justify-between px-1">
          <p className="text-[11px] font-medium text-[var(--ledger-text-secondary)]">Repositories</p>
          {isUnavailable && <span className="text-[11px] text-[var(--ledger-danger)]">Access unavailable</span>}
        </div>
        <div>
          {visibleRepositories.map((repository) => <a key={repository.id} href={repository.html_url} target="_blank" rel="noreferrer" className="flex min-h-8 items-center justify-between gap-3 rounded-md px-1 text-[11px] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]">
            <span className="flex min-w-0 items-center gap-1.5 truncate"><span className="truncate">{repository.name}</span>{repository.is_private && <LockKeyhole size={10} className="shrink-0 text-[var(--ledger-text-muted)]" />}</span>
            <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">{repositoryStatus(repository)}</span>
          </a>)}
        </div>
        {repositories.length > 5 && <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 px-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">{showAll ? 'Show less' : `Show all (${repositories.length})`}</button>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-[var(--ledger-text-muted)]">
          <span>{status.health?.label ?? 'Connected'} · Connected {connectedDate} · Last synced {syncDate}</span>
          {['action_required', 'access_changed', 'suspended', 'delayed'].includes(healthState) && <span className="text-[var(--ledger-danger)]">{status.health?.error_message ?? (healthState === 'suspended' ? 'GitHub installation is suspended.' : healthState === 'access_changed' ? 'Repository access changed.' : healthState === 'delayed' ? 'Sync is delayed.' : 'Refresh required.')}</span>}
          {canManage && status.management_url && <a href={status.management_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">Manage repositories <ExternalLink size={11} /></a>}
          {canManage && <button type="button" onClick={() => void openCaptureRules()} className="font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">Manage capture rules</button>}
        </div>
      </div>}
    </div>
    {error && <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ledger-danger)]" role="alert"><CircleAlert size={13} />{error}</p>}
    <ModalOverlay isOpen={captureRulesOpen} onClose={() => setCaptureRulesOpen(false)} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-md rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--ledger-text-primary)]">GitHub capture rules</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ledger-text-secondary)]">Choose which approved repository activity enters Ledger.</p>
        </div>
        <button type="button" onClick={() => setCaptureRulesOpen(false)} className="text-xs text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">Close</button>
      </div>
      {captureRulesLoading ? <p className="mt-5 text-xs text-[var(--ledger-text-muted)]">Loading capture rules…</p> : <div className="mt-5 space-y-1">
        <label className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">
          <input type="checkbox" checked={captureDraft.issueIntake} onChange={(event) => setCaptureDraft((draft) => ({ ...draft, issueIntake: event.target.checked }))} className="h-3.5 w-3.5 rounded border-[color:var(--ledger-border-strong)] text-[var(--ledger-accent)]" />
          <span>Send new issues to Intake</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">
          <input type="checkbox" checked={captureDraft.pullRequestIntake} onChange={(event) => setCaptureDraft((draft) => ({ ...draft, pullRequestIntake: event.target.checked }))} className="h-3.5 w-3.5 rounded border-[color:var(--ledger-border-strong)] text-[var(--ledger-accent)]" />
          <span>Send new pull requests to Intake</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">
          <input type="checkbox" checked={captureDraft.reviewNotification} onChange={(event) => setCaptureDraft((draft) => ({ ...draft, reviewNotification: event.target.checked }))} className="h-3.5 w-3.5 rounded border-[color:var(--ledger-border-strong)] text-[var(--ledger-accent)]" />
          <span>Notify when review is requested</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">
          <input type="checkbox" checked={captureDraft.checksNotification} onChange={(event) => setCaptureDraft((draft) => ({ ...draft, checksNotification: event.target.checked }))} className="h-3.5 w-3.5 rounded border-[color:var(--ledger-border-strong)] text-[var(--ledger-accent)]" />
          <span>Notify when checks fail</span>
        </label>
        <div className="mt-3 border-t border-[color:var(--ledger-border-subtle)] pt-3">
          <p className="text-[11px] font-medium text-[var(--ledger-text-secondary)]">Repositories</p>
          <div className="mt-2 flex gap-3 text-xs text-[var(--ledger-text-secondary)]">
            <label className="flex items-center gap-2"><input type="radio" name="github-capture-scope" checked={captureDraft.repositoryScope === 'all_approved'} onChange={() => setCaptureDraft((draft) => ({ ...draft, repositoryScope: 'all_approved' }))} />All approved</label>
            <label className="flex items-center gap-2"><input type="radio" name="github-capture-scope" checked={captureDraft.repositoryScope === 'selected'} onChange={() => setCaptureDraft((draft) => ({ ...draft, repositoryScope: 'selected' }))} />Selected repositories</label>
          </div>
          {captureDraft.repositoryScope === 'selected' && <div className="mt-2 max-h-32 overflow-auto rounded-lg border border-[color:var(--ledger-border-subtle)] p-1">
            {repositories.map((repository) => {
              const repositoryId = String(repository.id);
              const checked = captureDraft.repositoryIds.includes(repositoryId);
              return <label key={repositoryId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]"><input type="checkbox" checked={checked} onChange={() => setCaptureDraft((draft) => ({ ...draft, repositoryIds: checked ? draft.repositoryIds.filter((id) => id !== repositoryId) : [...draft.repositoryIds, repositoryId] }))} /><span className="truncate">{repository.full_name}</span></label>;
            })}
          </div>}
        </div>
      </div>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCaptureRulesOpen(false)} className="h-8 rounded-lg px-3 text-xs text-[var(--ledger-text-secondary)]">Cancel</button><button type="button" onClick={() => void saveCaptureRules()} disabled={captureRulesLoading || captureRulesSaving} className="h-8 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-50">{captureRulesSaving ? 'Saving…' : 'Save rules'}</button></div>
    </ModalOverlay>
    <ModalOverlay isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-sm rounded-2xl border p-5">
      <h3 className="text-base font-semibold text-[var(--ledger-text-primary)]">Disconnect GitHub?</h3>
      <p className="mt-2 text-sm leading-5 text-[var(--ledger-text-secondary)]">This removes the Ledger workspace connection and approved repository metadata. It does not uninstall the GitHub App.</p>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmOpen(false)} className="h-8 rounded-full px-3 text-xs text-[var(--ledger-text-secondary)]">Cancel</button><button type="button" onClick={() => void disconnect()} disabled={busy === 'disconnect'} className="h-8 rounded-full bg-[var(--ledger-danger)] px-3 text-xs font-medium text-white">{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button></div>
    </ModalOverlay>
  </div>;
};
