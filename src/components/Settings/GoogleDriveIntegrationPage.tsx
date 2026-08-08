import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Folder,
  FolderKanban,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { GoogleDriveIcon } from '../Common/GoogleDriveIcon';
import { useToast } from '../Common/ToastProvider';
import { ModalOverlay } from '../Common/ModalOverlay';
import {
  IntegrationSection,
  MetaRow,
  settingsIntegrationButton,
  settingsIntegrationPrimary,
} from './FigmaIntegrationPage';
import {
  ExternalProviderOperationStatus,
  type ExternalProviderOperation,
} from '../Projects/ExternalProviderOperationStatus';
import {
  FolderTemplateBuilderModal,
  type DriveFolderTemplate,
  type DriveTemplateFolder,
} from './GoogleDriveFolderTemplateBuilder';
import {
  GoogleDriveRuleBuilderModal,
  GoogleDriveRuleTestModal,
  type GoogleDriveRule,
} from './GoogleDriveRuleBuilderModal';

type Status = {
  status?: string;
  provider_account_email?: string | null;
  connected_at?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
};
type Source = {
  id: string;
  name: string;
  provider_source_id?: string;
  canonical_url?: string | null;
  status?: string;
  last_successful_refresh_at?: string | null;
  external_metadata?: Record<string, unknown>;
  relationship?: {
    project?: { id: string; name: string } | null;
    connected_by?: { full_name?: string | null; email?: string | null } | null;
  } | null;
};
type Template = DriveFolderTemplate;
type Rule = GoogleDriveRule & {
  last_error?: string | null;
  last_success_at?: string | null;
  source?: Source;
  sourceName?: string;
  projectName?: string;
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const openExternal = (url?: string | null) => {
  if (!url) return;
  if (window.desktopWindow?.openExternal) void window.desktopWindow.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};
const openOAuth = async (api: ReturnType<typeof useApi>) => {
  const result = (await api.connectGoogleDrive()) as { url?: string };
  if (!result.url) throw new Error('Google Drive authorization is unavailable.');
  if (window.desktopWindow?.openExternal) await window.desktopWindow.openExternal(result.url);
  else window.open(result.url, '_blank', 'noopener,noreferrer');
};

export function GoogleDriveIntegrationPage({
  workspaceId,
  canManage,
  onBack,
  onStatusChange,
}: {
  workspaceId: string | null;
  canManage: boolean;
  onBack: () => void;
  onStatusChange?: (status: Status) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [status, setStatus] = useState<Status>({ status: 'disconnected' });
  const [sources, setSources] = useState<Source[]>([]);
  const [monitoring, setMonitoring] = useState<any>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [operations, setOperations] = useState<ExternalProviderOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | 'new' | null>(null);
  const [rulesAvailable, setRulesAvailable] = useState(true);
  const [ruleEditor, setRuleEditor] = useState<Rule | 'new' | null>(null);
  const [ruleMenuId, setRuleMenuId] = useState<string | null>(null);
  const [testRule, setTestRule] = useState<Rule | null>(null);
  const [historyRule, setHistoryRule] = useState<Rule | null>(null);
  const [ruleHistory, setRuleHistory] = useState<Array<Record<string, unknown>>>([]);
  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [nextStatus, nextSources, nextMonitoring, nextOperations] = await Promise.all([
        api.getGoogleDriveIntegrationStatus(),
        api.getGoogleDriveConnectedSources(),
        api.getGoogleDriveMonitoring(),
        api.getGoogleDriveOperations(),
      ]);
      const normalized = nextStatus as Status;
      setStatus(normalized);
      onStatusChange?.(normalized);
      setSources(Array.isArray(nextSources) ? (nextSources as Source[]) : []);
      setMonitoring(nextMonitoring);
      setOperations(
        Array.isArray(nextOperations) ? (nextOperations as ExternalProviderOperation[]) : []
      );
      const sourceRows = Array.isArray(nextSources) ? (nextSources as Source[]) : [];
      let available = true;
      const ruleResponses = await Promise.all(
        sourceRows.map(async (source) => {
          try {
            return await api.getConnectedSourceRules(source.id);
          } catch {
            available = false;
            return [];
          }
        })
      );
      const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
      const ruleRows = ruleResponses.flat().map((rule) => {
        const typed = rule as Rule;
        const source = sourceById.get(typed.connected_source_id || '');
        return {
          ...typed,
          source,
          sourceName: source?.name,
          projectName: source?.relationship?.project?.name,
        };
      });
      setRules(ruleRows);
      setRulesAvailable(available);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not load Google Drive settings.', {
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [workspaceId]);
  const connected = status.status === 'connected';
  const statusLabel =
    status.status === 'connected'
      ? 'Connected'
      : status.status === 'revoked'
      ? 'Reconnect required'
      : status.status === 'error'
      ? 'Needs attention'
      : 'Not connected';
  const beginOAuth = async (label: string) => {
    setBusy(label);
    try {
      await openOAuth(api);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not open Google authorization.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.disconnectGoogleDrive();
      setConfirmDisconnect(false);
      await refresh();
      toast.show('Google Drive disconnected.', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not disconnect Google Drive.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const saveTemplate = async (payload: {
    name: string;
    description: string;
    structure: { folders: DriveTemplateFolder[] };
  }) => {
    setBusy('template');
    try {
      const isStarter =
        editingTemplate !== 'new' && Boolean(editingTemplate?.id.startsWith('starter:'));
      if (editingTemplate === 'new' || isStarter) {
        await api.createExternalFolderTemplate(payload);
      } else if (editingTemplate) {
        await api.updateExternalFolderTemplate(editingTemplate.id, payload);
      }
      setEditingTemplate(null);
      await refresh();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save template.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const openTemplateEditor = (template: Template | 'new') => setEditingTemplate(template);
  const saveRule = async (sourceId: string, payload: Record<string, unknown>, ruleId?: string) => {
    setBusy('rule');
    try {
      if (ruleId) await api.updateIntegrationRule(ruleId, payload);
      else await api.createConnectedSourceRule(sourceId, payload);
      setRuleEditor(null);
      await refresh();
      toast.show(ruleId ? 'Rule updated.' : 'Rule created.', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save rule.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const deleteRule = async (rule: Rule) => {
    if (!window.confirm(`Delete ${rule.name}?`)) return;
    setBusy('rule-delete');
    try {
      await api.deleteIntegrationRule(rule.id);
      await refresh();
      toast.show('Rule deleted.', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not delete rule.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const duplicateRule = async (rule: Rule) => {
    if (!rule.connected_source_id) return;
    setBusy('rule-duplicate');
    try {
      await api.createConnectedSourceRule(rule.connected_source_id, {
        name: `${rule.name} copy`,
        project_id: rule.project_id || null,
        trigger_type: rule.trigger_type,
        trigger_config: {},
        conditions: rule.conditions || [],
        actions: rule.actions || [],
      });
      await refresh();
      toast.show('Rule duplicated.', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not duplicate rule.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const openHistory = async (rule: Rule) => {
    setRuleMenuId(null);
    setHistoryRule(rule);
    try {
      setRuleHistory(
        (await api.getIntegrationRuleExecutions(rule.id)) as Array<Record<string, unknown>>
      );
    } catch (error) {
      setRuleHistory([]);
      toast.show(error instanceof Error ? error.message : 'Could not load rule history.', {
        variant: 'error',
      });
    }
  };
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const openProject = (source: Source) => {
    const project = source.relationship?.project;
    if (!project?.id) return;
    window.history.pushState(
      {},
      '',
      `/?window=module&module=projects&project=${encodeURIComponent(project.id)}`
    );
  };
  const refreshFolder = async (source: Source) => {
    const projectId = source.relationship?.project?.id;
    if (!projectId) return;
    setFolderMenuId(null);
    setBusy(`folder:${source.id}`);
    try {
      await api.refreshConnectedSource(source.id, projectId);
      await refresh();
      toast.show('Folder refreshed.', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not refresh folder.', {
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const monitoringLabel =
    monitoring?.status === 'active'
      ? 'Active'
      : monitoring?.status === 'disabled'
      ? 'Disabled'
      : monitoring?.status === 'connection_required'
      ? 'Reconnect required'
      : 'Delayed';
  const sourceCount = sources.length;
  return (
    <section className="w-full max-w-215" aria-labelledby="settings-google-drive">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]"
      >
        ← Integrations
      </button>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ledger-surface-muted)]">
          <GoogleDriveIcon size={20} />
        </span>
        <div>
          <h2
            id="settings-google-drive"
            className="text-2xl font-semibold tracking-tight text-[var(--ledger-text-primary)]"
          >
            Google Drive
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--ledger-text-secondary)]">
            Connect Google Drive files, folders, and activity to your Ledger work.
          </p>
        </div>
      </div>
      {!canManage && (
        <p className="mt-5 flex items-center gap-2 text-xs text-[var(--ledger-danger)]">
          <AlertCircle size={14} />
          You don’t have permission to manage Google Drive integration settings.
        </p>
      )}
      <IntegrationSection title="Connection">
        {loading ? (
          <LoadingRow label="Checking Google Drive connection…" />
        ) : !connected ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium">Connect Google Drive</p>
              <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                Browse and link Google Drive files to your Ledger projects and work.
              </p>
            </div>
            <button
              type="button"
              className={settingsIntegrationPrimary}
              disabled={!canManage || !!busy}
              onClick={() => void beginOAuth('connect')}
            >
              {busy === 'connect' ? 'Opening…' : 'Connect Google Drive'}
            </button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
              <MetaRow
                label="Connected account"
                value={status.provider_account_email || 'Google account'}
              />
              <MetaRow label="Status" value={statusLabel} icon={<Check size={14} />} />
              <MetaRow label="Connected on" value={formatDate(status.connected_at)} />
              <MetaRow label="Last checked" value={formatDate(status.updated_at)} />
            </div>
            {status.status !== 'connected' && (
              <p className="mt-3 text-xs text-amber-900">
                {status.last_error || 'Reconnect Google Drive to resume live access.'}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className={settingsIntegrationButton}
                disabled={!canManage || !!busy}
                onClick={() => void beginOAuth('reconnect')}
              >
                {busy === 'reconnect' ? 'Opening…' : 'Reconnect'}
              </button>
              <button
                type="button"
                className={settingsIntegrationButton}
                disabled={!canManage || !!busy}
                onClick={() => void beginOAuth('switch')}
              >
                {busy === 'switch' ? 'Opening…' : 'Switch account'}
              </button>
            </div>
          </>
        )}
      </IntegrationSection>
      <IntegrationSection title="Connected folders">
        {sources.length === 0 ? (
          <div className="py-2">
            <p className="text-[13px] font-medium">No connected folders</p>
            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
              Connect a Google Drive folder from a Ledger project to manage its files and activity
              here.
            </p>
          </div>
        ) : (
          <div className="-mx-4 -my-4 divide-y divide-[color:var(--ledger-border-subtle)]">
            {sources.map((source) => {
              const projectName = source.relationship?.project?.name;
              const statusText =
                source.status === 'active'
                  ? 'Active'
                  : source.status === 'connection_required'
                  ? 'Reconnect required'
                  : source.status === 'inaccessible' || source.status === 'not_found'
                  ? 'Inaccessible'
                  : source.status === 'stale'
                  ? 'Monitoring delayed'
                  : source.status || 'Needs attention';
              const needsAttention = statusText !== 'Active';
              const menuOpen = folderMenuId === source.id;
              return (
                <div
                  key={source.id}
                  className="relative flex min-h-14 items-center gap-3 px-4 py-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--ledger-surface-muted)]">
                    <Folder size={14} className="text-[var(--ledger-text-muted)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
                        {source.name}
                      </p>
                      {projectName && (
                        <span className="hidden truncate text-xs text-[var(--ledger-text-muted)] sm:inline">
                          {projectName}
                        </span>
                      )}
                    </div>
                    <p
                      className={`truncate text-[11px] ${
                        needsAttention ? 'text-amber-700' : 'text-[var(--ledger-text-muted)]'
                      }`}
                    >
                      {projectName ? <span className="sm:hidden">{projectName} · </span> : null}
                      {statusText} · {Number(source.external_metadata?.itemCount || 0)} items ·
                      Refreshed{' '}
                      {source.last_successful_refresh_at
                        ? new Date(source.last_successful_refresh_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openExternal(source.canonical_url)}
                    aria-label={`Open ${source.name} in Google Drive`}
                    title="Open in Google Drive"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <ExternalLink size={14} />
                  </button>
                  {projectName && (
                    <button
                      type="button"
                      onClick={() => openProject(source)}
                      aria-label={`Open ${projectName}`}
                      title="Open project"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                    >
                      <FolderKanban size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFolderMenuId(menuOpen ? null : source.id)}
                    aria-label={`More actions for ${source.name}`}
                    aria-expanded={menuOpen}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-4 top-11 z-20 w-48 rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
                      <button
                        type="button"
                        onClick={() => openProject(source)}
                        disabled={!projectName}
                        className="block w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
                      >
                        Browse folder
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          openExternal(source.canonical_url);
                          setFolderMenuId(null);
                        }}
                        className="block w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                      >
                        Open in Google Drive
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshFolder(source)}
                        disabled={!canManage || !!busy}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
                      >
                        <RefreshCw
                          size={13}
                          className={busy === `folder:${source.id}` ? 'animate-spin' : ''}
                        />
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFolderMenuId(null);
                          toast.show('Folder settings are managed from this Google Drive page.', {
                            variant: 'info',
                          });
                        }}
                        className="block w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                      >
                        Folder settings
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFolderMenuId(null);
                          toast.show(
                            `Connected by ${
                              source.relationship?.connected_by?.full_name ||
                              source.relationship?.connected_by?.email ||
                              'Ledger user'
                            }${
                              source.last_successful_refresh_at
                                ? ` · Refreshed ${formatDate(source.last_successful_refresh_at)}`
                                : ''
                            }`,
                            { variant: 'info' }
                          );
                        }}
                        className="block w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                      >
                        View connection details
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFolderMenuId(null);
                          toast.show(
                            'Disconnect this folder from its project from the project page.',
                            { variant: 'info' }
                          );
                        }}
                        className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
                      >
                        Disconnect from project
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </IntegrationSection>
      <IntegrationSection title="Monitoring">
        <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
          <MetaRow
            label="Status"
            value={monitoringLabel}
            icon={monitoring?.status === 'active' ? <Check size={14} /> : undefined}
          />
          <MetaRow
            label="Last successful check"
            value={formatDate(monitoring?.state?.last_successful_drain_at)}
          />
          <MetaRow label="Monitored folders" value={String(sourceCount)} />
        </div>
        {monitoring?.status !== 'active' && canManage ? (
          <button
            type="button"
            className={`${settingsIntegrationButton} mt-3`}
            disabled={!!busy}
            onClick={() =>
              void (setBusy('monitoring'),
              api
                .repairGoogleDriveMonitoring()
                .then(refresh)
                .catch((error) =>
                  toast.show(
                    error instanceof Error ? error.message : 'Could not repair monitoring.',
                    { variant: 'error' }
                  )
                )
                .finally(() => setBusy(null)))
            }
          >
            {busy === 'monitoring' ? 'Retrying…' : 'Retry monitoring'}
          </button>
        ) : null}
      </IntegrationSection>
      {rulesAvailable && (
        <IntegrationSection title="Rules">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium">Automate Drive changes</p>
              <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--ledger-text-muted)]">
                Automate what happens when files change in your connected Drive folders.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                className={settingsIntegrationPrimary}
                disabled={!sources.length || !!busy}
                onClick={() => setRuleEditor('new')}
              >
                <Plus size={13} className="mr-1 inline" />
                Create rule
              </button>
            )}
          </div>
          {!sources.length ? (
            <div className="mt-3 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-3 text-xs text-[var(--ledger-text-muted)]">
              <p className="font-medium text-[var(--ledger-text-secondary)]">
                Connect a Google Drive folder first
              </p>
              <p className="mt-1">Rules watch connected folders for file changes.</p>
            </div>
          ) : rules.length ? (
            <div className="mt-4 divide-y divide-[color:var(--ledger-border-subtle)]">
              {rules.map((rule) => (
                <div key={rule.id} className="relative flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-medium">{rule.name}</p>
                      <span
                        className={`shrink-0 text-[11px] ${
                          rule.enabled ? 'text-emerald-700' : 'text-[var(--ledger-text-muted)]'
                        }`}
                      >
                        {rule.enabled ? 'On' : 'Off'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ledger-text-secondary)]">
                      {rule.trigger_type?.replace(/^file_/, 'File ').replace(/_/g, ' ') ||
                        'Drive change'}
                      {rule.sourceName ? ` in ${rule.sourceName}` : ''}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-[var(--ledger-text-muted)]">
                      {(rule.actions || [])
                        .map(
                          (action) =>
                            ((
                              {
                                send_to_intake: 'Send to Intake',
                                add_to_project_resources: 'Link to project',
                                add_project_activity: 'Add activity',
                              } as Record<string, string>
                            )[action.type || ''] || action.type?.replace(/_/g, ' '))
                        )
                        .filter(Boolean)
                        .join(' · ') || 'No actions'}
                      {rule.projectName ? ` · ${rule.projectName}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">
                      Last ran: {formatDate(rule.last_success_at)}
                    </p>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={`Actions for ${rule.name}`}
                      className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                      onClick={() => setRuleMenuId(ruleMenuId === rule.id ? null : rule.id)}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {ruleMenuId === rule.id && (
                      <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                          onClick={() => {
                            setRuleMenuId(null);
                            setRuleEditor(rule);
                          }}
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                          onClick={() => {
                            setRuleMenuId(null);
                            setTestRule(rule);
                          }}
                        >
                          <Play size={13} />
                          Test
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                          onClick={() => void openHistory(rule)}
                        >
                          <History size={13} />
                          View history
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                          onClick={() => {
                            setRuleMenuId(null);
                            void api
                              .updateIntegrationRule(rule.id, { enabled: !rule.enabled })
                              .then(refresh)
                              .catch((error) =>
                                toast.show(
                                  error instanceof Error ? error.message : 'Could not update rule.',
                                  { variant: 'error' }
                                )
                              );
                          }}
                        >
                          <Power size={13} />
                          {rule.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                          onClick={() => {
                            setRuleMenuId(null);
                            void duplicateRule(rule);
                          }}
                        >
                          <Copy size={13} />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
                          onClick={() => {
                            setRuleMenuId(null);
                            void deleteRule(rule);
                          }}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-2 text-xs text-[var(--ledger-text-muted)]">
              <p>Send new files to Intake</p>
              <p>Create a task when a file is ready for review</p>
              <p>Notify the team when a final file is added</p>
            </div>
          )}
        </IntegrationSection>
      )}
      <IntegrationSection title="Folder templates">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-[var(--ledger-text-muted)]">
            Create repeatable Google Drive folder structures for your projects.
          </p>
          {canManage && (
            <button
              type="button"
              className={settingsIntegrationButton}
              onClick={() => openTemplateEditor('new')}
            >
              <Plus size={13} className="mr-1 inline" />
              Create template
            </button>
          )}
        </div>
      </IntegrationSection>
      {operations.length ? (
        <IntegrationSection title="Recent operations">
          <div className="space-y-2">
            {operations.map((operation) => (
              <ExternalProviderOperationStatus key={operation.id} operation={operation} />
            ))}
          </div>
        </IntegrationSection>
      ) : null}
      <IntegrationSection title="Danger zone">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium">Disconnect Google Drive</p>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--ledger-text-muted)]">
              Ledger will stop accessing this Google account. Existing linked resources, folder
              connections, Intake records, and cached metadata will remain in Ledger, but live
              updates and Drive actions will stop until an account is reconnected.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full border border-[color:rgba(217,45,32,0.18)] px-3 py-2 text-xs font-medium text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
            disabled={!canManage || !!busy}
            onClick={() => setConfirmDisconnect(true)}
          >
            Disconnect Google Drive
          </button>
        </div>
      </IntegrationSection>
      {editingTemplate && (
        <FolderTemplateBuilderModal
          template={editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSave={saveTemplate}
          busy={busy === 'template'}
        />
      )}
      {ruleEditor && (
        <GoogleDriveRuleBuilderModal
          sources={sources}
          initialRule={ruleEditor === 'new' ? null : ruleEditor}
          onClose={() => setRuleEditor(null)}
          onSave={saveRule}
          busy={busy === 'rule'}
        />
      )}
      {testRule && (
        <GoogleDriveRuleTestModal
          rule={testRule}
          source={testRule.source}
          onClose={() => setTestRule(null)}
        />
      )}
      {historyRule && (
        <RuleHistoryModal
          rule={historyRule}
          executions={ruleHistory}
          onClose={() => setHistoryRule(null)}
        />
      )}
      {confirmDisconnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6">
          <div className="w-full max-w-sm rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-5 shadow-[var(--ledger-shadow)]">
            <h3 className="text-base font-semibold">Disconnect Google Drive?</h3>
            <p className="mt-2 text-sm leading-5 text-[var(--ledger-text-secondary)]">
              This does not delete Google Drive files or Ledger resources. It stops metadata
              refresh, monitoring, and Drive write actions, and connected folders may need
              reconnection later.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={settingsIntegrationButton}
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-[var(--ledger-danger)] px-3 py-2 text-xs font-medium text-white"
                disabled={busy === 'disconnect'}
                onClick={() => void disconnect()}
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Google Drive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RuleHistoryModal({
  rule,
  executions,
  onClose,
}: {
  rule: Rule;
  executions: Array<Record<string, unknown>>;
  onClose: () => void;
}) {
  return (
    <ModalOverlay
      isOpen
      onClose={onClose}
      classNameContainer="w-full max-w-lg overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
    >
      <div className="flex max-h-[min(620px,calc(100vh-32px))] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <p className="text-[11px] text-[var(--ledger-text-muted)]">Google Drive rule</p>
            <h2 className="mt-1 text-base font-semibold">{rule.name} history</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {executions.length ? (
            <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
              {executions.map((execution, index) => (
                <div key={String(execution.id || index)} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium">
                      {String(execution.status || 'Completed').replace(/_/g, ' ')}
                    </p>
                    <span className="text-[11px] text-[var(--ledger-text-muted)]">
                      {formatDate(String(execution.created_at || execution.started_at || ''))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                    {execution.error_message
                      ? String(execution.error_message)
                      : 'Actions evaluated for the matching Drive change.'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--ledger-text-muted)]">This rule has not run yet.</p>
          )}
        </div>
        <footer className="flex justify-end border-t border-[var(--ledger-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white"
          >
            Done
          </button>
        </footer>
      </div>
    </ModalOverlay>
  );
}

const LoadingRow = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 py-2 text-xs text-[var(--ledger-text-muted)]">
    <Loader2 size={14} className="animate-spin" />
    {label}
  </div>
);
