import {
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
  Unplug,
  Check,
  ChevronDown,
  LockKeyhole,
  SlidersHorizontal,
  Users,
  ArrowLeft,
  ArrowRight,
  Link2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { IntegrationProviderMark } from '../Common/IntegrationProviderMark';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';

type SlackWindowProps = { routeWorkspaceId?: string | null };
type CaptureFilter = 'all' | 'in_intake' | 'converted' | 'failed';
type SlackStatus = {
  connected?: boolean;
  team_name?: string | null;
  team_icon?: string | null;
  connected_by?: { name?: string | null; avatar_url?: string | null } | null;
  created_at?: string | null;
  needs_reauthorization?: boolean;
  missing_activity_scopes?: string[];
};
type SlackIdentity = {
  id: string;
  slack_display_name?: string | null;
  slack_real_name?: string | null;
  slack_email?: string | null;
  slack_avatar_url?: string | null;
  status?: 'connected' | 'reauthorization_required' | 'disconnected' | 'error' | string | null;
  linked_at?: string | null;
  last_verified_at?: string | null;
  error_code?: string | null;
};
type SlackConversation = {
  id: string;
  name: string;
  conversation_type: 'public_channel' | 'private_channel' | 'group_conversation' | 'direct_message' | string;
  is_private?: boolean;
  member_count?: number | null;
  latest_message_ts?: string | null;
  permalink?: string | null;
  personal_watch?: SlackWatch | null;
  shared_watch?: SlackWatch | null;
};
type SlackWatchPreferences = {
  include_in_daily_recap: boolean;
  show_mentions: boolean;
  show_replies: boolean;
  show_active_threads: boolean;
};
type SlackWatch = {
  id: string;
  slack_conversation_id: string;
  slack_team_id?: string | null;
  conversation_name: string;
  conversation_type: string;
  watch_type: 'personal' | 'shared' | string;
  status: 'active' | 'paused' | 'access_lost' | 'disconnected' | 'removed' | string;
  watch_started_at?: string | null;
  last_activity_at?: string | null;
  permalink?: string | null;
  preferences?: SlackWatchPreferences;
};
type SlackActivity = {
  id: string;
  activity_type: string;
  conversation_type?: string;
  slack_conversation_id: string;
  slack_message_ts: string;
  slack_root_thread_ts?: string | null;
  author_slack_user_id?: string | null;
  message_text?: string | null;
  permalink?: string | null;
  source_created_at?: string | null;
  is_deleted?: boolean;
  is_read?: boolean;
  context?: { reply_count?: number | null; latest_reply_at?: string | null; sync_status?: string | null } | null;
  intake_item?: { id: string; status?: string | null; converted_type?: string | null; converted_id?: string | null } | null;
};
type SlackRecap = { date: string; metrics: { new_messages: number; mentions: number; replies: number; active_threads: number; sent_to_intake: number; linked_contexts: number }; most_active_conversations?: Array<{ conversation_id: string; count: number }> };
type SlackCapture = {
  id: string;
  external_url?: string | null;
  channel_name?: string | null;
  author_name?: string | null;
  captured_text?: string | null;
  captured_at?: string | null;
  created_at: string;
  capture_status?: 'received' | 'processing' | 'completed' | 'failed' | string | null;
  failure_reason?: string | null;
  intake_item_id?: string | null;
  intake_item?: {
    id: string;
    status?: string | null;
    title?: string | null;
    converted_type?: string | null;
    converted_id?: string | null;
  } | null;
  converted_item?: { id: string; type: string; title: string } | null;
};

const filterOptions: Array<{ value: CaptureFilter; label: string }> = [
  { value: 'all', label: 'All captures' },
  { value: 'in_intake', label: 'In Intake' },
  { value: 'converted', label: 'Converted' },
  { value: 'failed', label: 'Failed' },
];

const formatDate = (value?: string | null) => {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatRelative = (value?: string | null) => {
  if (!value) return 'Just now';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Just now';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const titleCase = (value?: string | null) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const avatarInitial = (name?: string | null) =>
  String(name ?? '?').trim().charAt(0).toUpperCase() || '?';

export default function SlackWindow({ routeWorkspaceId = null }: SlackWindowProps) {
  const api = useApi();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const workspaceId = routeWorkspaceId || activeWorkspaceId;
  const routeMatchesActiveWorkspace = !routeWorkspaceId || routeWorkspaceId === activeWorkspaceId;
  const canManage = routeMatchesActiveWorkspace && (activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin');
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [captures, setCaptures] = useState<SlackCapture[]>([]);
  const [filter, setFilter] = useState<CaptureFilter>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCaptures, setIsLoadingCaptures] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [identity, setIdentity] = useState<SlackIdentity | null>(null);
  const [isLoadingIdentity, setIsLoadingIdentity] = useState(true);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [watches, setWatches] = useState<SlackWatch[]>([]);
  const [isLoadingWatches, setIsLoadingWatches] = useState(true);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [isWatchPickerOpen, setIsWatchPickerOpen] = useState(false);
  const [conversations, setConversations] = useState<SlackConversation[]>([]);
  const [conversationSearch, setConversationSearch] = useState('');
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [settingsWatchId, setSettingsWatchId] = useState<string | null>(null);
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [activityFilter, setActivityFilter] = useState('all');
  const [activities, setActivities] = useState<SlackActivity[]>([]);
  const [recap, setRecap] = useState<SlackRecap | null>(null);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityBusy, setActivityBusy] = useState<string | null>(null);
  const [linkActivity, setLinkActivity] = useState<SlackActivity | null>(null);
  const [linkTargets, setLinkTargets] = useState<Array<{ id: string; targetType: string; title: string }>>([]);

  const loadStatus = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true);
    setError(null);
    try {
      setStatus((await api.getSlackIntegrationStatus(workspaceId)) as SlackStatus);
    } catch {
      setStatus(null);
      setError('Ledger could not verify the Slack connection.');
    } finally {
      setIsLoading(false);
    }
  }, [api, workspaceId]);

  const loadCaptures = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoadingCaptures(true);
    setCaptureError(null);
    try {
      const result = await api.getSlackCaptures(workspaceId, { search });
      setCaptures((Array.isArray(result) ? result : []) as SlackCapture[]);
    } catch {
      setCaptureError('Ledger could not load recent Slack captures.');
    } finally {
      setIsLoadingCaptures(false);
    }
  }, [api, search, workspaceId]);

  const loadIdentity = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoadingIdentity(true);
    setIdentityError(null);
    try {
      const result = (await api.getSlackIdentity(workspaceId)) as { identity?: SlackIdentity | null };
      setIdentity(result.identity ?? null);
    } catch {
      setIdentity(null);
      setIdentityError('Ledger could not load your Slack identity.');
    } finally {
      setIsLoadingIdentity(false);
    }
  }, [api, workspaceId]);

  const loadWatches = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoadingWatches(true);
    setWatchError(null);
    try {
      const result = await api.getSlackWatches(workspaceId);
      setWatches((Array.isArray(result) ? result : []) as SlackWatch[]);
    } catch {
      setWatches([]);
      setWatchError('Ledger could not load watched conversations.');
    } finally {
      setIsLoadingWatches(false);
    }
  }, [api, workspaceId]);

  const loadConversations = useCallback(async () => {
    if (!workspaceId || !identity || identity.status !== 'connected') return;
    setIsLoadingConversations(true);
    setConversationError(null);
    try {
      const result = await api.getSlackConversations(workspaceId, conversationSearch);
      setConversations((Array.isArray(result) ? result : []) as SlackConversation[]);
    } catch (error) {
      setConversations([]);
      setConversationError(error instanceof Error ? error.message : 'Ledger could not load available conversations.');
    } finally {
      setIsLoadingConversations(false);
    }
  }, [api, conversationSearch, identity, workspaceId]);

  const loadActivity = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoadingActivity(true);
    setActivityError(null);
    try {
      const [activityResult, recapResult] = await Promise.all([api.getSlackActivity(workspaceId, { date: activityDate, filter: activityFilter === 'unread' ? 'all' : activityFilter, unread: activityFilter === 'unread', limit: 50 }), api.getSlackActivityRecap(workspaceId, activityDate)]);
      setActivities(Array.isArray(activityResult?.rows) ? activityResult.rows as SlackActivity[] : []);
      setRecap(recapResult as SlackRecap);
    } catch {
      setActivityError('Ledger could not load your Slack activity.');
      setActivities([]);
      setRecap(null);
    } finally {
      setIsLoadingActivity(false);
    }
  }, [activityDate, activityFilter, api, workspaceId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);

  useEffect(() => {
    void loadWatches();
  }, [loadWatches]);

  useEffect(() => {
    if (isWatchPickerOpen) void loadConversations();
  }, [isWatchPickerOpen, loadConversations]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    const handleIdentityChange = () => {
      void loadIdentity();
      void loadWatches();
    };
    window.ipcRenderer?.on?.('slack:identity-changed', handleIdentityChange as any);
    return () => {
      window.ipcRenderer?.off?.('slack:identity-changed', handleIdentityChange as any);
    };
  }, [loadIdentity, loadWatches]);

  const visibleCaptures = useMemo(() => {
    return captures.filter((capture) => {
      if (filter === 'failed') return capture.capture_status === 'failed';
      if (filter === 'in_intake') {
        return capture.intake_item?.status === 'unprocessed' || capture.intake_item?.status === 'snoozed';
      }
      if (filter === 'converted') return capture.intake_item?.status === 'converted';
      return true;
    });
  }, [captures, filter]);

  const openSettings = () => {
    void window.desktopWindow?.openModule('settings', {
      kind: 'settings',
      focusSection: 'integrations',
    });
  };

  const openSlack = (url?: string | null) => {
    if (url) void window.desktopWindow?.openExternal(url);
    else void window.desktopWindow?.openExternal('https://slack.com');
  };

  const openIntake = (id?: string | null) => {
    if (!id) return;
    void window.desktopWindow?.openModule('inbox', { kind: 'inbox', focusInboxId: id });
  };

  const openConvertedItem = (capture: SlackCapture) => {
    const item = capture.converted_item;
    if (!item) return;
    if (item.type === 'note') {
      void window.desktopWindow?.openModule('notes', { kind: 'notes', focusNoteId: item.id });
    } else if (item.type === 'task' || item.type === 'project') {
      void window.desktopWindow?.openModule('projects', {
        kind: 'projects',
        ...(item.type === 'task' ? { focusTaskId: item.id } : { focusProjectId: item.id }),
      });
    } else {
      void window.desktopWindow?.openModule('calendar', {
        kind: 'calendar',
        focusContext: `focus-${item.type}:${item.id}`,
      });
    }
  };

  const connectSlack = async () => {
    if (!workspaceId || !canManage) return;
    setIsConnecting(true);
    try {
      const result = (await api.getSlackInstallUrl(workspaceId)) as { url?: string };
      if (result.url) await window.desktopWindow?.openExternal(result.url);
    } finally {
      setIsConnecting(false);
    }
  };

  const connectIdentity = async () => {
    if (!workspaceId || !routeMatchesActiveWorkspace || identityBusy) return;
    setIdentityBusy('connect');
    setIdentityError(null);
    try {
      const result = (await api.getSlackIdentityConnectUrl(workspaceId)) as { url?: string };
      if (!result.url) throw new Error('Slack identity authorization is unavailable.');
      await window.desktopWindow?.openExternal(result.url);
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : 'Ledger could not start Slack identity linking.');
    } finally {
      setIdentityBusy(null);
    }
  };

  const disconnectIdentity = async () => {
    if (!workspaceId || identityBusy) return;
    setIdentityBusy('disconnect');
    setIdentityError(null);
    try {
      await api.disconnectSlackIdentity(workspaceId);
      await loadIdentity();
    } catch {
      setIdentityError('Ledger could not disconnect your Slack identity.');
    } finally {
      setIdentityBusy(null);
    }
  };

  const openWatchPicker = () => {
    setSelectedConversationIds([]);
    setConversationSearch('');
    setIsWatchPickerOpen(true);
  };

  const toggleConversation = (conversationId: string) => setSelectedConversationIds((current) => current.includes(conversationId) ? current.filter((id) => id !== conversationId) : [...current, conversationId]);

  const createWatches = async (watchType: 'personal' | 'shared') => {
    if (!workspaceId || selectedConversationIds.length === 0) return;
    setWatchBusy(`create-${watchType}`);
    try {
      for (const conversationId of selectedConversationIds) await api.createSlackWatch(workspaceId, { slack_conversation_id: conversationId, watch_type: watchType });
      setSelectedConversationIds([]);
      setIsWatchPickerOpen(false);
      await loadWatches();
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : 'Ledger could not start watching these conversations.');
    } finally {
      setWatchBusy(null);
    }
  };

  const removeWatch = async (watch: SlackWatch) => {
    if (!workspaceId) return;
    setWatchBusy(`remove-${watch.id}`);
    try {
      await api.removeSlackWatch(workspaceId, watch.id);
      await loadWatches();
    } catch {
      setWatchError('Ledger could not stop watching this conversation.');
    } finally {
      setWatchBusy(null);
    }
  };

  const updateWatchPreference = async (watch: SlackWatch, field: keyof SlackWatchPreferences, value: boolean) => {
    if (!workspaceId) return;
    setWatchBusy(`preference-${watch.id}`);
    try {
      await api.updateSlackWatchPreferences(workspaceId, watch.id, { [field]: value });
      await loadWatches();
    } catch {
      setWatchError('Ledger could not update watch preferences.');
    } finally {
      setWatchBusy(null);
    }
  };

  const markActivityRead = async (activity: SlackActivity) => {
    if (!workspaceId || activity.is_read) return;
    setActivityBusy(`read-${activity.id}`);
    try { await api.markSlackActivityRead(workspaceId, activity.id); setActivities((current) => current.map((row) => row.id === activity.id ? { ...row, is_read: true } : row)); } catch { setActivityError('Ledger could not update this Slack activity.'); } finally { setActivityBusy(null); }
  };

  const sendActivityToIntake = async (activity: SlackActivity) => {
    if (!workspaceId || activityBusy) return;
    setActivityBusy(`intake-${activity.id}`);
    try { const result = await api.promoteSlackActivityToIntake(workspaceId, activity.id) as { inboxId?: string }; setActivities((current) => current.map((row) => row.id === activity.id ? { ...row, intake_item: result.inboxId ? { id: result.inboxId, status: 'unprocessed' } : row.intake_item } : row)); } catch { setActivityError('Ledger could not send this Slack item to Intake.'); } finally { setActivityBusy(null); }
  };

  const openActivityLinker = async (activity: SlackActivity) => {
    if (!workspaceId) return;
    try {
      const [notes, projects, tasks] = await Promise.all([api.getNotes(), api.getProjects({ includeCompleted: true }), api.getTasks()]);
      setLinkTargets([
        ...(Array.isArray(notes) ? notes.slice(0, 40).map((item: any) => ({ id: String(item.id), targetType: 'note', title: String(item.title ?? 'Untitled note') })) : []),
        ...(Array.isArray(projects) ? projects.slice(0, 40).map((item: any) => ({ id: String(item.id), targetType: 'project', title: String(item.name ?? item.title ?? 'Untitled project') })) : []),
        ...(Array.isArray(tasks) ? tasks.slice(0, 40).map((item: any) => ({ id: String(item.id), targetType: 'task', title: String(item.title ?? 'Untitled task') })) : []),
      ]);
      setLinkActivity(activity);
    } catch { setActivityError('Ledger could not load Ledger objects for this context.'); }
  };

  const linkActivityContext = async (target: { id: string; targetType: string }) => {
    if (!workspaceId || !linkActivity) return;
    setActivityBusy(`link-${linkActivity.id}`);
    if (linkActivity.conversation_type === 'private_channel' && !window.confirm('This Slack conversation is private. Linking it here may make its captured content visible to people with access to this Ledger item.')) return;
    try { await api.linkSlackActivityContext(workspaceId, linkActivity.id, target.targetType, target.id); setLinkActivity(null); } catch { setActivityError('Ledger could not link this Slack context.'); } finally { setActivityBusy(null); }
  };

  const close = () => {
    if (window.desktopWindow) void window.desktopWindow.closeModule('slack');
    else window.history.back();
  };

  const isDisconnected = !isLoading && (!status?.connected || Boolean(error));

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--ledger-background)] text-[var(--ledger-text-primary)]">
      <ModuleWindowHeader
        title="Slack"
        subtitle="Stay current across your important conversations."
        stripTitle="Slack"
        icon={<IntegrationProviderMark provider="slack" size={20} />}
        onClose={close}
        primaryActions={
          <>
            <button type="button" onClick={() => openSlack()} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]">
              <ExternalLink size={13} /> Open Slack
            </button>
            <button type="button" onClick={openWatchPicker} disabled={identity?.status !== 'connected'} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)] disabled:opacity-40">
              <Users size={13} /> Watch conversations
            </button>
            <button type="button" onClick={openSettings} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]">
              <Settings2 size={13} /> Integration settings
            </button>
          </>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
        <div className="mx-auto max-w-5xl space-y-7">
          {isLoading ? <SlackSkeleton /> : isDisconnected ? (
            <DisconnectedState canManage={canManage} isConnecting={isConnecting} onConnect={connectSlack} onBack={close} onSettings={openSettings} />
          ) : (
            <>
              <section className="rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] p-5 shadow-[0_12px_35px_rgba(17,24,39,0.04)]">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="flex min-w-0 items-center gap-3">
                    {status?.team_icon ? <img src={status.team_icon} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E01E5A]/10"><IntegrationProviderMark provider="slack" size={21} /></span>}
                    <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">Connected workspace</p><h2 className="truncate text-lg font-medium text-[var(--ledger-text-primary)]">{status?.team_name || 'Slack workspace'}</h2></div>
                  </div>
                  <button type="button" onClick={openSettings} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><Settings2 size={13} /> Manage</button>
                </div>
                <div className="mt-5 grid gap-4 text-sm sm:grid-cols-4">
                  <OverviewValue label="Status" value="Connected" />
                  <OverviewValue label="Messages are sent to" value={`${activeWorkspace?.name || 'Current workspace'} · Ledger Intake`} />
                  <OverviewValue label="Connected on" value={formatDate(status?.created_at)} />
                  <OverviewValue label="Connected by" value={status?.connected_by?.name || 'Ledger member'} />
                </div>
              </section>

              {status?.needs_reauthorization ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900"><span>Slack needs additional permissions to enable activity monitoring.</span>{canManage ? <button type="button" onClick={openSettings} className="rounded-lg bg-white/70 px-2.5 py-1.5 font-medium hover:bg-white">Reauthorize Slack</button> : <span className="text-amber-800/80">Ask a workspace admin to reauthorize Slack.</span>}</div> : null}

              <IdentityCard identity={identity} workspaceName={status?.team_name} isLoading={isLoadingIdentity} error={identityError} canConnect={routeMatchesActiveWorkspace} busy={identityBusy} onConnect={() => void connectIdentity()} onDisconnect={() => void disconnectIdentity()} />

              <SlackActivitySection date={activityDate} onDateChange={setActivityDate} recap={recap} activities={activities} filter={activityFilter} onFilterChange={setActivityFilter} isLoading={isLoadingActivity} error={activityError} onRetry={() => void loadActivity()} onOpenSlack={openSlack} onRead={(activity) => void markActivityRead(activity)} onSendToIntake={(activity) => void sendActivityToIntake(activity)} onLinkContext={(activity) => void openActivityLinker(activity)} onOpenIntake={openIntake} busy={activityBusy} />

              <WatchedConversationsSection watches={watches} isLoading={isLoadingWatches} error={watchError} identityConnected={identity?.status === 'connected'} canManageShared={canManage && !activeWorkspace?.is_personal} onWatch={openWatchPicker} onRemove={(watch) => void removeWatch(watch)} onToggleSettings={(watchId) => setSettingsWatchId((current) => current === watchId ? null : watchId)} settingsWatchId={settingsWatchId} busy={watchBusy} onUpdatePreference={(watch, field, value) => void updateWatchPreference(watch, field, value)} onOpenSlack={openSlack} />

              <section className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><h2 className="text-base font-medium">Recent Slack captures</h2><p className="mt-1 text-sm text-[var(--ledger-text-muted)]">Messages manually sent to Ledger Intake.</p></div>
                  <button type="button" onClick={() => void Promise.all([loadStatus(), loadCaptures()])} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><RefreshCw size={13} /> Refresh</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {filterOptions.map((option) => <button key={option.value} type="button" onClick={() => setFilter(option.value)} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${filter === option.value ? 'bg-[var(--ledger-text-primary)] text-white' : 'text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'}`}>{option.label}</button>)}
                  <label className="ml-auto flex min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2.5 py-1.5 text-xs text-[var(--ledger-text-muted)] sm:max-w-xs"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search captures" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--ledger-text-muted)]" /><button type="button" onClick={() => setSearch('')} className={search ? 'opacity-100' : 'pointer-events-none opacity-0'} aria-label="Clear search"><X size={13} /></button></label>
                </div>
                {captureError ? <InlineError message={captureError} onRetry={() => void loadCaptures()} /> : isLoadingCaptures ? <CaptureSkeleton /> : visibleCaptures.length === 0 ? <EmptyState onOpenSlack={() => openSlack()} /> : <div className="space-y-2">{visibleCaptures.map((capture) => <CaptureRow key={capture.id} capture={capture} onOpenSlack={openSlack} onOpenIntake={openIntake} onOpenConverted={openConvertedItem} />)}</div>}
              </section>
            </>
          )}
        </div>
      </main>
      {isWatchPickerOpen ? <WatchConversationPicker conversations={conversations} search={conversationSearch} onSearch={setConversationSearch} selectedIds={selectedConversationIds} onToggle={toggleConversation} isLoading={isLoadingConversations} error={conversationError} canManageShared={canManage && !activeWorkspace?.is_personal} onClose={() => setIsWatchPickerOpen(false)} onCreatePersonal={() => void createWatches('personal')} onCreateShared={() => void createWatches('shared')} busy={watchBusy} /> : null}
      {linkActivity ? <SlackActivityLinkModal targets={linkTargets} onClose={() => setLinkActivity(null)} onLink={(target) => void linkActivityContext(target)} busy={activityBusy} /> : null}
    </div>
  );
}

function SlackActivitySection({ date, onDateChange, recap, activities, filter, onFilterChange, isLoading, error, onRetry, onOpenSlack, onRead, onSendToIntake, onLinkContext, onOpenIntake, busy }: { date: string; onDateChange: (date: string) => void; recap: SlackRecap | null; activities: SlackActivity[]; filter: string; onFilterChange: (filter: string) => void; isLoading: boolean; error: string | null; onRetry: () => void; onOpenSlack: (url?: string | null) => void; onRead: (activity: SlackActivity) => void; onSendToIntake: (activity: SlackActivity) => void; onLinkContext: (activity: SlackActivity) => void; onOpenIntake: (id?: string | null) => void; busy: string | null }) {
  const moveDate = (amount: number) => { const next = new Date(`${date}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + amount); onDateChange(next.toISOString().slice(0, 10)); };
  const isToday = date === new Date().toISOString().slice(0, 10);
  const labels: Record<string, string> = { all: 'All activity', mentions: 'Mentions', replies: 'Replies', threads: 'Threads', watched: 'Watched', sent_to_intake: 'Sent to Intake', unread: 'Unread' };
  return <section className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-medium">Today</h2><p className="mt-1 text-sm text-[var(--ledger-text-muted)]">What changed in your stored Slack activity.</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => moveDate(-1)} className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]" aria-label="Previous day"><ArrowLeft size={14} /></button><span className="min-w-24 text-center text-xs font-medium text-[var(--ledger-text-secondary)]">{isToday ? 'Today' : formatDate(date)}</span><button type="button" onClick={() => moveDate(1)} disabled={isToday} className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-30" aria-label="Next day"><ArrowRight size={14} /></button></div></div>{error ? <InlineError message={error} onRetry={onRetry} /> : isLoading ? <div className="grid gap-2 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-xl bg-[var(--ledger-surface-muted)] sm:col-span-3" /><div className="h-24 animate-pulse rounded-xl bg-[var(--ledger-surface-muted)] sm:col-span-3" /></div> : <><div className="grid gap-2 sm:grid-cols-3">{[['New messages', recap?.metrics.new_messages ?? 0], ['Mentions', recap?.metrics.mentions ?? 0], ['Replies', recap?.metrics.replies ?? 0], ['Active threads', recap?.metrics.active_threads ?? 0], ['Sent to Intake', recap?.metrics.sent_to_intake ?? 0], ['Linked contexts', recap?.metrics.linked_contexts ?? 0]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3.5 py-3"><p className="text-[11px] text-[var(--ledger-text-muted)]">{label}</p><p className="mt-1 text-xl font-medium text-[var(--ledger-text-primary)]">{value}</p></div>)}</div><div className="pt-2"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-medium">Mentions and replies</h2><p className="mt-1 text-sm text-[var(--ledger-text-muted)]">Review personal activity without importing unrelated Slack messages.</p></div><div className="flex flex-wrap gap-1">{Object.entries(labels).map(([value, label]) => <button key={value} type="button" onClick={() => onFilterChange(value)} className={`rounded-lg px-2 py-1.5 text-[11px] font-medium ${filter === value ? 'bg-[var(--ledger-text-primary)] text-white' : 'text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]'}`}>{label}</button>)}</div></div>{activities.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-[var(--ledger-border-subtle)] px-4 py-6 text-center text-sm text-[var(--ledger-text-muted)]">{filter === 'mentions' || filter === 'replies' ? 'No new mentions or replies' : 'Nothing new today'}</div> : <div className="mt-3 space-y-1">{activities.map((activity) => <article key={activity.id} className={`rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3.5 py-3 ${activity.is_read ? 'opacity-75' : ''}`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--ledger-text-muted)]"><span className="font-medium text-[var(--ledger-text-secondary)]">{activity.activity_type === 'mention' ? 'Mention' : activity.activity_type === 'thread_reply' ? 'Thread reply' : activity.activity_type === 'message_edited' ? 'Edited message' : 'Slack activity'}</span><span>·</span><span>{formatDate(activity.source_created_at)}</span>{!activity.is_read ? <span className="rounded bg-[color:rgba(255,95,64,0.1)] px-1.5 py-0.5 text-[var(--ledger-accent)]">Unread</span> : null}</div><p className="mt-1.5 text-sm leading-5 text-[var(--ledger-text-primary)]">{activity.is_deleted ? 'This Slack message was deleted in Slack.' : activity.message_text || 'Slack message'}</p>{activity.context?.reply_count ? <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">Slack thread · {activity.context.reply_count} {activity.context.reply_count === 1 ? 'reply' : 'replies'}{activity.context.sync_status === 'sync_error' ? ' · Replies may be delayed' : ''}</p> : null}</div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => onOpenSlack(activity.permalink)} title="Open in Slack" className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]"><ExternalLink size={13} /></button>{activity.intake_item ? <button type="button" onClick={() => onOpenIntake(activity.intake_item?.id)} className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">Open in Intake</button> : <button type="button" onClick={() => onSendToIntake(activity)} disabled={Boolean(busy)} className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-muted)]">Send to Intake</button>}{!activity.is_read ? <button type="button" onClick={() => onRead(activity)} disabled={Boolean(busy)} title="Mark as read" className="rounded-lg px-2 py-1.5 text-[11px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]">Read</button> : null}<button type="button" onClick={() => onLinkContext(activity)} disabled={Boolean(busy)} className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]" title="Link as context"><Link2 size={13} /></button></div></div></article>)}</div>}</div></>}</section>;
}

function SlackActivityLinkModal({ targets, onClose, onLink, busy }: { targets: Array<{ id: string; targetType: string; title: string }>; onClose: () => void; onLink: (target: { id: string; targetType: string }) => void; busy: string | null }) {
  return <ModalOverlay isOpen onClose={onClose} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"><div className="flex max-h-[min(560px,calc(100vh-48px))] flex-col"><div className="flex items-center justify-between border-b border-[var(--ledger-border-subtle)] px-5 py-4"><div><h2 className="text-base font-semibold">Link Slack context</h2><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Choose a Ledger object for this stored Slack activity.</p></div><ModalCloseButton onClick={onClose} ariaLabel="Close link Slack context" /></div><div className="min-h-0 overflow-y-auto p-3">{targets.length === 0 ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No Ledger objects available.</p> : targets.map((target) => <button key={`${target.targetType}-${target.id}`} type="button" onClick={() => onLink(target)} disabled={Boolean(busy)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--ledger-surface-hover)]"><span className="min-w-0 flex-1 truncate text-sm text-[var(--ledger-text-primary)]">{target.title}</span><span className="text-[11px] capitalize text-[var(--ledger-text-muted)]">{target.targetType}</span></button>)}</div></div></ModalOverlay>;
}

function IdentityCard({ identity, workspaceName, isLoading, error, canConnect, busy, onConnect, onDisconnect }: { identity: SlackIdentity | null; workspaceName?: string | null; isLoading: boolean; error: string | null; canConnect: boolean; busy: 'connect' | 'disconnect' | null; onConnect: () => void; onDisconnect: () => void }) {
  const isConnected = identity?.status === 'connected';
  const needsReauthorization = identity?.status === 'reauthorization_required' || identity?.status === 'error';
  const displayName = identity?.slack_display_name || identity?.slack_real_name || 'Slack member';
  return <section className="rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {isConnected && identity?.slack_avatar_url ? <img src={identity.slack_avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-muted)]"><UserRound size={16} /></span>}
        <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">Your Slack identity</p>{isLoading ? <div className="mt-1 h-4 w-40 animate-pulse rounded bg-[var(--ledger-surface-muted)]" /> : <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">{isConnected ? displayName : needsReauthorization ? 'Reconnect your Slack identity' : 'Not connected'}</p>}</div>
      </div>
      {!isLoading && isConnected ? <button type="button" onClick={onDisconnect} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)] disabled:opacity-50"><Unplug size={13} />{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect identity'}</button> : null}
    </div>
    {!isLoading && <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs leading-5 text-[var(--ledger-text-muted)]">{isConnected ? `${workspaceName || 'Slack workspace'} · Connected${identity?.linked_at ? ` · Linked ${formatDate(identity.linked_at)}` : ''}. Personal mentions, replies, and followed conversations are not synced yet.` : needsReauthorization ? 'Reconnect your Slack identity to continue receiving personal Slack activity.' : 'Connect your Slack account to view personal mentions, replies, and followed conversations.'}</p>{!isConnected && canConnect ? <button type="button" onClick={onConnect} disabled={Boolean(busy)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50">{busy === 'connect' ? <Loader2 size={13} className="animate-spin" /> : null}{needsReauthorization ? 'Reconnect' : 'Connect my Slack account'}</button> : null}</div>}
    {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
  </section>;
}

const conversationTypeLabel = (type: string) => type === 'private_channel' ? 'Private channel' : type === 'group_conversation' ? 'Group conversation' : type === 'direct_message' ? 'Direct message' : 'Public channel';

function WatchedConversationsSection({ watches, isLoading, error, identityConnected, canManageShared, onWatch, onRemove, onToggleSettings, settingsWatchId, busy, onUpdatePreference, onOpenSlack }: { watches: SlackWatch[]; isLoading: boolean; error: string | null; identityConnected: boolean; canManageShared: boolean; onWatch: () => void; onRemove: (watch: SlackWatch) => void; onToggleSettings: (watchId: string) => void; settingsWatchId: string | null; busy: string | null; onUpdatePreference: (watch: SlackWatch, field: keyof SlackWatchPreferences, value: boolean) => void; onOpenSlack: (url?: string | null) => void }) {
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-medium">Watched conversations</h2><p className="mt-1 text-sm text-[var(--ledger-text-muted)]">Choose which Slack conversations Ledger should prepare for future activity.</p></div><button type="button" onClick={onWatch} disabled={!identityConnected} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ledger-text-primary)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"><Users size={13} /> Watch conversations</button></div>
    {error ? <InlineError message={error} onRetry={() => {}} /> : isLoading ? <div className="space-y-2">{[1, 2].map((row) => <div key={row} className="h-14 animate-pulse rounded-xl bg-[var(--ledger-surface-muted)]" />)}</div> : !identityConnected ? <div className="rounded-xl border border-dashed border-[var(--ledger-border-subtle)] px-4 py-5 text-sm text-[var(--ledger-text-muted)]">Connect your Slack identity to choose conversations to watch.</div> : watches.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--ledger-border-subtle)] px-4 py-5 text-sm text-[var(--ledger-text-muted)]">No conversations watched yet. Choose a channel or conversation to prepare it for future Slack activity.</div> : <div className="space-y-1">{watches.map((watch) => {
      const preferences = watch.preferences ?? { include_in_daily_recap: true, show_mentions: true, show_replies: true, show_active_threads: true };
      const isSettingsOpen = settingsWatchId === watch.id;
      const isPaused = watch.status !== 'active';
      return <div key={watch.id} className="rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3.5 py-3 transition hover:bg-[var(--ledger-surface-hover)]"><div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-muted)]">{watch.conversation_type === 'private_channel' ? <LockKeyhole size={14} /> : <Users size={14} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">#{watch.conversation_name}</p><p className="truncate text-[11px] text-[var(--ledger-text-muted)]">{watch.watch_type === 'shared' ? 'Workspace' : 'Personal'} · {isPaused ? watch.status === 'access_lost' ? 'Access lost' : 'Paused' : 'No new activity'}{watch.last_activity_at ? ` · Last activity ${formatRelative(watch.last_activity_at)}` : ''}</p></div><button type="button" onClick={() => onOpenSlack(watch.permalink)} title="Open in Slack" aria-label="Open in Slack" className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><ExternalLink size={13} /></button><button type="button" onClick={() => onToggleSettings(watch.id)} title="Watch settings" aria-label="Watch settings" className={`rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)] ${isSettingsOpen ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]' : ''}`}><SlidersHorizontal size={13} /></button>{(watch.watch_type === 'personal' || canManageShared) ? <button type="button" onClick={() => onRemove(watch)} disabled={Boolean(busy)} title="Stop watching" aria-label="Stop watching" className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-red-700 disabled:opacity-50"><Unplug size={13} /></button> : null}</div>{isSettingsOpen ? <div className="mt-3 grid gap-2 border-t border-[var(--ledger-border-subtle)] pt-3 sm:grid-cols-2">{([['include_in_daily_recap', 'Include in daily recap'], ['show_mentions', 'Show mentions'], ['show_replies', 'Show replies'], ['show_active_threads', 'Show active threads']] as const).map(([field, label]) => <label key={field} className="flex items-center justify-between gap-3 text-xs text-[var(--ledger-text-secondary)]"><span>{label}</span><button type="button" role="switch" aria-checked={preferences[field]} disabled={Boolean(busy)} onClick={() => onUpdatePreference(watch, field, !preferences[field])} className={`relative h-5 w-9 rounded-full transition ${preferences[field] ? 'bg-[var(--ledger-accent)]' : 'bg-[var(--ledger-border-subtle)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${preferences[field] ? 'left-[18px]' : 'left-0.5'}`} /></button></label>)}</div> : null}</div>;
    })}</div>}
  </section>;
}

function WatchConversationPicker({ conversations, search, onSearch, selectedIds, onToggle, isLoading, error, canManageShared, onClose, onCreatePersonal, onCreateShared, busy }: { conversations: SlackConversation[]; search: string; onSearch: (value: string) => void; selectedIds: string[]; onToggle: (id: string) => void; isLoading: boolean; error: string | null; canManageShared: boolean; onClose: () => void; onCreatePersonal: () => void; onCreateShared: () => void; busy: string | null }) {
  return <ModalOverlay isOpen onClose={onClose} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-[680px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"><div className="flex h-[min(640px,calc(100vh-48px))] flex-col"><div className="flex shrink-0 items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4"><div><h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">Watch conversations</h2><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Only conversations your linked Slack identity can access are shown.</p></div><ModalCloseButton onClick={onClose} ariaLabel="Close watch conversations" /></div><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="flex items-center gap-2 rounded-lg border border-[var(--ledger-border-subtle)] px-3"><Search size={14} className="text-[var(--ledger-text-muted)]" /><input autoFocus value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search conversations" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>{error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}<div className="mt-3 overflow-hidden rounded-xl bg-[var(--ledger-surface-muted)]">{isLoading ? <div className="space-y-1 p-2">{[1, 2, 3, 4].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--ledger-surface)]" />)}</div> : conversations.length === 0 ? <p className="p-5 text-center text-xs text-[var(--ledger-text-muted)]">No accessible conversations found.</p> : conversations.map((conversation) => { const selected = selectedIds.includes(conversation.id); const personalWatched = Boolean(conversation.personal_watch); const sharedWatched = Boolean(conversation.shared_watch); return <button type="button" key={conversation.id} onClick={() => onToggle(conversation.id)} disabled={Boolean(busy) || personalWatched || sharedWatched} className={`flex w-full items-center gap-3 border-b border-[var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-default disabled:opacity-70 ${selected ? 'bg-[color:rgba(255,95,64,0.07)]' : ''}`}><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)] text-white' : 'border-[var(--ledger-border-subtle)]'}`}>{selected ? <Check size={11} /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">{conversation.name}</span><span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-[var(--ledger-text-muted)]">{conversation.is_private ? <LockKeyhole size={11} /> : null}{conversationTypeLabel(conversation.conversation_type)}{conversation.member_count ? ` · ${conversation.member_count} members` : ''}{personalWatched ? ' · Already watching' : sharedWatched ? ' · Workspace watched' : ''}</span></span><ChevronDown size={14} className="-rotate-90 text-[var(--ledger-text-muted)]" /></button>; })}</div></div><div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--ledger-border-subtle)] px-5 py-3"><p className="text-xs text-[var(--ledger-text-muted)]">{selectedIds.length} selected</p><div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={onCreatePersonal} disabled={!selectedIds.length || Boolean(busy)} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy === 'create-personal' ? 'Watching…' : 'Watch for me'}</button>{canManageShared ? <button type="button" onClick={onCreateShared} disabled={!selectedIds.length || Boolean(busy)} className="rounded-lg border border-[var(--ledger-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ledger-text-primary)] disabled:opacity-50">{busy === 'create-shared' ? 'Watching…' : 'Watch for workspace'}</button> : null}</div></div></div></ModalOverlay>;
}

function OverviewValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">{label}</p><p className="mt-1 truncate text-sm text-[var(--ledger-text-primary)]">{value}</p></div>;
}

function CaptureRow({ capture, onOpenSlack, onOpenIntake, onOpenConverted }: { capture: SlackCapture; onOpenSlack: (url?: string | null) => void; onOpenIntake: (id?: string | null) => void; onOpenConverted: (capture: SlackCapture) => void }) {
  const isFailed = capture.capture_status === 'failed';
  const isProcessing = capture.capture_status === 'received' || capture.capture_status === 'processing';
  const isConverted = capture.intake_item?.status === 'converted';
  const convertedLabel = capture.converted_item ? `Converted to ${titleCase(capture.converted_item.type)}` : null;
  return <article className="rounded-xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-4 py-3.5 transition hover:border-[var(--ledger-border)] hover:bg-[var(--ledger-surface-hover)]"><div className="flex gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-surface-muted)] text-xs font-medium text-[var(--ledger-text-secondary)]">{avatarInitial(capture.author_name)}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ledger-text-muted)]"><span className="font-medium text-[var(--ledger-text-secondary)]">{capture.author_name || 'Slack member'}</span>{capture.channel_name ? <><span>·</span><span>#{capture.channel_name}</span></> : null}<span>·</span><span>{formatDate(capture.captured_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[var(--ledger-text-primary)]">{capture.captured_text || 'Slack message'}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-md px-2 py-1 font-medium ${isFailed ? 'bg-red-50 text-red-700' : isProcessing ? 'bg-amber-50 text-amber-700' : isConverted ? 'bg-emerald-50 text-emerald-700' : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]'}`}>{isFailed ? 'Capture failed' : isProcessing ? 'Sending to Intake' : convertedLabel || 'In Intake'}</span><span className="text-[var(--ledger-text-muted)]">Sent {formatRelative(capture.created_at)}</span></div></div><div className="flex shrink-0 items-start gap-1"><IconAction icon={<ExternalLink size={14} />} label="Open in Slack" onClick={() => onOpenSlack(capture.external_url)} />{capture.intake_item_id ? <IconAction icon={<Inbox size={14} />} label="Open in Intake" onClick={() => onOpenIntake(capture.intake_item_id)} /> : null}{capture.converted_item && isConverted ? <IconAction icon={<FileText size={14} />} label="Open Ledger item" onClick={() => onOpenConverted(capture)} /> : null}</div></div></article>;
}

function IconAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-lg p-2 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]">{icon}</button>;
}

function DisconnectedState({ canManage, isConnecting, onConnect, onBack, onSettings }: { canManage: boolean; isConnecting: boolean; onConnect: () => void; onBack: () => void; onSettings: () => void }) {
  return <section className="mx-auto max-w-xl rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-6 py-12 text-center shadow-[0_12px_35px_rgba(17,24,39,0.04)]"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E01E5A]/10"><IntegrationProviderMark provider="slack" size={23} /></span><h1 className="mt-5 text-xl font-medium">Slack is not connected</h1><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ledger-text-muted)]">Connect Slack to send messages into Ledger Intake and manage Slack activity for this workspace.</p><div className="mt-6 flex flex-wrap justify-center gap-2">{canManage ? <button type="button" onClick={onConnect} disabled={isConnecting} className="inline-flex items-center gap-2 rounded-lg bg-[var(--ledger-accent)] px-3.5 py-2 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60">{isConnecting ? <Loader2 size={13} className="animate-spin" /> : null}{isConnecting ? 'Connecting...' : 'Connect Slack'}</button> : <p className="rounded-lg bg-[var(--ledger-surface-muted)] px-3.5 py-2 text-xs font-medium text-[var(--ledger-text-secondary)]">Ask a workspace admin to connect Slack.</p>}<button type="button" onClick={onBack} className="rounded-lg px-3.5 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)]">Back to workspace</button><button type="button" onClick={onSettings} className="rounded-lg px-3.5 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)]">Integration settings</button></div></section>;
}

function EmptyState({ onOpenSlack }: { onOpenSlack: () => void }) {
  return <div className="rounded-2xl border border-dashed border-[var(--ledger-border-subtle)] px-6 py-12 text-center"><Inbox className="mx-auto text-[var(--ledger-text-muted)]" size={22} /><h3 className="mt-4 text-base font-medium">No Slack messages in Ledger yet</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ledger-text-muted)]">From any Slack message, open More actions and choose Send to Ledger Intake. The message will appear here and in your workspace Intake.</p><button type="button" onClick={onOpenSlack} className="mt-5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><ExternalLink size={13} /> Open Slack</button></div>;
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50/60 px-4 py-3 text-xs text-red-700"><span>{message}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition hover:bg-white/70"><RotateCcw size={13} /> Try again</button></div>;
}

function SlackSkeleton() {
  return <div className="space-y-7 animate-pulse"><div className="h-36 rounded-2xl bg-[var(--ledger-surface-muted)]" /><div className="h-7 w-56 rounded-lg bg-[var(--ledger-surface-muted)]" /><div className="h-20 rounded-xl bg-[var(--ledger-surface-muted)]" /></div>;
}

function CaptureSkeleton() {
  return <div className="space-y-2">{[1, 2, 3].map((row) => <div key={row} className="h-24 animate-pulse rounded-xl bg-[var(--ledger-surface-muted)]" />)}</div>;
}
