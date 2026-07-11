import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Bell,
  Folder,
  LogOut,
  Plus,
  Funnel,
  RotateCcw,
  StickyNote,
  Trash2,
  Search,
  CheckSquare2,
  FileText,
  FolderKanban,
  Keyboard,
  Link2,
  Milestone,
  Map as MapIcon,
  Plug2,
  UserPlus,
  CircleUserRound,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useSidebar } from '../../context/SidebarContext';
import { useSearch } from '../../context/SearchContext';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceRealtimeRefresh } from '../../hooks/useWorkspaceRealtimeRefresh';
import { SkeletonList } from '../Common/Skeleton';
import { WorkspaceSwitcherMenu } from '../Common/WorkspaceSwitcherMenu';
import { sidebarTheme } from './sidebarTheme';
import { getProjectTypeOption } from '../../utils/projectTypes';
import { resolveIntakeRouting } from '../../utils/intakeRouting';

type FocusItem = {
  id: string;
  text: string;
  done: boolean;
};

type SidebarNote = {
  id: string;
  title: string;
  content: string;
  content_html?: string | null;
  created_at: string;
  updated_at?: string | null;
  source?: string | null;
};

type QuickCaptureMode = 'none' | 'note' | 'event';
type TodayTask = {
  kind: 'task' | 'reminder';
  id: string;
  title: string;
  status: string;
  due_date?: string | null;
  due_time?: string | null;
  remind_at?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  note_id?: string | null;
  note_title?: string | null;
  calendar_id?: string | null;
  calendar_name?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_color?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  assigned_to?: string | null;
  task_horizon?: 'today' | 'long_term' | null;
  is_today_focus?: boolean;
  show_in_today?: boolean;
  is_done?: boolean;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
type CompletedTodayTask = {
  kind: 'task' | 'reminder';
  id: string;
  title: string;
  status?: string;
  completed_at?: string | null;
  remind_at?: string | null;
  is_today_focus?: boolean;
  show_in_today?: boolean;
  task_horizon?: 'today' | 'long_term' | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_color?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  note_id?: string | null;
  note_title?: string | null;
};
type UpcomingItem = {
  id: string;
  title: string;
  type: 'event' | 'task';
  dueDate: string;
  time?: string;
  rawDate: string;
  sortAt: number;
  start_at?: string | null;
  end_at?: string | null;
  notes?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  note_id?: string | null;
  note_title?: string | null;
  calendar_id?: string | null;
  calendar_name?: string | null;
  workspace_name?: string | null;
  workspace_color?: string | null;
};

type ProjectSemanticStatus = 'not_started' | 'in_progress' | 'paused' | 'completed';

const formatTodayTaskWorkspace = (item: {
  workspace_name?: string | null;
  project_name?: string | null;
  note_title?: string | null;
  calendar_name?: string | null;
  created_by_name?: string | null;
  kind?: 'task' | 'reminder';
  remind_at?: string | null;
}) => {
  const parts = [
    item.workspace_name,
    item.created_by_name ? `by ${item.created_by_name}` : null,
    item.project_name,
    item.note_title ? `Note: ${item.note_title}` : null,
    item.calendar_name ? `Calendar: ${item.calendar_name}` : null,
  ].filter(Boolean);

  if (item.kind === 'reminder' && item.remind_at) {
    const remindAt = new Date(item.remind_at);
    if (!Number.isNaN(remindAt.getTime())) {
      parts.push(
        remindAt.toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
        })
      );
    }
  }

  return parts.join(' · ');
};

const getTodayTaskSortAt = (item: {
  kind?: 'task' | 'reminder';
  due_date?: string | null;
  due_time?: string | null;
  remind_at?: string | null;
  created_at?: string | null;
}) => {
  if (item.kind === 'reminder' && item.remind_at) {
    const ts = new Date(item.remind_at).getTime();
    if (Number.isFinite(ts)) return ts;
  }

  if (item.due_date) {
    const time = item.due_time ? `${item.due_time}:00` : '09:00:00';
    const ts = new Date(`${item.due_date}T${time}`).getTime();
    if (Number.isFinite(ts)) return ts;
  }

  if (item.created_at) {
    const ts = new Date(item.created_at).getTime();
    if (Number.isFinite(ts)) return ts;
  }

  return Number.MAX_SAFE_INTEGER;
};

const sortTodayTasks = <T extends { kind?: 'task' | 'reminder'; title?: string }>(items: T[]) =>
  [...items].sort((a, b) => {
    const diff = getTodayTaskSortAt(a) - getTodayTaskSortAt(b);
    if (diff !== 0) return diff;
    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });

const isUpcomingEventActive = (event: {
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}) => {
  if (String(event.status ?? '').toLowerCase() === 'done') return false;
  const endAt = new Date(event.end_at ?? event.start_at ?? 0).getTime();
  return Number.isFinite(endAt) && endAt > Date.now();
};

const todayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const formatOrdinalDay = (day: number) => {
  const mod10 = day % 10;
  const mod100 = day % 100;
  if (mod10 === 1 && mod100 !== 11) return `${day}st`;
  if (mod10 === 2 && mod100 !== 12) return `${day}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${day}rd`;
  return `${day}th`;
};

const formatTaskDueDateLabel = (value?: string | null) => {
  if (!value) return null;

  const dueDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return value;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(dueDate);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return overdueDays === 1 ? 'Overdue by 1 day' : `Overdue by ${overdueDays} days`;
  }
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) {
    return dueDate.toLocaleDateString([], { weekday: 'short' });
  }
  if (diffDays <= 30) {
    return dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  const month = dueDate.toLocaleDateString([], { month: 'long' });
  const year = dueDate.getFullYear();
  return `${month} ${formatOrdinalDay(dueDate.getDate())}, ${year}`;
};

export const ExpandedSidebar = ({
  onDragHandleMouseDown,
  onCollapseRequest,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCollapseRequest?: () => void;
}) => {
  const { user, signOut } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const { collapseToRail, position } = useSidebar();
  const { openSearch } = useSearch();
  const api = useApi();
  const isHorizontal = position === 'top' || position === 'bottom';
  const getWorkspaceTaskMetadata = () => ({
    workspace_id: activeWorkspaceId ?? null,
    workspace_name: activeWorkspace?.name?.trim() || null,
    workspace_color: activeWorkspace?.color ?? null,
  });

  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [checkin, setCheckin] = useState({
    finished: '',
    blocked: '',
    firstTaskTomorrow: '',
  });
  const [isCheckinExpanded, setIsCheckinExpanded] = useState(false);
  const [isLoadingDaily, setIsLoadingDaily] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quickCaptureMode, setQuickCaptureMode] = useState<QuickCaptureMode>('none');
  const [todayQuickDraft, setTodayQuickDraft] = useState('');
  const [todayQuickSaving, setTodayQuickSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savedNotes, setSavedNotes] = useState<SidebarNote[]>([]);
  const [savedNotesExpanded, setSavedNotesExpanded] = useState(false);
  const [eventDraft, setEventDraft] = useState('');
  const [eventDate, setEventDate] = useState(todayKey());
  const [eventStartTime, setEventStartTime] = useState('09:00');
  const [eventEndTime, setEventEndTime] = useState('10:00');
  const [quickCaptureNotice, setQuickCaptureNotice] = useState<string | null>(null);
  const todayBucketRef = useRef(todayKey());
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      completeness: number;
      color?: string;
      project_type?: string | null;
      start_date?: string | null;
      end_date?: string | null;
    }>
  >([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [calendarScope, setCalendarScope] = useState<'current_workspace' | 'all_accessible_workspaces'>(
    'current_workspace'
  );
  const [upcomingItems, setUpcomingItems] = useState<UpcomingItem[]>([]);
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [todayItems, setTodayItems] = useState<TodayTask[]>([]);
  const [isLoadingToday, setIsLoadingToday] = useState(true);
  const [completedToday, setCompletedToday] = useState<CompletedTodayTask[]>([]);
  const [sidebarRefreshToken, setSidebarRefreshToken] = useState(0);
  const autoExpireTodayTaskIdsRef = useRef<Set<string>>(new Set());
  const TODAY_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:today-collapsed:v1';
  const CHECKIN_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:checkin-collapsed:v1';
  const PROJECTS_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:projects-collapsed:v1';
  const EVENTS_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:events-collapsed:v1';
  const loadCollapsedPreference = (key: string, fallback = true) => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === null) return fallback;
      return saved === '1';
    } catch {
      return fallback;
    }
  };

  const [todayCollapsed, setTodayCollapsed] = useState<boolean>(() =>
    loadCollapsedPreference(TODAY_COLLAPSE_STORAGE_KEY)
  );
  const [projectsCollapsed, setProjectsCollapsed] = useState<boolean>(() =>
    loadCollapsedPreference(PROJECTS_COLLAPSE_STORAGE_KEY, false)
  );
  const [completedTodayExpanded, setCompletedTodayExpanded] = useState(false);
  const [todayDockPopoverOpen, setTodayDockPopoverOpen] = useState(false);
  const [todayDockPopoverStyle, setTodayDockPopoverStyle] = useState<React.CSSProperties | null>(
    null
  );
  const [todayAddRowOpen, setTodayAddRowOpen] = useState(false);
  const todayAddInputRef = useRef<HTMLInputElement | null>(null);
  const [tasksCollapsed, setTasksCollapsed] = useState(true);
  const [taskDraft, setTaskDraft] = useState('');
  const [taskScope, setTaskScope] = useState<'today' | 'long_term'>('long_term');
  const [workspaceTasks, setWorkspaceTasks] = useState<
    Array<
      TodayTask & {
        task_horizon?: 'today' | 'long_term' | null;
      }
    >
  >([]);
  const [isLoadingWorkspaceTasks, setIsLoadingWorkspaceTasks] = useState(true);
  const [isSavingWorkspaceTask, setIsSavingWorkspaceTask] = useState(false);
  const taskCaptureRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setIsCheckinExpanded(!loadCollapsedPreference(CHECKIN_COLLAPSE_STORAGE_KEY, true));
  }, []);

  useEffect(() => {
    setEventsExpanded(!loadCollapsedPreference(EVENTS_COLLAPSE_STORAGE_KEY, false));
  }, []);

  const [contextMenu, setContextMenu] = useState<{
    type: 'project' | 'today-active' | 'today-completed';
    id: string;
    kind?: 'task' | 'reminder';
    x: number;
    y: number;
  } | null>(null);
  const noteCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const quickCaptureNoticeTimerRef = useRef<number | null>(null);
  const workspaceCaptureRef = useRef<HTMLDivElement | null>(null);

  const handleSidebarWorkspaceRefresh = useCallback(() => {
    setSidebarRefreshToken((current) => current + 1);
  }, []);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: ['notes', 'projects', 'tasks', 'events', 'reminders'],
    enabled: Boolean(user && activeWorkspaceId),
    onChange: handleSidebarWorkspaceRefresh,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const loadCalendarSettings = async () => {
      try {
        const settings = (await api.getUserSettings()) as {
          preferences?: { calendarScope?: 'current_workspace' | 'all_accessible_workspaces' } | null;
        };
        if (cancelled) return;
        setCalendarScope(
          settings?.preferences?.calendarScope === 'all_accessible_workspaces'
            ? 'all_accessible_workspaces'
            : 'current_workspace'
        );
      } catch {
        if (!cancelled) {
          setCalendarScope('current_workspace');
        }
      }
    };

    void loadCalendarSettings();

    return () => {
      cancelled = true;
    };
  }, [api, user]);
  const eventCaptureRef = useRef<HTMLInputElement | null>(null);
  const todayDockButtonRef = useRef<HTMLButtonElement | null>(null);
  const todayDockPopoverRef = useRef<HTMLDivElement | null>(null);
  const checkinSectionRef = useRef<HTMLElement | null>(null);
  const sidebarContextMenuWidth = 196;
  const sidebarContextMenuHeight = 176;

  const normalizeProjectStatus = (status: string): ProjectSemanticStatus => {
    const value = status.toLowerCase();
    if (value.includes('complete')) return 'completed';
    if (value.includes('pause') || value.includes('archiv')) return 'paused';
    if (value.includes('progress') || value.includes('in_')) return 'in_progress';
    return 'not_started';
  };

  const WorkspaceSwitcher = ({ compact = false }: { compact?: boolean }) => (
    <WorkspaceSwitcherMenu variant="sidebar" compact={compact} />
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      setIsLoadingProjects(false);
      setSavedNotes([]);
      setProjects([]);
      setUpcomingItems([]);
      return;
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    const loadDaily = async () => {
      if (!user) {
        if (!cancelled) {
          setFocusItems([]);
          setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' });
          setIsLoadingDaily(false);
        }
        return;
      }

      setIsLoadingDaily(true);
      setSaveError(null);

      try {
        const data = await api.getDailyAccountability();

        if (cancelled) return;

        const row = data as {
          focus_items?: FocusItem[] | null;
          checkin_finished?: string | null;
          checkin_blocked?: string | null;
          checkin_first_task_tomorrow?: string | null;
        } | null;

        setFocusItems(Array.isArray(row?.focus_items) ? row!.focus_items : []);
        setCheckin({
          finished: row?.checkin_finished ?? '',
          blocked: row?.checkin_blocked ?? '',
          firstTaskTomorrow: row?.checkin_first_task_tomorrow ?? '',
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load daily accountability:', error);
          setFocusItems([]);
          setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDaily(false);
        }
      }
    };

    loadDaily();

    return () => {
      cancelled = true;
    };
  }, [user?.id, activeWorkspaceId, sidebarRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    let hasLoadedToday = false;

    const loadToday = async () => {
      if (!user) {
        setTodayItems([]);
        setIsLoadingToday(false);
        return;
      }

      const showInitialSkeleton = !hasLoadedToday;
      if (showInitialSkeleton) {
        setIsLoadingToday(true);
      }

      try {
        const data = await api.getToday();
        if (cancelled) return;
        const activeTasks = Array.isArray(data?.active) ? (data.active as TodayTask[]) : [];
        const activeReminders = Array.isArray(data?.reminders)
          ? (data.reminders as TodayTask[])
          : [];
        const completedTasks = Array.isArray(data?.completed)
          ? (data.completed as CompletedTodayTask[])
          : [];
        const completedReminders = Array.isArray(data?.completed_reminders)
          ? (data.completed_reminders as CompletedTodayTask[])
          : [];
        setTodayItems(
          sortTodayTasks([
            ...activeTasks.map((item) => ({ ...item, kind: 'task' as const })),
            ...activeReminders.map((item) => ({ ...item, kind: 'reminder' as const })),
          ])
        );
        setCompletedToday(
          sortTodayTasks([
            ...completedTasks.map((item) => ({ ...item, kind: 'task' as const })),
            ...completedReminders.map((item) => ({ ...item, kind: 'reminder' as const })),
          ])
        );
      } catch (error) {
        console.error('Failed to load Today items:', error);
        setTodayItems([]);
        setCompletedToday([]);
      } finally {
        hasLoadedToday = true;
        if (!cancelled && showInitialSkeleton) setIsLoadingToday(false);
      }
    };

    void loadToday();

    const refreshTimer = window.setInterval(() => {
      void loadToday();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [user?.id, activeWorkspaceId, sidebarRefreshToken]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      autoExpireTodayTaskIdsRef.current.clear();
      return;
    }
    autoExpireTodayTaskIdsRef.current.clear();
  }, [activeWorkspaceId, user]);

  useEffect(() => {
    let cancelled = false;

    const loadNotes = async () => {
      if (!user || !activeWorkspaceId) {
        setSavedNotes([]);
        return;
      }

      try {
        const data = await api.getNotes();
        if (cancelled) return;

        const payload = data as
          | {
              notes?: Array<SidebarNote>;
            }
          | Array<SidebarNote>;
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.notes)
          ? payload.notes
          : [];

        const next = rows
          .map((note) => ({
            id: note.id,
            title: note.title,
            content: note.content ?? '',
            content_html: note.content_html ?? null,
            created_at: note.created_at,
            updated_at: note.updated_at ?? null,
            source: note.source ?? null,
          }))
          .sort((a, b) => {
            const aTime = new Date(a.updated_at || a.created_at).getTime();
            const bTime = new Date(b.updated_at || b.created_at).getTime();
            return bTime - aTime;
          });

        setSavedNotes(next);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load notes:', error);
          setSavedNotes([]);
        }
      }
    };

    void loadNotes();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, user, sidebarRefreshToken]);

  useEffect(() => {
    if (!user) {
      setIsLoadingProjects(false);
      setProjects([]);
      return;
    }

    if (!activeWorkspaceId) {
      setProjects([]);
      setIsLoadingProjects(false);
      return;
    }

    let cancelled = false;

    setIsLoadingProjects(true);

    const loadProjects = async () => {
      try {
        const data = await api.getProjects();
        if (!cancelled) {
          const projects = (
            data as Array<{
              id: string;
              name: string;
              status: string;
              completeness: number;
              color?: string;
              project_type?: string | null;
              start_date?: string | null;
              end_date?: string | null;
            }>
          )
            .filter((project) => normalizeProjectStatus(project.status) !== 'completed')
            .map((project) => ({
              ...project,
              status: normalizeProjectStatus(project.status),
              completeness: Math.max(0, Math.min(100, Number(project.completeness) || 0)),
            }));
          setProjects(projects);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        if (!cancelled) setIsLoadingProjects(false);
      }
    };

    void loadProjects();

    const refreshTimer = window.setInterval(() => {
      void loadProjects();
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [user?.id, activeWorkspaceId, sidebarRefreshToken]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      setInboxCount(0);
      return;
    }

    let cancelled = false;

    const loadInboxCount = async () => {
      try {
        const payload = (await api.getInboxCount()) as { count?: number };
        if (!cancelled) {
          setInboxCount(Math.max(0, Number(payload?.count ?? 0)));
        }
      } catch (error) {
        console.error('Failed to load inbox count:', error);
      }
    };

    void loadInboxCount();

    const handleRefreshInboxCount = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void loadInboxCount();
    };

    const handleInboxItemsUpdated = (_event: unknown, payload?: { delta?: number }) => {
      if (typeof payload?.delta === 'number' && Number.isFinite(payload.delta)) {
        setInboxCount((current) => Math.max(0, current + payload.delta!));
        return;
      }
      void loadInboxCount();
    };

    window.ipcRenderer?.on('inbox:items-updated', handleInboxItemsUpdated);
    window.addEventListener('focus', handleRefreshInboxCount);
    document.addEventListener('visibilitychange', handleRefreshInboxCount);

    const refreshTimer = window.setInterval(() => {
      void loadInboxCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.ipcRenderer?.off('inbox:items-updated', handleInboxItemsUpdated);
      window.removeEventListener('focus', handleRefreshInboxCount);
      document.removeEventListener('visibilitychange', handleRefreshInboxCount);
    };
  }, [api, activeWorkspaceId, user]);

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }

    let cancelled = false;

    const loadNotificationSummary = async () => {
      try {
        const payload = (await api.getNotificationCenterSummary()) as {
          counts?: { active?: number };
        };
        if (!cancelled) {
          setNotificationCount(Math.max(0, Number(payload?.counts?.active ?? 0)));
        }
      } catch (error) {
        console.error('Failed to load notification count:', error);
      }
    };

    void loadNotificationSummary();

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ activeCount?: number }>).detail;
      if (typeof detail?.activeCount === 'number' && Number.isFinite(detail.activeCount)) {
        setNotificationCount(Math.max(0, detail.activeCount));
        return;
      }
      void loadNotificationSummary();
    };

    window.addEventListener(
      'ledger:notifications-summary',
      handleNotificationsSummary as EventListener
    );
    const refreshTimer = window.setInterval(() => {
      void loadNotificationSummary();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener(
        'ledger:notifications-summary',
        handleNotificationsSummary as EventListener
      );
    };
  }, [api, user]);

  useEffect(() => {
    if (!user) {
      setUpcomingItems([]);
      return;
    }

    if (!activeWorkspaceId) {
      setUpcomingItems([]);
      return;
    }

    let cancelled = false;

    const loadUpcoming = async () => {
      try {
        const events = await api.getUpcomingEvents({ scope: calendarScope });
        const todayISO = formatDateKey(new Date());
        const tomorrowISO = formatDateKey(addDays(new Date(), 1));

        const eventItems = (events || []).map((e: any) => {
          const startDate = new Date(e.start_at);
          const startAt = startDate.getTime();
          const isValidDate = Number.isFinite(startAt);
          const eventDateISO = isValidDate ? formatDateKey(startDate) : '';
          let dateDisplay = '';

          if (eventDateISO === todayISO) {
            dateDisplay = 'Today';
          } else if (eventDateISO === tomorrowISO) {
            dateDisplay = 'Tomorrow';
          } else {
            dateDisplay = isValidDate
              ? startDate.toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
              : 'No date';
          }

          return {
            id: e.id,
            title: e.title,
            status: e.status ?? null,
            start_at: e.start_at ?? null,
            end_at: e.end_at ?? null,
            notes: e.notes ?? null,
            project_id: e.project_id ?? null,
            project_name: e.project_name ?? null,
            note_id: e.note_id ?? null,
            note_title: e.note_title ?? null,
            calendar_id: e.calendar_id ?? null,
            calendar_name: e.calendar_name ?? null,
            workspace_name: e.workspace_name ?? null,
            workspace_color: e.workspace_color ?? null,
            type: 'event' as const,
            dueDate: dateDisplay,
                  rawDate: eventDateISO,
                  time: isValidDate
                    ? startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : undefined,
            sortAt: isValidDate ? startAt : Number.MAX_SAFE_INTEGER,
          };
        });

        const activeEventItems = eventItems
          .filter((item: { status?: string | null; start_at?: string | null; end_at?: string | null }) =>
            isUpcomingEventActive(item)
          )
          .sort((a: { sortAt: number }, b: { sortAt: number }) => a.sortAt - b.sortAt);

        if (!cancelled) {
          setUpcomingItems(activeEventItems.slice(0, 5));
        }
      } catch (error) {
        console.error('Failed to load upcoming:', error);
      }
    };

    void loadUpcoming();

    const refreshTimer = window.setInterval(() => {
      void loadUpcoming();
    }, 60_000);

    const handleCalendarItemsUpdated = () => {
      void loadUpcoming();
    };

    window.ipcRenderer?.on('calendar:items-updated', handleCalendarItemsUpdated);

    return () => {
      cancelled = true;
      window.ipcRenderer?.off('calendar:items-updated', handleCalendarItemsUpdated);
      window.clearInterval(refreshTimer);
    };
  }, [user?.id, activeWorkspaceId, calendarScope, api]);

  useEffect(() => {
    if (quickCaptureMode === 'none') return;
    const t = window.setTimeout(() => {
      if (quickCaptureMode === 'note') noteCaptureRef.current?.focus();
      if (quickCaptureMode === 'event') eventCaptureRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [quickCaptureMode]);

  useEffect(() => {
    if (quickCaptureMode === 'none') return;

    const handleOutsidePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (workspaceCaptureRef.current?.contains(target)) return;
      const hasContent =
        (quickCaptureMode === 'note' && Boolean(noteDraft.trim())) ||
        (quickCaptureMode === 'event' && Boolean(eventDraft.trim()));
      if (hasContent) return;
      setQuickCaptureMode('none');
    };

    document.addEventListener('mousedown', handleOutsidePointerDown);
    return () => document.removeEventListener('mousedown', handleOutsidePointerDown);
  }, [eventDraft, noteDraft, quickCaptureMode]);

  useEffect(() => {
    if (tasksCollapsed) return;
    const t = window.setTimeout(() => {
      taskCaptureRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [tasksCollapsed]);

  useEffect(() => {
    const handleOpenCheckin = () => {
      setIsCheckinExpanded(true);
      window.setTimeout(() => {
        checkinSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    };

    window.ipcRenderer?.on('sidebar:open-checkin', handleOpenCheckin);
    return () => {
      window.ipcRenderer?.off('sidebar:open-checkin', handleOpenCheckin);
    };
  }, []);

  useEffect(() => {
    if (!todayDockPopoverOpen || !todayDockButtonRef.current) {
      setTodayDockPopoverStyle(null);
      return;
    }

    const updateTodayDockPosition = () => {
      const rect = todayDockButtonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const preferredWidth = 340;
      const gap = 10;
      const centeredLeft = rect.left + rect.width / 2 - preferredWidth / 2;
      const left = Math.max(12, Math.min(window.innerWidth - preferredWidth - 12, centeredLeft));
      const isBottomDock = position === 'bottom';
      const top = isBottomDock ? rect.top - gap : rect.bottom + gap;

      setTodayDockPopoverStyle({
        position: 'fixed',
        left: `${left}px`,
        top: isBottomDock ? `${top}px` : `${top}px`,
        transform: isBottomDock ? 'translateY(-100%)' : 'none',
        width: `${preferredWidth}px`,
        maxHeight: '360px',
        zIndex: 30000,
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTodayDockPopoverOpen(false);
    };

    updateTodayDockPosition();
    window.addEventListener('resize', updateTodayDockPosition);
    window.addEventListener('scroll', updateTodayDockPosition, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updateTodayDockPosition);
      window.removeEventListener('scroll', updateTodayDockPosition, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [position, todayDockPopoverOpen]);

  useEffect(() => {
    if (!todayDockPopoverOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (todayDockButtonRef.current?.contains(target)) return;
      if (todayDockPopoverRef.current?.contains(target)) return;
      setTodayDockPopoverOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [todayDockPopoverOpen]);

  

  useEffect(() => {
    const syncToNextDay = () => {
      const currentDay = todayKey();
      if (todayBucketRef.current === currentDay) return;

      todayBucketRef.current = currentDay;
      setFocusItems([]);
      setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' });
      setIsLoadingDaily(true);

      void (async () => {
        try {
          const data = await api.getDailyAccountability();
          const row = data as {
            focus_items?: FocusItem[] | null;
            checkin_finished?: string | null;
            checkin_blocked?: string | null;
            checkin_first_task_tomorrow?: string | null;
          } | null;

          setFocusItems(Array.isArray(row?.focus_items) ? row!.focus_items : []);
          setCheckin({
            finished: row?.checkin_finished ?? '',
            blocked: row?.checkin_blocked ?? '',
            firstTaskTomorrow: row?.checkin_first_task_tomorrow ?? '',
          });
        } catch (error) {
          console.error('Failed to refresh daily accountability on day rollover:', error);
        } finally {
          setIsLoadingDaily(false);
        }
      })();
    };

    syncToNextDay();
    const timer = window.setInterval(syncToNextDay, 60_000);
    return () => window.clearInterval(timer);
  }, [api]);

  const saveDaily = async (next: {
    focusItems?: FocusItem[];
    checkin?: { finished: string; blocked: string; firstTaskTomorrow: string };
  }) => {
    if (!user) return false;

    const nextFocus = next.focusItems ?? focusItems;
    const nextCheckin = next.checkin ?? checkin;

    const data = await api.saveDailyAccountability({
      focus_items: nextFocus,
      finished: nextCheckin.finished.trim(),
      blocked: nextCheckin.blocked.trim(),
      first_task_tomorrow: nextCheckin.firstTaskTomorrow.trim(),
    });

    if (!data) {
      setSaveError('Could not save. Try again.');
      return false;
    }

    setSaveError(null);
    return true;
  };

  const toggleCompleteTodayItem = async (taskId: string) => {
    const activeSnapshot = todayItems.slice();
    const completedSnapshot = completedToday.slice();
    const activeItem = activeSnapshot.find((t) => t.id === taskId);
    const completedItem = completedSnapshot.find((t) => t.id === taskId);

    if (activeItem) {
      setTodayItems((s) => s.filter((t) => t.id !== taskId));
      setCompletedToday((s) => [
        {
          kind: activeItem.kind,
          id: activeItem.id,
          title: activeItem.title,
          status: 'completed',
          workspace_id: activeItem.workspace_id ?? null,
          workspace_name: activeItem.workspace_name ?? null,
          workspace_color: activeItem.workspace_color ?? null,
          project_id: activeItem.project_id ?? null,
          project_name: activeItem.project_name ?? null,
          note_id: activeItem.note_id ?? null,
          note_title: activeItem.note_title ?? null,
          remind_at: activeItem.remind_at ?? null,
          is_today_focus: activeItem.is_today_focus ?? false,
          show_in_today: activeItem.show_in_today ?? false,
          task_horizon: activeItem.task_horizon ?? null,
          completed_at: new Date().toISOString(),
        },
        ...s,
      ]);

      try {
        if (activeItem.kind === 'reminder') {
          await api.updateReminder(taskId, { status: 'completed' });
        } else if (activeItem.workspace_id) {
          await api.updateTaskInWorkspace(taskId, activeItem.workspace_id, { status: 'completed' });
        } else {
          await api.updateTask(taskId, { status: 'completed' });
        }
      } catch (error) {
        console.error('Failed to complete today item:', error);
        setTodayItems(activeSnapshot);
        setCompletedToday(completedSnapshot);
      }
      return;
    }

    if (!completedItem) return;

    setCompletedToday((s) => s.filter((t) => t.id !== taskId));
    setTodayItems((s) => [
      {
        kind: completedItem.kind,
        id: completedItem.id,
        title: completedItem.title,
        status: 'todo',
        workspace_id: completedItem.workspace_id ?? null,
        workspace_name: completedItem.workspace_name ?? null,
        workspace_color: completedItem.workspace_color ?? null,
        project_id: completedItem.project_id ?? null,
        project_name: completedItem.project_name ?? null,
        note_id: completedItem.note_id ?? null,
        note_title: completedItem.note_title ?? null,
        remind_at: completedItem.remind_at ?? null,
        is_today_focus: completedItem.is_today_focus ?? false,
        show_in_today: true,
        task_horizon: completedItem.task_horizon ?? 'today',
        created_at: completedItem.completed_at ?? new Date().toISOString(),
      },
      ...s,
    ]);

    try {
      if (completedItem.kind === 'reminder') {
        await api.updateReminder(taskId, {
          status: 'active',
          is_done: false,
          is_today_focus: completedItem.is_today_focus ?? false,
          show_in_today: true,
          task_horizon: completedItem.task_horizon ?? 'today',
        });
      } else if (completedItem.workspace_id) {
        await api.updateTaskInWorkspace(taskId, completedItem.workspace_id, {
          status: 'todo',
          is_today_focus: completedItem.is_today_focus ?? false,
          show_in_today: true,
          task_horizon: completedItem.task_horizon ?? 'today',
        });
      } else {
        await api.updateTask(taskId, {
          status: 'todo',
          is_today_focus: completedItem.is_today_focus ?? false,
          show_in_today: true,
          task_horizon: completedItem.task_horizon ?? 'today',
        });
      }
    } catch (error) {
      console.error('Failed to restore today item:', error);
      setTodayItems(activeSnapshot);
      setCompletedToday(completedSnapshot);
    }
  };

  const deleteTodayItem = async (taskId: string) => {
    const previous = todayItems;
    const target = previous.find((task) => task.id === taskId);
    if (!target) return;

    const clientId = (target as TodayTask & { client_id?: string | null }).client_id ?? null;
    setTodayItems((list) => list.filter((task) => task.id !== taskId));
    setContextMenu(null);
    window.ipcRenderer?.send('dashboard:today-task-deleted', {
      source: 'sidebar',
      optimistic: true,
      client_id: clientId,
      task: {
        ...target,
        id: target.id,
        title: target.title,
        workspace_id: target.workspace_id ?? null,
        workspace_name: target.workspace_name ?? null,
        workspace_color: target.workspace_color ?? null,
        is_today_focus: target.is_today_focus ?? false,
        show_in_today: target.show_in_today ?? false,
        due_date: target.due_date ?? null,
        due_time: target.due_time ?? null,
        created_at: target.created_at ?? null,
      },
    });

    try {
      if (target.kind === 'reminder') {
        await api.deleteReminder(taskId);
      } else if (target.workspace_id) {
        await api.deleteTaskInWorkspace(taskId, target.workspace_id);
      } else {
        await api.deleteTask(taskId);
      }
    } catch (error) {
      setTodayItems(previous);
      window.ipcRenderer?.send('dashboard:today-task-deleted', {
        source: 'sidebar',
        rollback: true,
        client_id: clientId,
        task: {
          ...target,
          id: target.id,
          title: target.title,
          workspace_id: target.workspace_id ?? null,
          workspace_name: target.workspace_name ?? null,
          workspace_color: target.workspace_color ?? null,
          is_today_focus: target.is_today_focus ?? false,
          show_in_today: target.show_in_today ?? false,
          due_date: target.due_date ?? null,
          due_time: target.due_time ?? null,
          created_at: target.created_at ?? null,
        },
      });
      setSaveError('Could not delete task.');
    }
  };

  const resetCompletedTodayItem = async (taskId: string) => {
    setContextMenu(null);
    await toggleCompleteTodayItem(taskId);
  };

  const saveCheckin = async () => {
    window.ipcRenderer?.send('daily:checkin-updated', {
      finished: checkin.finished,
      blocked: checkin.blocked,
      firstTaskTomorrow: checkin.firstTaskTomorrow,
    });
    await saveDaily({ checkin });
  };

  useEffect(() => {
    return () => {};
  }, []);

  useEffect(() => {
    if (!quickCaptureNotice) return;

    if (quickCaptureNoticeTimerRef.current !== null) {
      window.clearTimeout(quickCaptureNoticeTimerRef.current);
    }

    quickCaptureNoticeTimerRef.current = window.setTimeout(() => {
      setQuickCaptureNotice(null);
      quickCaptureNoticeTimerRef.current = null;
    }, 1800);

    return () => {
      if (quickCaptureNoticeTimerRef.current !== null) {
        window.clearTimeout(quickCaptureNoticeTimerRef.current);
        quickCaptureNoticeTimerRef.current = null;
      }
    };
  }, [quickCaptureNotice]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaceTasks = async () => {
      if (!user || !activeWorkspaceId) {
        setWorkspaceTasks([]);
        setIsLoadingWorkspaceTasks(false);
        return;
      }

      setIsLoadingWorkspaceTasks(true);
      try {
        const data = await api.getTasks();
        if (cancelled) return;
        const rows = Array.isArray(data) ? (data as Array<TodayTask & { task_horizon?: string | null }>) : [];
        setWorkspaceTasks(rows);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load workspace tasks:', error);
          setWorkspaceTasks([]);
        }
      } finally {
        if (!cancelled) setIsLoadingWorkspaceTasks(false);
      }
    };

    void loadWorkspaceTasks();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, sidebarRefreshToken, user]);

  const saveQuickNote = async (routeToIntake = false) => {
    const text = noteDraft.trim();
    if (!text || !user || !activeWorkspaceId) return;

    try {
      const firstLine =
        text
          .split('\n')
          .find((line) => line.trim())
          ?.trim() ?? 'Untitled note';
      const title = firstLine.replace(/^#\s*/, '').slice(0, 72);

      const routing = resolveIntakeRouting({
        source: 'sidebar',
        requestedType: 'note',
        explicitSendToIntake: routeToIntake,
      });

      if (routing === 'intake') {
        const data = await api.createIntakeItem({
          workspace_id: activeWorkspaceId,
          source: 'quick_capture',
          suggested_type: 'note',
          title,
          body: text,
          raw_content: text,
          reason: 'Quick note capture',
          source_object_type: 'note',
        });

        if (!data) {
          setSaveError('Could not send note to Intake.');
          return;
        }

        setNoteDraft('');
        setQuickCaptureMode('none');
        setQuickCaptureNotice('Sent to Intake');
        window.ipcRenderer?.send('inbox:items-updated');
        return;
      }

      const data = await api.createNote(title, text, { source: 'sidebar_quick_capture' });

      if (!data) {
        setSaveError('Could not save note.');
        return;
      }

      const row = data as SidebarNote;
      setSavedNotes((prev) => [
        {
          id: row.id,
          title: row.title,
          content: row.content ?? text,
          content_html: row.content_html ?? null,
          created_at: row.created_at ?? new Date().toISOString(),
          updated_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
          source: row.source ?? 'sidebar_quick_capture',
        },
        ...prev.filter((item) => item.id !== row.id),
      ]);
      setNoteDraft('');
      setQuickCaptureMode('none');
      setSavedNotesExpanded(true);
      setQuickCaptureNotice('Saved note');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save note.');
    }
  };

  const visibleSavedNotes = savedNotes.slice(0, 6);

  const saveTodayQuickTask = async () => {
    const base = todayQuickDraft.trim();
    if (!base || todayQuickSaving) return;

    setTodayQuickSaving(true);
    setTodayQuickDraft('');
    const tempId = `today-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dueDate = todayKey();
    const optimisticTask: TodayTask = {
      id: tempId,
      kind: 'task',
      title: base,
      status: 'todo',
      due_date: dueDate,
      show_in_today: true,
      is_today_focus: false,
      task_horizon: 'today',
      created_at: new Date().toISOString(),
      ...getWorkspaceTaskMetadata(),
    };
    setTodayItems((prev) => [optimisticTask, ...prev]);
    window.ipcRenderer?.send('dashboard:today-task-created', {
      source: 'sidebar',
        optimistic: true,
        client_id: tempId,
        task: {
          ...optimisticTask,
          id: tempId,
          kind: 'task' as const,
          is_today_focus: false,
          task_horizon: 'today',
          ...getWorkspaceTaskMetadata(),
        },
      });
    try {
      const created = await api.createTask({
        title: base,
        status: 'todo',
        due_date: dueDate,
        show_in_today: true,
        is_today_focus: false,
        task_horizon: 'today',
      });

      if (created && typeof created === 'object') {
        const createdTask = created as Partial<TodayTask> & { id?: string };
        const createdId = createdTask.id ?? tempId;
        setTodayItems((prev) => [
          {
            ...optimisticTask,
            ...createdTask,
            id: createdId,
            kind: 'task' as const,
            ...getWorkspaceTaskMetadata(),
          },
          ...prev.filter((item) => item.id !== tempId && item.id !== createdId),
        ]);
        window.ipcRenderer?.send('dashboard:today-task-created', {
          source: 'sidebar',
          optimistic: false,
          client_id: tempId,
          task: {
            ...optimisticTask,
            ...createdTask,
            id: createdId,
            kind: 'task' as const,
            is_today_focus: false,
            task_horizon: 'today',
            ...getWorkspaceTaskMetadata(),
          },
        });
      }
      setTodayAddRowOpen(false);
    } catch (error) {
      setTodayItems((prev) => prev.filter((item) => item.id !== tempId));
      setTodayQuickDraft(base);
      window.ipcRenderer?.send('dashboard:today-task-created', {
        source: 'sidebar',
        rollback: true,
        client_id: tempId,
        task: {
          id: tempId,
          title: base,
          kind: 'task' as const,
          is_today_focus: false,
          ...getWorkspaceTaskMetadata(),
        },
      });
      setSaveError(error instanceof Error ? error.message : 'Could not save task.');
    } finally {
      setTodayQuickSaving(false);
    }
  };

  const saveWorkspaceTask = async () => {
    const title = taskDraft.trim();
    if (!title || isSavingWorkspaceTask || !user || !activeWorkspaceId) return;

    setIsSavingWorkspaceTask(true);
    try {
      const payload = {
        title,
        status: 'todo',
        priority: 'medium',
        task_horizon: taskScope,
        show_in_today: taskScope === 'today',
        is_today_focus: false,
        ...(taskScope === 'today' ? { due_date: todayKey() } : {}),
      };

      await api.createTask(payload);
      setTaskDraft('');
      setTaskScope('long_term');
      setTasksCollapsed(true);
      setQuickCaptureNotice(
        taskScope === 'today'
          ? `Saved task to Today`
          : `Saved task to ${activeWorkspace?.name?.trim() || 'workspace'}`
      );
      handleSidebarWorkspaceRefresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save task.');
    } finally {
      setIsSavingWorkspaceTask(false);
    }
  };

  const sortedTodayItems = useMemo(() => sortTodayTasks(todayItems), [todayItems]);
  const sortedCompletedToday = useMemo(() => sortTodayTasks(completedToday), [completedToday]);
  const visibleTodayItems = sortedTodayItems.slice(0, 3);
  const visibleCompletedToday = sortedCompletedToday.slice(0, 4);
  const longTermWorkspaceTasks = useMemo(
    () =>
      workspaceTasks.filter((task) => {
        if (String(task.status ?? '') === 'completed') return false;
        if (String(task.task_horizon ?? '') === 'today') return false;
        if (task.show_in_today || task.is_today_focus) return false;
        return true;
      }),
    [workspaceTasks]
  );
  const visibleWorkspaceTasks = longTermWorkspaceTasks.slice(0, 3);
  const workspaceAssignedTasks = longTermWorkspaceTasks.filter(
    (task) => task.assigned_to && task.assigned_to === user?.id
  );
  const workspaceUpcomingTasks = longTermWorkspaceTasks.filter((task) => {
    if (!task.due_date) return false;
    const dueAt = new Date(task.due_date);
    if (Number.isNaN(dueAt.getTime())) return false;
    const now = new Date();
    const inSevenDays = new Date(now);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    return dueAt.getTime() >= now.getTime() && dueAt.getTime() <= inSevenDays.getTime();
  });
  const todayTotalCount = todayItems.length + completedToday.length;
  const workspaceTaskCount = longTermWorkspaceTasks.length;
  const hasCheckinContent = Boolean(
    checkin.finished.trim() || checkin.blocked.trim() || checkin.firstTaskTomorrow.trim()
  );
  const checkinStatusLabel = hasCheckinContent ? 'Done' : 'Not started';
  const checkinFieldClass =
    'h-8 w-full rounded-lg bg-transparent px-2 text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] transition hover:bg-[var(--ledger-surface-muted)] focus:bg-[var(--ledger-surface-muted)] focus:outline-none shadow-none border-0 ring-0';
  const eventComposerFieldClass =
    'h-8 rounded-lg bg-transparent px-2 text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] transition hover:bg-[var(--ledger-surface-muted)] focus:bg-[var(--ledger-surface-muted)] focus:outline-none shadow-none border-0 ring-0';

  const persistCollapsedState = (key: string, value: boolean) => {
    try {
      window.localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // No-op when storage is unavailable.
    }
  };

  const closeWorkspaceSections = (next?: 'tasks' | 'today' | 'note' | 'event' | 'events' | 'checkin' | 'projects') => {
    setTasksCollapsed(next !== 'tasks');
    setTodayCollapsed(next !== 'today');
    setProjectsCollapsed(next !== 'projects');
    setIsCheckinExpanded(next === 'checkin');
    setQuickCaptureMode(next === 'note' ? 'note' : next === 'event' ? 'event' : 'none');
    setEventsExpanded(next === 'events');
    setTodayAddRowOpen(false);
    setCompletedTodayExpanded(false);
    setSavedNotesExpanded(false);

    persistCollapsedState(TODAY_COLLAPSE_STORAGE_KEY, next !== 'today');
    persistCollapsedState(PROJECTS_COLLAPSE_STORAGE_KEY, next !== 'projects');
    persistCollapsedState(CHECKIN_COLLAPSE_STORAGE_KEY, next !== 'checkin');
    persistCollapsedState(EVENTS_COLLAPSE_STORAGE_KEY, next !== 'events');
  };

  const toggleTodayCollapsed = () => {
    setTodayCollapsed((current) => {
      const next = !current;
      persistCollapsedState(TODAY_COLLAPSE_STORAGE_KEY, next);
      if (next) {
        setTodayAddRowOpen(false);
        setCompletedTodayExpanded(false);
      } else {
        closeWorkspaceSections('today');
      }
      return next;
    });
  };

  useEffect(() => {
    if (!todayAddRowOpen) return;
    todayAddInputRef.current?.focus();
  }, [todayAddRowOpen]);

  useEffect(() => {
    if (!isCheckinExpanded) return;
    const timer = window.setTimeout(() => {
      const firstCheckinInput = document.querySelector<HTMLInputElement>('[data-checkin-input="finished"]');
      firstCheckinInput?.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [isCheckinExpanded]);

  const saveQuickEvent = async () => {
    const title = eventDraft.trim();
    if (!title || !user || !activeWorkspaceId) return;

    setSaveError(null);

    try {
      const hasTiming = Boolean(eventDate.trim() && eventStartTime.trim());
      const routing = resolveIntakeRouting({
        source: 'sidebar',
        requestedType: 'event',
        requiredFieldsValid: hasTiming,
      });

      if (routing === 'validate') {
        setSaveError('Date and start time are required to create an event.');
        return;
      }

      const settings = (await api.getUserSettings()) as {
        preferences?: {
          defaultEventStatus?: 'planned' | 'tentative' | 'confirmed';
          defaultEventCalendar?: 'personal' | 'work' | 'projects';
        } | null;
      };
      const defaultEventStatus =
        settings.preferences?.defaultEventStatus === 'tentative'
          ? 'tentative'
          : settings.preferences?.defaultEventStatus === 'confirmed'
            ? 'confirmed'
            : 'planned';
      const defaultEventCalendar = settings.preferences?.defaultEventCalendar ?? 'personal';

      let calendars = await api.getCalendars({ scope: calendarScope });
      const personalCalendar =
        Array.isArray(calendars)
          ? calendars.find((calendar) => calendar.is_visible !== false && calendar.is_personal) ??
            calendars.find((calendar) => calendar.is_visible !== false && calendar.is_default) ??
            calendars[0] ??
            null
          : null;
      const workspaceCalendar =
        Array.isArray(calendars)
          ? calendars.find(
              (calendar) => calendar.is_visible !== false && !calendar.is_personal && calendar.is_default
            ) ??
            calendars.find((calendar) => calendar.is_visible !== false && !calendar.is_personal) ??
            personalCalendar
          : null;
      const projectCalendar =
        Array.isArray(calendars)
          ? calendars.find(
              (calendar) =>
                calendar.is_visible !== false &&
                /project/i.test(String(calendar.name ?? '').trim())
            ) ??
            workspaceCalendar ??
            personalCalendar
          : null;
      let selectedCalendar =
        defaultEventCalendar === 'work'
          ? workspaceCalendar
          : defaultEventCalendar === 'projects'
            ? projectCalendar
            : personalCalendar;

      if (!selectedCalendar) {
        const createdCalendar = await api.createCalendar('Personal', 'var(--ledger-accent)', true);
        if (createdCalendar && typeof createdCalendar === 'object') {
          const created = createdCalendar as { id: string; color?: string };
          selectedCalendar = {
            id: created.id,
            color: created.color ?? 'var(--ledger-accent)',
          };
        } else {
          calendars = await api.getCalendars({ scope: calendarScope });
          selectedCalendar = Array.isArray(calendars) ? calendars[0] ?? null : null;
        }
      }

      if (!selectedCalendar) {
        throw new Error('Could not create a calendar for this workspace.');
      }

      const startDateTime = new Date(`${eventDate}T${eventStartTime}:00`);
      let endDateTime = eventEndTime.trim()
        ? new Date(`${eventDate}T${eventEndTime}:00`)
        : new Date(startDateTime.getTime() + 60 * 60 * 1000);
      if (Number.isNaN(startDateTime.getTime())) {
        throw new Error('Could not create a valid event date.');
      }
      if (Number.isNaN(endDateTime.getTime()) || endDateTime <= startDateTime) {
        endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
      }

      const data = await api.createEvent({
        title,
        start_at: startDateTime.toISOString(),
        end_at: endDateTime.toISOString(),
        calendar_id: selectedCalendar.id,
        color: selectedCalendar.color,
        notes: '',
        all_day: false,
        status: defaultEventStatus,
      });

      if (!data) {
        throw new Error('Could not save event.');
      }

      const createdEvent = data as { id: string; title: string; start_at: string };
      const start = new Date(createdEvent.start_at);
      const startAt = start.getTime();
      const isValidDate = Number.isFinite(startAt);
      const eventDateISO = isValidDate ? formatDateKey(start) : '';
      const todayISO = formatDateKey(new Date());
      const tomorrowISO = formatDateKey(addDays(new Date(), 1));
      const dueDate =
        eventDateISO === todayISO
          ? 'Today'
          : eventDateISO === tomorrowISO
          ? 'Tomorrow'
          : isValidDate
          ? start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
          : 'No date';

      const newItem = {
        id: createdEvent.id,
        title: createdEvent.title,
        type: 'event' as const,
        dueDate,
        rawDate: eventDateISO,
        time: isValidDate
          ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : undefined,
        sortAt: isValidDate ? startAt : Number.MAX_SAFE_INTEGER,
        start_at: createdEvent.start_at,
        end_at: null,
        notes: '',
        project_id: null,
        project_name: null,
        note_id: null,
        note_title: null,
        calendar_id: selectedCalendar.id,
        calendar_name: (selectedCalendar as { name?: string | null }).name ?? null,
        workspace_name: activeWorkspace?.name?.trim() || null,
        workspace_color: activeWorkspace?.color ?? null,
      };
      setUpcomingItems((prev) =>
        [...prev.filter((item) => item.id !== newItem.id), newItem]
          .sort((a, b) => a.sortAt - b.sortAt)
          .slice(0, 12)
      );

      setEventDraft('');
      setEventDate(todayKey());
      setEventStartTime('09:00');
      setEventEndTime('10:00');
      setQuickCaptureMode('none');
      setEventsExpanded(true);
      setQuickCaptureNotice('Created event');
    } catch (error) {
      console.error('Failed to create event from sidebar:', error);
      setSaveError(error instanceof Error ? error.message : 'Could not save event.');
    }
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name || !user || !activeWorkspaceId) {
      setSaveError('Missing name, user, or workspace');
      return;
    }

    setIsCreatingProject(true);
    try {
      const routing = resolveIntakeRouting({
        source: 'sidebar',
        requestedType: 'project',
        requiredFieldsValid: Boolean(name),
      });

      if (routing === 'validate') {
        setSaveError('Project name is required.');
        return;
      }

      const created = await api.createProject({
        name,
        status: 'NotStarted',
      });

      if (!created) {
        setSaveError('Could not create project.');
        return;
      }

      const createdProject = created as (typeof projects)[number];
      setProjects((prev) => [createdProject, ...prev.filter((item) => item.id !== createdProject.id)]);
      setNewProjectName('');
      setIsCreatingProject(false);
      setQuickCaptureNotice('Created project');
      handleSidebarWorkspaceRefresh();
    } catch (error) {
      console.error('Project creation error:', error);
      setSaveError(error instanceof Error ? error.message : 'Could not create project.');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setContextMenu(null);
    } catch (error) {
      setSaveError('Could not delete project.');
    }
  };

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) setContextMenu(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  const activeProjectCount = projects.filter(
    (project) => normalizeProjectStatus(String(project.status)) !== 'completed'
  ).length;
  const horizontalTodaySummary =
    todayTotalCount > 0 ? `${completedToday.length}/${todayTotalCount} complete` : 'Nothing yet';
  const openSettingsSection = (focusContext: 'workspace' | 'integrations' | 'shortcuts') => {
    void window.desktopWindow?.openModule('settings', {
      kind: 'settings',
      focusContext,
    });
  };
  const trySectionItems = [
    {
      title: 'Connect calendar',
      icon: CalendarDays,
      action: () => openSettingsSection('integrations'),
    },
    {
      title: 'Try project roadmap',
      icon: FolderKanban,
      action: () => window.desktopWindow?.toggleModule('projects'),
    },
    {
      title: 'Invite a member',
      icon: UserPlus,
      action: () => openSettingsSection('workspace'),
    },
    {
      title: 'Add a milestone',
      icon: Milestone,
      action: () => window.desktopWindow?.toggleModule('projects'),
    },
    {
      title: 'Review unfinished',
      icon: CheckSquare2,
      action: () => window.desktopWindow?.toggleModule('dashboard'),
    },
    {
      title: 'Install browser extension',
      icon: Plug2,
      action: () => openSettingsSection('integrations'),
    },
    {
      title: 'Create a meeting note',
      icon: FileText,
      action: () => window.desktopWindow?.toggleModule('quick-note' as any),
    },
    {
      title: 'Link a note to a project',
      icon: Link2,
      action: () => window.desktopWindow?.toggleModule('projects'),
    },
    {
      title: 'Try long-term tasks',
      icon: Check,
      action: () => window.desktopWindow?.toggleModule('quick-task' as any),
    },
    {
      title: 'Set up shortcuts',
      icon: Keyboard,
      action: () => openSettingsSection('shortcuts'),
    },
  ];
  const trySectionRotationSeed = Number(todayKey().replace(/-/g, ''));
  const trySectionRotationStart =
    trySectionItems.length > 0 ? trySectionRotationSeed % trySectionItems.length : 0;
  const trySectionVisibleItems =
    trySectionItems.length <= 4
      ? trySectionItems
      : [
          ...trySectionItems.slice(trySectionRotationStart),
          ...trySectionItems.slice(0, trySectionRotationStart),
        ].slice(0, 4);

  if (isHorizontal) {
    const isTopDock = position === 'top';
    const CollapseChevron = isTopDock ? ChevronUp : ChevronDown;

    return (
      <div className="flex h-full w-full flex-col items-center gap-1.25 p-1.25">
        <div className={`flex h-15 w-full items-center gap-2 px-2.5 backdrop-blur-sm ${sidebarTheme.surface}`}>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onCollapseRequest?.();
                collapseToRail();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:bg-[var(--ledger-surface-muted)]"
              title="Collapse sidebar"
            >
              <img src="./logo-color.svg" alt="Ledger" className="h-7 w-7 opacity-100" />
            </button>
            <WorkspaceSwitcher compact />
          </div>

          <button
            type="button"
            onClick={openSearch}
            className="flex h-8 w-[320px] min-w-65 max-w-85 items-center justify-between gap-2 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 text-left shadow-sm transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-muted)]"
          >
            <span className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
              <Search size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
              <span className="truncate">Search...</span>
            </span>
            <span className="shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ledger-text-muted)]">
              ⌘K
            </span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            {[
              { label: 'Notifications', icon: Bell, action: () => window.desktopWindow?.openModule('notifications') },
              { label: 'Overview', icon: BarChart3, action: () => window.desktopWindow?.toggleModule('dashboard') },
              { label: 'Circle', icon: CircleUserRound, action: () => window.desktopWindow?.toggleModule('circle') },
              { label: 'Projects', icon: Folder, action: () => window.desktopWindow?.toggleModule('projects') },
              { label: 'Notes', icon: StickyNote, action: () => window.desktopWindow?.toggleModule('notes') },
              { label: 'Calendar', icon: CalendarDays, action: () => window.desktopWindow?.openModule('calendar') },
              { label: 'Teams', icon: Users, action: () => window.desktopWindow?.toggleModule('teams') },
            ].map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-[var(--ledger-text-secondary)] transition hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                title={item.label}
                aria-label={item.label}
              >
                <item.icon size={14} />
                {item.label === 'Notifications' && notificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => {
                onCollapseRequest?.();
                collapseToRail();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]"
              title="Collapse"
              aria-label="Collapse sidebar"
            >
              <CollapseChevron size={16} />
            </button>
            <button
              onClick={signOut}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-selected)] text-[var(--ledger-text-secondary)] transition-colors duration-150 hover:bg-[color:rgba(255,95,64,0.08)] hover:text-[var(--ledger-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        <div className={`flex w-full flex-1 min-h-0 items-center gap-2 px-3 ${sidebarTheme.surface}`}>
          <button
            ref={todayDockButtonRef}
            type="button"
            onClick={() => {
              setTodayDockPopoverOpen((current) => !current);
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-[var(--ledger-surface-muted)]"
          >
            <span className="text-xs font-medium text-[var(--ledger-text-muted)]">
              Today
            </span>
            <span className="font-semibold text-[var(--ledger-text-primary)]">{horizontalTodaySummary}</span>
          </button>

          <span className="text-[var(--ledger-text-muted)]/40">•</span>

          <button
            type="button"
            onClick={() => window.desktopWindow?.openCheckin()}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-[var(--ledger-surface-muted)]"
          >
            <span className="text-xs font-medium text-[var(--ledger-text-muted)]">
              Check-in
            </span>
            <span className="font-medium text-[var(--ledger-text-primary)]">
              {checkin.finished.trim()
                ? 'Saved'
                : checkin.blocked.trim()
                ? 'Blocked'
                : 'Not started'}
            </span>
          </button>

          <span className="text-[var(--ledger-text-muted)]/40">•</span>

          <button
            type="button"
            onClick={() => window.desktopWindow?.openModule('calendar')}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-[var(--ledger-surface-muted)]"
          >
            <span className="text-xs font-medium text-[var(--ledger-text-muted)]">
              Upcoming
            </span>
            <span className="font-medium text-[var(--ledger-text-primary)]">{upcomingItems.length}</span>
          </button>

          <span className="text-[var(--ledger-text-muted)]/40">•</span>

          <button
            type="button"
            onClick={() => window.desktopWindow?.toggleModule('projects')}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-[var(--ledger-surface-muted)]"
          >
            <span className="text-xs font-medium text-[var(--ledger-text-muted)]">
              Projects
            </span>
            <span className="font-medium text-[var(--ledger-text-primary)]">{activeProjectCount} active</span>
          </button>

          <div className="ml-auto">
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('dashboard')}
              className="inline-flex items-center rounded-full border border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)] px-3.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]"
            >
              Open Overview
            </button>
          </div>
        </div>

        {todayDockPopoverOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={todayDockPopoverRef}
                style={todayDockPopoverStyle ?? undefined}
                onMouseDown={(e) => e.stopPropagation()}
                className={`${sidebarTheme.popover} p-3`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                      Today
                    </p>
                    <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">{horizontalTodaySummary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTodayDockPopoverOpen(false)}
                    className="rounded-lg px-2 py-1 text-xs text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)]"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-3 max-h-70 space-y-1.5 overflow-auto pr-1">
                  {todayItems.length > 0 ? (
                    todayItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void toggleCompleteTodayItem(item.id)}
                        className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ledger-text-muted)]">
                          {item.kind === 'reminder' ? <Bell size={13} className="shrink-0" /> : <Zap size={13} className="shrink-0" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-[var(--ledger-text-primary)]">{item.title}</span>
                          <span className="block truncate text-[11px] text-[var(--ledger-text-muted)]">
                            {formatTodayTaskWorkspace(item) || item.workspace_name || 'Workspace'}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-sm text-[var(--ledger-text-muted)]">Nothing needs your attention yet.</p>
                  )}

                  {completedToday.length > 0 && (
                    <div className="pt-2">
                      <p className="px-2 text-xs font-medium text-[var(--ledger-text-muted)]">
                        Completed today
                      </p>
                      {sortTodayTasks(completedToday).slice(0, 4).map((item) => (
                        <div
                          key={item.id}
                          className="mt-1 flex items-start gap-2 rounded-xl px-2 py-2 text-left"
                        >
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--ledger-success)]" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-[var(--ledger-text-secondary)] line-through">
                              {item.title}
                            </span>
                            <span className="block truncate text-[11px] text-[var(--ledger-text-muted)]">
                              {formatTodayTaskWorkspace(item) || item.workspace_name || 'Workspace'}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>,
              document.body
            )
          : null}

        

      </div>

    );
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full bg-transparent ${
        isHorizontal ? 'flex-col border-b border-[color:var(--ledger-border-subtle)] py-5' : 'flex-col py-5'
      }`}
    >
      <div
        className="relative z-10 px-3.5 pt-1 pb-1.5 bg-transparent"
        onMouseDown={(e) => {
          if (!onDragHandleMouseDown) return;
          if (
            (e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')
          )
            return;
          onDragHandleMouseDown(e);
        }}
        style={{ cursor: onDragHandleMouseDown ? 'grab' : 'auto' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 bg-transparent text-left">
            <img src="./logo-color.svg" alt="Ledger" className="h-7 w-7 shrink-0" />
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              onCollapseRequest?.();
              collapseToRail();
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="mt-0 flex items-center justify-between gap-2">
          <div className="min-w-0 -ml-1.5">
            <WorkspaceSwitcher compact />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => window.desktopWindow?.openModule('notifications')}
              onMouseDown={(e) => e.stopPropagation()}
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              title="Notifications"
              aria-label="Open notifications center"
            >
              <Bell size={14} />
              {notificationCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-[color:var(--ledger-surface)] bg-[var(--ledger-accent)] px-1 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm">
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              )}
            </button>
            <button
              onClick={openSearch}
              onMouseDown={(e) => e.stopPropagation()}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              title="Search"
              aria-label="Open search"
            >
              <Search size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto px-3.5 py-3 gap-3">
        <section className="order-1 space-y-2">
          <p className={sidebarTheme.sectionLabel}>Navigation</p>
          <div className="space-y-1">
            {[
              { label: 'Overview', icon: BarChart3, action: () => window.desktopWindow?.toggleModule('dashboard') },
              { label: 'Projects', icon: Folder, action: () => window.desktopWindow?.toggleModule('projects') },
              { label: 'Notes', icon: StickyNote, action: () => window.desktopWindow?.toggleModule('notes') },
              { label: 'Calendar', icon: CalendarDays, action: () => window.desktopWindow?.openModule('calendar') },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              >
                <item.icon size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section ref={workspaceCaptureRef} className="order-2 space-y-3">
          <p className={sidebarTheme.sectionLabel}>Workspace</p>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                if (tasksCollapsed) {
                  closeWorkspaceSections('tasks');
                } else {
                  setTasksCollapsed(true);
                }
              }}
              className={`relative z-20 flex h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition ${
                tasksCollapsed
                  ? 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
                  : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Check size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="truncate">Tasks</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
                <span>{workspaceTaskCount}</span>
                {tasksCollapsed ? (
                  <ChevronDown size={14} className="text-[var(--ledger-text-muted)]" />
                ) : (
                  <ChevronUp size={14} className="text-[var(--ledger-text-muted)]" />
                )}
              </span>
            </button>
            {!tasksCollapsed && (
              <div className="relative z-10 mt-1.5 space-y-2 pl-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ledger-text-muted)]">
                  <span>Assigned to me · {workspaceAssignedTasks.length}</span>
                  <span>Long-term · {workspaceTaskCount}</span>
                  <span>Upcoming · {workspaceUpcomingTasks.length}</span>
                </div>
                <div className="space-y-0.5">
                  {isLoadingWorkspaceTasks && visibleWorkspaceTasks.length === 0 ? (
                    <SkeletonList />
                  ) : visibleWorkspaceTasks.length > 0 ? (
                    <>
                      {visibleWorkspaceTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() =>
                            void window.desktopWindow?.toggleModule('dashboard', {
                              focusTaskId: task.id,
                            })
                          }
                          className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                        >
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ledger-text-muted)]">
                            <MapIcon size={13} className="shrink-0" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] leading-4 text-[var(--ledger-text-primary)]">
                              {task.title}
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] text-[var(--ledger-text-muted)]">
                              <span className="truncate">
                                {task.due_date ? `Due ${formatTaskDueDateLabel(task.due_date)}` : 'Long-term'}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                      {workspaceTaskCount > visibleWorkspaceTasks.length && (
                        <button
                          type="button"
                          onClick={() => void window.desktopWindow?.toggleModule('dashboard')}
                          className="w-full rounded-lg px-2 py-1 text-left text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                        >
                          View all tasks
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="px-2 py-1 text-[11px] text-[var(--ledger-text-muted)]">
                      Nothing long-term yet.
                    </p>
                  )}
                </div>

                <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--ledger-surface-muted)]">
                  <input
                    ref={taskCaptureRef}
                    value={taskDraft}
                    onChange={(e) => setTaskDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === '+') {
                        e.preventDefault();
                        void saveWorkspaceTask();
                      }
                      if (e.key === 'Escape' && !taskDraft.trim()) {
                        e.preventDefault();
                        setTaskDraft('');
                        setTaskScope('long_term');
                        setTasksCollapsed(true);
                      }
                    }}
                    onBlur={(e) => {
                      const nextFocus = e.relatedTarget;
                      if (!taskDraft.trim() && !workspaceCaptureRef.current?.contains(nextFocus)) {
                        setTaskDraft('');
                        setTaskScope('long_term');
                        setTasksCollapsed(true);
                      }
                    }}
                    placeholder="Add a task..."
                    className="min-w-0 flex-1 bg-transparent px-0 py-0.5 text-[12px] leading-4 text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                    disabled={isSavingWorkspaceTask}
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void saveWorkspaceTask()}
                    disabled={isSavingWorkspaceTask || !taskDraft.trim()}
                    className="inline-flex h-6 items-center justify-center rounded-full px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                    aria-label="Add task"
                  >
                    +
                  </button>
                </div>

                <div className="flex items-center justify-start gap-1.5 pl-1">
                  <button
                    type="button"
                    onClick={() => setTaskScope('today')}
                    className={`h-7 rounded-full px-2.5 text-[11px] font-medium transition ${
                      taskScope === 'today'
                        ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskScope('long_term')}
                    className={`h-7 rounded-full px-2.5 text-[11px] font-medium transition ${
                      taskScope === 'long_term'
                        ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
                    }`}
                  >
                    Long-term
                  </button>
                </div>
              </div>
            )}

            <section className="space-y-1">
              <button
                type="button"
                onClick={toggleTodayCollapsed}
                className={`flex h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition ${
                  todayCollapsed
                    ? 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
                    : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ClipboardCheck size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                  <span className="truncate">Today</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
                  <span>{todayTotalCount > 0 ? `${completedToday.length}/${todayTotalCount}` : '0/0'}</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${todayCollapsed ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>

              {!todayCollapsed && (
                <div className="space-y-0.5 pl-1">
                  {isLoadingToday && todayItems.length === 0 && completedToday.length === 0 ? (
                    <SkeletonList />
                  ) : (
                    <>
                      {visibleTodayItems.length > 0 ? (
                        <div className="space-y-0.5">
                          {visibleTodayItems.map((item) => (
                            <div
                              key={item.id}
                              role="button"
                              tabIndex={0}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({
                                  type: 'today-active',
                                  id: item.id,
                                  kind: item.kind,
                                  x: e.clientX,
                                  y: e.clientY,
                                });
                              }}
                              onClick={() =>
                                void window.desktopWindow?.toggleModule('dashboard', {
                                  focusTaskId: item.id,
                                })
                              }
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                void window.desktopWindow?.toggleModule('dashboard', {
                                  focusTaskId: item.id,
                                });
                              }}
                              className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                            >
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleCompleteTodayItem(item.id);
                                }}
                                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                                title="Mark complete"
                              >
                                {item.kind === 'reminder' ? (
                                  <Bell size={13} className="shrink-0" />
                                ) : (
                                  <Zap size={13} className="shrink-0" />
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] leading-4 text-[var(--ledger-text-primary)]">
                                  {item.title}
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] text-[var(--ledger-text-muted)]">
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: item.workspace_color || 'var(--ledger-border-subtle)',
                                    }}
                                  />
                                  <span className="truncate">
                                    {item.project_name || item.workspace_name || 'Workspace'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                          {todayItems.length > visibleTodayItems.length && (
                            <button
                              type="button"
                              onClick={() => void window.desktopWindow?.toggleModule('dashboard')}
                              className="w-full rounded-lg px-2 py-1 text-left text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                            >
                              View all today
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="px-2 py-1 text-[11px] text-[var(--ledger-text-muted)]">
                          Nothing for today.
                        </p>
                      )}

                      {todayAddRowOpen ? (
                        <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--ledger-surface-muted)]">
                          <input
                            ref={todayAddInputRef}
                            value={todayQuickDraft}
                            onChange={(e) => setTodayQuickDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === '+') {
                                e.preventDefault();
                                void saveTodayQuickTask();
                              }
                              if (e.key === 'Escape' && !todayQuickDraft.trim()) {
                                e.preventDefault();
                                setTodayQuickDraft('');
                                setTodayAddRowOpen(false);
                              }
                            }}
                            onBlur={() => {
                              if (!todayQuickDraft.trim()) {
                                setTodayQuickDraft('');
                                setTodayAddRowOpen(false);
                              }
                            }}
                            placeholder="Add task for today..."
                            className="min-w-0 flex-1 bg-transparent px-0 py-0.5 text-[12px] leading-4 text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                            disabled={todayQuickSaving || isLoadingToday}
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void saveTodayQuickTask()}
                            className="inline-flex h-6 items-center justify-center rounded-full px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                            disabled={todayQuickSaving || isLoadingToday || !todayQuickDraft.trim()}
                            aria-label="Add task"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTodayAddRowOpen(true)}
                          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                        >
                          <Plus size={13} className="shrink-0" />
                          <span className="truncate">Add task</span>
                        </button>
                      )}

                      {completedToday.length > 0 && (
                        <div className="space-y-0.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setCompletedTodayExpanded((prev) => !prev)}
                            className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[12px] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                          >
                            <span>Completed · {completedToday.length}</span>
                            <ChevronDown
                              size={14}
                              className={`shrink-0 transition-transform ${
                                completedTodayExpanded ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          {completedTodayExpanded && (
                            <div className="space-y-0.5">
                              {visibleCompletedToday.map((item) => (
                                <div
                                  key={item.id}
                                  role="button"
                                  tabIndex={0}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({
                                      type: 'today-completed',
                                      id: item.id,
                                      kind: item.kind,
                                      x: e.clientX,
                                      y: e.clientY,
                                    });
                                  }}
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('dashboard', {
                                      focusTaskId: item.id,
                                    })
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    void window.desktopWindow?.toggleModule('dashboard', {
                                      focusTaskId: item.id,
                                    });
                                  }}
                                  className="group flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                                >
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void toggleCompleteTodayItem(item.id);
                                    }}
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[var(--ledger-success)] transition hover:text-[var(--ledger-success)]"
                                    title="Mark incomplete"
                                  >
                                    <Check size={12} />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] leading-4 text-[var(--ledger-text-secondary)] line-through decoration-[color:var(--ledger-border-strong)]">
                                      {item.title}
                                    </div>
                                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] text-[var(--ledger-text-muted)]">
                                      <span
                                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                                        style={{
                                          backgroundColor: item.workspace_color || 'var(--ledger-border-subtle)',
                                        }}
                                      />
                                      <span className="truncate">
                                        {item.project_name || item.workspace_name || 'Workspace'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {completedToday.length > visibleCompletedToday.length && (
                                <button
                                  type="button"
                                  onClick={() => void window.desktopWindow?.toggleModule('dashboard')}
                                  className="w-full rounded-xl px-2 py-1 text-left text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                                >
                                  View all completed
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>

            <button
              type="button"
              onClick={() => {
                if (quickCaptureMode === 'note') {
                  setQuickCaptureMode('none');
                } else {
                  closeWorkspaceSections('note');
                }
              }}
              className={`flex h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition ${
                quickCaptureMode === 'note'
                  ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                  : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <StickyNote size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="truncate">Note</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
                <span>+</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${quickCaptureMode === 'note' ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
            {quickCaptureMode === 'note' && (
              <div className="pl-1">
                <div className="space-y-2 rounded-lg px-2 py-2.5 transition hover:bg-[var(--ledger-surface-muted)]">
                  <textarea
                    ref={noteCaptureRef}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                        if (noteDraft.trim() && !noteDraft.includes('\n')) {
                          e.preventDefault();
                          void saveQuickNote(false);
                        }
                        return;
                      }
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void saveQuickNote(false);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        if (!noteDraft.trim()) setQuickCaptureMode('none');
                      }
                    }}
                    placeholder="Write a quick note..."
                    rows={2}
                    className="min-h-[52px] w-full resize-none bg-transparent px-0 py-0.5 text-[12px] leading-5 text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void saveQuickNote(false)}
                      disabled={!noteDraft.trim()}
                      className="inline-flex h-7 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                    >
                      Save note
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void saveQuickNote(true)}
                      disabled={!noteDraft.trim()}
                      className="inline-flex h-7 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-3 text-[11px] font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
                    >
                      Send to Intake
                    </button>
                  </div>
                </div>

                {quickCaptureNotice && (
                  <p className="px-1 pt-1 text-[11px] text-[var(--ledger-text-muted)]">
                    {quickCaptureNotice}
                  </p>
                )}

                {savedNotes.length > 0 && (
                  <div className="space-y-0.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setSavedNotesExpanded((prev) => !prev)}
                      className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[12px] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                    >
                      <span>Notes · {savedNotes.length}</span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 transition-transform ${
                          savedNotesExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                {savedNotesExpanded && (
                  <div className="max-h-44 space-y-0.5 overflow-auto pr-0.5">
                    {visibleSavedNotes.map((note) => {
                        return (
                          <button
                            key={note.id}
                              type="button"
                              onClick={() =>
                                void window.desktopWindow?.toggleModule('notes', {
                                  focusNoteId: note.id,
                                })
                              }
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                            >
                              <span className="min-w-0 flex-1 truncate text-[12px] font-normal text-[var(--ledger-text-primary)]">
                                {note.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">
                                {new Date(note.updated_at || note.created_at).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </button>
                          );
                        })}
                    {savedNotes.length > visibleSavedNotes.length && (
                      <button
                        type="button"
                        onClick={() => void window.desktopWindow?.toggleModule('notes')}
                        className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                      >
                        View all notes
                      </button>
                    )}
                  </div>
                )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (quickCaptureMode === 'event') {
                  setQuickCaptureMode('none');
                } else {
                  closeWorkspaceSections('event');
                }
              }}
              className={`flex h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition ${
                quickCaptureMode === 'event'
                  ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                  : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <CalendarDays size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="truncate">Event</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
                <span>+</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${quickCaptureMode === 'event' ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
            {quickCaptureMode === 'event' && (
              <div className="space-y-2 pl-1 pt-1">
                <div className="space-y-2">
                  <div className={`flex w-full items-center gap-2 ${eventComposerFieldClass}`}>
                    <input
                      ref={eventCaptureRef}
                      value={eventDraft}
                      onChange={(e) => setEventDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === '+') {
                          e.preventDefault();
                          void saveQuickEvent();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          if (!eventDraft.trim()) setQuickCaptureMode('none');
                        }
                      }}
                      placeholder="Event title..."
                      className="min-w-0 flex-1 bg-transparent px-0 text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void saveQuickEvent()}
                      disabled={!eventDraft.trim()}
                      className="inline-flex h-6 shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                      aria-label="Add event"
                    >
                      +
                    </button>
                  </div>
                  <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr] gap-2">
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className={`w-full appearance-none ${eventComposerFieldClass}`}
                    />
                    <input
                      type="time"
                      value={eventStartTime}
                      onChange={(e) => setEventStartTime(e.target.value)}
                      className={`w-full appearance-none ${eventComposerFieldClass}`}
                    />
                    <input
                      type="time"
                      value={eventEndTime}
                      onChange={(e) => setEventEndTime(e.target.value)}
                      className={`w-full appearance-none ${eventComposerFieldClass}`}
                    />
                  </div>
                </div>
            {quickCaptureNotice && (
              <p className="px-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                {quickCaptureNotice}
              </p>
            )}
                <div className="space-y-0.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEventsExpanded((current) => {
                        const next = !current;
                        persistCollapsedState(EVENTS_COLLAPSE_STORAGE_KEY, !next);
                        return next;
                      });
                    }}
                    className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[12px] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                  >
                    <span>Events · {upcomingItems.length}</span>
                    <ChevronDown
                      size={14}
                      className={`shrink-0 transition-transform ${
                        eventsExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {eventsExpanded && (
                    <div className="max-h-44 space-y-0.5 overflow-auto pr-0.5">
                      {upcomingItems.length > 0 ? (
                        <>
                          {upcomingItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                void window.desktopWindow?.toggleModule('calendar', {
                                  focusContext: `focus-event:${item.id}`,
                                })
                              }
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                            >
                              <span className="min-w-0 flex-1 truncate text-[12px] font-normal text-[var(--ledger-text-primary)]">
                                {item.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">
                                {item.dueDate}
                              </span>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => void window.desktopWindow?.openModule('calendar')}
                            className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                          >
                            View all events
                          </button>
                        </>
                      ) : (
                        <div className="px-2 py-1">
                          <p className="text-[11px] text-[var(--ledger-text-muted)]">
                            No upcoming events
                          </p>
                          <button
                            type="button"
                            onClick={() => setQuickCaptureMode('event')}
                            className="mt-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                          >
                            Create one from Event above
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        <section ref={checkinSectionRef} className="order-5 space-y-1.5">
          <button
            type="button"
            onClick={() => {
              if (isCheckinExpanded) {
                setIsCheckinExpanded(false);
                persistCollapsedState(CHECKIN_COLLAPSE_STORAGE_KEY, true);
              } else {
                closeWorkspaceSections('checkin');
              }
            }}
            className={`flex h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition ${
              isCheckinExpanded
                ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ClipboardCheck size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
              <span className="truncate">Daily Check-in</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
              <span>{checkinStatusLabel}</span>
              {isCheckinExpanded ? (
                <ChevronUp size={14} className="text-[var(--ledger-text-muted)]" />
              ) : (
                <ChevronDown size={14} className="text-[var(--ledger-text-muted)]" />
              )}
            </span>
          </button>

          {isCheckinExpanded && (
            <div className="pl-1">
              <div className="space-y-2">
                <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
                  <label className="text-[10px] font-medium text-[var(--ledger-text-muted)]">Finished</label>
                  <input
                    data-checkin-input="finished"
                    value={checkin.finished}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, finished: e.target.value }));
                    }}
                    placeholder="What did you finish?"
                    className={checkinFieldClass}
                    disabled={isLoadingDaily}
                  />
                </div>
                <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
                  <label className="text-[10px] font-medium text-[var(--ledger-text-muted)]">Blocked</label>
                  <input
                    value={checkin.blocked}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, blocked: e.target.value }));
                    }}
                    placeholder="Anything blocked?"
                    className={checkinFieldClass}
                    disabled={isLoadingDaily}
                  />
                </div>
                <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
                  <label className="text-[10px] font-medium text-[var(--ledger-text-muted)]">Tomorrow</label>
                  <input
                    value={checkin.firstTaskTomorrow}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, firstTaskTomorrow: e.target.value }));
                    }}
                    placeholder="First task tomorrow?"
                    className={checkinFieldClass}
                    disabled={isLoadingDaily}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    onClick={() => void saveCheckin()}
                    className="inline-flex h-6 shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                    disabled={isLoadingDaily}
                    aria-label="Save check-in"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="order-4 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (projectsCollapsed) {
                  closeWorkspaceSections('projects');
                } else {
                  setProjectsCollapsed(true);
                }
              }}
              className={`flex h-9 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition ${
                projectsCollapsed
                  ? 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
                  : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Folder size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="truncate">Projects</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
                <span>{projects.length}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${projectsCollapsed ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
          </div>

          {!projectsCollapsed && (
            <div className="space-y-1">
              {isLoadingProjects ? (
                <SkeletonList count={2} />
              ) : projects.length === 0 ? (
                <p className="px-0.5 text-xs text-[var(--ledger-text-muted)]">No active projects</p>
              ) : (
                <>
                  {projects.slice(0, 4).map((project) => {
                    const displayCompleteness = Math.max(0, Math.min(100, Number(project.completeness) || 0));
                    const projectAccent = project.color || 'var(--ledger-accent)';
                    const ProjectTypeIcon = getProjectTypeOption(project.project_type).icon;

                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          void window.desktopWindow?.toggleModule('projects', {
                            kind: 'projects',
                            focusProjectId: project.id,
                          });
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            type: 'project',
                            id: project.id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        className="group w-full rounded-xl px-2 py-2 text-left transition hover:bg-[var(--ledger-surface-muted)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-secondary)]">
                              <ProjectTypeIcon size={11} style={{ color: projectAccent }} />
                            </span>
                            <p className="truncate text-xs font-medium text-[var(--ledger-text-primary)]">
                              {project.name}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] font-medium text-[var(--ledger-text-muted)]">
                            {displayCompleteness}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${displayCompleteness}%`,
                              backgroundColor: projectAccent,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                  {projects.length > 4 && (
                    <button
                      type="button"
                      onClick={() => window.desktopWindow?.toggleModule('projects')}
                      className="w-full rounded-lg px-2 py-1 text-left text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                    >
                      +{projects.length - 4} more projects
                    </button>
                  )}
                  {isCreatingProject ? (
                    <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--ledger-surface-muted)]">
                      <input
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === '+') {
                            e.preventDefault();
                            void createProject();
                          }
                          if (e.key === 'Escape' && !newProjectName.trim()) {
                            e.preventDefault();
                            setNewProjectName('');
                            setIsCreatingProject(false);
                          }
                        }}
                        onBlur={(e) => {
                          const nextFocus = e.relatedTarget;
                          if (!newProjectName.trim() && !nextFocus) {
                            setNewProjectName('');
                            setIsCreatingProject(false);
                          }
                        }}
                        placeholder="Project name..."
                        className="min-w-0 flex-1 bg-transparent px-0 py-0.5 text-[12px] leading-4 text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void createProject()}
                        disabled={isCreatingProject || !newProjectName.trim()}
                        className="inline-flex h-6 items-center justify-center rounded-full px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                        aria-label="Add project"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsCreatingProject(true)}
                      className="flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-[12px] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                    >
                      <Plus size={13} className="shrink-0" />
                      <span className="truncate">Add Project</span>
                    </button>
                  )}
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('teams')}
              className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
            >
              <Users size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
              <span>Teams</span>
            </button>
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('circle')}
              className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
            >
              <CircleUserRound size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
              <span>Circle</span>
            </button>
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              className="relative flex h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              title="Intake"
              aria-label="Open intake"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Funnel size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="truncate">Intake</span>
              </span>
              {inboxCount > 0 && (
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ledger-text-muted)]">
                  <span>{inboxCount > 99 ? '99+' : inboxCount}</span>
                </span>
              )}
            </button>
          </section>

        <section className="order-6 space-y-2">
          <p className={sidebarTheme.sectionLabel}>Try</p>
          <div className="space-y-1">
            {trySectionVisibleItems.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={item.action}
                className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              >
                <item.icon size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </section>

        {saveError && <p className="text-[11px] text-[var(--ledger-danger)]">{saveError}</p>}
        </section>
      </div>

      {contextMenu &&
        createPortal(
          <div
            className={`${sidebarTheme.menu} min-w-max`}
            style={{
              left: `${Math.max(
                8,
                Math.min(contextMenu.x, window.innerWidth - sidebarContextMenuWidth - 8)
              )}px`,
              top: `${Math.max(
                8,
                Math.min(contextMenu.y, window.innerHeight - sidebarContextMenuHeight - 8)
              )}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.type === 'project' && (
              <>
                <button
                  onClick={() => {
                    const project = projects.find((p) => p.id === contextMenu.id);
                    if (project) {
                      void window.desktopWindow?.toggleModule('projects', {
                        kind: 'projects',
                        focusProjectId: project.id,
                      });
                    }
                    setContextMenu(null);
                  }}
                  className={sidebarTheme.menuItemAccent}
                >
                  <Folder size={14} />
                  Navigate to project
                </button>
                <button
                  onClick={() => {
                    void deleteProject(contextMenu.id);
                  }}
                  className={sidebarTheme.menuItemDanger}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </>
            )}

            {contextMenu.type === 'today-active' && (
              <>
                <button
                  onClick={() => {
                    void deleteTodayItem(contextMenu.id);
                  }}
                  className={sidebarTheme.menuItemDanger}
                >
                  <Trash2 size={14} />
                  Delete {contextMenu.kind === 'reminder' ? 'reminder' : 'task'}
                </button>
              </>
            )}

            {contextMenu.type === 'today-completed' && (
              <>
                <button
                  onClick={() => {
                    void resetCompletedTodayItem(contextMenu.id);
                  }}
                  className={sidebarTheme.menuItem}
                >
                  <RotateCcw size={14} />
                  Reset to active
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

export default ExpandedSidebar;
