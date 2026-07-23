import { CircleAlert, Check, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { IntegrationProviderMark } from '../Common/IntegrationProviderMark';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { Capability, IntegrationSection, LoadingRow, MetaRow, settingsIntegrationButton, settingsIntegrationPrimary } from './FigmaIntegrationPage';

export type SlackIntegrationPageStatus = {
  connected: boolean;
  team_name?: string | null;
  connected_by?: { name?: string | null; email?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  needs_reauthorization?: boolean;
};

type SlackIdentity = {
  slack_display_name?: string | null;
  slack_real_name?: string | null;
  slack_email?: string | null;
  status?: string | null;
  linked_at?: string | null;
  last_verified_at?: string | null;
};
type SlackWatch = { watch_type?: string | null; status?: string | null };
type SlackActivity = { source_created_at?: string | null; context?: { last_synced_at?: string | null } | null };
type SlackContext = { last_synced_at?: string | null };
type Props = { workspaceId: string | null; canManage: boolean; onBack: () => void; onStatusChange?: (status: SlackIntegrationPageStatus) => void };

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const openExternal = async (url: string) => { if (window.desktopWindow?.openExternal) await window.desktopWindow.openExternal(url); else window.open(url, '_blank', 'noopener,noreferrer'); };

export const SlackIntegrationPage = ({ workspaceId, canManage, onBack, onStatusChange }: Props) => {
  const api = useApi();
  const { activeWorkspace } = useWorkspaceContext();
  const [status, setStatus] = useState<SlackIntegrationPageStatus>({ connected: false });
  const [identity, setIdentity] = useState<SlackIdentity | null>(null);
  const [watches, setWatches] = useState<SlackWatch[]>([]);
  const [activities, setActivities] = useState<SlackActivity[]>([]);
  const [contexts, setContexts] = useState<SlackContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'identity' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmIdentityDisconnect, setConfirmIdentityDisconnect] = useState(false);

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true); setError(null);
    try {
      const next = await api.getSlackIntegrationStatus(workspaceId) as SlackIntegrationPageStatus;
      setStatus(next); onStatusChange?.(next);
      const [identityResult, watchesResult, activityResult, contextsResult] = await Promise.all([
        api.getSlackIdentity(workspaceId), api.getSlackWatches(workspaceId),
        api.getSlackActivity(workspaceId, { limit: 50 }), api.getSlackContexts(workspaceId, { search: '' }),
      ]);
      setIdentity((identityResult as { identity?: SlackIdentity | null })?.identity ?? null);
      setWatches(Array.isArray(watchesResult) ? watchesResult as SlackWatch[] : []);
      setActivities(Array.isArray((activityResult as { rows?: SlackActivity[] })?.rows) ? (activityResult as { rows: SlackActivity[] }).rows : []);
      setContexts(Array.isArray(contextsResult) ? contextsResult as SlackContext[] : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load Slack integration details.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [workspaceId]);

  const connectWorkspace = async () => {
    if (!workspaceId || !canManage) return;
    setBusy('connect'); setError(null);
    try { const result = await api.getSlackInstallUrl(workspaceId) as { url?: string }; if (!result.url) throw new Error('Slack authorization is unavailable.'); await openExternal(result.url); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start Slack authorization.'); }
    finally { setBusy(null); }
  };
  const disconnectWorkspace = async () => {
    if (!workspaceId || !canManage) return;
    setBusy('disconnect'); setError(null);
    try { await api.disconnectSlackIntegration(workspaceId); setConfirmDisconnect(false); await refresh(); window.ipcRenderer?.send('slack:connection-changed'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect Slack.'); }
    finally { setBusy(null); }
  };
  const connectIdentity = async () => {
    if (!workspaceId) return;
    setBusy('identity'); setError(null);
    try { const result = await api.getSlackIdentityConnectUrl(workspaceId) as { url?: string }; if (!result.url) throw new Error('Slack identity authorization is unavailable.'); await openExternal(result.url); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not connect your Slack identity.'); }
    finally { setBusy(null); }
  };
  const disconnectIdentity = async () => {
    if (!workspaceId) return;
    setBusy('identity'); setError(null);
    try { await api.disconnectSlackIdentity(workspaceId); setConfirmIdentityDisconnect(false); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect your Slack identity.'); }
    finally { setBusy(null); }
  };

  const personalWatches = watches.filter((watch) => watch.watch_type === 'personal');
  const workspaceWatches = watches.filter((watch) => watch.watch_type === 'shared');
  const identityConnected = identity?.status === 'connected';
  const identityNeedsAuth = identity?.status === 'reauthorization_required';
  const lastEvent = useMemo(() => activities.map((item) => item.source_created_at).filter(Boolean).sort().at(-1), [activities]);
  const lastSync = useMemo(() => contexts.map((item) => item.last_synced_at).filter(Boolean).sort().at(-1), [contexts]);
  const capabilityStatus = (requiresIdentity: boolean) => !status.connected ? 'Unavailable' : status.needs_reauthorization ? 'Requires reauthorization' : requiresIdentity && !identityConnected ? 'Requires personal identity' : 'Available';
  const statusLabel = !status.connected ? 'Not connected' : status.needs_reauthorization ? 'Requires reauthorization' : 'Connected';

  return <section className="w-full max-w-215" aria-labelledby="settings-slack">
    <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">← Integrations</button>
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ledger-surface-muted)]"><IntegrationProviderMark provider="slack" size={19} /></span><div><h2 id="settings-slack" className="text-2xl font-semibold tracking-tight text-[var(--ledger-text-primary)]">Slack</h2><p className="mt-1 text-[13px] leading-5 text-[var(--ledger-text-secondary)]">Capture Slack messages, monitor selected conversations, and link Slack context throughout Ledger.</p></div></div>
    {!canManage && <p className="mt-5 flex items-center gap-2 text-xs text-[var(--ledger-text-muted)]"><CircleAlert size={14} />You don’t have permission to manage the workspace Slack connection.</p>}
    <IntegrationSection title="Connection">{loading ? <LoadingRow label="Checking Slack connection…" /> : !status.connected ? <div className="flex items-center justify-between gap-4"><div><p className="text-[13px] font-medium">Connect Slack to this workspace</p><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Authorization opens securely in your browser.</p></div><button type="button" onClick={() => void connectWorkspace()} disabled={!canManage || !!busy} className={settingsIntegrationPrimary}>{busy === 'connect' ? 'Opening…' : 'Connect Slack'}</button></div> : <><div className="divide-y divide-[color:var(--ledger-border-subtle)]"><MetaRow label="Connected Slack workspace" value={status.team_name || 'Slack workspace'} /><MetaRow label="Status" value={statusLabel} icon={status.needs_reauthorization ? <CircleAlert size={14} /> : <Check size={14} />} /><MetaRow label="Connected by" value={status.connected_by?.name || status.connected_by?.email || '—'} /><MetaRow label="Connected on" value={formatDate(status.created_at)} /><MetaRow label="Last checked" value={formatDate(status.updated_at)} /><MetaRow label="Intake destination" value={`${activeWorkspace?.name || 'This workspace'} Intake`} /></div>{status.needs_reauthorization && <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50/70 p-3 text-xs text-amber-900"><CircleAlert size={14} className="mt-0.5 shrink-0" /><span>Slack needs additional permissions to monitor activity. Reauthorize Slack to resume monitoring.</span></div>}<div className="mt-4 flex gap-2"><button type="button" className={settingsIntegrationButton} onClick={() => void connectWorkspace()} disabled={!canManage || !!busy}>{busy === 'connect' ? 'Opening…' : status.needs_reauthorization ? 'Reauthorize Slack' : 'Reauthorize'}</button><button type="button" className="h-8 rounded-full border border-[color:rgba(217,45,32,0.18)] px-3 text-xs font-medium text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-50" onClick={() => setConfirmDisconnect(true)} disabled={!canManage || !!busy}>Disconnect</button></div></>}</IntegrationSection>
    <IntegrationSection title="Personal Slack identity">{loading ? <LoadingRow label="Checking your Slack identity…" /> : identityConnected ? <><div className="divide-y divide-[color:var(--ledger-border-subtle)]"><MetaRow label="Connected Slack user" value={identity?.slack_display_name || identity?.slack_real_name || identity?.slack_email || 'Slack user'} /><MetaRow label="Identity status" value="Connected" icon={<Check size={14} />} /><MetaRow label="Linked on" value={formatDate(identity?.linked_at)} /><MetaRow label="Last verified" value={formatDate(identity?.last_verified_at)} /></div><div className="mt-4 flex gap-2"><button type="button" className={settingsIntegrationButton} onClick={() => void connectIdentity()} disabled={!!busy}>Reconnect</button><button type="button" className="h-8 rounded-full border border-[color:rgba(217,45,32,0.18)] px-3 text-xs font-medium text-[var(--ledger-text-danger)] hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-50" onClick={() => setConfirmIdentityDisconnect(true)} disabled={!!busy}>Disconnect identity</button></div></> : <div className="flex items-center justify-between gap-4"><div><p className="text-[13px] font-medium">{identityNeedsAuth ? 'Slack identity needs reauthorization' : 'No personal Slack identity connected'}</p><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Your identity is separate from the workspace connection and only affects your own watches, mentions, and replies.</p></div><button type="button" onClick={() => void connectIdentity()} disabled={!status.connected || !!busy} className={settingsIntegrationButton}>{identityNeedsAuth ? 'Reconnect' : 'Connect my Slack account'}</button></div>}</IntegrationSection>
    <IntegrationSection title="Capabilities"><Capability title="Send messages to Intake" detail="Save selected Slack messages into this workspace’s Intake." status={capabilityStatus(false)} /><Capability title="View watched conversation activity" detail="Monitor conversations selected in Slack watches." status={capabilityStatus(true)} /><Capability title="Personal mentions and replies" detail="See relevant activity for your connected Slack identity." status={capabilityStatus(true)} /><Capability title="Reusable Slack context" detail="Link captured Slack threads to Ledger work." status={capabilityStatus(false)} /><Capability title="Continued thread reply sync" detail="Keep linked thread context current when replies arrive." status={capabilityStatus(true)} /><Capability title="Open original message in Slack" detail="Return to the source conversation when needed." status={capabilityStatus(false)} /></IntegrationSection>
    <IntegrationSection title="Activity monitoring"><div className="divide-y divide-[color:var(--ledger-border-subtle)]"><MetaRow label="Event monitoring status" value={status.connected && !status.needs_reauthorization ? 'Active' : status.connected ? 'Paused' : 'Unavailable'} /><MetaRow label="Required permissions status" value={status.needs_reauthorization ? 'Action required' : status.connected ? 'Available' : 'Unavailable'} /><MetaRow label="Last event received" value={formatDate(lastEvent)} /><MetaRow label="Last successful sync" value={formatDate(lastSync)} /><MetaRow label="Watched conversation count" value={String(watches.length)} /><MetaRow label="Synced thread count" value={String(contexts.length)} /></div>{status.needs_reauthorization && <p className="mt-3 text-xs text-amber-900">Slack activity is paused until the connection is reauthorized.</p>}<div className="mt-4 flex gap-2"><button type="button" className={settingsIntegrationButton} onClick={() => void connectWorkspace()} disabled={!canManage || !!busy}>{status.needs_reauthorization ? 'Reauthorize Slack' : 'Reauthorize Slack'}</button><button type="button" className={settingsIntegrationButton} onClick={() => { setBusy('check'); void refresh().finally(() => setBusy(null)); }} disabled={!!busy}>{busy === 'check' ? <Loader2 size={13} className="animate-spin" /> : null}Retry connection check</button></div></IntegrationSection>
    <IntegrationSection title="Watched conversations"><p className="text-[13px] text-[var(--ledger-text-secondary)]">{personalWatches.length} personal {personalWatches.length === 1 ? 'watch' : 'watches'} · {workspaceWatches.length} workspace {workspaceWatches.length === 1 ? 'watch' : 'watches'}</p><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Manage watched conversations from the Slack module.</p></IntegrationSection>
    {error && <p className="mt-3 text-xs text-[var(--ledger-danger)]" role="alert">{error}</p>}
    {confirmDisconnect && <ConfirmDialog title="Disconnect Slack?" body="New Slack activity will stop and watched conversations will pause. Existing Slack contexts and captured Intake items will remain in Ledger." confirmLabel="Disconnect" busy={busy === 'disconnect'} onCancel={() => setConfirmDisconnect(false)} onConfirm={() => void disconnectWorkspace()} />}
    {confirmIdentityDisconnect && <ConfirmDialog title="Disconnect your Slack identity?" body="This only disconnects your personal Slack identity. Slack will remain connected for the Ledger workspace, and existing Slack contexts and Intake items will remain." confirmLabel="Disconnect identity" busy={busy === 'identity'} onCancel={() => setConfirmIdentityDisconnect(false)} onConfirm={() => void disconnectIdentity()} />}
  </section>;
};

const ConfirmDialog = ({ title, body, confirmLabel, busy, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) => <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="w-full max-w-sm rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.18)]" role="dialog" aria-modal="true" aria-labelledby="slack-confirm-title"><h3 id="slack-confirm-title" className="text-base font-semibold">{title}</h3><p className="mt-2 text-sm text-[var(--ledger-text-secondary)]">{body}</p><div className="mt-5 flex justify-end gap-2"><button type="button" className={settingsIntegrationButton} onClick={onCancel}>Cancel</button><button type="button" className="h-8 rounded-full bg-[var(--ledger-danger)] px-3 text-xs font-medium text-white disabled:opacity-50" onClick={onConfirm} disabled={busy}>{busy ? 'Disconnecting…' : confirmLabel}</button></div></div></div>;
