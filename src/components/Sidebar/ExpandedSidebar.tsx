import {
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Folder,
  LogOut,
  Plus,
  RotateCcw,
  Settings,
  StickyNote,
  Trash2,
  Search,
  Inbox,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useSidebar } from '../../context/SidebarContext';
import { useSearch } from '../../context/SearchContext';
import { useApi } from '../../hooks/useApi';
import { SkeletonList } from '../Common/Skeleton';

type FocusItem = {
  id: string;
  text: string;
  done: boolean;
};

type QuickNote = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};
type QuickCaptureMode = 'none' | 'task' | 'note' | 'event';
type ProjectStatus = 'NotStarted' | 'InProgress' | 'Paused' | 'Completed';
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
  assigned_to?: string | null;
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
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_color?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  note_id?: string | null;
  note_title?: string | null;
};

const normalizeProjectNameKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();
type ProjectSemanticStatus = 'not_started' | 'in_progress' | 'paused' | 'completed';

const htmlToPlainText = (value: string) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatTodayTaskWorkspace = (item: {
  workspace_name?: string | null;
  project_name?: string | null;
  note_title?: string | null;
  calendar_name?: string | null;
  kind?: 'task' | 'reminder';
  remind_at?: string | null;
}) => {
  const parts = [
    item.workspace_name,
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

const parseDateKey = (value: string) => {
  const [yearRaw, monthRaw, dayRaw] = String(value ?? '').split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : 1,
    day: Number.isFinite(day) ? day : 1,
  };
};

const toDateKey = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0'
  )}`;

const monthOptions = [
  { value: 1, label: 'Jan' },
  { value: 2, label: 'Feb' },
  { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' },
  { value: 5, label: 'May' },
  { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' },
  { value: 8, label: 'Aug' },
  { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' },
  { value: 11, label: 'Nov' },
  { value: 12, label: 'Dec' },
];

const buildTimeOptions = () => {
  const options: Array<{ value: string; label: string }> = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const suffix = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      const label = `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
      options.push({ value, label });
    }
  }
  return options;
};

const timeOptions = buildTimeOptions();

const getProgressStateColor = (value: number) => {
  const percent = Math.max(0, Math.min(100, value));
  if (percent < 35) return '#FF5F40';
  if (percent < 70) return '#F59E0B';
  return '#22C55E';
};

export const ExpandedSidebar = ({
  onDragHandleMouseDown,
  onCollapseRequest,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCollapseRequest?: () => void;
}) => {
  const { user, signOut } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId, workspaces, setActiveWorkspace } = useWorkspaceContext();
  const { collapseToRail, position } = useSidebar();
  const { openSearch } = useSearch();
  const api = useApi();
  const isHorizontal = position === 'top' || position === 'bottom';
  const isWindowsPlatform =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
  const fullName = (user?.user_metadata?.full_name as string | undefined)?.trim() ?? '';
  const firstName = fullName ? fullName.split(' ')[0] : user?.email?.split('@')[0] ?? 'User';
  const getWorkspaceTaskMetadata = () => ({
    workspace_id: activeWorkspaceId ?? null,
    workspace_name: activeWorkspace?.name?.trim() || null,
    workspace_color: activeWorkspace?.color ?? null,
  });
  const getTaskExpiryMetadata = (hoursAhead = 24) => {
    const expiresAt = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
    const year = expiresAt.getFullYear();
    const month = String(expiresAt.getMonth() + 1).padStart(2, '0');
    const day = String(expiresAt.getDate()).padStart(2, '0');
    const hour = String(expiresAt.getHours()).padStart(2, '0');
    const minute = String(expiresAt.getMinutes()).padStart(2, '0');

    return {
      due_date: `${year}-${month}-${day}`,
      due_time: `${hour}:${minute}`,
    };
  };

  const getTaskExpiryDate = (task: {
    due_date?: string | null;
    due_time?: string | null;
  }) => {
    if (!task.due_date) return null;

    const dueAt = task.due_time
      ? new Date(
          `${task.due_date}T${task.due_time.length === 5 ? `${task.due_time}:00` : task.due_time}`
        )
      : new Date(`${task.due_date}T23:59:59`);

    return Number.isNaN(dueAt.getTime()) ? null : dueAt;
  };

  const shouldAutoExpireTodayTask = (task: {
    due_date?: string | null;
    due_time?: string | null;
    show_in_today?: boolean | null;
    is_today_focus?: boolean | null;
    status?: string | null;
  }) => {
    if (String(task.status ?? '') === 'completed') return false;
    if (!task.show_in_today && !task.is_today_focus) return false;

    const dueAt = getTaskExpiryDate(task);
    return dueAt !== null && dueAt.getTime() <= Date.now();
  };

  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [checkin, setCheckin] = useState({
    finished: '',
    blocked: '',
    firstTaskTomorrow: '',
  });
  const [checkinSaved, setCheckinSaved] = useState(false);
  const [isCheckinExpanded, setIsCheckinExpanded] = useState(false);
  const [isLoadingDaily, setIsLoadingDaily] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quickCaptureMode, setQuickCaptureMode] = useState<QuickCaptureMode>('none');
  const [taskDraft, setTaskDraft] = useState('');
  const [taskPriority, setTaskPriority] = useState<'none' | 'high' | 'medium' | 'low'>('none');
  const [taskTag, setTaskTag] = useState('');
  const [taskCaptureSaved, setTaskCaptureSaved] = useState(false);
  const [todayQuickDraft, setTodayQuickDraft] = useState('');
  const [todayQuickSaving, setTodayQuickSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  const [eventDraft, setEventDraft] = useState('');
  const [eventDate, setEventDate] = useState(todayKey());
  const [eventStartTime, setEventStartTime] = useState('09:00');
  const [eventEndTime, setEventEndTime] = useState('10:00');
  const todayBucketRef = useRef(todayKey());
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
      status: ProjectStatus | string;
      completeness: number;
      color?: string;
      start_date?: string | null;
      end_date?: string | null;
    }>
  >([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [projectUpdating, setProjectUpdating] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [upcomingItems, setUpcomingItems] = useState<
    Array<{
      id: string;
      title: string;
      type: 'event' | 'task';
      dueDate: string;
      time?: string;
      rawDate: string;
      sortAt: number;
    }>
  >([]);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(true);
  const [todayItems, setTodayItems] = useState<TodayTask[]>([]);
  const [isLoadingToday, setIsLoadingToday] = useState(true);
  const [completedToday, setCompletedToday] = useState<CompletedTodayTask[]>([]);
  const autoExpireTodayTaskIdsRef = useRef<Set<string>>(new Set());
  const TODAY_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:today-collapsed:v1';
  const TODAY_HELP_TEXT = 'Your working list for today: what to do now, and what got done.';

  const loadTodayCollapsedPreference = () => {
    try {
      const saved = window.localStorage.getItem(TODAY_COLLAPSE_STORAGE_KEY);
      if (saved === null) return true;
      return saved === '1';
    } catch {
      return true;
    }
  };

  const [todayCollapsed, setTodayCollapsed] = useState<boolean>(() => loadTodayCollapsedPreference());
  const [completedTodayExpanded, setCompletedTodayExpanded] = useState(false);
  const [todayHelpOpen, setTodayHelpOpen] = useState(false);
  const [todayHelpPopoverStyle, setTodayHelpPopoverStyle] = useState<React.CSSProperties | null>(
    null
  );
  const [todayDockPopoverOpen, setTodayDockPopoverOpen] = useState(false);
  const [todayDockPopoverStyle, setTodayDockPopoverStyle] = useState<React.CSSProperties | null>(
    null
  );
  
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<string | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    type: 'project' | 'upcoming' | 'today-active' | 'today-completed';
    id: string;
    kind?: 'task' | 'reminder';
    x: number;
    y: number;
  } | null>(null);
  const taskCaptureRef = useRef<HTMLInputElement | null>(null);
  const noteCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const eventCaptureRef = useRef<HTMLInputElement | null>(null);
  const todayHelpButtonRef = useRef<HTMLButtonElement | null>(null);
  const todayHelpPopoverRef = useRef<HTMLDivElement | null>(null);
  const todayDockButtonRef = useRef<HTMLButtonElement | null>(null);
  const todayDockPopoverRef = useRef<HTMLDivElement | null>(null);
  
  const todayHelpCloseTimerRef = useRef<number | null>(null);
  const checkinSectionRef = useRef<HTMLElement | null>(null);
  const checkinSavedTimerRef = useRef<number | null>(null);
  const projectDragRef = useRef<{
    projectId: string;
    rectLeft: number;
    rectWidth: number;
    pointerId: number;
  } | null>(null);
  const sidebarContextMenuWidth = 196;
  const sidebarContextMenuHeight = 176;

  const normalizeProjectStatus = (status: string): ProjectSemanticStatus => {
    const value = status.toLowerCase();
    if (value.includes('complete')) return 'completed';
    if (value.includes('pause') || value.includes('archiv')) return 'paused';
    if (value.includes('progress') || value.includes('in_')) return 'in_progress';
    return 'not_started';
  };

  const WorkspaceSwitcher = ({ compact = false }: { compact?: boolean }) => {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [portalStyle, setPortalStyle] = useState<React.CSSProperties | null>(null);
    const storedWorkspaceId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('ledger:active-workspace-id')?.trim() || null
        : null;
    const storedWorkspaceName =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('ledger:active-workspace-name')?.trim() || null
        : null;
    const resolvedActiveWorkspace =
      activeWorkspace ??
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
      workspaces.find((workspace) => workspace.id === storedWorkspaceId) ??
      null;
    const resolvedActiveWorkspaceLabel =
      resolvedActiveWorkspace?.name ?? storedWorkspaceName ?? (storedWorkspaceId ? 'Workspace' : 'No workspace');

    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (buttonRef.current && buttonRef.current.contains(e.target as Node)) return;
        if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
        setOpen(false);
      };

      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    useEffect(() => {
      if (!open || !buttonRef.current) {
        setPortalStyle(null);
        return;
      }

      const rect = buttonRef.current.getBoundingClientRect();
      const left = Math.max(8, rect.left + 4);
      const top = rect.bottom + 6;
      const width = Math.max(160, rect.width + 20);

      setPortalStyle({ position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, zIndex: 9999 });
    }, [open]);

    const dropdown = (
      <div
        ref={dropdownRef}
        style={portalStyle ?? undefined}
        className="rounded-2xl border border-gray-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.12)] ring-0 outline-none max-h-56 overflow-y-auto overscroll-contain pr-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {Array.isArray(workspaces) && workspaces.length > 0 ? (
          workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={async (ev) => {
                ev.stopPropagation();
                try {
                  await setActiveWorkspace(ws.id);
                } catch (err) {
                  // ignore
                }
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {ws.id === activeWorkspaceId ? (
                <Check size={14} className="text-gray-600" />
              ) : (
                <span className="w-4" />
              )}
              <span className="truncate">{ws.name}</span>
            </button>
          ))
        ) : (
          <div className="px-3 py-2 text-sm text-gray-500">
            {storedWorkspaceId ? 'Loading workspaces...' : 'No workspaces'}
          </div>
        )}
      </div>
    );

    return (
      <div className={compact ? 'relative inline-block' : 'relative inline-block w-full'}>
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={
            compact
              ? 'inline-flex h-9 max-w-45 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-left shadow-sm transition hover:border-gray-300 hover:bg-gray-50'
              : 'flex w-full items-center justify-between gap-2 truncate text-left text-[11px] font-medium text-gray-600'
          }
        >
          <span className={compact ? 'truncate text-[12px] font-medium text-gray-700' : 'truncate'}>
            {resolvedActiveWorkspaceLabel}
          </span>
          <ChevronDown size={compact ? 13 : 14} className="shrink-0 text-gray-500" />
        </button>

        {open && typeof document !== 'undefined'
          ? createPortal(dropdown, document.body)
          : null}
      </div>
    );
  };

  const projectStatusLabels: Record<ProjectSemanticStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    paused: 'Paused',
    completed: 'Completed',
  };

  const projectStatusStyles: Record<ProjectSemanticStatus, string> = {
    not_started: 'text-blue-700 bg-blue-50',
    in_progress: 'text-[#C84E2B] bg-[#FFF0EB]',
    paused: 'text-gray-700 bg-gray-100',
    completed: 'text-green-700 bg-green-50',
  };

  const projectStatusCandidates: Record<ProjectSemanticStatus, string[]> = {
    not_started: ['NotStarted', 'not_started'],
    in_progress: ['InProgress', 'in_progress'],
    paused: ['Paused', 'paused', 'archived'],
    completed: ['Completed', 'completed'],
  };

  const updateProjectStatusWithFallback = async (
    projectId: string,
    semantic: ProjectSemanticStatus
  ) => {
    const candidates = projectStatusCandidates[semantic];
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        await api.updateProject(projectId, { status: candidate });
        return candidate;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Could not update project status.');
  };

  useEffect(() => {
    if (!activeWorkspaceId) {
      setIsLoadingProjects(false);
      setIsLoadingUpcoming(false);
      setQuickNotes([]);
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
          setCheckinSaved(false);
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
        setCheckinSaved(false);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load daily accountability:', error);
          setFocusItems([]);
          setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' });
          setCheckinSaved(false);
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
  }, [user?.id, activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    const loadToday = async () => {
      if (!user) {
        setTodayItems([]);
        setIsLoadingToday(false);
        return;
      }

      setIsLoadingToday(true);
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
        if (!cancelled) setIsLoadingToday(false);
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
  }, [user?.id, activeWorkspaceId]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      autoExpireTodayTaskIdsRef.current.clear();
      return;
    }

    const expiredTasks = todayItems.filter((task) => shouldAutoExpireTodayTask(task));
    if (expiredTasks.length === 0) return;

    expiredTasks.forEach((task) => {
      if (autoExpireTodayTaskIdsRef.current.has(task.id)) return;
      autoExpireTodayTaskIdsRef.current.add(task.id);
      setTodayItems((prev) => prev.filter((item) => item.id !== task.id));

      void (async () => {
        let succeeded = false;
        try {
          const workspaceId = task.workspace_id ?? activeWorkspaceId;
          if (!workspaceId) return;

          await api.updateTaskInWorkspace(task.id, workspaceId, {
            due_date: null,
            due_time: null,
            show_in_today: false,
            is_today_focus: false,
          });
          succeeded = true;

          window.ipcRenderer?.send('dashboard:today-task-deleted', {
            source: 'sidebar',
            optimistic: true,
            task: {
              ...task,
              due_date: null,
              due_time: null,
              show_in_today: false,
              is_today_focus: false,
            },
          });
        } catch (error) {
          console.error('Failed to expire today task:', error);
          setTodayItems((prev) => [task, ...prev.filter((item) => item.id !== task.id)]);
          autoExpireTodayTaskIdsRef.current.delete(task.id);
        } finally {
          if (succeeded) {
            autoExpireTodayTaskIdsRef.current.delete(task.id);
          }
        }
      })();
    });
  }, [activeWorkspaceId, api, todayItems, user]);

  useEffect(() => {
    let cancelled = false;

    const loadQuickNotes = async () => {
      if (!user || !activeWorkspaceId) {
        setQuickNotes([]);
        return;
      }

      try {
        const data = await api.getNotes();

        if (cancelled) return;

        const payload = data as
          | {
              notes?: Array<{
                id: string;
                title: string;
                content: string;
                created_at: string;
                source?: string | null;
              }>;
            }
          | Array<{
              id: string;
              title: string;
              content: string;
              created_at: string;
              source?: string | null;
            }>;
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.notes)
          ? payload.notes
          : [];
        const mapped = rows
          .filter((row) => (row.source ?? 'workspace') === 'quick_capture')
          .map((row) => ({
            id: row.id,
            title: row.title,
            body: htmlToPlainText(row.content ?? ''),
            createdAt: row.created_at,
          }));

        setQuickNotes(mapped);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load notes:', error);
          setQuickNotes([]);
        }
      }
    };

    void loadQuickNotes();

    return () => {
      cancelled = true;
    };
  }, [user?.id, activeWorkspaceId]);

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
  }, [user?.id, activeWorkspaceId]);

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
      setIsLoadingUpcoming(false);
      setUpcomingItems([]);
      return;
    }

    if (!activeWorkspaceId) {
      setUpcomingItems([]);
      setIsLoadingUpcoming(false);
      return;
    }

    let cancelled = false;

    setIsLoadingUpcoming(true);

    const loadUpcoming = async () => {
      try {
        const events = await api.getUpcomingEvents();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString().slice(0, 10);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowISO = tomorrow.toISOString().slice(0, 10);

        const eventItems = (events || []).map((e: any) => {
          const startDate = new Date(e.start_at);
          const startAt = startDate.getTime();
          const isValidDate = Number.isFinite(startAt);
          const eventDateISO = isValidDate ? startDate.toISOString().slice(0, 10) : '';
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
      } finally {
        if (!cancelled) setIsLoadingUpcoming(false);
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
  }, [user?.id, activeWorkspaceId]);

  useEffect(() => {
    if (quickCaptureMode === 'none') return;
    const t = window.setTimeout(() => {
      if (quickCaptureMode === 'task') taskCaptureRef.current?.focus();
      if (quickCaptureMode === 'note') noteCaptureRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [quickCaptureMode]);

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
    if (!todayHelpOpen || !todayHelpButtonRef.current) {
      setTodayHelpPopoverStyle(null);
      return;
    }

    const updateTodayHelpPosition = () => {
      const rect = todayHelpButtonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const preferredWidth = 196;
      const topGap = 6;
      const centerX = rect.left + rect.width / 2;
      const left = Math.max(
        12,
        Math.min(window.innerWidth - preferredWidth - 12, centerX - preferredWidth / 2)
      );
      const top = Math.max(12, rect.top - topGap);

      setTodayHelpPopoverStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        transform: 'translateY(-100%)',
        width: `${preferredWidth}px`,
        zIndex: 30000,
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTodayHelpOpen(false);
    };

    updateTodayHelpPosition();
    window.addEventListener('resize', updateTodayHelpPosition);
    window.addEventListener('scroll', updateTodayHelpPosition, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updateTodayHelpPosition);
      window.removeEventListener('scroll', updateTodayHelpPosition, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [todayHelpOpen]);

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
    return () => {
      if (todayHelpCloseTimerRef.current !== null) {
        window.clearTimeout(todayHelpCloseTimerRef.current);
        todayHelpCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const syncToNextDay = () => {
      const currentDay = todayKey();
      if (todayBucketRef.current === currentDay) return;

      todayBucketRef.current = currentDay;
      setFocusItems([]);
      setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' });
      setCheckinSaved(false);
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
          setCheckinSaved(false);
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
    const prev = todayItems.slice();
    const item = prev.find((t) => t.id === taskId);
    if (!item) return;

    setTodayItems((s) => s.filter((t) => t.id !== taskId));
    setCompletedToday((s) => [
      {
        kind: item.kind,
        id: item.id,
        title: item.title,
        status: 'completed',
        workspace_id: item.workspace_id ?? null,
        workspace_name: item.workspace_name ?? null,
        workspace_color: item.workspace_color ?? null,
        project_id: item.project_id ?? null,
        project_name: item.project_name ?? null,
        note_id: item.note_id ?? null,
        note_title: item.note_title ?? null,
        remind_at: item.remind_at ?? null,
        completed_at: new Date().toISOString(),
      },
      ...s,
    ]);

    try {
      if (item.kind === 'reminder') {
        await api.updateReminder(taskId, { is_done: true });
      } else if (item.workspace_id) {
        await api.updateTaskInWorkspace(taskId, item.workspace_id, { status: 'completed' });
      } else {
        await api.updateTask(taskId, { status: 'completed' });
      }
    } catch (error) {
      console.error('Failed to complete today item:', error);
      setTodayItems(prev);
      setCompletedToday((s) => s.filter((c) => c.id !== taskId));
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
    const completedSnapshot = completedToday;
    const activeSnapshot = todayItems;
    const target = completedSnapshot.find((task) => task.id === taskId);
    if (!target) return;

    setCompletedToday((list) => list.filter((task) => task.id !== taskId));
    setTodayItems((list) => [
      {
        kind: target.kind,
        id: target.id,
        title: target.title,
        status: 'todo',
        workspace_id: target.workspace_id ?? null,
        workspace_name: target.workspace_name ?? null,
        workspace_color: target.workspace_color ?? null,
        project_id: target.project_id ?? null,
        project_name: target.project_name ?? null,
        note_id: target.note_id ?? null,
        note_title: target.note_title ?? null,
        remind_at: target.remind_at ?? null,
        show_in_today: true,
      },
      ...list,
    ]);
    setContextMenu(null);

    try {
      if (target.kind === 'reminder') {
        await api.updateReminder(taskId, { is_done: false });
      } else if (target.workspace_id) {
        await api.updateTaskInWorkspace(taskId, target.workspace_id, {
          status: 'todo',
          show_in_today: true,
        });
      } else {
        await api.updateTask(taskId, { status: 'todo', show_in_today: true });
      }
    } catch (error) {
      setCompletedToday(completedSnapshot);
      setTodayItems(activeSnapshot);
      setSaveError('Could not reset task.');
    }
  };

  const saveCheckin = async () => {
    window.ipcRenderer?.send('daily:checkin-updated', {
      finished: checkin.finished,
      blocked: checkin.blocked,
      firstTaskTomorrow: checkin.firstTaskTomorrow,
    });
    const success = await saveDaily({ checkin });
    if (success) {
      setCheckinSaved(true);
      if (checkinSavedTimerRef.current !== null) {
        window.clearTimeout(checkinSavedTimerRef.current);
      }
      checkinSavedTimerRef.current = window.setTimeout(() => {
        setCheckinSaved(false);
        checkinSavedTimerRef.current = null;
      }, 2200);
    }
  };

  const clearCheckin = async () => {
    const empty = { finished: '', blocked: '', firstTaskTomorrow: '' };
    setCheckin(empty);
    window.ipcRenderer?.send('daily:checkin-updated', empty);
    const success = await saveDaily({ checkin: empty });
    if (checkinSavedTimerRef.current !== null) {
      window.clearTimeout(checkinSavedTimerRef.current);
      checkinSavedTimerRef.current = null;
    }
    if (success) setCheckinSaved(false);
  };

  useEffect(() => {
    return () => {
      if (checkinSavedTimerRef.current !== null) {
        window.clearTimeout(checkinSavedTimerRef.current);
      }
    };
  }, []);

  const saveQuickNote = async () => {
    const text = noteDraft.trim();
    if (!text || !user || !activeWorkspaceId) return;

    const firstLine =
      text
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? 'Untitled note';
    const title = firstLine.replace(/^#\s*/, '').slice(0, 72);

    const data = await api.createNote(title, text, { source: 'quick_capture' });

    if (!data) {
      setSaveError('Could not save note.');
      return;
    }

    const row = data as { id: string; title: string; content: string; created_at: string };
    const note: QuickNote = {
      id: row.id,
      title: row.title,
      body: htmlToPlainText(row.content ?? text),
      createdAt: row.created_at ?? new Date().toISOString(),
    };

    setQuickNotes((prev) => [note, ...prev].slice(0, 24));
    setNoteDraft('');
    setQuickCaptureMode('none');
  };

  const saveQuickTask = async () => {
    const base = taskDraft.trim();
    if (!base) return;

    const priorityLabel =
      taskPriority === 'high'
        ? '[High]'
        : taskPriority === 'medium'
        ? '[Medium]'
        : taskPriority === 'low'
        ? '[Low]'
        : '';

    const tagLabel = taskTag.trim() ? `#${taskTag.trim().replace(/^#/, '')}` : '';
    const text = [priorityLabel, tagLabel, base].filter(Boolean).join(' ');
    const tempId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dueAt = getTaskExpiryMetadata(24);
    const optimisticTask: TodayTask = {
      id: tempId,
      kind: 'task',
      title: text,
      status: 'todo',
      ...dueAt,
      show_in_today: true,
      created_at: new Date().toISOString(),
      ...getWorkspaceTaskMetadata(),
    };
    setTodayItems((prev) => [optimisticTask, ...prev]);
    setTaskDraft('');
    setTaskPriority('none');
    setTaskTag('');
    setQuickCaptureMode('none');

    try {
      const created = await api.createTask({
        title: text,
        status: 'todo',
        priority: taskPriority === 'none' ? 'medium' : taskPriority,
        ...dueAt,
        show_in_today: true,
        is_today_focus: false,
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
        window.dispatchEvent(
          new CustomEvent('ledger:task-created', {
            detail: {
              source: 'sidebar',
              task: {
                ...optimisticTask,
                ...createdTask,
                id: createdId,
                kind: 'task' as const,
                is_today_focus: false,
                ...getWorkspaceTaskMetadata(),
              },
            },
          })
        );
      }
      setTaskCaptureSaved(true);
      window.setTimeout(() => setTaskCaptureSaved(false), 1500);
    } catch (error) {
      setTodayItems((prev) => prev.filter((item) => item.id !== tempId));
      setSaveError(error instanceof Error ? error.message : 'Could not save task.');
    }
  };

  const saveTodayQuickTask = async () => {
    const base = todayQuickDraft.trim();
    if (!base || todayQuickSaving) return;

    setTodayQuickSaving(true);
    setTodayQuickDraft('');
    const tempId = `today-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dueAt = getTaskExpiryMetadata(24);
    const optimisticTask: TodayTask = {
      id: tempId,
      kind: 'task',
      title: base,
      status: 'todo',
      ...dueAt,
      show_in_today: true,
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
        is_today_focus: true,
        ...getWorkspaceTaskMetadata(),
      },
    });
    try {
      const created = await api.createTask({
        title: base,
        status: 'todo',
        ...dueAt,
        show_in_today: true,
        is_today_focus: true,
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
            is_today_focus: true,
            ...getWorkspaceTaskMetadata(),
          },
        });
      }
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
          is_today_focus: true,
          ...getWorkspaceTaskMetadata(),
        },
      });
      setSaveError(error instanceof Error ? error.message : 'Could not save task.');
    } finally {
      setTodayQuickSaving(false);
    }
  };

  const todayTotalCount = todayItems.length + completedToday.length;

  const toggleTodayCollapsed = () => {
    setTodayCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(TODAY_COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // No-op when storage is unavailable.
      }
      return next;
    });
  };

  const saveQuickEvent = async () => {
    const title = eventDraft.trim();
    if (!title || !user || !activeWorkspaceId) return;

    setSaveError(null);

    try {
      let calendars = await api.getCalendars();
      let selectedCalendar = Array.isArray(calendars) ? calendars[0] ?? null : null;

      if (!selectedCalendar) {
        const createdCalendar = await api.createCalendar('Personal', '#3B82F6', true);
        if (createdCalendar && typeof createdCalendar === 'object') {
          const created = createdCalendar as { id: string; color?: string };
          selectedCalendar = {
            id: created.id,
            color: created.color ?? '#3B82F6',
          };
        } else {
          calendars = await api.getCalendars();
          selectedCalendar = Array.isArray(calendars) ? calendars[0] ?? null : null;
        }
      }

      if (!selectedCalendar) {
        throw new Error('Could not create a calendar for this workspace.');
      }

      const startDateTime = new Date(`${eventDate}T${eventStartTime}:00`);
      let endDateTime = new Date(`${eventDate}T${eventEndTime}:00`);
      if (endDateTime <= startDateTime) {
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
        status: 'planned',
      });

      if (!data) {
        throw new Error('Could not save event.');
      }

      const createdEvent = data as { id: string; title: string; start_at: string };
      const start = new Date(createdEvent.start_at);
      const startAt = start.getTime();
      const isValidDate = Number.isFinite(startAt);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const eventDateISO = isValidDate ? start.toISOString().slice(0, 10) : '';
      const todayISO = today.toISOString().slice(0, 10);
      const tomorrowISO = tomorrow.toISOString().slice(0, 10);
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
      };
      setUpcomingItems((prev) =>
        [...prev.filter((item) => item.id !== newItem.id), newItem]
          .sort((a, b) => a.sortAt - b.sortAt)
          .slice(0, 5)
      );

      setEventDraft('');
      setEventDate(todayKey());
      setEventStartTime('09:00');
      setEventEndTime('10:00');
      setQuickCaptureMode('none');
    } catch (error) {
      console.error('Failed to create event from sidebar:', error);
      setSaveError(error instanceof Error ? error.message : 'Could not save event.');
    }
  };

  const updateProjectStatus = async (projectId: string, newStatus: ProjectStatus) => {
    setProjectUpdating(projectId);
    const semantic = normalizeProjectStatus(newStatus);
    const previousProject = projects.find((p) => p.id === projectId);
    const previousStatus = previousProject
      ? normalizeProjectStatus(String(previousProject.status))
      : null;

    // Optimistic UI: reflect status immediately.
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: semantic } : p)));
    try {
      const resolvedStatus = await updateProjectStatusWithFallback(projectId, semantic);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, status: normalizeProjectStatus(resolvedStatus) } : p
        )
      );
    } catch (error) {
      console.error('Project status update error:', error);
      setSaveError('Could not update project status.');
      if (previousStatus) {
        setProjects((prev) =>
          prev.map((p) => (p.id === projectId ? { ...p, status: previousStatus } : p))
        );
      }
    }
    setProjectUpdating(null);
  };

  const setProjectCompletenessLocal = (projectId: string, completeness: number) => {
    completeness = Math.max(0, Math.min(100, completeness));
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, completeness } : p)));
  };

  const saveProjectCompleteness = async (projectId: string, completeness: number) => {
    try {
      await api.updateProject(projectId, { completeness });
    } catch (error) {
      setSaveError('Could not update progress.');
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
      const data = await api.createProject(name);
      const createdProject = {
        ...(data as {
          id: string;
          name: string;
          status: string;
          completeness: number;
          color?: string;
          start_date?: string | null;
          end_date?: string | null;
        }),
        status: normalizeProjectStatus((data as { status: string }).status),
      };
      setProjects((prev) => {
        const next = prev.filter(
          (project) =>
            normalizeProjectNameKey(project.name) !== normalizeProjectNameKey(createdProject.name)
        );
        return [createdProject, ...next];
      });
      setNewProjectName('');
    } catch (error) {
      console.error('Project creation error:', error);
      setSaveError(error instanceof Error ? error.message : 'Could not create project.');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const eventDateParts = parseDateKey(eventDate);
  const daysInSelectedMonth = new Date(eventDateParts.year, eventDateParts.month, 0).getDate();
  const currentYear = new Date().getFullYear();
  const eventYearOptions = Array.from({ length: 6 }).map((_, index) => currentYear - 1 + index);

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

  useEffect(() => {
    if (!draggingProjectId) return;

    const handleMove = (event: PointerEvent) => {
      const drag = projectDragRef.current;
      if (!drag || drag.projectId !== draggingProjectId) return;

      const percent = Math.round(((event.clientX - drag.rectLeft) / drag.rectWidth) * 100);
      setProjectCompletenessLocal(drag.projectId, percent);
    };

    const handleUp = () => {
      const drag = projectDragRef.current;
      if (!drag || drag.projectId !== draggingProjectId) {
        setDraggingProjectId(null);
        projectDragRef.current = null;
        return;
      }

      const project = projects.find((item) => item.id === drag.projectId);
      const finalPercent = project?.completeness ?? 0;
      projectDragRef.current = null;
      setDraggingProjectId(null);
      void saveProjectCompleteness(drag.projectId, finalPercent);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [draggingProjectId, projects]);

  const activeProjectCount = projects.filter(
    (project) => normalizeProjectStatus(String(project.status)) !== 'completed'
  ).length;
  const horizontalTodaySummary =
    todayTotalCount > 0 ? `${completedToday.length}/${todayTotalCount} complete` : 'Nothing yet';

  if (isHorizontal) {
    const isTopDock = position === 'top';
    const CollapseChevron = isTopDock ? ChevronUp : ChevronDown;

    return (
      <div className="flex h-full w-full flex-col items-center gap-1.25 p-1.25">
        <div className="flex h-15 w-full items-center gap-2 rounded-3xl border border-white/40 bg-white/78 px-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-sm">
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onCollapseRequest?.();
                collapseToRail();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:bg-white/60"
              title="Collapse sidebar"
            >
              <img src="./logo-color.svg" alt="Ledger" className="h-7 w-7 opacity-100" />
            </button>
            <WorkspaceSwitcher compact />
          </div>

          <button
            type="button"
            onClick={openSearch}
            className="flex h-8 w-[320px] min-w-65 max-w-85 items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-3 text-left shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="flex min-w-0 items-center gap-2 text-[11px] text-gray-500">
              <Search size={14} className="shrink-0 text-gray-400" />
              <span className="truncate">Search...</span>
            </span>
            <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
              ⌘K
            </span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            {[
              { label: 'Inbox', icon: Inbox, action: () => window.desktopWindow?.toggleModule('inbox') },
              { label: 'Dashboard', icon: BarChart3, action: () => window.desktopWindow?.toggleModule('dashboard') },
              { label: 'Projects', icon: Folder, action: () => window.desktopWindow?.toggleModule('projects') },
              { label: 'Notes', icon: StickyNote, action: () => window.desktopWindow?.toggleModule('notes') },
              { label: 'Calendar', icon: CalendarDays, action: () => window.desktopWindow?.toggleModule('calendar') },
            ].map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-gray-700 transition hover:border-gray-200 hover:bg-white/70 hover:text-gray-900"
                title={item.label}
                aria-label={item.label}
              >
                <item.icon size={14} />
                {item.label === 'Inbox' && inboxCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[#FF5F40] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                    {inboxCount > 9 ? '9+' : inboxCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => window.desktopWindow?.toggleModule('settings')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-white/60 text-gray-700"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={() => {
                onCollapseRequest?.();
                collapseToRail();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-white/60 text-gray-700"
              title="Collapse"
              aria-label="Collapse sidebar"
            >
              <CollapseChevron size={16} />
            </button>
            <button
              onClick={signOut}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-red-50 text-red-600"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        <div className="flex w-full flex-1 min-h-0 items-center gap-2 rounded-[20px] border border-gray-200/70 bg-white px-3 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <button
            ref={todayDockButtonRef}
            type="button"
            onClick={() => {
              setTodayDockPopoverOpen((current) => !current);
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-gray-50"
          >
            <span className="text-xs font-medium text-gray-500">
              Today
            </span>
            <span className="font-semibold text-gray-900">{horizontalTodaySummary}</span>
          </button>

          <span className="text-gray-300">•</span>

          <button
            type="button"
            onClick={() => window.desktopWindow?.openCheckin()}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-gray-50"
          >
            <span className="text-xs font-medium text-gray-500">
              Check-in
            </span>
            <span className="font-medium text-gray-900">
              {checkin.finished.trim()
                ? 'Saved'
                : checkin.blocked.trim()
                ? 'Blocked'
                : 'Not started'}
            </span>
          </button>

          <span className="text-gray-300">•</span>

          <button
            type="button"
            onClick={() => window.desktopWindow?.toggleModule('calendar')}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-gray-50"
          >
            <span className="text-xs font-medium text-gray-500">
              Upcoming
            </span>
            <span className="font-medium text-gray-900">{upcomingItems.length}</span>
          </button>

          <span className="text-gray-300">•</span>

          <button
            type="button"
            onClick={() => window.desktopWindow?.toggleModule('projects')}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-[13px] transition hover:bg-gray-50"
          >
            <span className="text-xs font-medium text-gray-500">
              Projects
            </span>
            <span className="font-medium text-gray-900">{activeProjectCount} active</span>
          </button>

          <div className="ml-auto">
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('dashboard')}
              className="inline-flex items-center rounded-full border border-[#FF5F40] bg-[#FF5F40] px-3.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-[#f25538]"
            >
              Open Dashboard
            </button>
          </div>
        </div>

        {todayDockPopoverOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={todayDockPopoverRef}
                style={todayDockPopoverStyle ?? undefined}
                onMouseDown={(e) => e.stopPropagation()}
                className="rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Today
                    </p>
                    <p className="mt-1 text-sm text-gray-600">{horizontalTodaySummary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTodayDockPopoverOpen(false)}
                    className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
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
                        className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-gray-50"
                      >
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-gray-900">{item.title}</span>
                          <span className="block truncate text-[11px] text-gray-500">
                            {formatTodayTaskWorkspace(item) || item.workspace_name || 'Workspace'}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-sm text-gray-500">Nothing needs your attention yet.</p>
                  )}

                  {completedToday.length > 0 && (
                    <div className="pt-2">
                      <p className="px-2 text-xs font-medium text-gray-400">
                        Completed today
                      </p>
                      {sortTodayTasks(completedToday).slice(0, 4).map((item) => (
                        <div
                          key={item.id}
                          className="mt-1 flex items-start gap-2 rounded-xl px-2 py-2 text-left"
                        >
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-green-500" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-gray-500 line-through">
                              {item.title}
                            </span>
                            <span className="block truncate text-[11px] text-gray-400">
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
        isHorizontal ? 'flex-col border-b border-gray-200 py-5' : 'flex-col py-5'
      }`}
    >
      <div
        className="relative z-10 px-5 pb-2 border-b border-white/20 bg-transparent"
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 bg-transparent text-left">
            <img src="./logo-color.svg" alt="Ledger" className="h-8 w-8" />
            <h1 className={`text-2xl tracking-tight text-gray-950 ${isWindowsPlatform ? 'font-normal' : 'font-light'}`}>
              Ledger
            </h1>
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              onCollapseRequest?.();
              collapseToRail();
            }}
            className="p-1 hover:bg-white/30 rounded-lg transition"
            title="Collapse sidebar"
          >
            <ChevronLeft size={20} className="text-gray-700" />
          </button>
        </div>

        <div className="bg-white rounded-lg p-3 border border-gray-200 flex items-start justify-between opacity-100">
          <div>
            <p className="text-sm font-semibold text-gray-900 opacity-100">{firstName}</p>
            <div className="mt-0.5">
              <WorkspaceSwitcher />
            </div>
            <p className="text-xs text-gray-700 truncate">{user?.email}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              onMouseDown={(e) => e.stopPropagation()}
              className="relative p-1.5 hover:bg-gray-100 rounded-md transition text-gray-600 hover:text-gray-900"
              title="Inbox"
              aria-label="Open inbox"
            >
              <Inbox size={15} />
              {inboxCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[#FF5F40] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              )}
            </button>
            <button
              onClick={() => window.desktopWindow?.toggleModule('settings')}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1.5 hover:bg-gray-100 rounded-md transition text-gray-600 hover:text-gray-900 shrink-0"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 pt-2 pb-2">
        <button
          type="button"
          onClick={openSearch}
          className="mb-3 flex h-10 w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-3 text-left shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
        >
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-gray-500">
            <Search size={14} className="shrink-0 text-gray-400" />
            <span className="truncate">Search everything...</span>
          </span>
          <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
            ⌘K
          </span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => window.desktopWindow?.toggleModule('dashboard')}
            className="h-10 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <BarChart3 size={13} />
            Dashboard
          </button>
          <button
            onClick={() => window.desktopWindow?.toggleModule('projects')}
            className="h-10 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <Folder size={13} />
            Projects
          </button>
          <button
            onClick={() => window.desktopWindow?.toggleModule('notes')}
            className="h-10 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <StickyNote size={13} />
            Notes
          </button>
          <button
            onClick={() => window.desktopWindow?.toggleModule('calendar')}
            className="h-10 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <CalendarDays size={13} />
            Calendar
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        {/* Today unified feed (workspace-aware) */}
        <section className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
          <div
            role="button"
            tabIndex={0}
            onClick={toggleTodayCollapsed}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              toggleTodayCollapsed();
            }}
            className="flex w-full items-start justify-between gap-3 text-left outline-none"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold tracking-tight text-gray-900">Today</p>
                <button
                  ref={todayHelpButtonRef}
                  type="button"
                  onMouseEnter={() => {
                    if (todayHelpCloseTimerRef.current !== null) {
                      window.clearTimeout(todayHelpCloseTimerRef.current);
                      todayHelpCloseTimerRef.current = null;
                    }
                    setTodayHelpOpen(true);
                  }}
                  onMouseLeave={() => {
                    if (todayHelpCloseTimerRef.current !== null) {
                      window.clearTimeout(todayHelpCloseTimerRef.current);
                    }
                    todayHelpCloseTimerRef.current = window.setTimeout(() => {
                      setTodayHelpOpen(false);
                      todayHelpCloseTimerRef.current = null;
                    }, 120);
                  }}
                  onFocus={() => setTodayHelpOpen(true)}
                  onBlur={() => setTodayHelpOpen(false)}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-200 text-[10px] font-semibold text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
                  aria-label="What is Today?"
                  title="What is Today?"
                >
                  ?
                </button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                <span className="shrink-0">
                  {todayTotalCount > 0 ? `${completedToday.length}/${todayTotalCount} complete` : 'Nothing yet'}
                </span>
              </div>
              {!todayCollapsed && (
                <p className="text-[11px] text-gray-500">Operational queue for today.</p>
              )}
            </div>
            <ChevronDown
              size={14}
              className={`mt-0.5 shrink-0 text-gray-400 transition-transform ${
                todayCollapsed ? 'rotate-180' : ''
              }`}
            />
          </div>

          {!todayCollapsed && (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                <input
                  value={todayQuickDraft}
                  onChange={(e) => setTodayQuickDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveTodayQuickTask();
                    }
                  }}
                  placeholder="Add task for today..."
                  className="flex-1 bg-transparent px-0.5 text-[12px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
                  disabled={todayQuickSaving || isLoadingToday}
                />
                <button
                  onClick={() => void saveTodayQuickTask()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                  title="Add to Today"
                  disabled={todayQuickSaving || isLoadingToday || !todayQuickDraft.trim()}
                >
                  <Plus size={12} />
                </button>
              </div>

              <div className="flex items-center justify-between px-0.5">
                <p className="text-[10px] text-gray-500">Press Enter or + to add</p>
                <p
                  className={`text-[10px] text-green-700 transition-opacity duration-200 ${
                    taskCaptureSaved ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  Added
                </p>
              </div>

              {isLoadingToday && todayItems.length === 0 && completedToday.length === 0 ? (
                <SkeletonList />
              ) : (
                <>
                  {todayItems.length > 0 && (
                    <div className="space-y-0.5">
                      {todayItems.map((item) => (
                        <div
                          key={item.id}
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
                          className="flex items-start gap-1.5 rounded-lg px-1 py-1 transition hover:bg-gray-50"
                        >
                          <button
                            type="button"
                            onClick={() => void toggleCompleteTodayItem(item.id)}
                            className="mt-px flex h-5 w-5 shrink-0 items-center justify-center"
                            title="Mark complete"
                          >
                            <div className="flex h-4.5 w-4.5 items-center justify-center rounded-full border border-gray-300 text-gray-600">
                              <span className="sr-only">Mark complete</span>
                            </div>
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] leading-4 text-gray-900">
                              {item.title}
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 truncate text-[9px] text-gray-500">
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: item.workspace_color || '#CBD5E1',
                                }}
                              />
                              <span className="truncate">
                                {formatTodayTaskWorkspace(item) || item.workspace_name || 'Workspace'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {completedToday.length > 0 && (
                    <div className="pt-0">
                      <button
                        type="button"
                        onClick={() => setCompletedTodayExpanded((prev) => !prev)}
                        className="flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-gray-50 transition"
                      >
                        <span className="text-[11px] font-medium text-gray-500">
                          Completed · {completedToday.length}
                        </span>
                        <ChevronDown
                          size={14}
                          className={`text-gray-400 transition-transform ${
                            completedTodayExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {completedTodayExpanded && (
                        <div className="mt-1 space-y-1">
                          {sortTodayTasks(completedToday).map((item) => (
                            <div
                              key={item.id}
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
                                className="flex items-start gap-1.5 rounded-lg px-1 py-1 transition hover:bg-gray-50"
                            >
                              <button
                                type="button"
                                onClick={() => void toggleCompleteTodayItem(item.id)}
                                className="mt-px flex h-5 w-5 shrink-0 items-center justify-center"
                                title="Mark incomplete"
                              >
                                <div className="flex h-4.5 w-4.5 items-center justify-center rounded-full border border-green-600 bg-green-50 text-green-600">
                                  <Check size={12} />
                                </div>
                              </button>
                              <div className="min-w-0 flex-1">
                                  <div className="truncate text-[11px] leading-4 text-gray-600 line-through">
                                  {item.title}
                                </div>
                                  <div className="flex min-w-0 items-center gap-1.5 truncate text-[9px] text-gray-500">
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: item.workspace_color || '#CBD5E1',
                                    }}
                                  />
                                  <span className="truncate">
                                    {formatTodayTaskWorkspace(item) || item.workspace_name || 'Workspace'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        {todayHelpOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={todayHelpPopoverRef}
                style={todayHelpPopoverStyle ?? undefined}
                onMouseEnter={() => {
                  if (todayHelpCloseTimerRef.current !== null) {
                    window.clearTimeout(todayHelpCloseTimerRef.current);
                    todayHelpCloseTimerRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  if (todayHelpCloseTimerRef.current !== null) {
                    window.clearTimeout(todayHelpCloseTimerRef.current);
                  }
                  todayHelpCloseTimerRef.current = window.setTimeout(() => {
                    setTodayHelpOpen(false);
                    todayHelpCloseTimerRef.current = null;
                  }, 120);
                }}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-[0_10px_20px_rgba(15,23,42,0.12)]"
              >
                <p className="text-[11px] leading-4 text-gray-600">{TODAY_HELP_TEXT}</p>
              </div>,
              document.body
            )
          : null}

        <section>
          <h2 className="mb-2 text-xs font-medium text-gray-500">
            Quick Capture
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setQuickCaptureMode((prev) => (prev === 'task' ? 'none' : 'task'))}
              className={`px-2.5 py-2 text-xs font-medium rounded-lg transition flex items-center justify-center gap-1.5 ${
                quickCaptureMode === 'task'
                  ? 'text-gray-900 bg-white border border-gray-300'
                  : 'text-gray-700 bg-white hover:bg-gray-50'
              }`}
            >
              <Plus size={13} />
              Task
            </button>
            <button
              onClick={() => setQuickCaptureMode((prev) => (prev === 'note' ? 'none' : 'note'))}
              className={`px-2.5 py-2 text-xs font-medium rounded-lg transition flex items-center justify-center gap-1.5 ${
                quickCaptureMode === 'note'
                  ? 'text-gray-900 bg-white border border-gray-300'
                  : 'text-gray-700 bg-white hover:bg-gray-50'
              }`}
            >
              <StickyNote size={13} />
              Note
            </button>
            <button
              onClick={() => setQuickCaptureMode((prev) => (prev === 'event' ? 'none' : 'event'))}
              className={`px-2.5 py-2 text-xs font-medium rounded-lg transition flex items-center justify-center gap-1.5 ${
                quickCaptureMode === 'event'
                  ? 'text-gray-900 bg-white border border-gray-300'
                  : 'text-gray-700 bg-white hover:bg-gray-50'
              }`}
            >
              <CalendarDays size={13} />
              Event
            </button>
          </div>

          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              quickCaptureMode === 'task' ? 'max-h-56 opacity-100 mt-2.5' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="rounded-lg border border-gray-200 bg-white p-2.5">
              <input
                ref={taskCaptureRef}
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveQuickTask();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (!taskDraft.trim()) setQuickCaptureMode('none');
                  }
                }}
                placeholder="Add a task..."
                className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  value={taskPriority}
                  onChange={(e) =>
                    setTaskPriority(e.target.value as 'none' | 'high' | 'medium' | 'low')
                  }
                  className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                >
                  <option value="none">No priority</option>
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
                <input
                  value={taskTag}
                  onChange={(e) => setTaskTag(e.target.value)}
                  placeholder="Tag (optional)"
                  className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-xs font-medium text-gray-500">
                  <p>Press Enter to save quickly</p>
                </div>
                <button
                  onClick={() => void saveQuickTask()}
                  disabled={!taskDraft.trim()}
                  className="px-2 py-1 text-[11px] font-medium text-white bg-[#FF5F40] hover:bg-[#ea5336] rounded-md disabled:opacity-60"
                >
                  Add Task
                </button>
              </div>
            </div>
          </div>

          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              quickCaptureMode === 'note' ? 'max-h-48 opacity-100 mt-2.5' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="rounded-lg border border-gray-200 bg-white p-2.5 translate-y-0">
              <textarea
                ref={noteCaptureRef}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    saveQuickNote();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (!noteDraft.trim()) setQuickCaptureMode('none');
                  }
                }}
                placeholder="Write a quick note... (Cmd/Ctrl+Enter to save)"
                className="w-full h-24 resize-none text-xs leading-5 text-gray-800 placeholder:text-gray-400 bg-transparent focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">Esc to close</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setNoteDraft('');
                      setQuickCaptureMode('none');
                    }}
                    className="px-2 py-1 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
                  >
                    Clear
                  </button>
                  <button
                    onClick={saveQuickNote}
                    disabled={!noteDraft.trim()}
                    className="px-2 py-1 text-[11px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              quickCaptureMode === 'event'
                ? 'max-h-80 opacity-100 mt-2.5'
                : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
              <input
                ref={eventCaptureRef}
                value={eventDraft}
                onChange={(e) => setEventDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void saveQuickEvent();
                  }
                }}
                placeholder="Event title"
                className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
              />
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={eventDateParts.month}
                    onChange={(e) => {
                      const nextMonth = Number(e.target.value);
                      const nextDay = Math.min(
                        eventDateParts.day,
                        new Date(eventDateParts.year, nextMonth, 0).getDate()
                      );
                      setEventDate(toDateKey(eventDateParts.year, nextMonth, nextDay));
                    }}
                    className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  >
                    {monthOptions.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={eventDateParts.day}
                    onChange={(e) => {
                      const nextDay = Number(e.target.value);
                      setEventDate(toDateKey(eventDateParts.year, eventDateParts.month, nextDay));
                    }}
                    className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  >
                    {Array.from({ length: daysInSelectedMonth }).map((_, index) => {
                      const day = index + 1;
                      return (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    value={eventDateParts.year}
                    onChange={(e) => {
                      const nextYear = Number(e.target.value);
                      const nextDay = Math.min(
                        eventDateParts.day,
                        new Date(nextYear, eventDateParts.month, 0).getDate()
                      );
                      setEventDate(toDateKey(nextYear, eventDateParts.month, nextDay));
                    }}
                    className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  >
                    {eventYearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">Start</label>
                  <select
                    value={eventStartTime}
                    onChange={(e) => setEventStartTime(e.target.value)}
                    className="h-7 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  >
                    {timeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">End</label>
                  <select
                    value={eventEndTime}
                    onChange={(e) => setEventEndTime(e.target.value)}
                    className="h-7 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  >
                    {timeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setEventDraft('');
                    setEventDate(todayKey());
                    setEventStartTime('09:00');
                    setEventEndTime('10:00');
                    setQuickCaptureMode('none');
                  }}
                  className="flex-1 h-7 px-2 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Clear
                </button>
                <button
                  onClick={() => void saveQuickEvent()}
                  disabled={!eventDraft.trim()}
                  className="flex-1 h-7 px-2 text-[11px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </div>
          </div>

          {quickNotes.length > 0 && (
            <div className="mt-2 space-y-1.5 max-h-40 overflow-auto pr-0.5">
              {quickNotes.slice(0, 6).map((note) => (
                <div
                  key={note.id}
                  className="w-full rounded-md border border-gray-200 bg-white hover:bg-gray-50 px-2 py-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => {
                        setNoteDraft(note.body);
                        setQuickCaptureMode('note');
                      }}
                      className="min-w-0 text-left flex-1"
                    >
                      <p className="text-[11px] font-medium text-gray-900 truncate">{note.title}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {new Date(note.createdAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await api.deleteNote(note.id);
                        } catch (error) {
                          setSaveError('Could not delete note.');
                          return;
                        }
                        setQuickNotes((prev) => prev.filter((item) => item.id !== note.id));
                      }}
                      className="mt-0.5 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                      title="Delete note"
                      aria-label="Delete note"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          ref={checkinSectionRef}
          className="bg-white border border-gray-200 rounded-xl p-3.5"
        >
          <button
            onClick={() => setIsCheckinExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5">
              <ClipboardCheck size={14} className="text-gray-700" />
              <p className="text-xs font-semibold text-gray-900">Daily Check-in</p>
            </div>
            <div className="flex items-center gap-2">
              {checkinSaved && (
                <span className="text-[10px] text-green-700 font-medium">Saved</span>
              )}
              {isCheckinExpanded ? (
                <ChevronUp size={14} className="text-gray-500" />
              ) : (
                <ChevronDown size={14} className="text-gray-500" />
              )}
            </div>
          </button>

          {!isCheckinExpanded && (
            <p className="mt-2 text-[11px] text-gray-500">
              {checkinSaved
                ? 'Saved for today. Click to edit.'
                : 'Click to add your daily check-in.'}
            </p>
          )}

          {isCheckinExpanded && (
            <>
              <div className="mt-2.5 space-y-2">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    Finished
                  </label>
                  <input
                    value={checkin.finished}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, finished: e.target.value }));
                      setCheckinSaved(false);
                    }}
                    placeholder="What did you finish?"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                    disabled={isLoadingDaily}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    Blocked
                  </label>
                  <input
                    value={checkin.blocked}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, blocked: e.target.value }));
                      setCheckinSaved(false);
                    }}
                    placeholder="What didn't you finish"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                    disabled={isLoadingDaily}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    First Task Tomorrow
                  </label>
                  <input
                    value={checkin.firstTaskTomorrow}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, firstTaskTomorrow: e.target.value }));
                      setCheckinSaved(false);
                    }}
                    placeholder="What's first tomorrow?"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                    disabled={isLoadingDaily}
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => void clearCheckin()}
                  className="h-8 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition disabled:opacity-60"
                  disabled={
                    isLoadingDaily ||
                    (!checkinSaved &&
                      !checkin.finished.trim() &&
                      !checkin.blocked.trim() &&
                      !checkin.firstTaskTomorrow.trim())
                  }
                >
                  Clear
                </button>
                <button
                  onClick={() => void saveCheckin()}
                  className="h-8 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-md transition disabled:opacity-60"
                  disabled={isLoadingDaily}
                >
                  Save Check-in
                </button>
              </div>
            </>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Project Tracker
            </h2>
            <button
              onClick={() => setIsCreatingProject(!isCreatingProject)}
              className="text-xs font-medium text-[#FF5F40] hover:text-[#ea5336] px-2 py-1 rounded hover:bg-gray-50"
            >
              {isCreatingProject ? 'Cancel' : '+ New'}
            </button>
          </div>

          {isCreatingProject && (
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-2 space-y-2 overflow-hidden">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createProject();
                  }
                }}
                placeholder="Project name"
                className="w-full h-8 px-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:border-gray-500 bg-gray-50 text-gray-900 placeholder-gray-500"
                autoFocus
              />
              <button
                onClick={() => void createProject()}
                disabled={!newProjectName.trim()}
                className="w-full h-7 rounded-md bg-[#FF5F40] text-white text-xs font-medium hover:bg-[#ea5336] disabled:opacity-60"
              >
                Create Project
              </button>
            </div>
          )}

          <div className="space-y-2">
            {isLoadingProjects ? (
              <SkeletonList count={2} />
            ) : projects.length === 0 ? (
              <p className="text-xs text-gray-500">No active projects</p>
            ) : (
              projects.map((project) => {
                const isExpanded = expandedProjectId === project.id;
                const statusKey = normalizeProjectStatus(String(project.status));
                const statusLabel = projectStatusLabels[statusKey];
                const statusColor = projectStatusStyles[statusKey];
                const displayCompleteness = Math.max(0, Math.min(100, Number(project.completeness) || 0));
                const progressColor = getProgressStateColor(displayCompleteness);
                const projectAccent = project.color || '#007AFF';

                return (
                  <div
                    key={project.id}
                    className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        type: 'project',
                        id: project.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <button
                      onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
                      className="w-full text-left p-3 flex items-start justify-between bg-white transition hover:bg-gray-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full border border-black/5"
                            style={{ backgroundColor: projectAccent }}
                          />
                          <p className="text-xs font-semibold text-gray-900 truncate">
                            {project.name}
                          </p>
                        </div>
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const percent = Math.round(
                              ((e.clientX - rect.left) / rect.width) * 100
                            );
                            setDraggingProjectId(project.id);
                            projectDragRef.current = {
                              projectId: project.id,
                              rectLeft: rect.left,
                              rectWidth: rect.width,
                              pointerId: e.pointerId,
                            };
                            setProjectCompletenessLocal(project.id, percent);
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className={`mt-2 h-2 rounded-full bg-gray-200 overflow-hidden transition touch-none ${
                            'cursor-pointer hover:bg-gray-300'
                          }`}
                        >
                          <div
                            className={`h-full rounded-full ${
                              draggingProjectId === project.id ? '' : 'transition-all'
                            }`}
                            style={{
                              width: `${displayCompleteness}%`,
                              backgroundColor: progressColor,
                            }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-gray-600">
                            {displayCompleteness}% complete
                          </p>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColor}`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform shrink-0 ml-2 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-white p-3 space-y-2">
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-gray-600">
                            Project Status
                          </label>
                          <div className="mt-1.5 flex gap-1 flex-wrap">
                            {(
                              ['NotStarted', 'InProgress', 'Paused', 'Completed'] as ProjectStatus[]
                            ).map((status) => (
                              <button
                                key={status}
                                onClick={() => updateProjectStatus(project.id, status)}
                                disabled={projectUpdating === project.id}
                                className={`text-[10px] font-medium px-2 py-1 rounded transition ${
                                  normalizeProjectStatus(String(project.status)) ===
                                  normalizeProjectStatus(status)
                                    ? 'bg-[#FF5F40] text-white'
                                    : 'bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                                }`}
                              >
                                {projectStatusLabels[normalizeProjectStatus(status)]}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
            Upcoming
          </h2>
          <div className="space-y-2">
            {isLoadingUpcoming ? (
              <SkeletonList count={2} />
            ) : upcomingItems.length === 0 ? (
              <p className="text-xs text-gray-500">No upcoming events</p>
            ) : (
              upcomingItems.map((item) => {
                const isExpanded = expandedUpcomingId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setExpandedUpcomingId(isExpanded ? null : item.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ type: 'upcoming', id: item.id, x: e.clientX, y: e.clientY });
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left transition hover:bg-gray-50"
                  >
                    <div className="flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">
                        {item.type === 'event' ? (
                          <CalendarDays size={14} className="text-[#FF5F40]" />
                        ) : (
                          <CheckCircle2 size={14} className="text-green-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[13px] font-semibold leading-5 text-gray-900 ${
                            isExpanded ? '' : 'truncate'
                          }`}
                        >
                          {item.title}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-600">
                          {item.dueDate}
                          {item.time && ` · ${item.time}`}
                        </p>
                      </div>
                      <div className="shrink-0 mt-0.5">
                        {isExpanded ? (
                          <ChevronUp size={12} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={12} className="text-gray-400" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
      </div>

      {contextMenu &&
        createPortal(
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-max"
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
                {expandedProjectId === contextMenu.id ? (
                  <button
                    onClick={() => {
                      setExpandedProjectId(null);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
                  >
                    <ChevronUp size={14} />
                    Collapse
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const project = projects.find((p) => p.id === contextMenu.id);
                      if (project) {
                        setExpandedProjectId(contextMenu.id);
                        setContextMenu(null);
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
                  >
                    <ChevronDown size={14} />
                    Expand
                  </button>
                )}
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
                  className="w-full text-left px-4 py-2 text-sm text-[#FF5F40] hover:bg-gray-50 transition flex items-center gap-2"
                >
                  <Folder size={14} />
                  Navigate to project
                </button>
                <button
                  onClick={() => {
                    void deleteProject(contextMenu.id);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </>
            )}

            {contextMenu.type === 'upcoming' && (
              <>
                {expandedUpcomingId === contextMenu.id ? (
                  <button
                    onClick={() => {
                      setExpandedUpcomingId(null);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
                  >
                    <ChevronUp size={14} />
                    Collapse
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setExpandedUpcomingId(contextMenu.id);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
                  >
                    <ChevronDown size={14} />
                    Expand
                  </button>
                )}
                <button
                  onClick={() => {
                    const event = upcomingItems.find((e) => e.id === contextMenu.id);
                    if (event) {
                      void window.desktopWindow?.toggleModule('calendar', event.rawDate);
                      setContextMenu(null);
                    }
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-[#FF5F40] hover:bg-gray-50 transition flex items-center gap-2"
                >
                  <CalendarDays size={14} />
                  Open in Calendar
                </button>
                <button
                  onClick={() => {
                    const targetId = contextMenu.id;
                    const previousItems = upcomingItems;
                    setUpcomingItems((prev) => prev.filter((item) => item.id !== targetId));
                    setExpandedUpcomingId((current) => (current === targetId ? null : current));
                    setContextMenu(null);
                    void (async () => {
                      try {
                        await api.deleteEvent(targetId);
                        window.ipcRenderer?.send('calendar:items-updated');
                      } catch (error) {
                        setUpcomingItems(previousItems);
                        setSaveError('Could not delete event.');
                      }
                    })();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2"
                >
                  <Trash2 size={14} />
                  Delete Event
                </button>
              </>
            )}

            {contextMenu.type === 'today-active' && (
              <>
                <button
                  onClick={() => {
                    void deleteTodayItem(contextMenu.id);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2"
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
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
                >
                  <RotateCcw size={14} />
                  Reset to active
                </button>
              </>
            )}
          </div>,
          document.body
        )}

      <div className="px-5 space-y-3 border-t border-white/20 pt-4">
        <button
          onClick={() => window.desktopWindow?.toggleModule('dashboard')}
          className="w-full px-3 py-2 text-sm font-medium text-white bg-[#FF5F40] hover:bg-[#ea5336] rounded-lg transition flex items-center justify-center gap-2"
        >
          <BarChart3 size={16} />
          Open Dashboard
        </button>
        <button
          onClick={signOut}
          className="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition flex items-center justify-center gap-2"
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  );
};

export default ExpandedSidebar;
