import {
  Bell,
  ExternalLink,
  Inbox,
  Loader2,
  Search,
  Settings2,
  Unplug,
  Check,
  ChevronDown,
  LockKeyhole,
  SlidersHorizontal,
  Users,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  X,
  MoreHorizontal,
  CircleAlert,
  Hash,
  MessageCircle,
  Eye,
  EyeOff,
  Link2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSidebar } from '../../context/SidebarContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import {
  ModuleHeaderActionButton,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { IntegrationProviderMark } from '../Common/IntegrationProviderMark';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ContextMenu, type ContextMenuGroup } from '../Common/ContextMenu';

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
  context_id?: string | null;
  is_following?: boolean;
  matches?: Array<{ match_type?: string | null }>;
  dismissed_at?: string | null;
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
  { value: 'all', label: 'All' },
  { value: 'in_intake', label: 'In intake' },
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

const isStaleSlackCapture = (capture: SlackCapture) => {
  if (capture.capture_status !== 'received' && capture.capture_status !== 'processing') return false;
  const createdAt = new Date(capture.created_at).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt > 15 * 60_000;
};

export default function SlackWindow({ routeWorkspaceId = null }: SlackWindowProps) {
  const api = useApi();
  const { workspaceShellLayout } = useSidebar();
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
  const [activityContextMenu, setActivityContextMenu] = useState<{ activity: SlackActivity; x: number; y: number } | null>(null);

  useEffect(() => {
    const handleActivityMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ activity: SlackActivity; x: number; y: number }>).detail;
      if (detail?.activity) setActivityContextMenu(detail);
    };
    window.addEventListener('slack:activity-menu', handleActivityMenu);
    return () => window.removeEventListener('slack:activity-menu', handleActivityMenu);
  }, []);
  const [linkActivity, setLinkActivity] = useState<SlackActivity | null>(null);
  const [linkTargets, setLinkTargets] = useState<Array<{ id: string; targetType: string; title: string }>>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [pageView, setPageView] = useState<'activity' | 'watched' | 'captures'>('activity');

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

  const removeCapture = async (capture: SlackCapture) => {
    if (!workspaceId) return;
    try {
      await api.removeSlackCapture(workspaceId, capture.id);
      setCaptures((current) => current.filter((row) => row.id !== capture.id));
    } catch {
      setCaptureError('Ledger could not remove this Slack capture.');
    }
  };

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

  const loadCounts = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [inbox, notifications] = await Promise.all([
        api.getInboxCount() as Promise<{ count?: number }>,
        api.getNotificationCenterSummary() as Promise<{ counts?: { active?: number } }>,
      ]);
      setInboxCount(Math.max(0, Number(inbox?.count ?? 0)));
      setNotificationCount(Math.max(0, Number(notifications?.counts?.active ?? 0)));
    } catch {
      setInboxCount(0);
      setNotificationCount(0);
    }
  }, [api, workspaceId]);

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
    void loadCounts();
    const timer = window.setInterval(() => void loadCounts(), 10_000);
    return () => window.clearInterval(timer);
  }, [loadCounts]);

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
      if (filter === 'failed') return capture.capture_status === 'failed' || isStaleSlackCapture(capture);
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

  const markActivityUnread = async (activity: SlackActivity) => {
    if (!workspaceId || !activity.is_read) return;
    setActivityBusy(`unread-${activity.id}`);
    try { await api.markSlackActivityUnread(workspaceId, activity.id); setActivities((current) => current.map((row) => row.id === activity.id ? { ...row, is_read: false } : row)); } catch { setActivityError('Ledger could not update this Slack activity.'); } finally { setActivityBusy(null); }
  };

  const toggleActivityFollow = async (activity: SlackActivity) => {
    if (!workspaceId || !activity.context_id) return;
    setActivityBusy(`follow-${activity.id}`);
    try { const result = await api.followSlackContext(workspaceId, activity.context_id, !activity.is_following) as { following?: boolean }; setActivities((current) => current.map((row) => row.id === activity.id ? { ...row, is_following: Boolean(result.following) } : row)); } catch { setActivityError('Ledger could not update this Slack thread.'); } finally { setActivityBusy(null); }
  };

  const hideActivity = async (activity: SlackActivity) => {
    if (!workspaceId) return;
    setActivityBusy(`hide-${activity.id}`);
    try { await api.dismissSlackActivity(workspaceId, activity.id); setActivities((current) => current.filter((row) => row.id !== activity.id)); } catch { setActivityError('Ledger could not hide this Slack activity.'); } finally { setActivityBusy(null); }
  };

  const openActivityMenuFromPointer = (event: ReactMouseEvent<HTMLElement>) => {
    if (pageView !== 'activity') return;
    const article = (event.target as HTMLElement).closest('article');
    if (!article) return;
    const articles = Array.from(event.currentTarget.querySelectorAll('article'));
    const activity = activities[articles.indexOf(article)];
    if (!activity) return;
    setActivityContextMenu({ activity, x: event.clientX, y: event.clientY });
  };

  const openActivityMenuFromClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest('button[title="More actions"]')) return;
    const article = target.closest('article');
    if (!article) return;
    const articles = Array.from(event.currentTarget.querySelectorAll('article'));
    const activity = activities[articles.indexOf(article)];
    if (!activity) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = target.closest('button')?.getBoundingClientRect();
    setActivityContextMenu({ activity, x: rect?.right ?? event.clientX, y: rect?.bottom ?? event.clientY });
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
    <div
      className="relative flex h-screen min-h-0 flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-none"
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
      <ModuleWindowHeader
        title="Slack"
        subtitle="Stay current across your important conversations."
        stripTitle="Slack"
        icon={<IntegrationProviderMark provider="slack" size={20} />}
        onClose={close}
        onMinimize={() => window.desktopWindow?.minimizeModule('slack')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('slack')}
        showBodyHeader={false}
        stripLeadingActions={
          <div className="flex items-center gap-1">
            <ModuleHeaderActionButton
              variant="strip"
              iconOnly
              square
              children={null}
              onClick={() => openSlack()}
              title="Open Slack"
              ariaLabel="Open Slack"
              icon={<ExternalLink size={13} />}
            />
            <ModuleHeaderActionButton
              variant="strip"
              iconOnly
              square
              children={null}
              onClick={openWatchPicker}
              title="Watch conversations"
              ariaLabel="Watch conversations"
              icon={<Users size={13} />}
              disabled={identity?.status !== 'connected'}
            />
            <ModuleHeaderActionButton
              variant="strip"
              iconOnly
              square
              children={null}
              onClick={openSettings}
              title="Integration settings"
              ariaLabel="Integration settings"
              icon={<Settings2 size={13} />}
            />
          </div>
        }
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={12} />}
              count={inboxCount}
              onClick={() => window.desktopWindow?.openModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={12} />}
              count={notificationCount}
              notificationTrayToggle
              onClick={() =>
                window.dispatchEvent(new CustomEvent('ledger:toggle-notification-tray'))
              }
              title="Open notifications center"
              ariaLabel="Open notifications center"
            />
          </>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--ledger-background)] px-4 py-4 lg:px-5 lg:py-5">
        {status?.needs_reauthorization ? <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-text-secondary)]"><span className="flex min-w-0 items-center gap-2"><CircleAlert size={14} className="shrink-0 text-[var(--ledger-warning)]" /><span className="truncate">Slack needs additional permissions to monitor activity.</span></span>{canManage ? <button type="button" onClick={openSettings} className="shrink-0 font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)] hover:underline">Reauthorize</button> : <span className="shrink-0 text-[var(--ledger-text-muted)]">Ask an admin</span>}</div> : null}
        <div className="flex min-h-[680px] w-full flex-col overflow-hidden rounded-[18px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_18px_44px_rgba(66,42,24,0.06)]">
          {isLoading ? <SlackSkeleton /> : isDisconnected ? (
            <DisconnectedState canManage={canManage} isConnecting={isConnecting} onConnect={connectSlack} onBack={close} onSettings={openSettings} />
          ) : (
            <>
              <header className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
                <p className="text-[13px] text-[var(--ledger-text-muted)]">Slack activity across {activeWorkspace?.name ?? 'this workspace'}.</p>
              </header>
              <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_250px]">
                <main className="slack-content min-h-0 min-w-0 overflow-y-auto px-3 py-3" onContextMenu={(event) => { if ((event.target as HTMLElement).closest('article')) { event.preventDefault(); openActivityMenuFromPointer(event); } }} onClick={openActivityMenuFromClick}>
                  <div className="flex items-center gap-5 border-b border-[var(--ledger-border-subtle)] px-1">
                    {([['activity', 'Activity'], ['watched', 'Watched'], ['captures', 'Sent to Intake']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setPageView(value)} className={`border-b-2 px-0.5 py-2 text-xs font-medium transition ${pageView === value ? 'border-[var(--ledger-text-primary)] text-[var(--ledger-text-primary)]' : 'border-transparent text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'}`}>{label}</button>)}
                    <button type="button" onClick={openSettings} className="ml-auto inline-flex items-center gap-1.5 px-1 py-2 text-xs text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]"><Settings2 size={13} /> Manage</button>
                  </div>
                  {pageView === 'activity' ? <SlackActivitySection date={activityDate} onDateChange={setActivityDate} recap={recap} activities={activities} filter={activityFilter} onFilterChange={setActivityFilter} isLoading={isLoadingActivity} error={activityError} onRetry={() => void loadActivity()} onOpenSlack={openSlack} onRead={(activity) => void markActivityRead(activity)} onSendToIntake={(activity) => void sendActivityToIntake(activity)} onLinkContext={(activity) => void openActivityLinker(activity)} onOpenIntake={openIntake} busy={activityBusy} identityConnected={identity?.status === 'connected'} needsReauthorization={Boolean(status?.needs_reauthorization)} onConnect={() => void connectIdentity()} onReauthorize={openSettings} /> : pageView === 'watched' ? <WatchedConversationsSection watches={watches} isLoading={isLoadingWatches} error={watchError} identityConnected={identity?.status === 'connected'} needsReauthorization={Boolean(identity?.status === 'reauthorization_required' || identity?.status === 'error' || status?.needs_reauthorization)} canManageShared={canManage && !activeWorkspace?.is_personal} onWatch={openWatchPicker} onRemove={(watch) => void removeWatch(watch)} onToggleSettings={(watchId) => setSettingsWatchId((current) => current === watchId ? null : watchId)} settingsWatchId={settingsWatchId} busy={watchBusy} onUpdatePreference={(watch, field, value) => void updateWatchPreference(watch, field, value)} onOpenSlack={openSlack} onConnect={() => void connectIdentity()} onReauthorize={openSettings} canConnect={routeMatchesActiveWorkspace} /> : <CaptureView captures={visibleCaptures} filter={filter} onFilterChange={setFilter} search={search} onSearch={setSearch} error={captureError} loading={isLoadingCaptures} onRetry={() => void loadCaptures()} onOpenSlack={openSlack} onOpenIntake={openIntake} onOpenConverted={openConvertedItem} onRemoveCapture={(capture) => void removeCapture(capture)} identityConnected={identity?.status === 'connected'} needsReauthorization={Boolean(status?.needs_reauthorization)} onConnect={() => void connectIdentity()} onReauthorize={openSettings} canConnect={routeMatchesActiveWorkspace} />}
                </main>
                <SlackContextRail status={status} identity={identity} identityLoading={isLoadingIdentity} identityError={identityError} workspaceName={activeWorkspace?.name} onManage={openSettings} onOpenSlack={openSlack} onOpenIntake={() => openIntake()} onConnect={() => void connectIdentity()} onDisconnect={() => void disconnectIdentity()} identityBusy={identityBusy} canConnect={routeMatchesActiveWorkspace} recap={recap} />
              </div>
            </>
          )}
        </div>
      </main>
      <ContextMenu
        open={Boolean(activityContextMenu)}
        x={activityContextMenu?.x ?? 0}
        y={activityContextMenu?.y ?? 0}
        width={214}
        groups={activityContextMenu ? getSlackActivityMenuGroups(activityContextMenu.activity, {
          onOpenSlack: openSlack,
          onSendToIntake: (activity) => void sendActivityToIntake(activity),
          onOpenIntake: openIntake,
          onOpenDestination: (activity) => {
            const convertedType = activity.intake_item?.converted_type;
            const convertedId = activity.intake_item?.converted_id;
            if (!convertedType || !convertedId) return openIntake(activity.intake_item?.id);
            if (convertedType === 'note') return void window.desktopWindow?.openModule('notes', { kind: 'notes', focusNoteId: convertedId });
            if (convertedType === 'task' || convertedType === 'project') return void window.desktopWindow?.openModule('projects', { kind: 'projects', ...(convertedType === 'task' ? { focusTaskId: convertedId } : { focusProjectId: convertedId }) });
            return void window.desktopWindow?.openModule('calendar', { kind: 'calendar', focusContext: `focus-${convertedType}:${convertedId}` });
          },
          onLinkContext: (activity) => void openActivityLinker(activity),
          onToggleFollow: (activity) => void toggleActivityFollow(activity),
          onMarkRead: (activity) => void markActivityRead(activity),
          onMarkUnread: (activity) => void markActivityUnread(activity),
          onHide: (activity) => void hideActivity(activity),
        }) : []}
        onClose={() => setActivityContextMenu(null)}
        ariaLabel="Slack activity actions"
        groupLabelCase="normal"
      />
      {isWatchPickerOpen ? <WatchConversationPicker conversations={conversations} search={conversationSearch} onSearch={setConversationSearch} selectedIds={selectedConversationIds} onToggle={toggleConversation} isLoading={isLoadingConversations} error={conversationError} canManageShared={canManage && !activeWorkspace?.is_personal} onClose={() => setIsWatchPickerOpen(false)} onCreatePersonal={() => void createWatches('personal')} onCreateShared={() => void createWatches('shared')} busy={watchBusy} /> : null}
      {linkActivity ? <SlackActivityLinkModal targets={linkTargets} onClose={() => setLinkActivity(null)} onLink={(target) => void linkActivityContext(target)} busy={activityBusy} /> : null}
    </div>
  );
}

function getSlackActivityMenuGroups(activity: SlackActivity, actions: { onOpenSlack: (url?: string | null) => void; onSendToIntake: (activity: SlackActivity) => void; onOpenIntake: (id?: string | null) => void; onOpenDestination: (activity: SlackActivity) => void; onLinkContext: (activity: SlackActivity) => void; onToggleFollow: (activity: SlackActivity) => void; onMarkRead: (activity: SlackActivity) => void; onMarkUnread: (activity: SlackActivity) => void; onHide: (activity: SlackActivity) => void }): ContextMenuGroup[] {
  const convertedType = activity.intake_item?.converted_type;
  const destinationLabel = convertedType ? `Open ${titleCase(convertedType)}` : null;
  return [
    { items: [
      { id: 'open-slack', label: 'Open in Slack', icon: <ExternalLink size={14} />, onClick: () => actions.onOpenSlack(activity.permalink) },
      { id: 'intake', label: destinationLabel || (activity.intake_item ? 'Open in Intake' : 'Send to Intake'), icon: <Inbox size={14} />, onClick: () => destinationLabel ? actions.onOpenDestination(activity) : activity.intake_item ? actions.onOpenIntake(activity.intake_item.id) : actions.onSendToIntake(activity) },
      { id: 'link-context', label: 'Link as context', icon: <Link2 size={14} />, onClick: () => actions.onLinkContext(activity) },
    ] },
    { items: [
      { id: 'follow', label: activity.is_following ? 'Stop following' : 'Follow thread', icon: <Eye size={14} />, hidden: !activity.context_id, onClick: () => actions.onToggleFollow(activity) },
      { id: 'read', label: activity.is_read ? 'Mark as unread' : 'Mark as read', icon: activity.is_read ? <EyeOff size={14} /> : <Check size={14} />, onClick: () => activity.is_read ? actions.onMarkUnread(activity) : actions.onMarkRead(activity) },
      { id: 'hide', label: 'Hide from activity', icon: <EyeOff size={14} />, onClick: () => actions.onHide(activity) },
    ] },
  ];
}

function SlackActivitySection({ date, onDateChange, activities, filter, onFilterChange, isLoading, error, onRetry, onOpenSlack, onRead, onSendToIntake, onLinkContext, onOpenIntake, busy, identityConnected, needsReauthorization, onConnect, onReauthorize }: { date: string; onDateChange: (date: string) => void; recap: SlackRecap | null; activities: SlackActivity[]; filter: string; onFilterChange: (filter: string) => void; isLoading: boolean; error: string | null; onRetry: () => void; onOpenSlack: (url?: string | null) => void; onRead: (activity: SlackActivity) => void; onSendToIntake: (activity: SlackActivity) => void; onLinkContext: (activity: SlackActivity) => void; onOpenIntake: (id?: string | null) => void; busy: string | null; identityConnected: boolean; needsReauthorization: boolean; onConnect: () => void; onReauthorize: () => void }) {
  const moveDate = (amount: number) => { const next = new Date(`${date}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + amount); onDateChange(next.toISOString().slice(0, 10)); };
  const isToday = date === new Date().toISOString().slice(0, 10);
  const labels: Record<string, string> = { all: 'All', mentions: 'Mentions', replies: 'Replies', threads: 'Threads', unread: 'Unread' };
  const groups = activities.reduce<Record<string, SlackActivity[]>>((result, activity) => {
    const time = activity.source_created_at ? new Date(activity.source_created_at).getTime() : Date.now();
    const age = Date.now() - time;
    const group = !activity.is_read ? 'Needs attention' : age < 86_400_000 ? 'Earlier today' : 'Yesterday';
    (result[group] ||= []).push(activity);
    return result;
  }, {});
  return <section className="space-y-3 pt-3">
    <div className="flex items-center justify-between gap-3 border-b border-[var(--ledger-border-subtle)] px-1 pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {Object.entries(labels).map(([value, label]) => <button key={value} type="button" onClick={() => onFilterChange(value)} className={`border-b-2 px-0.5 py-1 text-xs font-medium transition ${filter === value ? 'border-[var(--ledger-text-primary)] text-[var(--ledger-text-primary)]' : 'border-transparent text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'}`}>{label}</button>)}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => moveDate(-1)} className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]" aria-label="Previous day"><ArrowLeft size={14} /></button>
        <span className="px-1 text-xs font-medium text-[var(--ledger-text-secondary)]">{isToday ? 'Today' : formatDate(date)}</span>
        <button type="button" onClick={() => moveDate(1)} disabled={isToday} className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-30" aria-label="Next day"><ArrowRight size={14} /></button>
      </div>
    </div>
    {error ? <InlineError message={error} onRetry={onRetry} /> : isLoading ? <div className="h-20 animate-pulse rounded-lg bg-[var(--ledger-surface-muted)]" /> : activities.length === 0 ? <SlackEmptyState icon={<MessageCircle size={18} />} title={identityConnected ? (filter === 'all' ? 'Nothing new today' : `No ${filter} activity`) : needsReauthorization ? 'Reconnect Slack to see activity' : 'Connect Slack to see activity'} description={identityConnected ? (filter === 'all' ? 'Your Slack activity will appear here.' : 'Try another filter or check back later.') : 'Link your Slack identity to view mentions, replies, and watched conversations.'} actionLabel={!identityConnected ? (needsReauthorization ? 'Reauthorize Slack' : 'Connect account') : undefined} onAction={!identityConnected ? (needsReauthorization ? onReauthorize : onConnect) : undefined} /> : <div className="space-y-3 pt-1">{Object.entries(groups).map(([group, rows]) => <div key={group}><div className="flex h-8 items-center gap-2 rounded-lg bg-[var(--ledger-surface-muted)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)]"><ChevronDown size={14} /><span>{group}</span><span className="text-[var(--ledger-text-muted)]">{rows.length}</span></div><div className="divide-y divide-[var(--ledger-border-subtle)]">{rows.map((activity) => <SlackActivityRow key={activity.id} activity={activity} busy={busy} onOpenSlack={onOpenSlack} onRead={onRead} onSendToIntake={onSendToIntake} onLinkContext={onLinkContext} onOpenIntake={onOpenIntake} />)}</div></div>)}</div>}
  </section>;
}

function SlackActivityRow({ activity, busy, onOpenSlack, onRead, onSendToIntake, onLinkContext, onOpenIntake }: { activity: SlackActivity; busy: string | null; onOpenSlack: (url?: string | null) => void; onRead: (activity: SlackActivity) => void; onSendToIntake: (activity: SlackActivity) => void; onLinkContext: (activity: SlackActivity) => void; onOpenIntake: (id?: string | null) => void }) {
  const label = activity.activity_type === 'mention' ? 'Mention' : activity.activity_type === 'thread_reply' ? 'Reply' : activity.activity_type === 'message_edited' ? 'Edited message' : 'Slack activity';
  return <article className={`group grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 py-2.5 ${activity.is_read ? 'opacity-75' : ''}`}><span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ledger-border-subtle)] text-[var(--ledger-text-muted)]"><Hash size={13} /></span><div className="min-w-0"><div className="flex min-w-0 items-center gap-2 text-xs"><span className="font-medium text-[var(--ledger-text-primary)]">{label}</span>{!activity.is_read ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" title="Unread" /> : null}<span className="truncate text-[var(--ledger-text-muted)]">{activity.conversation_type ? titleCase(activity.conversation_type) : 'Slack conversation'}</span></div><p className="mt-0.5 truncate text-xs text-[var(--ledger-text-secondary)]">{activity.is_deleted ? 'This Slack message was deleted in Slack.' : activity.message_text || 'Slack message'}</p><p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">{formatRelative(activity.source_created_at)}{activity.context?.reply_count ? ` · ${activity.context.reply_count} replies` : ''}{activity.intake_item ? ' · Sent to Intake' : ''}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => onOpenSlack(activity.permalink)} className="hidden rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] group-hover:block" title="Open in Slack"><ExternalLink size={13} /></button><div className="relative"><button type="button" className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]" title="More actions"><MoreHorizontal size={15} /></button><div className="pointer-events-none absolute right-0 top-8 z-10 hidden w-36 rounded-lg border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)] group-focus-within:block"><button type="button" onClick={() => activity.intake_item ? onOpenIntake(activity.intake_item.id) : onSendToIntake(activity)} className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">{activity.intake_item ? 'Open in Intake' : 'Send to Intake'}</button><button type="button" onClick={() => onLinkContext(activity)} className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">Link as context</button>{!activity.is_read ? <button type="button" onClick={() => onRead(activity)} disabled={Boolean(busy)} className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">Mark as read</button> : null}</div></div></div></article>;
}

function SlackActivityLinkModal({ targets, onClose, onLink, busy }: { targets: Array<{ id: string; targetType: string; title: string }>; onClose: () => void; onLink: (target: { id: string; targetType: string }) => void; busy: string | null }) {
  return <ModalOverlay isOpen onClose={onClose} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"><div className="flex max-h-[min(560px,calc(100vh-48px))] flex-col"><div className="flex items-center justify-between border-b border-[var(--ledger-border-subtle)] px-5 py-4"><div><h2 className="text-base font-semibold">Link Slack context</h2><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Choose a Ledger object for this stored Slack activity.</p></div><ModalCloseButton onClick={onClose} ariaLabel="Close link Slack context" /></div><div className="min-h-0 overflow-y-auto p-3">{targets.length === 0 ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No Ledger objects available.</p> : targets.map((target) => <button key={`${target.targetType}-${target.id}`} type="button" onClick={() => onLink(target)} disabled={Boolean(busy)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--ledger-surface-hover)]"><span className="min-w-0 flex-1 truncate text-sm text-[var(--ledger-text-primary)]">{target.title}</span><span className="text-[11px] capitalize text-[var(--ledger-text-muted)]">{target.targetType}</span></button>)}</div></div></ModalOverlay>;
}

const conversationTypeLabel = (type: string) => type === 'private_channel' ? 'Private channel' : type === 'group_conversation' ? 'Group conversation' : type === 'direct_message' ? 'Direct message' : 'Public channel';

function WatchedConversationsSection({ watches, isLoading, error, identityConnected, needsReauthorization, canManageShared, onWatch, onRemove, onToggleSettings, settingsWatchId, busy, onUpdatePreference, onOpenSlack, onConnect, onReauthorize, canConnect }: { watches: SlackWatch[]; isLoading: boolean; error: string | null; identityConnected: boolean; needsReauthorization: boolean; canManageShared: boolean; onWatch: () => void; onRemove: (watch: SlackWatch) => void; onToggleSettings: (watchId: string) => void; settingsWatchId: string | null; busy: string | null; onUpdatePreference: (watch: SlackWatch, field: keyof SlackWatchPreferences, value: boolean) => void; onOpenSlack: (url?: string | null) => void; onConnect: () => void; onReauthorize: () => void; canConnect: boolean }) {
  const isEmpty = !isLoading && !error && (!identityConnected || watches.length === 0);
  return <section className="space-y-3">
    {!isEmpty ? <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-sm font-medium">Watched conversations</h2><p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">Conversations Ledger is monitoring.</p></div><button type="button" onClick={onWatch} disabled={!identityConnected} className="inline-flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"><Users size={13} /> Watch conversation</button></div> : null}
    {error ? <InlineError message={error} onRetry={() => {}} /> : isLoading ? <div className="space-y-2">{[1, 2].map((row) => <div key={row} className="h-10 animate-pulse bg-[var(--ledger-surface-muted)]" />)}</div> : !identityConnected ? <SlackEmptyState icon={<Eye size={18} />} title={needsReauthorization ? 'Reconnect to watch conversations' : 'Connect to watch conversations'} description="Link your Slack identity to choose the conversations Ledger should monitor." actionLabel={canConnect ? (needsReauthorization ? 'Reauthorize Slack' : 'Connect account') : undefined} onAction={canConnect ? (needsReauthorization ? onReauthorize : onConnect) : undefined} /> : watches.length === 0 ? <SlackEmptyState icon={<Eye size={18} />} title="No watched conversations" description="Choose the Slack conversations you want Ledger to monitor." actionLabel="Watch conversation" onAction={onWatch} /> : <div className="divide-y divide-[var(--ledger-border-subtle)]">{watches.map((watch) => {
      const preferences = watch.preferences ?? { include_in_daily_recap: true, show_mentions: true, show_replies: true, show_active_threads: true };
      const isSettingsOpen = settingsWatchId === watch.id;
      const isPaused = watch.status !== 'active';
      return <div key={watch.id} className="px-1 py-2.5 transition hover:bg-[var(--ledger-surface-hover)]"><div className="flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--ledger-border-subtle)] text-[var(--ledger-text-muted)]">{watch.conversation_type === 'private_channel' ? <LockKeyhole size={13} /> : <Users size={13} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">#{watch.conversation_name}</p><p className="truncate text-[11px] text-[var(--ledger-text-muted)]">{watch.watch_type === 'shared' ? 'Workspace' : 'Personal'} · {isPaused ? watch.status === 'access_lost' ? 'Access lost' : 'Paused' : 'No new activity'}{watch.last_activity_at ? ` · Last activity ${formatRelative(watch.last_activity_at)}` : ''}</p></div><button type="button" onClick={() => onOpenSlack(watch.permalink)} title="Open in Slack" aria-label="Open in Slack" className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><ExternalLink size={13} /></button><button type="button" onClick={() => onToggleSettings(watch.id)} title="Watch settings" aria-label="Watch settings" className={`rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)] ${isSettingsOpen ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]' : ''}`}><SlidersHorizontal size={13} /></button>{(watch.watch_type === 'personal' || canManageShared) ? <button type="button" onClick={() => onRemove(watch)} disabled={Boolean(busy)} title="Stop watching" aria-label="Stop watching" className="rounded-lg p-1.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-red-700 disabled:opacity-50"><Unplug size={13} /></button> : null}</div>{isSettingsOpen ? <div className="mt-3 grid gap-2 border-t border-[var(--ledger-border-subtle)] pt-3">{([['include_in_daily_recap', 'Include in daily recap'], ['show_mentions', 'Show mentions'], ['show_replies', 'Show replies'], ['show_active_threads', 'Show active threads']] as const).map(([field, label]) => <label key={field} className="flex items-center justify-between gap-3 text-xs text-[var(--ledger-text-secondary)]"><span>{label}</span><button type="button" role="switch" aria-checked={preferences[field]} disabled={Boolean(busy)} onClick={() => onUpdatePreference(watch, field, !preferences[field])} className={`relative h-5 w-9 rounded-full transition ${preferences[field] ? 'bg-[var(--ledger-accent)]' : 'bg-[var(--ledger-border-subtle)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${preferences[field] ? 'left-[18px]' : 'left-0.5'}`} /></button></label>)}</div> : null}</div>;
    })}</div>}
  </section>;
}

function WatchConversationPicker({ conversations, search, onSearch, selectedIds, onToggle, isLoading, error, canManageShared, onClose, onCreatePersonal, onCreateShared, busy }: { conversations: SlackConversation[]; search: string; onSearch: (value: string) => void; selectedIds: string[]; onToggle: (id: string) => void; isLoading: boolean; error: string | null; canManageShared: boolean; onClose: () => void; onCreatePersonal: () => void; onCreateShared: () => void; busy: string | null }) {
  return <ModalOverlay isOpen onClose={onClose} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContainer="w-full max-w-[680px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"><div className="flex h-[min(640px,calc(100vh-48px))] flex-col"><div className="flex shrink-0 items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4"><div><h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">Watch conversations</h2><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Only conversations your linked Slack identity can access are shown.</p></div><ModalCloseButton onClick={onClose} ariaLabel="Close watch conversations" /></div><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="flex items-center gap-2 rounded-lg border border-[var(--ledger-border-subtle)] px-3"><Search size={14} className="text-[var(--ledger-text-muted)]" /><input autoFocus value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search conversations" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>{error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}<div className="mt-3 overflow-hidden rounded-xl bg-[var(--ledger-surface-muted)]">{isLoading ? <div className="space-y-1 p-2">{[1, 2, 3, 4].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--ledger-surface)]" />)}</div> : conversations.length === 0 ? <p className="p-5 text-center text-xs text-[var(--ledger-text-muted)]">No accessible conversations found.</p> : conversations.map((conversation) => { const selected = selectedIds.includes(conversation.id); const personalWatched = Boolean(conversation.personal_watch); const sharedWatched = Boolean(conversation.shared_watch); return <button type="button" key={conversation.id} onClick={() => onToggle(conversation.id)} disabled={Boolean(busy) || personalWatched || sharedWatched} className={`flex w-full items-center gap-3 border-b border-[var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-default disabled:opacity-70 ${selected ? 'bg-[color:rgba(255,95,64,0.07)]' : ''}`}><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)] text-white' : 'border-[var(--ledger-border-subtle)]'}`}>{selected ? <Check size={11} /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">{conversation.name}</span><span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-[var(--ledger-text-muted)]">{conversation.is_private ? <LockKeyhole size={11} /> : null}{conversationTypeLabel(conversation.conversation_type)}{conversation.member_count ? ` · ${conversation.member_count} members` : ''}{personalWatched ? ' · Already watching' : sharedWatched ? ' · Workspace watched' : ''}</span></span><ChevronDown size={14} className="-rotate-90 text-[var(--ledger-text-muted)]" /></button>; })}</div></div><div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--ledger-border-subtle)] px-5 py-3"><p className="text-xs text-[var(--ledger-text-muted)]">{selectedIds.length} selected</p><div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={onCreatePersonal} disabled={!selectedIds.length || Boolean(busy)} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy === 'create-personal' ? 'Watching…' : 'Watch for me'}</button>{canManageShared ? <button type="button" onClick={onCreateShared} disabled={!selectedIds.length || Boolean(busy)} className="rounded-lg border border-[var(--ledger-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ledger-text-primary)] disabled:opacity-50">{busy === 'create-shared' ? 'Watching…' : 'Watch for workspace'}</button> : null}</div></div></div></ModalOverlay>;
}

function CaptureView({ captures, filter, onFilterChange, search, onSearch, error, loading, onRetry, onOpenSlack, onOpenIntake, onOpenConverted, onRemoveCapture, identityConnected, needsReauthorization, onConnect, onReauthorize, canConnect }: { captures: SlackCapture[]; filter: CaptureFilter; onFilterChange: (filter: CaptureFilter) => void; search: string; onSearch: (value: string) => void; error: string | null; loading: boolean; onRetry: () => void; onOpenSlack: (url?: string | null) => void; onOpenIntake: (id?: string | null) => void; onOpenConverted: (capture: SlackCapture) => void; onRemoveCapture: (capture: SlackCapture) => void; identityConnected: boolean; needsReauthorization: boolean; onConnect: () => void; onReauthorize: () => void; canConnect: boolean }) {
  return <section className="space-y-3 pt-3"><div className="flex flex-wrap items-center gap-x-4 border-b border-[var(--ledger-border-subtle)] px-1 pb-2">{filterOptions.map((option) => <button key={option.value} type="button" onClick={() => onFilterChange(option.value)} className={`border-b-2 px-0.5 py-1 text-xs font-medium transition ${filter === option.value ? 'border-[var(--ledger-text-primary)] text-[var(--ledger-text-primary)]' : 'border-transparent text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'}`}>{option.label}</button>)}<label className="ml-auto flex min-w-[150px] max-w-xs flex-1 items-center gap-2 text-xs text-[var(--ledger-text-muted)]"><Search size={13} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--ledger-text-muted)]" /><button type="button" onClick={() => onSearch('')} className={search ? 'opacity-100' : 'pointer-events-none opacity-0'} aria-label="Clear search"><X size={13} /></button></label></div>{error ? <InlineError message={error} onRetry={onRetry} /> : loading ? <CaptureSkeleton /> : captures.length === 0 ? <SlackEmptyState icon={<Inbox size={18} />} title={identityConnected ? 'No captures in Intake' : needsReauthorization ? 'Reconnect Slack to send captures' : 'Connect Slack to send captures'} description={identityConnected ? 'Slack captures sent to Ledger Intake will appear here.' : 'Link your Slack identity to use the Slack capture workflow.'} actionLabel={!identityConnected && canConnect ? (needsReauthorization ? 'Reauthorize Slack' : 'Connect account') : undefined} onAction={!identityConnected && canConnect ? (needsReauthorization ? onReauthorize : onConnect) : undefined} /> : <div className="divide-y divide-[var(--ledger-border-subtle)]">{captures.map((capture) => <CaptureRow key={capture.id} capture={capture} onOpenSlack={onOpenSlack} onOpenIntake={onOpenIntake} onOpenConverted={onOpenConverted} onRemoveCapture={onRemoveCapture} />)}</div>}</section>;
}

function SlackEmptyState({ icon, title, description, actionLabel, onAction }: { icon: ReactNode; title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="flex min-h-[360px] items-center justify-center px-4 py-10"><div className="max-w-xs text-center"><span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-muted)]">{icon}</span><p className="mt-3 text-sm font-medium text-[var(--ledger-text-primary)]">{title}</p><p className="mt-1.5 text-xs leading-5 text-[var(--ledger-text-muted)]">{description}</p>{actionLabel && onAction ? <button type="button" onClick={onAction} className="mt-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)] hover:underline">{actionLabel}</button> : null}</div></div>;
}

function SlackContextRail({ status, identity, identityLoading, identityError, workspaceName, onManage, onOpenSlack, onOpenIntake, onConnect, onDisconnect, identityBusy, canConnect, recap }: { status: SlackStatus | null; identity: SlackIdentity | null; identityLoading: boolean; identityError: string | null; workspaceName?: string; onManage: () => void; onOpenSlack: (url?: string | null) => void; onOpenIntake: () => void; onConnect: () => void; onDisconnect: () => void; identityBusy: 'connect' | 'disconnect' | null; canConnect: boolean; recap: SlackRecap | null }) {
  const metrics = recap?.metrics;
  const hasActivity = Boolean(metrics?.new_messages || metrics?.mentions || metrics?.replies || metrics?.active_threads);
  const isConnected = identity?.status === 'connected';
  const displayName = identity?.slack_display_name || identity?.slack_real_name || 'Slack member';
  return <aside className="border-t border-[var(--ledger-border-subtle)] px-4 py-4 md:border-l md:border-t-0"><div className="text-xs"><div className="flex items-start gap-2.5 border-b border-[var(--ledger-border-subtle)] pb-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#E01E5A]/10"><IntegrationProviderMark provider="slack" size={15} /></span><div className="min-w-0"><p className="text-sm font-medium text-[var(--ledger-text-primary)]">Slack</p><p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">{status?.team_name || 'Slack workspace'} · Connected</p></div></div><div className="pt-5"><p className="text-xs font-medium text-[var(--ledger-text-secondary)]">Today</p>{hasActivity ? <div className="mt-2 space-y-1.5">{metrics?.new_messages ? <div className="flex items-center justify-between gap-3"><span className="text-[var(--ledger-text-muted)]">New messages</span><span className="font-medium text-[var(--ledger-text-primary)]">{metrics.new_messages}</span></div> : null}{metrics?.mentions || metrics?.replies ? <p className="text-[var(--ledger-text-muted)]"><span className="font-medium text-[var(--ledger-text-primary)]">{metrics.mentions ?? 0} {metrics.mentions === 1 ? 'mention' : 'mentions'}</span> · <span className="font-medium text-[var(--ledger-text-primary)]">{metrics.replies ?? 0} {metrics.replies === 1 ? 'reply' : 'replies'}</span></p> : null}{metrics?.active_threads ? <div className="flex items-center justify-between gap-3"><span className="text-[var(--ledger-text-muted)]">Active threads</span><span className="font-medium text-[var(--ledger-text-primary)]">{metrics.active_threads}</span></div> : null}</div> : <p className="mt-1.5 text-xs text-[var(--ledger-text-muted)]">Nothing new today</p>}</div><div className="pt-5"><p className="text-xs font-medium text-[var(--ledger-text-secondary)]">Your Slack identity</p>{identityLoading ? <div className="mt-2 h-4 w-28 animate-pulse rounded bg-[var(--ledger-surface-muted)]" /> : isConnected ? <><p className="mt-1.5 font-medium text-[var(--ledger-text-primary)]">{displayName}</p><p className="mt-0.5 text-[var(--ledger-text-muted)]">Connected</p><button type="button" onClick={onDisconnect} disabled={Boolean(identityBusy)} className="mt-1.5 text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">{identityBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button></> : <><p className="mt-1.5 font-medium text-[var(--ledger-text-primary)]">Not connected</p>{canConnect ? <button type="button" onClick={onConnect} disabled={Boolean(identityBusy)} className="mt-1.5 text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">{identityBusy === 'connect' ? 'Connecting…' : 'Connect account'}</button> : null}</>}{identityError ? <p className="mt-2 text-red-700">{identityError}</p> : null}</div><div className="mt-5 space-y-2"><button type="button" onClick={onManage} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><Settings2 size={13} /> Manage integration</button><button type="button" onClick={() => onOpenSlack()} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"><ExternalLink size={13} /> Open Slack</button></div><div className="mt-6 border-t border-[var(--ledger-border-subtle)] pt-3"><p className="text-[11px] text-[var(--ledger-text-muted)]">Sending captures to</p><button type="button" onClick={onOpenIntake} className="mt-0.5 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)] hover:underline">{workspaceName || 'this workspace'} Intake</button></div></div></aside>;
}

function CaptureRow({ capture, onOpenSlack, onOpenIntake, onOpenConverted, onRemoveCapture }: { capture: SlackCapture; onOpenSlack: (url?: string | null) => void; onOpenIntake: (id?: string | null) => void; onOpenConverted: (capture: SlackCapture) => void; onRemoveCapture: (capture: SlackCapture) => void }) {
  const isFailed = capture.capture_status === 'failed';
  const isProcessing = capture.capture_status === 'received' || capture.capture_status === 'processing';
  const isStale = isStaleSlackCapture(capture);
  const isConverted = capture.intake_item?.status === 'converted';
  const convertedLabel = capture.converted_item ? `Converted to ${titleCase(capture.converted_item.type)}` : null;
  return <article className="group grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--ledger-surface-muted)]"><span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ledger-border-subtle)] text-xs font-medium text-[var(--ledger-text-secondary)]">{avatarInitial(capture.author_name)}</span><div className="min-w-0"><div className="flex items-center gap-2 text-xs"><span className="truncate font-medium text-[var(--ledger-text-primary)]">{capture.author_name || 'Slack member'}{capture.channel_name ? ` · #${capture.channel_name}` : ''}</span></div><p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-[var(--ledger-text-secondary)]">{capture.captured_text || 'Slack message'}</p><p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">Sent {formatRelative(capture.created_at)} · <span className={isFailed ? 'text-red-700' : isStale ? 'text-[var(--ledger-warning)]' : isProcessing ? 'text-[var(--ledger-warning)]' : 'text-[var(--ledger-text-muted)]'}>{isFailed ? 'Failed' : isStale ? 'Capture stalled' : isProcessing ? 'Sending to Intake' : convertedLabel || 'In Intake'}</span></p></div><div className="flex items-start gap-1"><button type="button" onClick={() => onOpenSlack(capture.external_url)} className="hidden rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] group-hover:block" title="Open in Slack"><ExternalLink size={13} /></button><div className="relative"><button type="button" className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]" title="More actions"><MoreHorizontal size={15} /></button><div className="pointer-events-none absolute right-0 top-8 z-10 hidden w-36 rounded-lg border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)] group-focus-within:block">{capture.intake_item_id ? <button type="button" onClick={() => onOpenIntake(capture.intake_item_id)} className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">Open in Intake</button> : null}{capture.converted_item && isConverted ? <button type="button" onClick={() => onOpenConverted(capture)} className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">Open Ledger item</button> : null}{(isFailed || isStale) && !capture.intake_item_id ? <button type="button" onClick={() => onRemoveCapture(capture)} className="block w-full px-3 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]">Remove from Ledger</button> : null}</div></div></div></article>;
}

function DisconnectedState({ canManage, isConnecting, onConnect, onBack, onSettings }: { canManage: boolean; isConnecting: boolean; onConnect: () => void; onBack: () => void; onSettings: () => void }) {
  return <section className="flex min-h-[min(560px,calc(100vh-180px))] flex-1 items-center justify-center px-4 py-8"><div className="w-full max-w-md rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-5 py-8 text-center"><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#E01E5A]/10"><IntegrationProviderMark provider="slack" size={19} /></span><h1 className="mt-4 text-lg font-medium">Slack is not connected</h1><p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-[var(--ledger-text-muted)]">Connect Slack to send messages into Ledger Intake and manage Slack activity for this workspace.</p><div className="mt-5 flex items-center justify-center gap-4">{canManage ? <button type="button" onClick={onConnect} disabled={isConnecting} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60">{isConnecting ? <Loader2 size={12} className="animate-spin" /> : null}{isConnecting ? 'Connecting…' : 'Connect Slack'}</button> : <p className="text-xs text-[var(--ledger-text-muted)]">Ask a workspace admin to connect Slack.</p>}<button type="button" onClick={onBack} className="text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] hover:underline">Back to workspace</button><button type="button" onClick={onSettings} className="text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] hover:underline">Integration settings</button></div></div></section>;
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
