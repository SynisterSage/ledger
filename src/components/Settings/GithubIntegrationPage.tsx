import { Check, CircleAlert, ExternalLink, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { IntegrationProviderMark } from '../Common/IntegrationProviderMark';
import { Capability, IntegrationSection, LoadingRow, MetaRow, settingsIntegrationButton, settingsIntegrationPrimary } from './FigmaIntegrationPage';
import type { GithubIntegrationStatus } from './GithubIntegrationCard';

type Props = { workspaceId: string | null; canManage: boolean; onBack: () => void; onStatusChange?: (status: GithubIntegrationStatus) => void };
type Rule = { id: string; event_type: string; enabled: boolean; create_notification: boolean; create_intake_item: boolean; repository_scope: 'all_approved' | 'selected'; repository_ids: string[] };

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const ruleLabels: Record<string, string> = { issue_opened: 'New issues', pull_request_opened: 'New pull requests', review_requested: 'Review requests', checks_failing: 'Failing checks' };

export const GithubIntegrationPage = ({ workspaceId, canManage, onBack, onStatusChange }: Props) => {
  const api = useApi();
  const [status, setStatus] = useState<GithubIntegrationStatus>({ connected: false });
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'refresh' | 'disconnect' | 'rules' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showAllRepositories, setShowAllRepositories] = useState(false);

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true); setError(null);
    try {
      const next = await api.getGithubIntegrationStatus(workspaceId) as GithubIntegrationStatus;
      setStatus(next); onStatusChange?.(next);
      const nextRules = await api.getGithubCaptureRules() as Rule[];
      setRules(Array.isArray(nextRules) ? nextRules : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load GitHub integration details.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [workspaceId]);

  const openAuth = async () => {
    if (!workspaceId || !canManage) return;
    setBusy('connect');
    try { const result = await api.connectGithubIntegration(workspaceId) as { url: string }; if (window.desktopWindow?.openExternal) await window.desktopWindow.openExternal(result.url); else window.open(result.url, '_blank', 'noopener,noreferrer'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start GitHub authorization.'); }
    finally { setBusy(null); }
  };
  const refreshAccess = async () => {
    if (!workspaceId) return;
    setBusy('refresh'); setError(null);
    try { const next = await api.refreshGithubIntegration(workspaceId) as GithubIntegrationStatus; setStatus(next); onStatusChange?.(next); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not refresh GitHub access.'); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!workspaceId || !canManage) return;
    setBusy('disconnect');
    try { await api.disconnectGithubIntegration(workspaceId); setConfirmDisconnect(false); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect GitHub.'); }
    finally { setBusy(null); }
  };
  const toggleRule = async (rule: Rule, field: 'create_intake_item' | 'create_notification') => {
    if (!canManage) return;
    setBusy('rules');
    try {
      const next = await api.updateGithubCaptureRule(rule.id, { enabled: !rule[field], [field]: !rule[field] }) as Rule;
      setRules((current) => current.map((item) => item.id === rule.id ? next : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update GitHub capture rule.'); }
    finally { setBusy(null); }
  };

  const repositories = status.repositories ?? [];
  const visibleRepositories = showAllRepositories ? repositories : repositories.slice(0, 5);
  const connected = status.connected;
  const account = status.account?.login || 'GitHub account';
  const healthLabel = status.health?.label || (connected ? 'Connected' : 'Not connected');
  const statusValue = !connected ? 'Not connected' : status.health?.state === 'delayed' ? 'Sync delayed' : status.health?.state === 'suspended' ? 'Suspended' : 'Connected';
  const lastSync = status.health?.last_successful_sync_at || status.last_synced_at;
  const intakeRules = useMemo(() => rules.filter((rule) => rule.create_intake_item), [rules]);

  return <section className="w-full max-w-215" aria-labelledby="settings-github">
    <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">← Integrations</button>
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ledger-surface-muted)]"><IntegrationProviderMark provider="github" size={19} /></span><div><h2 id="settings-github" className="text-2xl font-semibold tracking-tight text-[var(--ledger-text-primary)]">GitHub</h2><p className="mt-1 text-[13px] leading-5 text-[var(--ledger-text-secondary)]">Connect repositories, capture development activity, and keep GitHub work moving through Ledger.</p></div></div>
    {!canManage && <p className="mt-5 flex items-center gap-2 text-xs text-[var(--ledger-text-muted)]"><CircleAlert size={14} />You don’t have permission to manage the workspace GitHub connection.</p>}
    <IntegrationSection title="Connection">{loading ? <LoadingRow label="Checking GitHub connection…" /> : !connected ? <div className="flex items-center justify-between gap-4"><div><p className="text-[13px] font-medium">Connect GitHub to this workspace</p><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Install the Ledger GitHub App and choose which repositories it can access.</p></div><button type="button" onClick={() => void openAuth()} disabled={!canManage || !!busy} className={settingsIntegrationPrimary}>{busy === 'connect' ? 'Opening…' : 'Connect GitHub'}</button></div> : <><div className="divide-y divide-[color:var(--ledger-border-subtle)]"><MetaRow label="Connected GitHub account" value={account} /><MetaRow label="Status" value={statusValue} icon={statusValue === 'Connected' ? <Check size={14} /> : <CircleAlert size={14} />} /><MetaRow label="Repository access" value={status.repository_selection === 'all' ? 'All repositories' : `${repositories.length} selected repositories`} /><MetaRow label="Last successful sync" value={formatDate(lastSync)} /></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={settingsIntegrationButton} onClick={() => void openAuth()} disabled={!canManage || !!busy}>{busy === 'connect' ? 'Opening…' : 'Reauthorize'}</button><button type="button" className={`${settingsIntegrationButton} inline-flex items-center gap-1.5 whitespace-nowrap`} onClick={() => void refreshAccess()} disabled={!!busy}>{busy === 'refresh' ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <RefreshCw size={13} className="shrink-0" />}<span>Refresh access</span></button><button type="button" className="h-8 rounded-full border border-[color:rgba(217,45,32,0.18)] px-3 text-xs font-medium text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]" onClick={() => setConfirmDisconnect(true)} disabled={!canManage || !!busy}>Disconnect</button></div></>}</IntegrationSection>
    <IntegrationSection title="Repositories">{loading ? <LoadingRow label="Loading repositories…" /> : !connected ? <p className="text-xs text-[var(--ledger-text-muted)]">Connect GitHub to choose repositories for this workspace.</p> : <><div className="divide-y divide-[color:var(--ledger-border-subtle)]">{visibleRepositories.map((repository) => <a key={repository.id} href={repository.html_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 py-2 text-[13px] text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]"><span className="min-w-0 flex-1 truncate">{repository.full_name}</span>{repository.is_private && <LockKeyhole size={13} className="shrink-0 text-[var(--ledger-text-muted)]" />}<span className="text-xs text-[var(--ledger-text-muted)]">{repository.is_archived ? 'Archived' : repository.is_private ? 'Private' : 'Public'}</span><ExternalLink size={13} className="shrink-0 text-[var(--ledger-text-muted)]" /></a>)}</div>{repositories.length > 5 && <button type="button" onClick={() => setShowAllRepositories((value) => !value)} className="mt-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">{showAllRepositories ? 'Show fewer repositories' : `Show all ${repositories.length} repositories`}</button>}{status.management_url && <p className="mt-3"><a href={status.management_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">Manage repository access <ExternalLink size={12} /></a></p>}</>}</IntegrationSection>
    <IntegrationSection title="Capabilities"><Capability title="Capture issues and pull requests" detail="Send selected GitHub work into Ledger Intake for follow-through." status={connected ? 'Available' : 'Unavailable'} /><Capability title="Review and checks notifications" detail="Create restrained notifications when reviews are requested or checks fail." status={connected ? 'Available' : 'Unavailable'} /><Capability title="Repository-linked context" detail="Keep GitHub references connected to Ledger work and open the original source when needed." status={connected ? 'Available' : 'Unavailable'} /><Capability title="GitHub App access" detail="Ledger uses approved repository access and does not need your GitHub password." status={connected ? 'Available' : 'Unavailable'} /></IntegrationSection>
    <IntegrationSection title="Capture rules">{loading ? <LoadingRow label="Loading capture rules…" /> : !connected ? <p className="text-xs text-[var(--ledger-text-muted)]">Connect GitHub before configuring capture rules.</p> : <><p className="text-xs text-[var(--ledger-text-muted)]">Choose which approved repository activity enters Ledger.</p><div className="mt-3 divide-y divide-[color:var(--ledger-border-subtle)]">{rules.map((rule) => { const action = rule.event_type.includes('issue') || rule.event_type.includes('pull_request') ? 'create_intake_item' : 'create_notification'; const detail = action === 'create_intake_item' ? 'Send this activity to Intake.' : 'Notify you in Ledger.'; return <label key={rule.id} className="flex items-start justify-between gap-4 py-3"><span><span className="block text-[13px] font-medium text-[var(--ledger-text-primary)]">{ruleLabels[rule.event_type] || rule.event_type}</span><span className="mt-0.5 block text-xs leading-5 text-[var(--ledger-text-muted)]">{detail}</span></span><input type="checkbox" checked={Boolean(rule[action])} disabled={!canManage || !!busy} onChange={() => void toggleRule(rule, action)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ledger-accent)]" aria-label={`Enable ${ruleLabels[rule.event_type] || rule.event_type}`} /></label>; })}</div>{!rules.length && <p className="mt-3 text-xs text-[var(--ledger-text-muted)]">No capture rules configured yet.</p>}<p className="mt-3 text-xs text-[var(--ledger-text-muted)]">{intakeRules.length} rule{intakeRules.length === 1 ? '' : 's'} currently send activity to Intake.</p></>}</IntegrationSection>
    <IntegrationSection title="Activity monitoring"><div className="divide-y divide-[color:var(--ledger-border-subtle)]"><MetaRow label="Connection health" value={healthLabel} /><MetaRow label="Last successful sync" value={formatDate(lastSync)} /><MetaRow label="Repository count" value={String(repositories.length)} /><MetaRow label="Webhook status" value={status.health?.last_successful_webhook_at ? `Last received ${formatDate(status.health.last_successful_webhook_at)}` : 'No webhook received yet'} /></div>{status.health?.error_message && <p className="mt-3 text-xs text-[var(--ledger-danger)]">{status.health.error_message}</p>}<div className="mt-4"><button type="button" className={`${settingsIntegrationButton} inline-flex items-center gap-1.5 whitespace-nowrap`} onClick={() => void refreshAccess()} disabled={!!busy}>{busy === 'refresh' ? <Loader2 size={13} className="shrink-0 animate-spin" /> : null}<span>Retry connection check</span></button></div></IntegrationSection>
    {error && <p className="mt-3 text-xs text-[var(--ledger-danger)]" role="alert">{error}</p>}
    {confirmDisconnect && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDisconnect(false); }}><div className="w-full max-w-sm rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.18)]" role="dialog" aria-modal="true"><h3 className="text-base font-semibold">Disconnect GitHub?</h3><p className="mt-2 text-sm text-[var(--ledger-text-secondary)]">This removes the workspace connection and approved repository metadata. It does not uninstall the GitHub App.</p><div className="mt-5 flex justify-end gap-2"><button type="button" className={settingsIntegrationButton} onClick={() => setConfirmDisconnect(false)}>Cancel</button><button type="button" className="h-8 rounded-full bg-[var(--ledger-danger)] px-3 text-xs font-medium text-white disabled:opacity-50" onClick={() => void disconnect()} disabled={busy === 'disconnect'}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button></div></div></div>}
  </section>;
};
