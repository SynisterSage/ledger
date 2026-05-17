import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Folder,
  Loader2,
  MoreHorizontal,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { ToastProvider } from './components/Common/ToastProvider';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from './context/AuthContext';
import { useWorkspaceContext } from './context/WorkspaceContext';
import { useWorkspaceInit } from './hooks/useWorkspaceInit';
import { useApi } from './hooks/useApi';
import { useSidebar } from './context/SidebarContext';
import { MainLayout } from './components/Common/MainLayout';
import { ModuleWindowHeader } from './components/Common/ModuleWindowHeader';
import { CloseGuardModal } from './components/Common/CloseGuardModal';
import LoginForm from './components/Common/LoginForm';
import CalendarWindow from './components/Calendar/CalendarWindow';
import NotesWindow from './components/Notes/NotesWindow';
import ProjectsWindow from './components/Projects/ProjectsWindow';
import SettingsWindow from './components/Settings/SettingsWindow';
import { SearchModal } from './components/Search/SearchModal';
import { SearchProvider } from './context/SearchContext';
import {
  SkeletonProjectCard,
  SkeletonNoteCard,
  SkeletonTaskItem,
} from './components/Common/Skeleton';
import { useSearch } from './context/SearchContext';
import { QuickCaptureWindow } from './components/Common/QuickCaptureWindow';

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'ready';
type ModuleKind =
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'dashboard'
  | 'settings'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event'
  | null;

const windowParams = new URLSearchParams(window.location.search);
const isModuleWindow = windowParams.get('window') === 'module';
const moduleKind = (windowParams.get('module') as ModuleKind) ?? null;
const moduleFocusContext = windowParams.get('focusContext')?.trim() ?? '';
const moduleFocusTaskId = windowParams.get('focusTaskId')?.trim() ?? '';
const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties & { WebkitAppRegion: 'drag' };
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties & {
  WebkitAppRegion: 'no-drag';
};

const getInviteTokenFromLocation = () => {
  const pathMatch = window.location.pathname.match(/^\/invite\/([^/?#]+)/);
  if (pathMatch?.[1]) {
    const token = decodeURIComponent(pathMatch[1]).trim();
    if (token) {
      window.history.replaceState({}, '', `/?token=${encodeURIComponent(token)}`);
      return token;
    }
  }
  return new URLSearchParams(window.location.search).get('token')?.trim() || null;
};

const getInviteTokenFromInput = (value: string) => {
  const raw = value.trim();
  if (!raw) return null;

  const pathMatch = raw.match(/\/invite\/([^/?#]+)/i);
  if (pathMatch?.[1]) {
    const token = decodeURIComponent(pathMatch[1]).trim();
    if (token) return token;
  }

  const queryTokenMatch = raw.match(/[?&]token=([^&#]+)/i);
  if (queryTokenMatch?.[1]) {
    const token = decodeURIComponent(queryTokenMatch[1]).trim();
    if (token) return token;
  }

  try {
    const url = new URL(raw);
    const urlPathMatch = url.pathname.match(/\/invite\/([^/?#]+)/i);
    if (urlPathMatch?.[1]) {
      const token = decodeURIComponent(urlPathMatch[1]).trim();
      if (token) return token;
    }

    const tokenParam = url.searchParams.get('token')?.trim();
    if (tokenParam) return tokenParam;
  } catch {
    // Fall through to raw token handling.
  }

  return raw;
};

function AuthStatusScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900"
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
      <button
        type="button"
        onClick={() => {
          void window.desktopWindow?.quitApp();
        }}
        aria-label="Close"
        className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900"
        style={noDragRegionStyle}
      >
        <X size={16} />
      </button>
      <div
        className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8"
        style={noDragRegionStyle}
      >
        <div className="flex w-full max-w-90 flex-col items-center text-center">
          <img src="./logo-color.svg" alt="Ledger" className="mb-5 h-12 w-12" />
          <h2 className="text-[26px] font-semibold leading-tight text-gray-950">{title}</h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-gray-500">{subtitle}</p>
          <div className="mt-6 flex items-center gap-2 text-gray-500">
            <Loader2 size={15} className="animate-spin" />
            <span className="text-xs font-medium">Loading</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const htmlToPlainText = (value: string) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Dashboard content component
function DashboardContent({ initialFocusTaskId }: { initialFocusTaskId?: string }) {
  const { user } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();
  const { setState } = useSidebar();
  const todayTasksRef = useRef<HTMLElement | null>(null);
  const followUpsRef = useRef<HTMLElement | null>(null);

  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [todayTasks, setTodayTasks] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      due_date?: string | null;
      due_time?: string | null;
      project_id?: string | null;
      project_name?: string | null;
      workspace_id?: string | null;
      workspace_name?: string | null;
      workspace_color?: string | null;
      assigned_to?: string | null;
      is_today_focus?: boolean;
      show_in_today?: boolean;
      completed_at?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>
  >([]);
  const [daily, setDaily] = useState<{
    focusItems: Array<{ id: string; text: string; done: boolean }>;
    finished: string;
    blocked: string;
    firstTaskTomorrow: string;
  }>({
    focusItems: [],
    finished: '',
    blocked: '',
    firstTaskTomorrow: '',
  });
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      completeness: number;
      end_date?: string | null;
    }>
  >([]);
  const [upcoming, setUpcoming] = useState<
    Array<{ id: string; title: string; start_at: string; end_at: string; color?: string }>
  >([]);
  const [notes, setNotes] = useState<
    Array<{ id: string; title: string; content: string; updated_at: string }>
  >([]);
  const [followUpTasks, setFollowUpTasks] = useState<
    Array<{
      id: string;
      title: string;
      status?: string | null;
      description?: string | null;
      notes?: string | null;
      updated_at?: string;
      eventId?: string | null;
      eventTitle?: string | null;
    }>
  >([]);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(initialFocusTaskId ?? null);
  const [focusDraftTitle, setFocusDraftTitle] = useState('');
  const [isSavingFocusTask, setIsSavingFocusTask] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [focusActionId, setFocusActionId] = useState<string | null>(null);
  const [isFocusPickerOpen, setIsFocusPickerOpen] = useState(false);
  const [isNewFocusModalOpen, setIsNewFocusModalOpen] = useState(false);
  const [expandedTimelineIds, setExpandedTimelineIds] = useState<Set<string>>(new Set());
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [dashboardContextMenu, setDashboardContextMenu] = useState<
    | { x: number; y: number; type: 'followup'; taskId: string }
    | { x: number; y: number; type: 'timeline'; eventId: string }
    | { x: number; y: number; type: 'project'; projectId: string }
    | { x: number; y: number; type: 'note'; noteId: string }
    | { x: number; y: number; type: 'checkin' }
    | null
  >(null);
  const hasLoadedDashboardRef = useRef(false);

  useEffect(() => {
    const handleSidebarStateChanged = (
      _event: unknown,
      payload: { state?: 'minimized' | 'expanded' | 'fullscreen' }
    ) => {
      if (!payload?.state) return;
      setState(payload.state);
    };

    window.ipcRenderer?.on('sidebar:state-changed', handleSidebarStateChanged);

    return () => {
      window.ipcRenderer?.off('sidebar:state-changed', handleSidebarStateChanged);
    };
  }, [setState]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      hasLoadedDashboardRef.current = false;
      setIsLoadingDashboard(false);
      setDashboardError(null);
      setDaily({
        focusItems: [],
        finished: '',
        blocked: '',
        firstTaskTomorrow: '',
      });
      setProjects([]);
      setUpcoming([]);
      setNotes([]);
      setFollowUpTasks([]);
      return;
    }

    let cancelled = false;

    const loadDashboard = async () => {
      const isInitialLoad = !hasLoadedDashboardRef.current;

      try {
        if (isInitialLoad) {
          setIsLoadingDashboard(true);
          setDashboardError(null);
        }

        const [dailyData, todayData, projectData, upcomingData, noteData, taskData] =
          await Promise.allSettled([
            api.getDailyAccountability(),
            api.getToday(),
            api.getProjects(),
            api.getUpcomingEvents(),
            api.getNotes(),
            api.getTasks(),
          ]);

        if (cancelled) return;

        const row =
          dailyData.status === 'fulfilled'
            ? (dailyData.value as {
                focus_items?: Array<{ id: string; text: string; done: boolean }> | null;
                checkin_finished?: string | null;
                checkin_blocked?: string | null;
                checkin_first_task_tomorrow?: string | null;
              } | null)
            : null;

        setDaily({
          focusItems: Array.isArray(row?.focus_items) ? row!.focus_items : [],
          finished: row?.checkin_finished ?? '',
          blocked: row?.checkin_blocked ?? '',
          firstTaskTomorrow: row?.checkin_first_task_tomorrow ?? '',
        });

        const activeToday =
          todayData.status === 'fulfilled' &&
          Array.isArray((todayData.value as { active?: unknown[] } | null)?.active)
            ? (todayData.value as { active: Array<(typeof todayTasks)[number]> }).active
          : [];

        setTodayTasks(activeToday);

        const normalizedNotes =
          noteData.status === 'fulfilled'
            ? Array.isArray(noteData.value)
              ? (noteData.value as Array<{
                  id: string;
                  title: string;
                  content: string;
                  updated_at: string;
                }>)
              : Array.isArray(
                  (
                    noteData.value as {
                      notes?: Array<{
                        id: string;
                        title: string;
                        content: string;
                        updated_at: string;
                      }>;
                    } | null
                  )?.notes
                )
              ? (
                  noteData.value as {
                    notes: Array<{
                      id: string;
                      title: string;
                      content: string;
                      updated_at: string;
                    }>;
                  }
                ).notes
              : []
            : [];

        setProjects(
          projectData.status === 'fulfilled'
            ? (
                (projectData.value ?? []) as Array<{
                  id: string;
                  name: string;
                  status: string;
                  completeness: number;
                }>
              ).slice(0, 4)
            : []
        );
        setUpcoming(
          upcomingData.status === 'fulfilled'
            ? (
                (upcomingData.value ?? []) as Array<{
                  id: string;
                  title: string;
                  start_at: string;
                  end_at: string;
                  color?: string;
                }>
              ).slice(0, 4)
            : []
        );
        setNotes(normalizedNotes.slice(0, 4));
        const rawTasks =
          taskData.status === 'fulfilled' && Array.isArray(taskData.value)
            ? (taskData.value as Array<{
                id: string;
                title: string;
                status?: string | null;
                description?: string | null;
                notes?: string | null;
                updated_at?: string;
              }>)
            : [];
        const calendarFollowUps = rawTasks
          .filter((task) => String(task.description ?? '').startsWith('calendar_followup:'))
          .map((task) => {
            const marker = String(task.description ?? '');
            const eventId = marker.startsWith('calendar_followup:')
              ? marker.slice('calendar_followup:'.length).trim()
              : '';
            const noteText = String(task.notes ?? '');
            const eventTitle = noteText.startsWith('Follow-up from calendar: ')
              ? noteText.slice('Follow-up from calendar: '.length).trim()
              : '';
            return {
              ...task,
              eventId: eventId || null,
              eventTitle: eventTitle || null,
            };
          })
          .sort(
            (left, right) =>
              new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime()
          )
          .slice(0, 8);
        setFollowUpTasks(calendarFollowUps);
        hasLoadedDashboardRef.current = true;
        const failedSections = [
          dailyData.status === 'rejected' ? 'daily check-in' : null,
          todayData.status === 'rejected' ? 'today feed' : null,
          projectData.status === 'rejected' ? 'projects' : null,
          upcomingData.status === 'rejected' ? 'upcoming events' : null,
          noteData.status === 'rejected' ? 'notes' : null,
          taskData.status === 'rejected' ? 'follow-ups' : null,
        ].filter(Boolean);

        if (failedSections.length > 0 && isInitialLoad) {
          setDashboardError(`Some dashboard sections could not load: ${failedSections.join(', ')}.`);
        }
      } catch (error) {
        if (!cancelled) {
          if (isInitialLoad) {
            setDashboardError(error instanceof Error ? error.message : 'Could not load dashboard.');
            setDaily({
              focusItems: [],
              finished: '',
              blocked: '',
              firstTaskTomorrow: '',
            });
            setTodayTasks([]);
            setProjects([]);
            setUpcoming([]);
            setNotes([]);
            setFollowUpTasks([]);
          } else {
            console.error('Background dashboard refresh failed:', error);
          }
        }
      } finally {
        if (!cancelled && isInitialLoad) setIsLoadingDashboard(false);
      }
    };

    void loadDashboard();
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, api, user]);

  useEffect(() => {
    const handleCheckinUpdated = (
      _event: unknown,
      payload: { finished?: string; blocked?: string; firstTaskTomorrow?: string }
    ) => {
      if (!payload) return;
      setDaily((prev) => ({
        ...prev,
        finished: typeof payload.finished === 'string' ? payload.finished : prev.finished,
        blocked: typeof payload.blocked === 'string' ? payload.blocked : prev.blocked,
        firstTaskTomorrow:
          typeof payload.firstTaskTomorrow === 'string'
            ? payload.firstTaskTomorrow
            : prev.firstTaskTomorrow,
      }));
    };

    window.ipcRenderer?.on('daily:checkin-updated', handleCheckinUpdated);
    return () => {
      window.ipcRenderer?.off('daily:checkin-updated', handleCheckinUpdated);
    };
  }, []);

  useEffect(() => {
    if (!initialFocusTaskId) return;
    setFocusedTaskId(initialFocusTaskId);
  }, [initialFocusTaskId]);

  useEffect(() => {
    const onFocusTask = (
      _event: unknown,
      payload: { kind?: string; focusTaskId?: string | null }
    ) => {
      if (payload?.kind !== 'dashboard' || !payload.focusTaskId) return;
      setFocusedTaskId(payload.focusTaskId);
      window.setTimeout(() => {
        followUpsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 30);
    };

    window.ipcRenderer?.on('module:focus-task', onFocusTask);
    return () => {
      window.ipcRenderer?.off('module:focus-task', onFocusTask);
    };
  }, []);

  useEffect(() => {
    if (!dashboardContextMenu) return;
    const close = () => setDashboardContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dashboardContextMenu]);

  const saveDailyAccountability = async (next: {
    focusItems?: Array<{ id: string; text: string; done: boolean }>;
    finished?: string;
    blocked?: string;
    firstTaskTomorrow?: string;
  }) => {
    const response = await api.saveDailyAccountability({
      focus_items: next.focusItems ?? daily.focusItems,
      finished: (next.finished ?? daily.finished).trim(),
      blocked: (next.blocked ?? daily.blocked).trim(),
      first_task_tomorrow: (next.firstTaskTomorrow ?? daily.firstTaskTomorrow).trim(),
    });

    if (!response) {
      throw new Error('Could not save daily accountability.');
    }

    const row = response as {
      focus_items?: Array<{ id: string; text: string; done: boolean }> | null;
      checkin_finished?: string | null;
      checkin_blocked?: string | null;
      checkin_first_task_tomorrow?: string | null;
    };

    setDaily({
      focusItems: Array.isArray(row.focus_items) ? row.focus_items : [],
      finished: row.checkin_finished ?? '',
      blocked: row.checkin_blocked ?? '',
      firstTaskTomorrow: row.checkin_first_task_tomorrow ?? '',
    });
  };

  const focusTasks = todayTasks.filter((task) => task.is_today_focus);
  const activeTodayTasks = todayTasks.filter((task) => !task.is_today_focus);
  const activeProjects = projects.filter((project) =>
    String(project.status).toLowerCase().includes('progress')
  ).length;
  const recentNotes = notes;
  const firstName =
    (user?.user_metadata?.full_name as string | undefined)?.trim()?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'User';
  const todayLabel = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const summaryText = `${focusTasks.length} focus priorit${
    focusTasks.length === 1 ? 'y' : 'ies'
  } · ${activeTodayTasks.length} active task${activeTodayTasks.length === 1 ? '' : 's'} · ${
    upcoming.length
  } upcoming · ${recentNotes.length} recent notes · ${activeProjects} active project${
    activeProjects === 1 ? '' : 's'
  }`;

  const refreshTodayTasks = async () => {
    const data = await api.getToday();
    const active = Array.isArray((data as { active?: unknown[] } | null)?.active)
      ? (
          data as {
            active: Array<{
              id: string;
              title: string;
              status: string;
              due_date?: string | null;
              due_time?: string | null;
              project_id?: string | null;
              project_name?: string | null;
              workspace_id?: string | null;
              workspace_name?: string | null;
              workspace_color?: string | null;
              assigned_to?: string | null;
              is_today_focus?: boolean;
              show_in_today?: boolean;
              completed_at?: string | null;
              created_at?: string | null;
              updated_at?: string | null;
            }>;
          }
        ).active
      : [];
    setTodayTasks(active);
  };

  const createNewFocusTask = async () => {
    const title = focusDraftTitle.trim();
    if (!title || isSavingFocusTask || focusTasks.length >= 3) return;

    setIsSavingFocusTask(true);
    try {
      await api.createTask({
        title,
        status: 'todo',
        show_in_today: true,
        is_today_focus: true,
      });
      setFocusDraftTitle('');
      setIsNewFocusModalOpen(false);
      await refreshTodayTasks();
    } finally {
      setIsSavingFocusTask(false);
    }
  };

  const addTodayTaskToFocus = async (taskId: string) => {
    const task = todayTasks.find((item) => item.id === taskId);
    if (!task || focusTasks.length >= 3) return;

    setFocusActionId(taskId);
    try {
      await api.updateTaskInWorkspace(taskId, task.workspace_id ?? activeWorkspaceId ?? '', {
        is_today_focus: true,
        show_in_today: true,
      });
      await refreshTodayTasks();
    } finally {
      setFocusActionId(null);
    }
  };

  const removeTaskFromFocus = async (taskId: string) => {
    const task = todayTasks.find((item) => item.id === taskId);
    if (!task) return;

    setFocusActionId(taskId);
    try {
      await api.updateTaskInWorkspace(taskId, task.workspace_id ?? activeWorkspaceId ?? '', {
        is_today_focus: false,
      });
      await refreshTodayTasks();
    } finally {
      setFocusActionId(null);
    }
  };

  const toggleFocusDone = async (taskId: string) => {
    const task = todayTasks.find((item) => item.id === taskId);
    if (!task) return;

    setFocusActionId(taskId);
    try {
      await api.updateTaskInWorkspace(taskId, task.workspace_id ?? activeWorkspaceId ?? '', {
        status: 'completed',
      });
      await refreshTodayTasks();
    } finally {
      setFocusActionId(null);
    }
  };

  const openModule = (kind: 'calendar' | 'notes' | 'projects') => {
    void window.desktopWindow?.toggleModule(kind);
  };

  const openContextMenu = (
    event: { preventDefault: () => void; clientX: number; clientY: number },
    menu:
      | { type: 'followup'; taskId: string }
      | { type: 'timeline'; eventId: string }
      | { type: 'project'; projectId: string }
      | { type: 'note'; noteId: string }
      | { type: 'checkin' }
  ) => {
    event.preventDefault();
    setDashboardContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...menu,
    });
  };

  const clearCheckin = async () => {
    const previous = daily;
    setDaily((current) => ({
      ...current,
      finished: '',
      blocked: '',
      firstTaskTomorrow: '',
    }));
    setDashboardContextMenu(null);
    try {
      await saveDailyAccountability({
        finished: '',
        blocked: '',
        firstTaskTomorrow: '',
      });
    } catch {
      setDaily(previous);
    }
  };

  const markFollowUpDone = async (taskId: string) => {
    const target = followUpTasks.find((task) => task.id === taskId);
    if (!target) return;
    const nextStatus = target.status === 'done' ? 'todo' : 'done';
    setFollowUpTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, status: nextStatus } : task))
    );
    setDashboardContextMenu(null);
    try {
      await api.updateTask(taskId, { status: nextStatus });
    } catch {
      setFollowUpTasks((prev) => prev.map((task) => (task.id === taskId ? target : task)));
    }
  };

  const deleteFollowUp = async (taskId: string) => {
    const previous = followUpTasks;
    setFollowUpTasks((prev) => prev.filter((task) => task.id !== taskId));
    setDashboardContextMenu(null);
    try {
      await api.deleteTask(taskId);
    } catch {
      setFollowUpTasks(previous);
    }
  };

  const openFollowUpEvent = (taskId: string) => {
    const target = followUpTasks.find((task) => task.id === taskId);
    if (!target) return;
    void window.desktopWindow?.toggleModule(
      'calendar',
      target.eventId
        ? {
            kind: 'calendar',
            focusContext: `focus-event:${target.eventId}`,
          }
        : {
            kind: 'calendar',
          }
    );
    setDashboardContextMenu(null);
  };

  const updateProjectStatus = async (
    projectId: string,
    status: 'not_started' | 'in_progress' | 'paused' | 'completed'
  ) => {
    const previous = projects;
    setProjects((prev) =>
      prev.map((project) => (project.id === projectId ? { ...project, status } : project))
    );
    setDashboardContextMenu(null);
    try {
      await api.updateProject(projectId, { status });
    } catch {
      setProjects(previous);
    }
  };

  const deleteDashboardProject = async (projectId: string) => {
    const previous = projects;
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    setDashboardContextMenu(null);
    try {
      await api.deleteProject(projectId);
    } catch {
      setProjects(previous);
    }
  };

  const deleteDashboardNote = async (noteId: string) => {
    const previous = notes;
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    setDashboardContextMenu(null);
    try {
      await api.deleteNote(noteId);
    } catch {
      setNotes(previous);
    }
  };

  const deleteTimelineEvent = async (eventId: string) => {
    const previous = upcoming;
    setUpcoming((prev) => prev.filter((item) => item.id !== eventId));
    setExpandedTimelineIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
    setDashboardContextMenu(null);
    try {
      await api.deleteEvent(eventId);
    } catch {
      setUpcoming(previous);
    }
  };

  const getProjectAttentionScore = (project: {
    status: string;
    completeness: number;
    end_date?: string | null;
    updated_at?: string | null;
  }) => {
    const status = String(project.status ?? '').toLowerCase();
    const dueDate = project.end_date ? new Date(project.end_date) : null;
    const now = Date.now();
    const dueDays = dueDate ? Math.ceil((dueDate.getTime() - now) / (1000 * 60 * 60 * 24)) : null;

    let score = 0;
    if (status.includes('pause')) score += 4;
    if (dueDays !== null && dueDays <= 3) score += 3;
    if (dueDays !== null && dueDays < 0) score += 5;
    if (project.completeness >= 70 && project.completeness < 100) score += 2;
    if (status.includes('progress')) score += 1;
    return score;
  };

  const attentionProjects = [...projects]
    .sort((a, b) => getProjectAttentionScore(b as any) - getProjectAttentionScore(a as any))
    .slice(0, 4);

  const attemptCloseDashboard = () => {
    const hasUnsaved = focusDraftTitle.trim().length > 0;
    if (isSavingFocusTask || hasUnsaved) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('dashboard');
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-[#f6f7f9] shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
      style={{ scrollbarGutter: 'stable' }}
    >
      <CloseGuardModal
        isOpen={showCloseGuardModal}
        isSaving={isSavingFocusTask}
        hasUnsavedChanges={focusDraftTitle.trim().length > 0}
        onCancel={() => setShowCloseGuardModal(false)}
        onCloseWithoutSaving={() => {
          setShowCloseGuardModal(false);
          setFocusDraftTitle('');
          setIsNewFocusModalOpen(false);
          void window.desktopWindow?.closeModule('dashboard');
        }}
        onRetrySaveAndClose={() => {
          void (async () => {
            if (isSavingFocusTask) return;
            if (focusDraftTitle.trim()) {
              await createNewFocusTask();
            }
            setShowCloseGuardModal(false);
            void window.desktopWindow?.closeModule('dashboard');
          })();
        }}
      />
      <ModuleWindowHeader
        eyebrow="Workspace"
        title={activeWorkspace?.name ?? 'My Work'}
        subtitle={
          activeWorkspace
            ? activeWorkspace.is_personal
              ? 'Personal workspace'
              : activeWorkspace.role
            : 'Dashboard overview'
        }
        icon={<img src="./logo-color.svg" alt="" className="h-5 w-5" />}
        closeLabel="Close dashboard"
        minimizeLabel="Minimize dashboard"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('dashboard');
        }}
        fullscreenLabel="Fullscreen dashboard"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('dashboard');
        }}
        onClose={attemptCloseDashboard}
        actions={
          <>
            <button
              onClick={() => window.desktopWindow?.toggleModule('calendar')}
              className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
            >
              <CalendarDays size={15} />
              Calendar
            </button>
            <button
              onClick={() => window.desktopWindow?.toggleModule('projects')}
              className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
            >
              <Folder size={15} />
              Projects
            </button>
            <button
              onClick={() => window.desktopWindow?.toggleModule('notes')}
              className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
            >
              <StickyNote size={15} />
              Notes
            </button>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto p-8" style={{ scrollbarGutter: 'stable' }}>
        <div className="mx-auto max-w-7xl space-y-5">
          <div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Today
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950">
                Good to see you, {firstName}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
                What needs your attention today?
              </p>
              <p className="mt-1 text-sm text-gray-500">{todayLabel}</p>
            </div>
          </div>

          {!isLoadingDashboard && (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
              <span className="font-medium text-gray-900">Today</span>
              <span className="ml-2 text-gray-600">{summaryText}</span>
            </div>
          )}

          {dashboardError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {dashboardError}
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="space-y-6">
              <section
                ref={todayTasksRef}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Focus
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">Focus</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Choose up to three priorities that matter today.
                    </p>
                  </div>
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600">
                    {focusTasks.length}/3
                  </span>
                </div>

                {isLoadingDashboard ? (
                  <div className="mt-5 space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonTaskItem key={i} />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setIsFocusPickerOpen(true)}
                        disabled={focusTasks.length >= 3 || activeTodayTasks.length === 0}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + Add from Today
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsNewFocusModalOpen(true)}
                        disabled={focusTasks.length >= 3}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + New focus
                      </button>
                    </div>

                    <div className="mt-5 space-y-3">
                      {focusTasks.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4">
                          <p className="text-sm font-medium text-gray-800">No focus set yet.</p>
                          <p className="mt-1 text-sm text-gray-500">
                            Choose from Today or create a new focus item.
                          </p>
                        </div>
                      ) : (
                        focusTasks.map((task, index) => (
                          <div
                            key={task.id}
                            className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-semibold text-gray-700">
                                {index + 1}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="text-sm font-medium text-gray-950">{task.title}</p>
                                <p className="text-xs text-gray-500">
                                  {task.project_name || task.workspace_name || 'Workspace task'}
                                  {task.due_date ? ` · Due ${task.due_date}` : ''}
                                  {task.due_time ? ` · ${task.due_time}` : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void toggleFocusDone(task.id)}
                                  disabled={focusActionId === task.id}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                                  title="Mark complete"
                                >
                                  <CheckCircle2 size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeTaskFromFocus(task.id)}
                                  disabled={focusActionId === task.id}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 hover:text-red-600 disabled:opacity-50"
                                  title="Remove from focus"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </section>

              <section
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                onContextMenu={(event) => openContextMenu(event, { type: 'checkin' })}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Capture
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    {
                      label: 'Task',
                      icon: CheckCircle2,
                      action: () => window.desktopWindow?.toggleModule('quick-task' as any),
                    },
                    {
                      label: 'Note',
                      icon: StickyNote,
                      action: () => window.desktopWindow?.toggleModule('quick-note' as any),
                    },
                    {
                      label: 'Event',
                      icon: CalendarDays,
                      action: () => window.desktopWindow?.toggleModule('quick-event' as any),
                    },
                    {
                      label: 'Project',
                      icon: Folder,
                      action: () =>
                        window.desktopWindow?.toggleModule('projects', {
                          kind: 'projects',
                          focusProjectId: '__new__',
                        }),
                    },
                  ].map(({ label, icon: Icon, action }) => (
                    <button
                      key={label}
                      onClick={() => void action()}
                      className="flex h-20 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 transition hover:border-gray-300 hover:bg-white"
                    >
                      <Icon size={16} className="text-gray-500" />
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Review
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">Daily check-in</h3>
                  </div>
                  <button
                    onClick={() => {
                      void window.desktopWindow?.openCheckin();
                      setState('expanded');
                    }}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Open check-in
                  </button>
                </div>
                <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-gray-50">
                  {[
                    { label: 'Finished', value: daily.finished || 'Nothing yet' },
                    { label: 'Blocked', value: daily.blocked || 'No blockers' },
                    {
                      label: 'First task tomorrow',
                      value: daily.firstTaskTomorrow || 'Not set yet',
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start justify-between gap-4 px-4 py-3"
                    >
                      <p className="shrink-0 text-sm text-gray-500">{item.label}</p>
                      <p className="text-right text-sm font-medium leading-6 text-gray-900">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Recent
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">Notes</h3>
                  </div>
                  <button
                    onClick={() => openModule('notes')}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Open notes
                  </button>
                </div>

                <div className="mt-4 divide-y divide-gray-100">
                  {isLoadingDashboard ? (
                    Array.from({ length: 2 }).map((_, i) => <SkeletonNoteCard key={i} />)
                  ) : recentNotes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                      <p className="text-sm font-medium text-gray-800">No notes yet.</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Capture a thought, meeting note, or plan from the sidebar.
                      </p>
                    </div>
                  ) : (
                    recentNotes.map((note) => (
                      <button
                        key={note.id}
                        onContextMenu={(event) =>
                          openContextMenu(event, { type: 'note', noteId: note.id })
                        }
                        onClick={() => openModule('notes')}
                        className="w-full rounded-lg px-2 py-3 text-left transition hover:bg-gray-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {note.title}
                            </p>
                            <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                              {htmlToPlainText(note.content) || 'No content yet'}
                            </p>
                            {expandedNoteIds.has(note.id) && (
                              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap wrap-break-word">
                                {htmlToPlainText(note.content) || 'No content yet'}
                              </p>
                            )}
                          </div>
                          <p className="shrink-0 text-[11px] text-gray-500">
                            {new Date(note.updated_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section
                ref={followUpsRef}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Follow-ups
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">From Calendar</h3>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {followUpTasks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                      <p className="text-sm font-medium text-gray-800">No follow-up tasks yet.</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Create one from Calendar event context.
                      </p>
                    </div>
                  ) : (
                    followUpTasks.map((task) => {
                      const isFocused = focusedTaskId === task.id;
                      const statusLabel = task.status === 'done' ? 'Done' : 'Todo';
                      return (
                        <button
                          key={task.id}
                          onContextMenu={(event) =>
                            openContextMenu(event, { type: 'followup', taskId: task.id })
                          }
                          onClick={() =>
                            void window.desktopWindow?.toggleModule(
                              'calendar',
                              task.eventId
                                ? {
                                    kind: 'calendar',
                                    focusContext: `focus-event:${task.eventId}`,
                                  }
                                : {
                                    kind: 'calendar',
                                  }
                            )
                          }
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            isFocused
                              ? 'border-orange-200 bg-orange-50 ring-1 ring-orange-200'
                              : 'border-gray-200 bg-gray-50 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-medium text-gray-900">
                              {task.title}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-xs text-gray-500">{statusLabel}</span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void markFollowUpDone(task.id);
                                }}
                                className="rounded px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-white hover:text-gray-900"
                              >
                                {task.status === 'done' ? 'Undo' : 'Done'}
                              </button>
                            </div>
                          </div>
                          {task.eventTitle && (
                            <p className="mt-1 truncate text-xs text-gray-500">
                              Event: {task.eventTitle}
                            </p>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Upcoming
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">Timeline</h3>
                  </div>
                  <button
                    onClick={() => openModule('calendar')}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Open calendar
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {isLoadingDashboard ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonNoteCard key={i} />)
                  ) : upcoming.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                      <p className="text-sm font-medium text-gray-800">No upcoming events today.</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Add events or reminders to build your timeline.
                      </p>
                    </div>
                  ) : (
                    upcoming.map((item) => {
                      const start = new Date(item.start_at);
                      const isExpanded = expandedTimelineIds.has(item.id);
                      const timeLabel = start.toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                      const dayLabel =
                        start.toDateString() === new Date().toDateString()
                          ? 'Today'
                          : start.toLocaleDateString([], { month: 'short', day: 'numeric' });
                      return (
                        <button
                          key={item.id}
                          onContextMenu={(event) =>
                            openContextMenu(event, { type: 'timeline', eventId: item.id })
                          }
                          onClick={() => openModule('calendar')}
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p
                              className={`${
                                isExpanded ? '' : 'truncate'
                              } text-sm font-medium text-gray-900`}
                            >
                              {item.title}
                            </p>
                            <p className="shrink-0 text-xs text-gray-500">{dayLabel}</p>
                          </div>
                          <p className="mt-1 text-xs text-gray-600">{timeLabel}</p>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Projects
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">Needs attention</h3>
                  </div>
                  <button
                    onClick={() => openModule('projects')}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Open projects
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {isLoadingDashboard ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonProjectCard key={i} />)
                  ) : attentionProjects.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                      <p className="text-sm font-medium text-gray-800">
                        No projects need attention.
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        Your active projects are on track.
                      </p>
                    </div>
                  ) : (
                    attentionProjects.map((project) => {
                      const status = String(project.status).toLowerCase();
                      const label = status.includes('complete')
                        ? 'Completed'
                        : status.includes('progress')
                        ? 'In progress'
                        : status.includes('pause')
                        ? 'Paused'
                        : 'Not started';
                      const due = (project as { end_date?: string | null }).end_date;
                      const dueLabel = due
                        ? `Due ${new Date(due).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}`
                        : 'No due date';

                      return (
                        <button
                          key={project.id}
                          onContextMenu={(event) =>
                            openContextMenu(event, { type: 'project', projectId: project.id })
                          }
                          onClick={() => openModule('projects')}
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white"
                        >
                          <p className="truncate text-sm font-medium text-gray-900">
                            {project.name}
                          </p>
                          <p className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                            <Circle size={8} className="fill-current text-[#FF5F40]" />
                            <span>{label}</span>
                            <span>·</span>
                            <span>{Math.max(0, Math.min(100, project.completeness))}%</span>
                          </p>
                          <p className="mt-1 text-xs text-gray-500">{dueLabel}</p>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
      {isFocusPickerOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-150 flex items-center justify-center bg-black/35 px-4 py-8"
            onClick={() => setIsFocusPickerOpen(false)}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-gray-100 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Add from Today
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Pick up to three priorities from today&apos;s queue.
                </p>
              </div>
              <div className="max-h-[60vh] overflow-auto p-4 space-y-2">
                {activeTodayTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-800">
                      No Today items to choose from.
                    </p>
                  </div>
                ) : (
                  activeTodayTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => void addTodayTaskToFocus(task.id)}
                      disabled={focusTasks.length >= 3 || focusActionId === task.id}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-950">{task.title}</p>
                          <p className="mt-1 truncate text-xs text-gray-500">
                            {task.project_name || task.workspace_name || 'Workspace task'}
                            {task.due_date ? ` · Due ${task.due_date}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600">
                          Add
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center justify-end border-t border-gray-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setIsFocusPickerOpen(false)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      {isNewFocusModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-150 flex items-center justify-center bg-black/35 px-4 py-8"
            onClick={() => {
              setIsNewFocusModalOpen(false);
              setFocusDraftTitle('');
            }}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-gray-100 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  New focus
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Create a new priority and keep it in Today.
                </p>
              </div>
              <div className="space-y-3 p-5">
                <input
                  value={focusDraftTitle}
                  onChange={(event) => setFocusDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void createNewFocusTask();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setIsNewFocusModalOpen(false);
                      setFocusDraftTitle('');
                    }
                  }}
                  placeholder="e.g. Submit posters for critique file"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-300"
                />
                <p className="text-xs text-gray-500">
                  This creates a Today task and marks it as a focus priority.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewFocusModalOpen(false);
                    setFocusDraftTitle('');
                  }}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void createNewFocusTask()}
                  disabled={!focusDraftTitle.trim() || isSavingFocusTask || focusTasks.length >= 3}
                  className="rounded-full bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  Add focus
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      {dashboardContextMenu &&
        createPortal(
          <div
            className="fixed z-140 min-w-46.5 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            style={{
              left: `${Math.max(8, Math.min(dashboardContextMenu.x, window.innerWidth - 200))}px`,
              top: `${Math.max(8, Math.min(dashboardContextMenu.y, window.innerHeight - 240))}px`,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {dashboardContextMenu.type === 'followup' && (
              <>
                <button
                  onClick={() => openFollowUpEvent(dashboardContextMenu.taskId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]"
                >
                  <CalendarDays size={14} />
                  Jump to event
                </button>
                <button
                  onClick={() => void markFollowUpDone(dashboardContextMenu.taskId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <CheckCircle2 size={14} />
                  Mark as done
                </button>
                <button
                  onClick={() => void deleteFollowUp(dashboardContextMenu.taskId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  Delete follow-up
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'timeline' && (
              <>
                {expandedTimelineIds.has(dashboardContextMenu.eventId) ? (
                  <button
                    onClick={() => {
                      setExpandedTimelineIds((prev) => {
                        const next = new Set(prev);
                        next.delete(dashboardContextMenu.eventId);
                        return next;
                      });
                      setDashboardContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ChevronUp size={14} />
                    Collapse
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setExpandedTimelineIds((prev) =>
                        new Set(prev).add(dashboardContextMenu.eventId)
                      );
                      setDashboardContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ChevronDown size={14} />
                    Expand
                  </button>
                )}
                <button
                  onClick={() => {
                    const event = upcoming.find((item) => item.id === dashboardContextMenu.eventId);
                    if (!event) return;
                    void window.desktopWindow?.toggleModule('calendar', {
                      kind: 'calendar',
                      focusContext: `focus-event:${event.id}`,
                    });
                    setDashboardContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]"
                >
                  <CalendarDays size={14} />
                  Open in Calendar
                </button>
                <button
                  onClick={() => void deleteTimelineEvent(dashboardContextMenu.eventId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  Delete Event
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'project' && (
              <>
                <button
                  onClick={() => {
                    void window.desktopWindow?.toggleModule('projects', {
                      kind: 'projects',
                      focusProjectId: dashboardContextMenu.projectId,
                    });
                    setDashboardContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]"
                >
                  <Folder size={14} />
                  Navigate to project
                </button>
                <button
                  onClick={() =>
                    void updateProjectStatus(dashboardContextMenu.projectId, 'in_progress')
                  }
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <MoreHorizontal size={14} />
                  Mark in progress
                </button>
                <button
                  onClick={() => void updateProjectStatus(dashboardContextMenu.projectId, 'paused')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <MoreHorizontal size={14} />
                  Mark paused
                </button>
                <button
                  onClick={() =>
                    void updateProjectStatus(dashboardContextMenu.projectId, 'completed')
                  }
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <CheckCircle2 size={14} />
                  Mark completed
                </button>
                <button
                  onClick={() => void deleteDashboardProject(dashboardContextMenu.projectId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  Delete project
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'note' && (
              <>
                {expandedNoteIds.has(dashboardContextMenu.noteId) ? (
                  <button
                    onClick={() => {
                      setExpandedNoteIds((prev) => {
                        const next = new Set(prev);
                        next.delete(dashboardContextMenu.noteId);
                        return next;
                      });
                      setDashboardContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ChevronUp size={14} />
                    Collapse
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setExpandedNoteIds((prev) => new Set(prev).add(dashboardContextMenu.noteId));
                      setDashboardContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ChevronDown size={14} />
                    Expand
                  </button>
                )}
                <button
                  onClick={() => {
                    void window.desktopWindow?.toggleModule('notes', {
                      kind: 'notes',
                      focusNoteId: dashboardContextMenu.noteId,
                    });
                    setDashboardContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]"
                >
                  <StickyNote size={14} />
                  Navigate to note
                </button>
                <button
                  onClick={() => void deleteDashboardNote(dashboardContextMenu.noteId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  Delete note
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'checkin' && (
              <button
                onClick={() => void clearCheckin()}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Clear check-in
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

// Main app component
function AppShell() {
  const { user, isLoading, error: authError } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId, refreshWorkspaces } = useWorkspaceContext();
  const api = useApi();
  const {
    state,
    setState,
    isExpanded,
    setIsExpanded,
    isVisible,
    setIsVisible,
    sidebarPreferences,
    collapseSidebar,
    collapseToRail,
  } = useSidebar();
  const { openSearch } = useSearch();
  const [uiMode, setUiMode] = useState<'auth' | 'app'>(user ? 'app' : 'auth');
  const [isAuthExiting, setIsAuthExiting] = useState(false);
  const [postAuthStage, setPostAuthStage] = useState<PostAuthStage>('idle');
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() =>
    getInviteTokenFromLocation()
  );
  const [inviteFlowStatus, setInviteFlowStatus] = useState<
    'idle' | 'checking' | 'awaiting-auth' | 'processing' | 'accepted' | 'already-member' | 'error'
  >('idle');
  const [inviteFlowError, setInviteFlowError] = useState<string | null>(null);
  const [inviteFlowNotice, setInviteFlowNotice] = useState<string | null>(null);
  const [inviteWorkspaceName, setInviteWorkspaceName] = useState<string | null>(null);
  const [onboardingWorkspaceName, setOnboardingWorkspaceName] = useState('');
  const [onboardingInviteValue, setOnboardingInviteValue] = useState('');
  const [isJoiningWorkspace, setIsJoiningWorkspace] = useState(false);
  const [onboardingInviteError, setOnboardingInviteError] = useState<string | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const handledInviteTokenRef = useRef<string | null>(null);
  const postAuthBootstrapUserRef = useRef<string | null>(null);
  const ensuredVisibleOnBootRef = useRef(false);

  // Initialize workspace for authenticated users
  useWorkspaceInit();
  const effectiveUiMode: 'auth' | 'app' = user ? 'app' : uiMode;

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      if (!user || isLoading) return;

      if (state !== 'expanded') {
        setState('expanded');
        window.setTimeout(() => {
          openSearch();
        }, 220);
        return;
      }

      openSearch();
    };

    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [isLoading, openSearch, setState, state, user]);

  useEffect(() => {
    const handleSidebarExpandShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() !== 'e') return;

      event.preventDefault();
      if (!user || isLoading || !isVisible) return;

      if (state === 'expanded') {
        collapseToRail();
        return;
      }

      setState('expanded');
      setIsExpanded(true);
    };

    const handleSidebarCollapseShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() !== 'c') return;

      event.preventDefault();
      if (!user || isLoading || !isVisible) return;

      if (state === 'expanded') {
        collapseToRail();
        return;
      }

      if (!isExpanded) {
        setIsExpanded(true);
      } else {
        collapseSidebar();
      }
    };

    window.addEventListener('keydown', handleSidebarExpandShortcut);
    window.addEventListener('keydown', handleSidebarCollapseShortcut);
    return () => {
      window.removeEventListener('keydown', handleSidebarExpandShortcut);
      window.removeEventListener('keydown', handleSidebarCollapseShortcut);
    };
  }, [isExpanded, isLoading, isVisible, setIsExpanded, setState, state, user]);

  useEffect(() => {
    const handleModuleNavigation = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey) return;
      if (!user || isLoading) return;

      const key = event.key.toLowerCase();

      // Module navigation: Cmd+1 to Cmd+5
      if (key === '1') {
        event.preventDefault();
        void window.desktopWindow?.toggleModule('dashboard');
        return;
      }

      if (key === '2') {
        event.preventDefault();
        void window.desktopWindow?.toggleModule('calendar');
        return;
      }

      if (key === '3') {
        event.preventDefault();
        void window.desktopWindow?.toggleModule('notes');
        return;
      }

      if (key === '4') {
        event.preventDefault();
        void window.desktopWindow?.toggleModule('projects');
        return;
      }

      if (key === '5') {
        event.preventDefault();
        void window.desktopWindow?.toggleModule('settings');
        return;
      }
    };

    window.addEventListener('keydown', handleModuleNavigation);
    return () => {
      window.removeEventListener('keydown', handleModuleNavigation);
    };
  }, [isLoading, user]);

  useEffect(() => {
    const handleSidebarVisibilityChanged = (_event: unknown, payload: { isVisible?: boolean }) => {
      if (typeof payload?.isVisible !== 'boolean') return;
      setIsVisible(payload.isVisible);
    };

    window.ipcRenderer?.on('sidebar:visibility-changed', handleSidebarVisibilityChanged);
    return () => {
      window.ipcRenderer?.off('sidebar:visibility-changed', handleSidebarVisibilityChanged);
    };
  }, [setIsVisible]);

  useEffect(() => {
    const handleOpenCheckin = () => {
      setIsVisible(true);
      setIsExpanded(true);
      setState('expanded');
    };

    window.ipcRenderer?.on('sidebar:open-checkin', handleOpenCheckin);
    return () => {
      window.ipcRenderer?.off('sidebar:open-checkin', handleOpenCheckin);
    };
  }, [setIsExpanded, setIsVisible, setState]);

  useEffect(() => {
    const handleTouchBarOpenSearch = () => {
      if (!user || isLoading) return;

      if (state !== 'expanded') {
        setState('expanded');
        window.setTimeout(() => {
          openSearch();
        }, 220);
        return;
      }

      openSearch();
    };

    window.ipcRenderer?.on('touchbar:open-search', handleTouchBarOpenSearch);
    return () => {
      window.ipcRenderer?.off('touchbar:open-search', handleTouchBarOpenSearch);
    };
  }, [isLoading, openSearch, setState, state, user]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;
    window.desktopWindow?.setVisible(isVisible).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [isLoading, isVisible]);

  useEffect(() => {
    if (isLoading) return;
    if (uiMode !== 'auth') return;
    if (isVisible) return;

    setIsVisible(true);
  }, [isLoading, isVisible, setIsVisible, uiMode]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;
    if (!user) {
      ensuredVisibleOnBootRef.current = false;
      return;
    }
    if (effectiveUiMode !== 'app') return;
    if (postAuthStage !== 'ready') return;
    if (ensuredVisibleOnBootRef.current) return;

    ensuredVisibleOnBootRef.current = true;
    if (!isVisible) {
      setIsVisible(true);
    }
  }, [effectiveUiMode, isLoading, isVisible, postAuthStage, setIsVisible, user]);

  if (isModuleWindow) {
    if (isLoading) {
      return (
        <AuthStatusScreen title="Loading module" subtitle="Bringing your workspace into view." />
      );
    }

    if (!user) {
      return (
        <AuthStatusScreen
          title="Sign in required"
          subtitle="Please sign in from the Ledger sidebar window first."
        />
      );
    }

    if (moduleKind === 'calendar') {
      return <CalendarWindow />;
    }

    if (moduleKind === 'notes') {
      return <NotesWindow />;
    }

    if (moduleKind === 'projects') {
      return <ProjectsWindow />;
    }

    if (moduleKind === 'dashboard') {
      return <DashboardContent initialFocusTaskId={moduleFocusTaskId || undefined} />;
    }

    if (moduleKind === 'settings') {
      return <SettingsWindow />;
    }

    if (
      moduleKind === 'quick-task' ||
      moduleKind === 'quick-note' ||
      moduleKind === 'quick-event'
    ) {
      return <QuickCaptureWindow kind={moduleKind} context={moduleFocusContext || undefined} />;
    }

    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-sm text-gray-600">Unknown module</p>
      </div>
    );
  }

  useEffect(() => {
    if (user && uiMode !== 'app') {
      setUiMode('app');
      setIsAuthExiting(false);
      return;
    }

    if (!user && !isLoading && uiMode !== 'auth') {
      setUiMode('auth');
      setIsAuthExiting(false);
      setPostAuthStage('idle');
    }
  }, [user, isLoading, uiMode]);

  useEffect(() => {
    if (!pendingInviteToken) {
      setInviteFlowStatus((current) => (current === 'error' ? current : 'idle'));
      return;
    }

    let cancelled = false;

    const loadInvite = async () => {
      try {
        setInviteFlowStatus('checking');
        setInviteFlowError(null);

        const payload = (await api.getWorkspaceInvitation(pendingInviteToken)) as {
          invitation?: { workspace_name?: string | null };
        };

        if (cancelled) return;
        setInviteWorkspaceName(payload.invitation?.workspace_name ?? 'Workspace');
        setInviteFlowStatus(user ? 'idle' : 'awaiting-auth');
      } catch (error) {
        if (cancelled) return;
        setInviteFlowStatus('error');
        setInviteFlowError(error instanceof Error ? error.message : 'Invalid invitation.');
      }
    };

    void loadInvite();

    return () => {
      cancelled = true;
    };
    // Validate the invite once per token. Re-checking after auth can race the accept call.
  }, [pendingInviteToken, api]);

  useEffect(() => {
    if (!pendingInviteToken) {
      setInviteFlowStatus((current) => (current === 'error' ? current : 'idle'));
      return;
    }

    if (isLoading) return;

    if (!user) {
      if (inviteFlowStatus !== 'error') {
        setInviteFlowStatus('awaiting-auth');
      }
      return;
    }

    if (inviteFlowStatus === 'checking' || inviteFlowStatus === 'error') return;

    if (handledInviteTokenRef.current === pendingInviteToken) {
      return;
    }

    handledInviteTokenRef.current = pendingInviteToken;

    let cancelled = false;

    const acceptInvitation = async () => {
      try {
        setInviteFlowStatus('processing');
        setInviteFlowError(null);

        const payload = (await api.acceptWorkspaceInvitation(pendingInviteToken)) as {
          already_member?: boolean;
        };
        await api.completeOnboarding();
        await refreshWorkspaces();

        if (cancelled) return;
        setPostAuthStage('ready');
        setInviteFlowStatus(payload.already_member ? 'already-member' : 'accepted');
        setInviteFlowNotice(
          payload.already_member
            ? "You're already a member. Switched to that workspace."
            : 'Workspace invite accepted.'
        );
      } catch (error) {
        if (cancelled) return;
        setInviteFlowStatus('error');
        setInviteFlowError(error instanceof Error ? error.message : 'Could not accept invitation.');
      } finally {
        if (cancelled) return;

        window.history.replaceState({}, '', '/');
        setPendingInviteToken(null);
      }
    };

    void acceptInvitation();

    return () => {
      cancelled = true;
    };
  }, [pendingInviteToken, isLoading, user, api, refreshWorkspaces, inviteFlowStatus]);

  useEffect(() => {
    if (postAuthStage !== 'onboarding') return;
    if (onboardingWorkspaceName.trim()) return;
    const suggested = activeWorkspace?.name?.trim() || 'My Workspace';
    setOnboardingWorkspaceName(suggested);
  }, [activeWorkspace?.name, onboardingWorkspaceName, postAuthStage]);

  useEffect(() => {
    const userId = user?.id ?? null;

    if (!userId) {
      postAuthBootstrapUserRef.current = null;
      return;
    }

    if (isLoading || effectiveUiMode !== 'app') return;

    if (postAuthBootstrapUserRef.current === userId) return;

    let isCancelled = false;
    postAuthBootstrapUserRef.current = userId;
    setPostAuthStage('loading');

    const loadPostAuthStage = async () => {
      try {
        const data = await api.getOnboardingStatus();

        if (isCancelled) return;

        const onboardingCompleted = Boolean(
          (data as { onboarding_completed?: boolean } | null)?.onboarding_completed
        );
        setPostAuthStage(onboardingCompleted ? 'ready' : 'onboarding');
      } catch (error) {
        if (isCancelled) return;
        console.warn('Unexpected onboarding state error:', error);
        setPostAuthStage('ready');
      }
    };

    loadPostAuthStage();

    const fallbackTimer = window.setTimeout(() => {
      if (isCancelled) return;
      setPostAuthStage((current) => (current === 'loading' ? 'ready' : current));
    }, 2500);

    return () => {
      isCancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [effectiveUiMode, isLoading, user?.id]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;
    const { opacity: _opacity, ...restPreferences } = sidebarPreferences;
    void window.desktopWindow?.applySidebarPreferences(restPreferences).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [
    isLoading,
    sidebarPreferences.position,
    sidebarPreferences.blur,
    sidebarPreferences.defaultState,
    sidebarPreferences.alwaysOnTop,
    sidebarPreferences.autoHide,
    sidebarPreferences.isExpanded,
    sidebarPreferences.collapsedRestoreIsExpanded,
    sidebarPreferences.collapsedRestoreView,
    sidebarPreferences.isHidden,
    sidebarPreferences.floatingPosition.x,
    sidebarPreferences.floatingPosition.y,
    sidebarPreferences.floatingDockEnabled,
    sidebarPreferences.floatingDockThreshold,
    sidebarPreferences.lastState,
  ]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;
    void window.desktopWindow
      ?.applySidebarPreferences({ opacity: sidebarPreferences.opacity })
      .catch(() => {
        // No-op outside Electron (browser dev mode)
      });
  }, [isLoading, sidebarPreferences.opacity]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;

    const isCenteredFlow =
      effectiveUiMode === 'auth' ||
      postAuthStage === 'idle' ||
      postAuthStage === 'loading' ||
      postAuthStage === 'onboarding';

    const mode = isCenteredFlow
      ? 'auth'
      : state === 'expanded'
      ? 'expanded'
      : isExpanded
      ? 'minimized'
      : 'compact';
    window.desktopWindow?.setMode(mode).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [isExpanded, isLoading, state, effectiveUiMode, postAuthStage]);

  if (isLoading) {
    return <AuthStatusScreen title="Loading" subtitle="Preparing Ledger." />;
  }

  if (authError) {
    return <AuthStatusScreen title="Configuration issue" subtitle={authError.message} />;
  }

  if (inviteFlowStatus === 'checking') {
    return (
      <AuthStatusScreen title="Checking invitation" subtitle="Validating this workspace invite." />
    );
  }

  if (inviteFlowStatus === 'error' && pendingInviteToken && inviteFlowError) {
    return <AuthStatusScreen title="Invite unavailable" subtitle={inviteFlowError} />;
  }

  if (inviteFlowStatus === 'processing') {
    return (
      <AuthStatusScreen
        title="Accepting invitation"
        subtitle="Joining your workspace and syncing access."
      />
    );
  }

  // Show login if not authenticated
  if (!user) {
    return (
      <div
        className="relative flex h-screen items-center justify-center bg-transparent p-3"
        style={dragRegionStyle}
      >
        <div className="absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
        <button
          type="button"
          onClick={() => {
            void window.desktopWindow?.quitApp();
          }}
          aria-label="Close"
          className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900"
          style={noDragRegionStyle}
        >
          <X size={16} />
        </button>
        <div
          className={`relative z-10 transform transition-all duration-250 ease-out ${
            isAuthExiting
              ? 'opacity-0 scale-95 translate-y-2'
              : 'opacity-100 scale-100 translate-y-0'
          }`}
          style={noDragRegionStyle}
        >
          <LoginForm
            notice={
              pendingInviteToken
                ? `Sign in to accept your ${inviteWorkspaceName ?? 'workspace'} invitation.`
                : null
            }
          />
        </div>
      </div>
    );
  }

  if (postAuthStage === 'idle' || postAuthStage === 'loading') {
    return (
      <AuthStatusScreen
        title="Preparing your workspace"
        subtitle="Loading your account and workspace context."
      />
    );
  }

  if (postAuthStage === 'onboarding') {
    const workspaceName = onboardingWorkspaceName.trim();
    return (
      <div
        className="relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900"
        style={dragRegionStyle}
      >
        <div className="absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
        <button
          type="button"
          onClick={() => {
            void window.desktopWindow?.quitApp();
          }}
          aria-label="Close"
          className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900"
          style={noDragRegionStyle}
        >
          <X size={16} />
        </button>
        <div
          className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8"
          style={noDragRegionStyle}
        >
          <div className="w-full max-w-97.5">
            <div className="mb-7 text-center">
              <img src="./logo-color.svg" alt="Ledger" className="mx-auto mb-4 h-12 w-12" />
              <h2 className="text-[28px] font-semibold leading-tight text-gray-950">
                Welcome to Ledger
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Join a workspace with an invite, or create your own first workspace.
              </p>
            </div>
            <div className="mb-7 space-y-3.5">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-gray-950">Join workspace</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Paste an invite code or the full invite link you received.
                  </p>
                </div>
                <div className="space-y-2.5">
                  <label className="block text-left">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                      Invite code or link
                    </span>
                    <input
                      value={onboardingInviteValue}
                      onChange={(event) => {
                        setOnboardingInviteValue(event.target.value);
                        if (onboardingInviteError) {
                          setOnboardingInviteError(null);
                        }
                      }}
                      placeholder="https://ledger.app/invite/..."
                      className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300"
                    />
                  </label>
                  {onboardingInviteError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {onboardingInviteError}
                    </div>
                  ) : null}
                  <button
                    disabled={isJoiningWorkspace}
                    onClick={async () => {
                      if (!user || isJoiningWorkspace) return;

                      const token = getInviteTokenFromInput(onboardingInviteValue);
                      if (!token) {
                        setOnboardingInviteError('Invite code is required.');
                        return;
                      }

                      setIsJoiningWorkspace(true);
                      setOnboardingInviteError(null);
                      setOnboardingError(null);
                      try {
                        const result = (await api.acceptWorkspaceInvitation(token)) as {
                          success?: boolean;
                          already_member?: boolean;
                          workspace_id?: string;
                        };

                        await api.completeOnboarding();
                        await refreshWorkspaces();

                        if (result?.already_member) {
                          setOnboardingInviteError(null);
                        }

                        setPostAuthStage('ready');
                      } catch (error) {
                        setOnboardingInviteError(
                          error instanceof Error ? error.message : 'Could not join workspace.'
                        );
                      } finally {
                        setIsJoiningWorkspace(false);
                      }
                    }}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#111827] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0b1220] disabled:opacity-60"
                  >
                    {isJoiningWorkspace ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Joining...
                      </>
                    ) : (
                      <>
                        Join workspace
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-1">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                  Or create one
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <label className="block text-left">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                  Workspace name
                </span>
                <input
                  value={onboardingWorkspaceName}
                  onChange={(event) => setOnboardingWorkspaceName(event.target.value)}
                  placeholder="My Workspace"
                  className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300"
                />
              </label>
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="text-green-600 mt-0.5" />
                <p className="text-sm text-gray-700">
                  You can also invite teammates later from dashboard settings.
                </p>
              </div>
            </div>
            {onboardingError ? (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {onboardingError}
              </div>
            ) : null}
            <button
              disabled={isSavingOnboarding}
              onClick={async () => {
                if (!user || isSavingOnboarding) return;
                if (!workspaceName) {
                  setOnboardingError('Workspace name is required.');
                  return;
                }
                setIsSavingOnboarding(true);
                setOnboardingError(null);
                try {
                  if (activeWorkspaceId) {
                    await api.updateWorkspace(activeWorkspaceId, { name: workspaceName });
                  }
                  await api.completeOnboarding();
                  await refreshWorkspaces();
                  setPostAuthStage('ready');
                } catch (error) {
                  setOnboardingError(
                    error instanceof Error ? error.message : 'Could not complete onboarding.'
                  );
                } finally {
                  setIsSavingOnboarding(false);
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,64,0.24)] transition-colors hover:bg-[#ea5336] disabled:opacity-60"
            >
              {isSavingOnboarding ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Continue to Ledger
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated view - sidebar shell
  if (postAuthStage !== 'ready') {
    return (
      <AuthStatusScreen
        title="Preparing your workspace"
        subtitle="Loading your account and workspace context."
      />
    );
  }

  return (
    <>
      {inviteFlowNotice && (
        <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {inviteFlowNotice}
        </div>
      )}
      {inviteFlowStatus === 'error' && inviteFlowError && (
        <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {inviteFlowError}
        </div>
      )}
      <MainLayout>
        <div className="flex-1 min-w-0 bg-transparent" />
      </MainLayout>
    </>
  );
}

function App() {
  return (
    <SearchProvider>
      <ToastProvider>
        <AppShell />
        <SearchModal />
      </ToastProvider>
    </SearchProvider>
  );
}

export default App;
