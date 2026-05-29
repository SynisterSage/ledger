import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  Inbox,
  MoreHorizontal,
  Plus,
  Search,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useAuthContext } from '../../context/AuthContext';
import {
  modulePaneSizing,
  clampPaneWidth,
  getPaneWidthForViewport,
} from '../../config/modulePaneSizes';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import {
  ModuleHeaderActionButton,
  ModuleHeaderStatus,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { SkeletonProjectCard, SkeletonTaskItem } from '../Common/Skeleton';
import { useViewportWidth } from '../../hooks/useViewportWidth';

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  completeness: number;
  color: string;
  start_date: string | null;
  end_date: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  status: 'todo' | 'in_progress' | 'completed' | 'cancelled' | string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type ProjectStatusFilter = 'all' | 'active' | 'paused' | 'completed';
type ProjectSemanticStatus = 'not_started' | 'in_progress' | 'paused' | 'completed';
type ProjectContextMenuState = { x: number; y: number; projectId: string };
type TaskContextMenuState = { x: number; y: number; taskId: string };
type LinkedNoteContextMenuState = {
  x: number;
  y: number;
  noteId: string;
  source: 'center' | 'right';
};
type WorkspaceMember = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

type NoteOption = {
  id: string;
  title: string;
  preview: string;
  updated_at?: string | null;
};

type ProjectNoteLink = {
  id: string;
  note_id: string;
  created_at: string;
  note: NoteOption;
};

const LEFT_PANE_MIN_WIDTH = 260;
const LEFT_PANE_MAX_WIDTH = 400;
const RIGHT_PANE_MIN_WIDTH = 260;
const RIGHT_PANE_MAX_WIDTH = 340;
const AUTO_SAVE_DELAY_MS = 900;

const projectStatusLabels: Record<ProjectSemanticStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
};

const projectStatusCandidates: Record<ProjectSemanticStatus, string[]> = {
  not_started: ['NotStarted', 'not_started', 'todo'],
  in_progress: ['InProgress', 'in_progress', 'doing'],
  paused: ['Paused', 'paused', 'archived'],
  completed: ['Completed', 'completed', 'done'],
};

const statusOrder: ProjectStatusFilter[] = ['all', 'active', 'paused', 'completed'];

const taskPriorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const taskPriorityTone: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-amber-50 text-amber-700',
  urgent: 'bg-red-50 text-red-700',
};

const projectColorOptions = [
  '#007AFF',
  '#FF5F40',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EF4444',
  '#0EA5E9',
  '#111827',
];

const normalizeProjectNameKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const todayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseProjectStatus = (status: string): ProjectSemanticStatus => {
  const value = status.toLowerCase();
  if (value.includes('complete') || value.includes('done')) return 'completed';
  if (value.includes('pause') || value.includes('archiv')) return 'paused';
  if (value.includes('progress') || value.includes('doing') || value.includes('in_'))
    return 'in_progress';
  return 'not_started';
};

const formatShortDate = (value: string | null) => {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatRelativeFromNow = (value: string | null | undefined) => {
  if (!value) return 'just now';
  const delta = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (delta < 60) return `${delta}s ago`;
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatSidebarDueDate = (project: ProjectRow, semantic: ProjectSemanticStatus) => {
  const anchorDate = project.end_date || project.start_date || null;
  if (!anchorDate) return 'No due date';
  const label = formatShortDate(anchorDate);
  if (semantic === 'completed') return `Completed ${label}`;
  return `Due ${label}`;
};

const CONTEXT_MENU_GUTTER = 8;

const getClampedMenuPosition = (x: number, y: number, width: number, height: number) => {
  const maxX = Math.max(CONTEXT_MENU_GUTTER, window.innerWidth - width - CONTEXT_MENU_GUTTER);
  const maxY = Math.max(CONTEXT_MENU_GUTTER, window.innerHeight - height - CONTEXT_MENU_GUTTER);
  return {
    x: Math.min(Math.max(x, CONTEXT_MENU_GUTTER), maxX),
    y: Math.min(Math.max(y, CONTEXT_MENU_GUTTER), maxY),
  };
};

const buildProjectUpdate = (draft: ProjectDraft) => ({
  name: draft.name,
  description: draft.description,
  status: draft.status,
  completeness: draft.completeness,
  color: draft.color,
  start_date: draft.startDate || null,
  end_date: draft.endDate || null,
});

type ProjectDraft = {
  name: string;
  description: string;
  status: ProjectSemanticStatus;
  completeness: number;
  color: string;
  startDate: string;
  endDate: string;
};

export const ProjectsWindow = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const api = useApi();
  const viewportWidth = useViewportWidth();
  const initialFocusProjectId = new URLSearchParams(window.location.search).get('focusProjectId');
  const initialFocusHandledRef = useRef(false);
  const initialFocusTaskId = new URLSearchParams(window.location.search).get('focusTaskId');
  const autosaveTimerRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);
  const isCompletenessDraggingRef = useRef(false);
  const projectContextRef = useRef<HTMLDivElement | null>(null);
  const taskContextRef = useRef<HTMLDivElement | null>(null);
  const linkedNoteContextRef = useRef<HTMLDivElement | null>(null);
  const rightPanelMenuRef = useRef<HTMLDivElement | null>(null);
  const createProjectInputRef = useRef<HTMLInputElement | null>(null);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('all');
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.projects.left)
  );
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.projects.right)
  );
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(true);
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(
    null
  );
  const [taskContextMenu, setTaskContextMenu] = useState<TaskContextMenuState | null>(null);
  const [linkedNoteContextMenu, setLinkedNoteContextMenu] =
    useState<LinkedNoteContextMenuState | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProjectNow, setIsCreatingProjectNow] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({
    name: '',
    description: '',
    status: 'not_started',
    completeness: 0,
    color: '#007AFF',
    startDate: '',
    endDate: '',
  });
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    'medium'
  );
  const [newTaskDueDate, setNewTaskDueDate] = useState(todayKey());
  const [newTaskDueTime, setNewTaskDueTime] = useState('');
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isTaskComposerOpen, setIsTaskComposerOpen] = useState(false);
  const [taskNotesTaskId, setTaskNotesTaskId] = useState<string | null>(null);
  const [taskNotesDraft, setTaskNotesDraft] = useState('');
  const [isSavingTaskNotes, setIsSavingTaskNotes] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [linkedNotes, setLinkedNotes] = useState<ProjectNoteLink[]>([]);
  const [isLoadingLinkedNotes, setIsLoadingLinkedNotes] = useState(false);
  const [isLinkNoteModalOpen, setIsLinkNoteModalOpen] = useState(false);
  const [isLinkingNote, setIsLinkingNote] = useState(false);
  const [linkableNotes, setLinkableNotes] = useState<NoteOption[]>([]);
  const [isLoadingLinkableNotes, setIsLoadingLinkableNotes] = useState(false);
  const [linkNotesSearch, setLinkNotesSearch] = useState('');
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed;

  useEffect(() => {
    const onHideSidePanelsShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() !== 'h') return;

      event.preventDefault();
      if (areSidePanelsCollapsed) {
        setIsLeftPaneCollapsed(false);
        setIsRightPaneCollapsed(false);
      } else {
        setIsLeftPaneCollapsed(true);
        setIsRightPaneCollapsed(true);
      }
    };

    window.addEventListener('keydown', onHideSidePanelsShortcut);
    return () => window.removeEventListener('keydown', onHideSidePanelsShortcut);
  }, [areSidePanelsCollapsed]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLowerCase();

    return projects.filter((project) => {
      const semantic = parseProjectStatus(String(project.status));
      const matchesSearch =
        !term ||
        [
          project.name,
          project.description ?? '',
          project.start_date ?? '',
          project.end_date ?? '',
          project.status,
        ]
          .join(' ')
          .toLowerCase()
          .includes(term);

      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return semantic !== 'completed' && semantic !== 'paused';
      return semantic === statusFilter;
    });
  }, [projects, search, statusFilter]);

  const selectedProjectTasks = useMemo(() => {
    return tasks
      .filter((task) => task.project_id === selectedProjectId)
      .sort((a, b) => {
        const aDate = a.due_date ?? '9999-12-31';
        const bDate = b.due_date ?? '9999-12-31';
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return b.created_at.localeCompare(a.created_at);
      });
  }, [selectedProjectId, tasks]);

  const taskCounts = useMemo(() => {
    const active = selectedProjectTasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'cancelled'
    ).length;
    const completed = selectedProjectTasks.filter((task) => task.status === 'completed').length;
    return { active, completed, total: selectedProjectTasks.length };
  }, [selectedProjectTasks]);

  const activeProjectTasks = useMemo(
    () =>
      selectedProjectTasks.filter(
        (task) => task.status !== 'completed' && task.status !== 'cancelled'
      ),
    [selectedProjectTasks]
  );

  const completedProjectTasks = useMemo(
    () => selectedProjectTasks.filter((task) => task.status === 'completed'),
    [selectedProjectTasks]
  );

  const projectDurationDays = useMemo(() => {
    if (!projectDraft.startDate || !projectDraft.endDate) return null;
    const start = new Date(projectDraft.startDate);
    const end = new Date(projectDraft.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const diff = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return diff > 0 ? diff : null;
  }, [projectDraft.endDate, projectDraft.startDate]);

  const recentProjectActivity = useMemo(() => {
    const events: Array<{ id: string; label: string; at: string | null }> = [];
    if (selectedProject?.updated_at) {
      events.push({
        id: 'project-updated',
        label: 'Project updated',
        at: selectedProject.updated_at,
      });
    }
    for (const task of completedProjectTasks.slice(0, 4)) {
      events.push({
        id: `task-${task.id}`,
        label: `Task completed: ${task.title}`,
        at: task.updated_at ?? null,
      });
    }
    return events
      .filter((event) => event.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 5);
  }, [completedProjectTasks, selectedProject?.updated_at]);

  const workspaceMemberById = useMemo(() => {
    return new Map(workspaceMembers.map((member) => [member.user_id, member]));
  }, [workspaceMembers]);

  const createdByMember = useMemo(() => {
    const id = selectedProject?.created_by ?? null;
    if (!id) return null;
    return workspaceMemberById.get(id) ?? null;
  }, [selectedProject?.created_by, workspaceMemberById]);

  const creatorDisplayName = useMemo(() => {
    if (createdByMember)
      return createdByMember.full_name?.trim() || createdByMember.email?.trim() || 'Unknown user';
    return 'Unknown user';
  }, [createdByMember]);

  const projectViewingSummary = useMemo(() => {
    if (!selectedProject?.created_by) return 'Only you';
    if (selectedProject.created_by === user?.id) return 'Only you';

    const firstName = creatorDisplayName.trim().split(/\s+/)[0]?.trim();
    if (!firstName) return 'Only you';
    return firstName;
  }, [creatorDisplayName, selectedProject?.created_by, user?.id]);

  const projectMenuPosition = useMemo(() => {
    if (!projectContextMenu) return null;
    return getClampedMenuPosition(projectContextMenu.x, projectContextMenu.y, 208, 304);
  }, [projectContextMenu]);

  const taskMenuPosition = useMemo(() => {
    if (!taskContextMenu) return null;
    return getClampedMenuPosition(taskContextMenu.x, taskContextMenu.y, 208, 220);
  }, [taskContextMenu]);
  const linkedNoteMenuPosition = useMemo(() => {
    if (!linkedNoteContextMenu) return null;
    return getClampedMenuPosition(linkedNoteContextMenu.x, linkedNoteContextMenu.y, 208, 144);
  }, [linkedNoteContextMenu]);

  const isCompactLayout = viewportWidth < modulePaneSizing.projects.right.compactBreakpoint;
  const taskNotesTask = useMemo(
    () => tasks.find((task) => task.id === taskNotesTaskId) ?? null,
    [taskNotesTaskId, tasks]
  );

  const filteredLinkableNotes = useMemo(() => {
    const term = linkNotesSearch.trim().toLowerCase();
    if (!term) return linkableNotes;
    return linkableNotes.filter((note) =>
      `${note.title} ${note.preview}`.toLowerCase().includes(term)
    );
  }, [linkNotesSearch, linkableNotes]);

  const syncDraftFromProject = useCallback((project: ProjectRow) => {
    setProjectDraft({
      name: project.name,
      description: project.description ?? '',
      status: parseProjectStatus(String(project.status)),
      completeness: Math.max(0, Math.min(100, Number(project.completeness) || 0)),
      color: project.color || '#007AFF',
      startDate: project.start_date ?? '',
      endDate: project.end_date ?? '',
    });
    isDirtyRef.current = false;
  }, []);

  const loadProjects = useCallback(async () => {
    if (!user || !activeWorkspaceId) {
      setProjects([]);
      setSelectedProjectId(null);
      setProjectDraft({
        name: '',
        description: '',
        status: 'not_started',
        completeness: 0,
        color: '#007AFF',
        startDate: '',
        endDate: '',
      });
      setIsLoadingProjects(false);
      setError(null);
      return;
    }
    setIsLoadingProjects(true);
    setError(null);

    try {
      const data = await api.getProjects({ includeCompleted: true });
      const rows = (data ?? []) as ProjectRow[];
      setProjects(rows);

      setSelectedProjectId((currentId) => {
        if (currentId && rows.some((project) => project.id === currentId)) {
          return currentId;
        }

        const next = rows[0] ?? null;
        if (next) {
          syncDraftFromProject(next);
          return next.id;
        }

        isDirtyRef.current = false;
        setProjectDraft({
          name: '',
          description: '',
          status: 'not_started',
          completeness: 0,
          color: '#007AFF',
          startDate: '',
          endDate: '',
        });
        return null;
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load projects.');
      setProjects([]);
      setSelectedProjectId(null);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [api, activeWorkspaceId, syncDraftFromProject, user]);

  const loadTasks = useCallback(async () => {
    if (!user || !activeWorkspaceId || !selectedProjectId) {
      setTasks([]);
      setIsLoadingTasks(false);
      return;
    }

    setIsLoadingTasks(true);
    setTaskError(null);

    try {
      const data = await api.getTasks({ projectId: selectedProjectId });
      const rows = (data ?? []) as TaskRow[];
      setTasks(rows);
      setSelectedTaskId((current) =>
        current && rows.some((task) => task.id === current) ? current : rows[0]?.id ?? null
      );
    } catch (fetchError) {
      setTaskError(fetchError instanceof Error ? fetchError.message : 'Could not load tasks.');
      setTasks([]);
      setSelectedTaskId(null);
    } finally {
      setIsLoadingTasks(false);
    }
  }, [api, activeWorkspaceId, selectedProjectId, user]);

  const flushProjectDraft = useCallback(async () => {
    if (!selectedProject) return null;
    if (!isDirtyRef.current) return selectedProject;

    const nextName = projectDraft.name.trim();
    if (!nextName) {
      setError('Project name is required.');
      return null;
    }

    setIsSavingProject(true);
    setError(null);

    try {
      const updated = (await api.updateProject(
        selectedProject.id,
        buildProjectUpdate(projectDraft)
      )) as ProjectRow;
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      syncDraftFromProject(updated);
      return updated;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save project.');
      return null;
    } finally {
      setIsSavingProject(false);
    }
  }, [api, projectDraft, selectedProject, syncDraftFromProject]);

  const selectProject = useCallback(
    async (project: ProjectRow) => {
      if (selectedProjectId === project.id) return;
      const saved = await flushProjectDraft();
      if (!saved && isDirtyRef.current) return;
      setSelectedProjectId(project.id);
      syncDraftFromProject(project);
      setSelectedTaskId(null);
    },
    [flushProjectDraft, selectedProjectId, syncDraftFromProject]
  );

  const focusProjectById = useCallback(
    async (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      if (!project) return;
      await selectProject(project);
    },
    [projects, selectProject]
  );

  const updateProjectDraft = useCallback((patch: Partial<ProjectDraft>) => {
    isDirtyRef.current = true;
    setProjectDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const setDurationDays = useCallback(
    (days: number) => {
      if (!projectDraft.startDate) return;
      const safeDays = Math.max(1, Math.min(3650, Math.floor(days)));
      const start = new Date(`${projectDraft.startDate}T00:00:00`);
      if (Number.isNaN(start.getTime())) return;
      const nextDue = new Date(start);
      nextDue.setDate(nextDue.getDate() + safeDays - 1);
      const yyyy = nextDue.getFullYear();
      const mm = String(nextDue.getMonth() + 1).padStart(2, '0');
      const dd = String(nextDue.getDate()).padStart(2, '0');
      updateProjectDraft({ endDate: `${yyyy}-${mm}-${dd}` });
    },
    [projectDraft.startDate, updateProjectDraft]
  );

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;

    setIsCreatingProjectNow(true);
    setError(null);

    try {
      const data = await api.createProject({
        name,
        description: '',
        color: '#007AFF',
        start_date: null,
        end_date: null,
      });
      const created = data as ProjectRow;
      setProjects((prev) => {
        const next = prev.filter(
          (project) =>
            normalizeProjectNameKey(project.name) !== normalizeProjectNameKey(created.name)
        );
        return [created, ...next];
      });
      setSelectedProjectId(created.id);
      syncDraftFromProject(created);
      setNewProjectName('');
      setIsCreatingProject(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create project.');
    } finally {
      setIsCreatingProjectNow(false);
    }
  }, [api, newProjectName, syncDraftFromProject]);

  const openCreateProjectComposer = useCallback(() => {
    setIsCreatingProject(true);
    window.setTimeout(() => {
      createProjectInputRef.current?.focus();
      createProjectInputRef.current?.select();
    }, 60);
  }, []);

  const deleteProject = useCallback(
    async (projectId: string) => {
      try {
        await api.deleteProject(projectId);
        setProjects((prev) => prev.filter((project) => project.id !== projectId));
        if (selectedProjectId === projectId) {
          setSelectedProjectId(null);
          setTasks([]);
          setSelectedTaskId(null);
          isDirtyRef.current = false;
          setProjectDraft({
            name: '',
            description: '',
            status: 'not_started',
            completeness: 0,
            color: '#007AFF',
            startDate: '',
            endDate: '',
          });
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : 'Could not delete project.');
      }
    },
    [api, selectedProjectId]
  );

  const updateProjectStatus = useCallback(
    async (projectId: string, semantic: ProjectSemanticStatus) => {
      try {
        const completeness = semantic === 'completed' ? 100 : undefined;
        const data = await api.updateProject(projectId, {
          status: projectStatusCandidates[semantic][0],
          ...(completeness !== undefined ? { completeness } : {}),
        });
        const updated = data as ProjectRow;
        setProjects((prev) =>
          prev.map((project) => (project.id === updated.id ? updated : project))
        );

        if (selectedProjectId === projectId) {
          syncDraftFromProject(updated);
        }
      } catch (updateError) {
        setError(
          updateError instanceof Error ? updateError.message : 'Could not update project status.'
        );
      }
    },
    [api, selectedProjectId, syncDraftFromProject]
  );

  const updateProjectColor = useCallback(
    async (projectId: string, color: string) => {
      try {
        const data = await api.updateProject(projectId, { color });
        const updated = data as ProjectRow;
        setProjects((prev) =>
          prev.map((project) => (project.id === updated.id ? updated : project))
        );
        if (selectedProjectId === projectId) {
          syncDraftFromProject(updated);
        }
      } catch (updateError) {
        setError(
          updateError instanceof Error ? updateError.message : 'Could not update project color.'
        );
      }
    },
    [api, selectedProjectId, syncDraftFromProject]
  );

  const createTask = useCallback(async () => {
    if (!selectedProjectId) return;
    const title = newTaskTitle.trim();
    if (!title) return;

    setIsCreatingTask(true);
    setTaskError(null);

    try {
      const data = await api.createTask({
        title,
        project_id: selectedProjectId,
        priority: newTaskPriority,
        due_date: newTaskDueDate || null,
        due_time: newTaskDueTime || null,
        status: 'todo',
      });
      const created = data as TaskRow;
      setTasks((prev) => [created, ...prev]);
      setNewTaskTitle('');
      setNewTaskPriority('medium');
      setNewTaskDueDate(todayKey());
      setNewTaskDueTime('');
    } catch (createError) {
      setTaskError(createError instanceof Error ? createError.message : 'Could not create task.');
    } finally {
      setIsCreatingTask(false);
    }
  }, [api, newTaskDueDate, newTaskDueTime, newTaskPriority, newTaskTitle, selectedProjectId]);

  const updateTaskStatus = useCallback(
    async (task: TaskRow, status: string) => {
      const previousTask = task;
      const nextTask = { ...task, status };

      setTasks((prev) => prev.map((row) => (row.id === task.id ? nextTask : row)));

      try {
        const data = await api.updateTask(task.id, { status });
        const updated = data as TaskRow;
        setTasks((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      } catch (updateError) {
        setTaskError(updateError instanceof Error ? updateError.message : 'Could not update task.');
        setTasks((prev) => prev.map((row) => (row.id === task.id ? previousTask : row)));
      }
    },
    [api]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      try {
        await api.deleteTask(taskId);
        setTasks((prev) => prev.filter((task) => task.id !== taskId));
        if (selectedTaskId === taskId) {
          setSelectedTaskId(null);
        }
      } catch (deleteError) {
        setTaskError(deleteError instanceof Error ? deleteError.message : 'Could not delete task.');
      }
    },
    [api, selectedTaskId]
  );

  const openTaskNotes = useCallback((task: TaskRow) => {
    setTaskNotesTaskId(task.id);
    setTaskNotesDraft(task.notes ?? '');
  }, []);

  const loadLinkedNotes = useCallback(
    async (projectId: string) => {
      setIsLoadingLinkedNotes(true);
      try {
        const payload = (await api.getProjectNoteLinks(projectId)) as { links?: ProjectNoteLink[] };
        const links = Array.isArray(payload?.links)
          ? payload.links.filter((item) => item?.note?.id)
          : [];
        setLinkedNotes(links);
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : 'Could not load linked notes.');
        setLinkedNotes([]);
      } finally {
        setIsLoadingLinkedNotes(false);
      }
    },
    [api]
  );

  const loadLinkableNotes = useCallback(async () => {
    setIsLoadingLinkableNotes(true);
    try {
      const payload = (await api.getNotes()) as {
        notes?: Array<{
          id: string;
          title?: string;
          content?: string;
          content_html?: string;
          updated_at?: string | null;
        }>;
      };
      const linkedSet = new Set(linkedNotes.map((item) => item.note_id));
      const rows = Array.isArray(payload?.notes) ? payload.notes : [];
      const options = rows
        .filter((row) => row?.id && !linkedSet.has(row.id))
        .map((row) => ({
          id: row.id,
          title: (row.title || 'Untitled note').trim(),
          preview: String(row.content ?? '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120),
          updated_at: row.updated_at ?? null,
        }));
      setLinkableNotes(options);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not load workspace notes.');
      setLinkableNotes([]);
    } finally {
      setIsLoadingLinkableNotes(false);
    }
  }, [api, linkedNotes]);

  const openLinkNoteModal = useCallback(async () => {
    if (!selectedProjectId) return;
    setIsLinkNoteModalOpen(true);
    setLinkNotesSearch('');
    await loadLinkableNotes();
  }, [loadLinkableNotes, selectedProjectId]);

  const linkNoteToProject = useCallback(
    async (noteId: string) => {
      if (!selectedProjectId) return;
      setIsLinkingNote(true);
      try {
        const linked = (await api.linkProjectNote(selectedProjectId, noteId)) as ProjectNoteLink;
        setLinkedNotes((prev) => {
          if (prev.some((item) => item.note_id === linked.note_id)) return prev;
          return [linked, ...prev];
        });
        setLinkableNotes((prev) => prev.filter((note) => note.id !== noteId));
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : 'Could not link note.');
      } finally {
        setIsLinkingNote(false);
      }
    },
    [api, selectedProjectId]
  );

  const unlinkNoteFromProject = useCallback(
    async (noteId: string) => {
      if (!selectedProjectId) return;
      const removed = linkedNotes.find((item) => item.note_id === noteId)?.note;
      setLinkedNotes((prev) => prev.filter((item) => item.note_id !== noteId));
      try {
        await api.unlinkProjectNote(selectedProjectId, noteId);
        if (removed) {
          setLinkableNotes((prev) => [removed, ...prev.filter((n) => n.id !== removed.id)]);
        }
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : 'Could not unlink note.');
        await loadLinkedNotes(selectedProjectId);
      }
    },
    [api, linkedNotes, loadLinkedNotes, selectedProjectId]
  );

  const openLinkedNoteInNotesModule = useCallback((noteId: string) => {
    void window.desktopWindow?.toggleModule('notes', { focusNoteId: noteId });
  }, []);

  const saveTaskNotes = useCallback(async () => {
    if (!taskNotesTaskId) return;
    setIsSavingTaskNotes(true);
    setTaskError(null);
    try {
      const data = await api.updateTask(taskNotesTaskId, { notes: taskNotesDraft.trim() || null });
      const updated = data as TaskRow;
      setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
      setTaskNotesTaskId(null);
      setTaskNotesDraft('');
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not save task notes.');
    } finally {
      setIsSavingTaskNotes(false);
    }
  }, [api, taskNotesDraft, taskNotesTaskId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    setLeftPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.projects.left)
    );
    setRightPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.projects.right)
    );
  }, [viewportWidth]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!user) {
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
      } catch {
        if (!cancelled) setInboxCount(0);
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

    const timer = window.setInterval(() => {
      void loadInboxCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.ipcRenderer?.off('inbox:items-updated', handleInboxItemsUpdated);
      window.removeEventListener('focus', handleRefreshInboxCount);
      document.removeEventListener('visibilitychange', handleRefreshInboxCount);
    };
  }, [api, user]);

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }

    let cancelled = false;
    const loadNotificationCount = async () => {
      try {
        const payload = (await api.getNotificationCenterSummary()) as {
          counts?: { active?: number };
        };
        if (!cancelled) {
          setNotificationCount(Number(payload?.counts?.active ?? 0));
        }
      } catch {
        if (!cancelled) setNotificationCount(0);
      }
    };

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ activeCount?: number }>).detail;
      setNotificationCount(Number(detail?.activeCount ?? 0));
    };

    void loadNotificationCount();
    window.addEventListener('ledger:notifications-summary', handleNotificationsSummary as EventListener);

    const timer = window.setInterval(() => {
      void loadNotificationCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('ledger:notifications-summary', handleNotificationsSummary as EventListener);
    };
  }, [api, user]);

  useEffect(() => {
    if (!selectedProjectId) {
      setLinkedNotes([]);
      setIsLoadingLinkedNotes(false);
      return;
    }
    void loadLinkedNotes(selectedProjectId);
  }, [loadLinkedNotes, selectedProjectId]);

  useEffect(() => {
    let mounted = true;
    const loadWorkspaceMembers = async () => {
      if (!activeWorkspaceId) {
        if (mounted) setWorkspaceMembers([]);
        return;
      }
      try {
        const payload = (await api.getWorkspaceMembers(activeWorkspaceId)) as {
          members?: Array<{ user_id: string; email?: string | null; full_name?: string | null }>;
        };
        if (!mounted) return;
        const members = Array.isArray(payload?.members)
          ? payload.members.map((member) => ({
              user_id: member.user_id,
              email: member.email ?? null,
              full_name: member.full_name ?? null,
            }))
          : [];
        setWorkspaceMembers(members);
      } catch {
        if (mounted) setWorkspaceMembers([]);
      }
    };
    void loadWorkspaceMembers();
    return () => {
      mounted = false;
    };
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    if (!selectedProject) return;
    syncDraftFromProject(selectedProject);
  }, [selectedProject, syncDraftFromProject]);

  useEffect(() => {
    if (!selectedProject || !isDirtyRef.current) return;
    if (isCompletenessDraggingRef.current) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void flushProjectDraft();
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [flushProjectDraft, projectDraft, selectedProject]);

  useEffect(() => {
    if (!initialFocusProjectId) return;
    if (initialFocusHandledRef.current) return;
    if (initialFocusProjectId === '__new__') {
      initialFocusHandledRef.current = true;
      openCreateProjectComposer();
      return;
    }
    if (!projects.length) return;
    initialFocusHandledRef.current = true;
    if (selectedProjectId === initialFocusProjectId) return;
    void focusProjectById(initialFocusProjectId);
  }, [
    focusProjectById,
    initialFocusProjectId,
    openCreateProjectComposer,
    projects,
    selectedProjectId,
  ]);

  useEffect(() => {
    const focusProjectListener = (
      _event: unknown,
      payload: { kind?: string; focusProjectId?: string | null }
    ) => {
      if (payload?.kind !== 'projects' || !payload.focusProjectId) return;
      if (payload.focusProjectId === '__new__') {
        openCreateProjectComposer();
        return;
      }
      void focusProjectById(payload.focusProjectId);
    };

    window.ipcRenderer?.on('module:focus-project', focusProjectListener);

    return () => {
      window.ipcRenderer?.off('module:focus-project', focusProjectListener);
    };
  }, [focusProjectById, openCreateProjectComposer]);

  useEffect(() => {
    if (!initialFocusTaskId) return;
    if (!tasks.length) return;
    const task = tasks.find((item) => item.id === initialFocusTaskId);
    if (!task) return;
    setSelectedTaskId(task.id);
    const element = document.getElementById(`task-row-${task.id}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [initialFocusTaskId, tasks]);

  useEffect(() => {
    const focusTaskListener = (
      _event: unknown,
      payload: { kind?: string; focusTaskId?: string | null }
    ) => {
      if (payload?.kind !== 'projects' || !payload.focusTaskId) return;
      const task = tasks.find((item) => item.id === payload.focusTaskId);
      if (!task) return;
      setSelectedTaskId(task.id);
      const element = document.getElementById(`task-row-${task.id}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.ipcRenderer?.on('module:focus-task', focusTaskListener);

    return () => {
      window.ipcRenderer?.off('module:focus-task', focusTaskListener);
    };
  }, [tasks]);

  useEffect(() => {
    if (!isResizingLeftPane) return;

    const handleMove = (event: MouseEvent) => {
      const next = Math.max(LEFT_PANE_MIN_WIDTH, Math.min(LEFT_PANE_MAX_WIDTH, event.clientX));
      setLeftPaneWidth(next);
    };

    const handleUp = () => setIsResizingLeftPane(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingLeftPane]);

  useEffect(() => {
    if (!isResizingRightPane) return;

    const handleMove = (event: MouseEvent) => {
      const next = window.innerWidth - event.clientX;
      const clamped = Math.max(RIGHT_PANE_MIN_WIDTH, Math.min(RIGHT_PANE_MAX_WIDTH, next));
      setRightPaneWidth(clamped);
    };

    const handleUp = () => setIsResizingRightPane(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingRightPane]);

  useEffect(() => {
    if (!projectContextMenu) return;

    const closeMenu = () => setProjectContextMenu(null);
    const onPointerDown = (event: MouseEvent) => {
      if (projectContextRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [projectContextMenu]);

  useEffect(() => {
    if (!taskContextMenu) return;

    const closeMenu = () => setTaskContextMenu(null);
    const onPointerDown = (event: MouseEvent) => {
      if (taskContextRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [taskContextMenu]);

  useEffect(() => {
    if (!linkedNoteContextMenu) return;

    const closeMenu = () => setLinkedNoteContextMenu(null);
    const onPointerDown = (event: MouseEvent) => {
      if (linkedNoteContextRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [linkedNoteContextMenu]);

  useEffect(() => {
    if (!isContextMenuOpen) return;
    const closeMenu = () => setIsContextMenuOpen(false);
    const onPointerDown = (event: MouseEvent) => {
      if (rightPanelMenuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isContextMenuOpen]);

  useEffect(() => {
    if (!taskNotesTask) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setTaskNotesTaskId(null);
      setTaskNotesDraft('');
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [taskNotesTask]);

  const attemptCloseProjects = useCallback(() => {
    if (isSavingProject || isSavingTaskNotes || isDirtyRef.current) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('projects');
  }, [isSavingProject, isSavingTaskNotes]);

  return (
    <div
      className="h-screen overflow-hidden rounded-3xl border border-gray-200 bg-[#f5f7fb] flex flex-col text-gray-900 shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
      style={{ scrollbarGutter: 'stable' }}
    >
      <CloseGuardModal
        isOpen={showCloseGuardModal}
        isSaving={isSavingProject || isSavingTaskNotes}
        hasUnsavedChanges={isDirtyRef.current}
        onCancel={() => setShowCloseGuardModal(false)}
        onCloseWithoutSaving={() => {
          setShowCloseGuardModal(false);
          void window.desktopWindow?.closeModule('projects');
        }}
        onRetrySaveAndClose={() => {
          void (async () => {
            const saved = await flushProjectDraft();
            if (!saved && isDirtyRef.current) return;
            setShowCloseGuardModal(false);
            void window.desktopWindow?.closeModule('projects');
          })();
        }}
      />
      <ModuleWindowHeader
        title="Projects"
        subtitle="Simple outcomes, clear next steps"
        icon={<Folder size={18} className="text-[#FF5F40]" />}
        closeLabel="Close projects"
        minimizeLabel="Minimize projects"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('projects');
        }}
        fullscreenLabel="Fullscreen projects"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('projects');
        }}
        onClose={attemptCloseProjects}
        showPanelToggle
        panelToggleLabel={areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
        onTogglePanels={() => {
          if (areSidePanelsCollapsed) {
            setIsLeftPaneCollapsed(false);
            setIsRightPaneCollapsed(false);
          } else {
            setIsLeftPaneCollapsed(true);
            setIsRightPaneCollapsed(true);
          }
        }}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={12} />}
              count={inboxCount}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open inbox"
              ariaLabel="Open inbox"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={12} />}
              count={notificationCount}
              onClick={() => window.desktopWindow?.openModule('notifications')}
              title="Open notifications center"
              ariaLabel="Open notifications center"
            />
          </>
        }
        primaryActions={
          <div className="flex items-center gap-2">
            <ModuleHeaderActionButton
              onClick={() => {
                setIsCreatingProject(!isCreatingProject);
              }}
              title={isCreatingProject ? 'Cancel new project' : 'Create a new project'}
            >
              <Plus size={12} />
              {isCreatingProject ? 'Cancel' : 'New project'}
            </ModuleHeaderActionButton>
          </div>
        }
        syncStatus={
          <ModuleHeaderStatus
            label=""
            state={isLoadingProjects ? 'syncing' : 'synced'}
            onClick={() => void loadProjects()}
            title="Refresh projects"
            ariaLabel="Refresh projects"
          />
        }
      />

      {error && (
        <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed ? (
          <>
            <aside
              className="border-r border-gray-200 bg-white flex flex-col overflow-hidden shrink-0"
              style={{ width: `${leftPaneWidth}px` }}
            >
              <div className={`${isCompactLayout ? 'p-3' : 'p-4'} border-b border-gray-100`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Library
                      </p>
                      <h2 className="text-sm font-semibold text-gray-900">
                        {projects.length} projects
                      </h2>
                    </div>
                    <button
                      onClick={() => setIsLeftPaneCollapsed(true)}
                      className="h-7 w-7 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                      title="Hide left panel"
                      aria-label="Hide left panel"
                    >
                      <ChevronLeft size={13} strokeWidth={2.25} className="-translate-x-px" />
                    </button>
                  </div>
                  <span className="text-[10px] text-gray-500">
                    {isLoadingProjects ? 'Syncing...' : 'Live'}
                  </span>
                </div>

                <div className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects"
                    className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                  />
                </div>

                <div className="relative mt-3">
                  <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex w-max items-center gap-1.5 pr-8">
                      {statusOrder.map((filter) => (
                        <button
                          key={filter}
                          onClick={() => setStatusFilter(filter)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition ${
                            statusFilter === filter
                              ? 'bg-gray-900 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {filter === 'all'
                            ? 'All'
                            : filter === 'active'
                            ? 'Active'
                            : filter === 'paused'
                            ? 'Paused'
                            : 'Completed'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pointer-events-none absolute right-0 top-0 h-7 w-7 bg-linear-to-l from-white to-transparent" />
                </div>

                {isCreatingProject && (
                  <div className="mt-3 space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                    <input
                      ref={createProjectInputRef}
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createProject();
                        }
                      }}
                      placeholder="Project name"
                      className="w-full h-9 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-300 bg-white text-gray-900 placeholder-gray-500"
                    />
                    <button
                      onClick={() => void createProject()}
                      disabled={!newProjectName.trim() || isCreatingProjectNow}
                      className="w-full h-9 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-60"
                    >
                      {isCreatingProjectNow ? 'Creating...' : 'Create project'}
                    </button>
                  </div>
                )}
              </div>

              <div
                className={`flex-1 overflow-auto ${isCompactLayout ? 'p-2.5' : 'p-3'} space-y-2`}
              >
                {isLoadingProjects ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonProjectCard key={i} />
                    ))}
                  </div>
                ) : visibleProjects.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-800">No matching projects.</p>
                    <p className="mt-1 text-sm text-gray-500">
                      Create one for internships, classes, or job applications.
                    </p>
                  </div>
                ) : (
                  visibleProjects.map((project) => {
                    const semantic = parseProjectStatus(String(project.status));
                    const active = selectedProjectId === project.id;
                    const displayCompleteness = active
                      ? Math.max(0, Math.min(100, Number(projectDraft.completeness) || 0))
                      : Math.max(0, Math.min(100, Number(project.completeness) || 0));
                    const progressColor = active
                      ? projectDraft.color || '#FF5F40'
                      : project.color || '#FF5F40';
                    const dueLabel = formatSidebarDueDate(project, semantic);
                    const statusLabel =
                      semantic === 'completed'
                        ? 'Completed'
                        : semantic === 'not_started'
                        ? 'Not started'
                        : projectStatusLabels[semantic];

                    return (
                      <button
                        key={project.id}
                        onClick={() => void selectProject(project)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setProjectContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            projectId: project.id,
                          });
                        }}
                        className={`w-full rounded-xl border px-2.5 py-2.5 text-left transition ${
                          active
                            ? 'border-gray-200 bg-gray-100'
                            : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-200'
                        }`}
                        title={project.name}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: active
                                  ? projectDraft.color || '#FF5F40'
                                  : project.color || '#FF5F40',
                              }}
                            />
                            <p className="truncate text-[13px] font-semibold text-gray-900">
                              {project.name}
                            </p>
                          </div>
                          <p className="mt-1 text-[11px] text-gray-600">
                            {statusLabel} · {displayCompleteness}%
                          </p>
                          <p className="mt-1 text-[11px] text-gray-500">{dueLabel}</p>
                        </div>
                        <div className="mt-1.5 h-1 rounded-full bg-gray-200/85 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(0, Math.min(100, displayCompleteness))}%`,
                              backgroundColor: progressColor,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <div
              className="w-1.5 cursor-col-resize bg-gray-100 hover:bg-gray-200 transition touch-none"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingLeftPane(true);
              }}
            />
          </>
        ) : (
          <div className="w-10 shrink-0 border-r border-gray-200 bg-white flex items-start justify-center pt-4">
            <button
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="h-7 w-7 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Show left panel"
              aria-label="Show left panel"
            >
              <ChevronRight size={14} strokeWidth={2.25} />
            </button>
          </div>
        )}

        <main className="flex-1 overflow-hidden bg-[#f5f7fb]">
          <div className={`h-full overflow-auto ${isCompactLayout ? 'p-4' : 'p-5'}`}>
            {selectedProject ? (
              <div className="mx-auto max-w-4xl space-y-4">
                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: projectDraft.color || '#FF5F40' }}
                        />
                        <h2 className="truncate text-3xl font-semibold tracking-tight text-gray-900">
                          {projectDraft.name}
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {isSavingProject
                          ? 'Saving…'
                          : isDirtyRef.current
                          ? 'Unsaved changes'
                          : 'Saved'}
                      </p>
                    </div>
                    <div className="relative shrink-0">
                      <select
                        value={projectDraft.status}
                        onChange={(e) =>
                          void updateProjectStatus(
                            selectedProject.id,
                            e.target.value as ProjectSemanticStatus
                          )
                        }
                        className="h-9 appearance-none rounded-xl border border-gray-200 bg-white py-0 pl-3 pr-8 text-sm font-medium text-gray-800 outline-none focus:border-gray-300"
                      >
                        {(Object.keys(projectStatusLabels) as ProjectSemanticStatus[]).map(
                          (status) => (
                            <option key={status} value={status}>
                              {projectStatusLabels[status]}
                            </option>
                          )
                        )}
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                    </div>
                  </div>
                  <div className="mt-5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Progress</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {projectDraft.completeness}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={projectDraft.completeness}
                      onPointerDown={() => {
                        isCompletenessDraggingRef.current = true;
                        if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
                      }}
                      onChange={(e) => updateProjectDraft({ completeness: Number(e.target.value) })}
                      onPointerUp={() => {
                        isCompletenessDraggingRef.current = false;
                        void flushProjectDraft();
                      }}
                      onPointerCancel={() => {
                        isCompletenessDraggingRef.current = false;
                        void flushProjectDraft();
                      }}
                      onBlur={() => {
                        isCompletenessDraggingRef.current = false;
                        void flushProjectDraft();
                      }}
                      style={{ accentColor: projectDraft.color || '#FF5F40' }}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500">
                      {projectDraft.endDate
                        ? `Due ${formatShortDate(projectDraft.endDate)}`
                        : 'No due date'}{' '}
                      · {taskCounts.active} active tasks · {taskCounts.completed} completed
                    </p>
                  </div>
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-medium text-gray-500">
                    Timeline
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Start</span>
                      <input
                        type="date"
                        value={projectDraft.startDate}
                        onChange={(e) => updateProjectDraft({ startDate: e.target.value })}
                        className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-sm text-gray-900 outline-none focus:border-gray-300"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Due</span>
                      <input
                        type="date"
                        value={projectDraft.endDate}
                        onChange={(e) => updateProjectDraft({ endDate: e.target.value })}
                        className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-sm text-gray-900 outline-none focus:border-gray-300"
                      />
                    </label>
                    <div className="text-xs text-gray-600">
                      <span className="mb-1 block">Duration</span>
                      <div className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-1.5 text-sm text-gray-800 inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          className="h-6 w-6 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                          onClick={() => {
                            if (!projectDurationDays) return;
                            setDurationDays(projectDurationDays - 1);
                          }}
                          disabled={!projectDurationDays || !projectDraft.startDate}
                          aria-label="Decrease duration"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={3650}
                          value={projectDurationDays ?? ''}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            setDurationDays(next);
                          }}
                          disabled={!projectDraft.startDate}
                          placeholder="--"
                          className="w-14 bg-transparent text-center outline-none disabled:opacity-60"
                        />
                        <span className="text-xs text-gray-600">days</span>
                        <button
                          type="button"
                          className="ml-auto h-6 w-6 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                          onClick={() => setDurationDays((projectDurationDays ?? 0) + 1)}
                          disabled={!projectDraft.startDate}
                          aria-label="Increase duration"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-medium text-gray-500">
                    Objective
                  </p>
                  <textarea
                    value={projectDraft.description}
                    onChange={(e) => updateProjectDraft({ description: e.target.value })}
                    placeholder="Add a short objective for this project..."
                    className="mt-3 h-24 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-300"
                  />
                </section>

                <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-6 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-500">Tasks</p>
                      <h3 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                        Next actions
                      </h3>
                    </div>
                    <div className="text-left sm:text-right text-xs text-gray-500 shrink-0">
                      <p>
                        {taskCounts.active} active · {taskCounts.completed} done
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 p-6 space-y-4">
                    <button
                      onClick={() => setIsTaskComposerOpen((prev) => !prev)}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      <Plus size={14} />
                      Add task
                    </button>

                    {isTaskComposerOpen && (
                      <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <input
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void createTask();
                            }
                          }}
                          placeholder="Add a next action"
                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300"
                        />
                        <div
                          className={`grid gap-2 ${
                            isCompactLayout
                              ? 'grid-cols-1'
                              : 'sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,140px)_auto]'
                          }`}
                        >
                          <div className="relative min-w-0">
                            <select
                              value={newTaskPriority}
                              onChange={(e) =>
                                setNewTaskPriority(e.target.value as typeof newTaskPriority)
                              }
                              className={`w-full min-w-0 appearance-none rounded-lg border border-gray-200 bg-white text-sm text-gray-700 outline-none ${
                                isCompactLayout ? 'py-2 pl-3 pr-9' : 'py-2 pl-3 pr-10'
                              }`}
                            >
                              {Object.entries(taskPriorityLabels).map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={isCompactLayout ? 12 : 14}
                              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                            />
                          </div>
                          <input
                            type="date"
                            value={newTaskDueDate}
                            onChange={(e) => setNewTaskDueDate(e.target.value)}
                            className="w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
                          />
                          <button
                            onClick={() => void createTask()}
                            disabled={!newTaskTitle.trim() || isCreatingTask}
                            className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
                          >
                            {isCreatingTask ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      </div>
                    )}

                    {taskError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {taskError}
                      </div>
                    )}

                    {isLoadingTasks ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <SkeletonTaskItem key={i} />
                        ))}
                      </div>
                    ) : selectedProjectTasks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-medium text-gray-800">No next actions yet.</p>
                        <p className="mt-1 text-sm text-gray-500">
                          Add the first action to start execution.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-gray-500">
                            Active
                          </p>
                          {activeProjectTasks.length === 0 ? (
                            <p className="text-sm text-gray-500">No active next actions.</p>
                          ) : (
                            activeProjectTasks.map((task) => {
                              const activeTask = selectedTaskId === task.id;
                              return (
                                <button
                                  id={`task-row-${task.id}`}
                                  key={task.id}
                                  onClick={() => {
                                    setSelectedTaskId(task.id);
                                    void updateTaskStatus(task, 'completed');
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setTaskContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      taskId: task.id,
                                    });
                                  }}
                                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                    activeTask
                                      ? 'border-gray-300 bg-white'
                                      : 'border-gray-200 bg-gray-50 hover:bg-white'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 bg-white" />
                                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                                      {task.title}
                                    </p>
                                    {task.due_date && (
                                      <span className="shrink-0 text-[11px] text-gray-500">
                                        Due {formatShortDate(task.due_date)}
                                      </span>
                                    )}
                                    <span
                                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                        taskPriorityTone[String(task.priority)] ??
                                        'bg-gray-100 text-gray-700'
                                      }`}
                                    >
                                      {taskPriorityLabels[String(task.priority)] ?? 'Medium'}
                                    </span>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>

                        {completedProjectTasks.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-gray-500">
                              Completed
                            </p>
                            {completedProjectTasks.map((task) => {
                              const activeTask = selectedTaskId === task.id;
                              return (
                                <button
                                  id={`task-row-${task.id}`}
                                  key={task.id}
                                  onClick={() => {
                                    setSelectedTaskId(task.id);
                                    void updateTaskStatus(task, 'todo');
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setTaskContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      taskId: task.id,
                                    });
                                  }}
                                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                    activeTask
                                      ? 'border-gray-300 bg-white'
                                      : 'border-gray-200 bg-gray-50 hover:bg-white'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-green-600 bg-green-600">
                                      <CheckCircle2 size={10} className="text-white" />
                                    </span>
                                    <p className="min-w-0 flex-1 truncate text-sm text-gray-500 line-through">
                                      {task.title}
                                    </p>
                                    <span className="shrink-0 text-[11px] text-gray-500">
                                      {formatShortDate(task.updated_at)}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-gray-500">
                      Linked notes
                    </p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        void openLinkNoteModal();
                      }}
                    >
                      <Plus size={12} />
                      Link note
                    </button>
                  </div>
                  {isLoadingLinkedNotes ? (
                    <p className="mt-3 text-sm text-gray-500">Loading linked notes…</p>
                  ) : linkedNotes.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">No notes linked yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {linkedNotes.map((link) => (
                        <div
                          key={link.id}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setLinkedNoteContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              noteId: link.note_id,
                              source: 'center',
                            });
                          }}
                          onDoubleClick={() => openLinkedNoteInNotesModule(link.note_id)}
                          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {link.note.title}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-gray-500">
                                {link.note.preview || 'No content'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void unlinkNoteFromProject(link.note_id)}
                              className="shrink-0 text-xs font-medium text-gray-500 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white px-8 py-10 text-center shadow-sm">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50">
                    <Folder size={18} className="text-gray-700" />
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
                    Start a project
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Projects keep internships, applications, classes, and personal goals organized
                    around a clear next step.
                  </p>
                  <button
                    onClick={() => setIsCreatingProject(true)}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                  >
                    <Plus size={16} />
                    New project
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        {!isRightPaneCollapsed ? (
          <>
            <div
              className="w-1.5 cursor-col-resize bg-gray-100 hover:bg-gray-200 transition touch-none"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingRightPane(true);
              }}
            />

            <aside
              className="flex shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-[#fbfcfe]"
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="flex-1 overflow-auto p-4 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Inspector
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
                      {selectedProject ? 'Project context' : 'No project selected'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      {selectedProject ? projectDraft.name : 'Click a project to view details'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsRightPaneCollapsed(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      aria-label="Hide right panel"
                      title="Hide right panel"
                    >
                      <ChevronRight size={14} />
                    </button>
                    {selectedProject && (
                      <div className="relative" ref={rightPanelMenuRef}>
                        <button
                          type="button"
                          onClick={() => setIsContextMenuOpen((current) => !current)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                          aria-label="Project context actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {isContextMenuOpen && (
                          <div className="absolute right-0 top-9 z-50 min-w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                              }}
                            >
                              Edit project notes
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                void openLinkNoteModal();
                              }}
                            >
                              Link note
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                              }}
                            >
                              Copy project link
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                if (!selectedProject) return;
                                void updateProjectStatus(selectedProject.id, 'paused');
                              }}
                            >
                              Archive project
                            </button>
                            <div className="my-1 h-px bg-gray-100" />
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                if (!selectedProject) return;
                                void deleteProject(selectedProject.id);
                              }}
                            >
                              Delete project
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {!selectedProject ? (
                  <p className="text-sm text-gray-500">
                    Select a project to view notes, details, and workspace activity.
                  </p>
                ) : (
                  <>
                    <section className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Project notes
                      </p>
                      <p className="text-sm text-gray-500 leading-6">
                        {projectDraft.description?.trim()
                          ? projectDraft.description.trim()
                          : 'Add project context, decisions, links, or reminders.'}
                      </p>
                    </section>

                    <section className="space-y-2 border-t border-gray-100 pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          Linked notes
                        </p>
                        <button
                          type="button"
                          className="text-xs font-medium text-[#FF5F40] hover:text-[#EA5336]"
                          onClick={() => {
                            void openLinkNoteModal();
                          }}
                        >
                          + Link note
                        </button>
                      </div>
                      {isLoadingLinkedNotes ? (
                        <p className="text-sm text-gray-500">Loading linked notes…</p>
                      ) : linkedNotes.length === 0 ? (
                        <p className="text-sm text-gray-500">No notes linked yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {linkedNotes.slice(0, 6).map((link) => (
                            <div
                              key={link.id}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setLinkedNoteContextMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  noteId: link.note_id,
                                  source: 'right',
                                });
                              }}
                              onDoubleClick={() => openLinkedNoteInNotesModule(link.note_id)}
                              className="flex items-start justify-between gap-2 rounded-md px-1 py-1 hover:bg-white"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {link.note.title}
                                </p>
                                <p className="truncate text-xs text-gray-500">
                                  {link.note.preview || 'No content'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void unlinkNoteFromProject(link.note_id)}
                                className="shrink-0 text-[11px] text-gray-500 hover:text-red-600"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="space-y-2 border-t border-gray-100 pt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Details
                      </p>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Status</span>
                          <span className="text-gray-900">
                            {projectStatusLabels[projectDraft.status]}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Progress</span>
                          <span className="text-gray-900">{projectDraft.completeness}%</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Start</span>
                          <span className="text-gray-900">
                            {projectDraft.startDate
                              ? formatShortDate(projectDraft.startDate)
                              : 'Not set'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Due</span>
                          <span className="text-gray-900">
                            {projectDraft.endDate
                              ? formatShortDate(projectDraft.endDate)
                              : 'Not set'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Active</span>
                          <span className="text-gray-900">{taskCounts.active}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Done</span>
                          <span className="text-gray-900">{taskCounts.completed}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Updated</span>
                          <span className="text-gray-900">
                            {formatRelativeFromNow(selectedProject.updated_at)}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-gray-100 pt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Workspace
                      </p>
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {activeWorkspace?.name?.trim() || 'Current workspace'}
                      </p>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Created by</span>
                          <span className="text-gray-900">{creatorDisplayName}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Last edited</span>
                          <span className="max-w-[60%] truncate text-right text-gray-900">
                            {creatorDisplayName} ·{' '}
                            {formatRelativeFromNow(selectedProject.updated_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">Viewing</span>
                          <span className="max-w-[60%] truncate text-right text-gray-900">
                            {projectViewingSummary}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-gray-100 pt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Recent activity
                      </p>
                      {recentProjectActivity.length === 0 ? (
                        <p className="text-sm text-gray-500">No recent activity.</p>
                      ) : (
                        <div className="space-y-1">
                          {recentProjectActivity.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-50 transition"
                            >
                              <span className="min-w-0 truncate font-medium text-gray-900">
                                {item.label}
                              </span>
                              <span className="shrink-0 text-[11px] text-gray-500">
                                {formatShortDate(item.at)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            </aside>
          </>
        ) : (
          <div className="w-10 shrink-0 border-l border-gray-200 bg-[#fbfcfe] flex items-start justify-center pt-4">
            <button
              onClick={() => setIsRightPaneCollapsed(false)}
              className="h-7 w-7 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Show right panel"
              aria-label="Show right panel"
            >
              <ChevronLeft size={13} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>

      {taskNotesTask && (
        <ModalOverlay
          isOpen={Boolean(taskNotesTask)}
          onClose={() => {
            setTaskNotesTaskId(null);
            setTaskNotesDraft('');
          }}
          classNameContainer="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        >
          <div>
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                  Task notes
                </p>
                <p className="mt-1 truncate text-base font-semibold text-gray-900">
                  {taskNotesTask.title}
                </p>
              </div>
              <ModalCloseButton
                onClick={() => {
                  setTaskNotesTaskId(null);
                  setTaskNotesDraft('');
                }}
                ariaLabel="Close task notes modal"
                className="shrink-0"
              />
            </div>
            <div className="p-5">
              <textarea
                value={taskNotesDraft}
                onChange={(e) => setTaskNotesDraft(e.target.value)}
                placeholder="Capture details, links, blockers, or handoff notes for this task."
                className="h-48 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-300"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setTaskNotesTaskId(null);
                    setTaskNotesDraft('');
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveTaskNotes()}
                  disabled={isSavingTaskNotes}
                  className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {isSavingTaskNotes ? 'Saving...' : 'Save notes'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {linkedNoteContextMenu && linkedNoteMenuPosition && (
        <div
          ref={linkedNoteContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${linkedNoteMenuPosition.x}px`, top: `${linkedNoteMenuPosition.y}px` }}
          role="menu"
          aria-label="Linked note actions"
        >
          <button
            type="button"
            onClick={() => {
              openLinkedNoteInNotesModule(linkedNoteContextMenu.noteId);
              setLinkedNoteContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <FileText size={14} />
            Open in notes
          </button>
          <button
            type="button"
            onClick={() => {
              void unlinkNoteFromProject(linkedNoteContextMenu.noteId);
              setLinkedNoteContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
            Unlink note
          </button>
        </div>
      )}

      <ModalOverlay
        isOpen={isLinkNoteModalOpen}
        onClose={() => setIsLinkNoteModalOpen(false)}
        classNameContainer="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
              Link note
            </p>
            <p className="mt-1 text-base font-semibold text-gray-900">
              Attach a workspace note to this project
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setIsLinkNoteModalOpen(false)}
            ariaLabel="Close link note modal"
            className="shrink-0"
          />
        </div>
        <div className="space-y-3 p-5">
          <input
            type="text"
            value={linkNotesSearch}
            onChange={(e) => setLinkNotesSearch(e.target.value)}
            placeholder="Search notes"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300"
          />
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white">
            {isLoadingLinkableNotes ? (
              <p className="p-3 text-sm text-gray-500">Loading notes…</p>
            ) : filteredLinkableNotes.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No available notes to link.</p>
            ) : (
              filteredLinkableNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  disabled={isLinkingNote}
                  onClick={() => void linkNoteToProject(note.id)}
                  className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50 disabled:opacity-50"
                >
                  <p className="truncate text-sm font-medium text-gray-900">{note.title}</p>
                  <p className="truncate text-xs text-gray-500">
                    {note.preview || 'No content'}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => setIsLinkNoteModalOpen(false)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </ModalOverlay>

      {projectContextMenu && projectMenuPosition && (
        <div
          ref={projectContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${projectMenuPosition.x}px`, top: `${projectMenuPosition.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              const project = projects.find((item) => item.id === projectContextMenu.projectId);
              if (project) {
                await selectProject(project);
              }
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <Folder size={14} />
            Open
          </button>
          <button
            onClick={() => {
              void updateProjectStatus(projectContextMenu.projectId, 'in_progress');
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <ChevronDown size={14} />
            Mark active
          </button>
          <button
            onClick={() => {
              void updateProjectStatus(projectContextMenu.projectId, 'paused');
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <ChevronDown size={14} />
            Mark paused
          </button>
          <button
            onClick={() => {
              void updateProjectStatus(projectContextMenu.projectId, 'completed');
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckCircle2 size={14} />
            Mark complete
          </button>
          <div className="px-4 py-2">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Color
            </p>
            <div className="grid grid-cols-8 gap-2">
              {projectColorOptions.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    void updateProjectColor(projectContextMenu.projectId, color);
                    setProjectContextMenu(null);
                  }}
                  className="h-4 w-4 rounded-full border border-black/10 transition hover:scale-110"
                  style={{ backgroundColor: color }}
                  aria-label={`Set project color ${color}`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              void deleteProject(projectContextMenu.projectId);
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {taskContextMenu && taskMenuPosition && (
        <div
          ref={taskContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${taskMenuPosition.x}px`, top: `${taskMenuPosition.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) void updateTaskStatus(task, 'todo');
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckCircle2 size={14} />
            Mark todo
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) void updateTaskStatus(task, 'in_progress');
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <ChevronDown size={14} />
            Mark in progress
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) void updateTaskStatus(task, 'completed');
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckCircle2 size={14} />
            Mark complete
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) openTaskNotes(task);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <FileText size={14} />
            Task notes
          </button>
          <button
            onClick={() => {
              void deleteTask(taskContextMenu.taskId);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default ProjectsWindow;
