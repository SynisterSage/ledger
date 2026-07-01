import {
  BriefcaseBusiness,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CircleDot,
  Code2,
  FileText,
  Flag,
  Folder,
  Inbox,
  Link2,
  MoreHorizontal,
  Pause,
  Plus,
  Play,
  Palette,
  Search,
  CheckCircle2,
  Sparkles,
  Loader2,
  Trash2,
  X,
  UserRound,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useAuthContext } from '../../context/AuthContext';
import {
  modulePaneSizing,
  clampPaneWidth,
  getPaneWidthForViewport,
} from '../../config/modulePaneSizes';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useWorkspaceRealtimeRefresh } from '../../hooks/useWorkspaceRealtimeRefresh';
import { useViewportHeight } from '../../hooks/useViewportHeight';
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
  project_type?: string | null;
  lead_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  project_id: string | null;
  milestone_id?: string | null;
  assigned_to?: string | null;
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
type ProjectTab = 'overview' | 'actions' | 'notes' | 'calendar' | 'activity';
type ActionsGroupBy = 'type' | 'due_date' | 'milestone';
type ProjectsOverviewView = 'timeline' | 'list';
type ProjectsOverviewRange = 'month' | 'quarter' | 'all';
type ProjectContextMenuState = { x: number; y: number; projectId: string };
type TimelineContextMenuState =
  | {
      kind: 'project';
      x: number;
      y: number;
      projectId: string;
      date: string | null;
    }
  | {
      kind: 'grid';
      x: number;
      y: number;
      date: string | null;
    }
  | {
      kind: 'marker';
      x: number;
      y: number;
      markerId: string;
      projectId: string | null;
      label: string;
      markerType: 'milestone' | 'event' | 'reminder';
    };
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

type ProjectMilestoneType =
  | 'Deadline'
  | 'Decision'
  | 'Review'
  | 'Event'
  | 'Reminder'
  | 'Handoff'
  | 'Custom';

type ProjectMilestoneRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  milestone_date: string;
  type: ProjectMilestoneType | string;
  note: string | null;
  completed: boolean;
  linked_note_id?: string | null;
  linked_reminder_id?: string | null;
  linked_event_id?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectCalendarEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  all_day?: boolean;
  status?: string;
  notes?: string | null;
  project_id?: string | null;
  note_id?: string | null;
  calendar_id?: string | null;
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ProjectCalendarReminder = {
  id: string;
  title: string;
  remind_at: string;
  status?: string;
  notes?: string | null;
  project_id?: string | null;
  note_id?: string | null;
  calendar_id?: string | null;
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_done?: boolean;
};

type CalendarLinkKind = 'event' | 'reminder';

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
const projectTabs: Array<{ id: ProjectTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'notes', label: 'Notes' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'activity', label: 'Activity' },
];
const projectMilestoneTypes: ProjectMilestoneType[] = [
  'Deadline',
  'Decision',
  'Review',
  'Event',
  'Reminder',
  'Handoff',
  'Custom',
];
const projectMilestoneTypeLabels: Record<ProjectMilestoneType, string> = {
  Deadline: 'Deadline',
  Decision: 'Decision',
  Review: 'Review',
  Event: 'Event',
  Reminder: 'Reminder',
  Handoff: 'Handoff',
  Custom: 'Custom',
};

const taskPriorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const taskPriorityTone: Record<string, string> = {
  low: 'border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]',
  medium:
    'border border-[color:rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.12)] text-[rgb(37,99,235)]',
  high:
    'border border-[color:rgba(245,158,11,0.2)] bg-[rgba(245,158,11,0.14)] text-[rgb(180,83,9)]',
  urgent:
    'border border-[color:rgba(255,95,64,0.22)] bg-[rgba(255,95,64,0.14)] text-[rgb(220,77,52)]',
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

const parseDateValue = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

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
  const date = parseDateValue(value);
  if (!date) return 'No date';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatDateRange = (start: string | null, end: string | null) => {
  if (start && end) return `${formatShortDate(start)} → ${formatShortDate(end)}`;
  if (start) return `Started ${formatShortDate(start)}`;
  if (end) return `Due ${formatShortDate(end)}`;
  return 'No dates set';
};

const formatShortDateLong = (value: string | null | undefined) => {
  if (!value) return 'No date';
  const date = parseDateValue(value);
  if (!date) return 'No date';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseTimelineDate = (value: string | null | undefined) => {
  const date = parseDateValue(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const startOfQuarter = (date: Date) => {
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterMonth, 1);
};

const addMonths = (date: Date, months: number) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);

const daysBetween = (start: Date, end: Date) => {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
};

const timelineOffsetPercent = (start: Date, end: Date, totalDays: number) =>
  Math.max(0, Math.min(100, ((end.getTime() - start.getTime()) / 86_400_000 / totalDays) * 100));

const formatCompactTime = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatEventDateLabel = (event: ProjectCalendarEvent) => {
  const date = formatShortDate(event.start_at);
  const time = event.all_day ? '' : formatCompactTime(event.start_at);
  return time ? `${date} · ${time}` : date;
};

const formatReminderDateLabel = (reminder: ProjectCalendarReminder) => {
  const date = formatShortDate(reminder.remind_at);
  const time = formatCompactTime(reminder.remind_at);
  return time ? `${date} · ${time}` : date;
};

const displayMemberName = (member: WorkspaceMember | null | undefined) => {
  if (!member) return 'Unknown';
  return member.full_name?.trim() || member.email?.trim() || 'Unknown';
};

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
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
  project_type: draft.projectType,
  lead_id: draft.leadId || null,
});

const makeEmptyProjectDraft = (): ProjectDraft => ({
  name: '',
  description: '',
  status: 'not_started',
  completeness: 0,
  color: '#007AFF',
  startDate: '',
  endDate: '',
  projectType: 'other',
  leadId: '',
});

type ProjectDraft = {
  name: string;
  description: string;
  status: ProjectSemanticStatus;
  completeness: number;
  color: string;
  startDate: string;
  endDate: string;
  projectType: ProjectTypeKind;
  leadId: string;
};

type ProjectTypeKind = 'code' | 'design' | 'personal' | 'ops' | 'writing' | 'other';

type ProjectTypeOption = {
  id: ProjectTypeKind;
  label: string;
  description: string;
  color: string;
  icon: typeof Code2;
};

const projectTypeOptions: ProjectTypeOption[] = [
  {
    id: 'code',
    label: 'Code',
    description: 'Engineering and product work',
    color: '#3B82F6',
    icon: Code2,
  },
  {
    id: 'design',
    label: 'Design',
    description: 'Graphic and visual work',
    color: '#FF5F40',
    icon: Palette,
  },
  {
    id: 'personal',
    label: 'Personal',
    description: 'Life admin and personal goals',
    color: '#22C55E',
    icon: UserRound,
  },
  {
    id: 'ops',
    label: 'Ops',
    description: 'Execution and coordination',
    color: '#F59E0B',
    icon: BriefcaseBusiness,
  },
  {
    id: 'writing',
    label: 'Writing',
    description: 'Docs, copy, and content',
    color: '#14B8A6',
    icon: FileText,
  },
  {
    id: 'other',
    label: 'Other',
    description: 'General project work',
    color: '#6B7280',
    icon: Sparkles,
  },
];

const getProjectTypeOption = (value: string | null | undefined) =>
  projectTypeOptions.find((option) => option.id === value) ?? projectTypeOptions[5];

export const ProjectsWindow = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const api = useApi();
  const isWindowsPlatform =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();
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
  const timelineContextRef = useRef<HTMLDivElement | null>(null);
  const timelineSurfaceRef = useRef<HTMLDivElement | null>(null);
  const timelineFieldRef = useRef<HTMLDivElement | null>(null);
  const timelineCanvasRef = useRef<HTMLDivElement | null>(null);
  const milestoneEditorRef = useRef<HTMLDivElement | null>(null);
  const milestoneDetailRef = useRef<HTMLDivElement | null>(null);
  const milestoneNameInputRef = useRef<HTMLInputElement | null>(null);
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
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(() => viewportWidth < 760);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(true);
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(
    null
  );
  const [taskContextMenu, setTaskContextMenu] = useState<TaskContextMenuState | null>(null);
  const [linkedNoteContextMenu, setLinkedNoteContextMenu] =
    useState<LinkedNoteContextMenuState | null>(null);
  const [timelineContextMenu, setTimelineContextMenu] = useState<TimelineContextMenuState | null>(
    null
  );
  const [workspaceMilestones, setWorkspaceMilestones] = useState<ProjectMilestoneRow[]>([]);
  const [isMilestonePlacementActive, setIsMilestonePlacementActive] = useState(false);
  const [milestonePlacementHint, setMilestonePlacementHint] = useState(
    'Click a project row to place a milestone.'
  );
  const [milestoneHover, setMilestoneHover] = useState<{
    projectId: string;
    date: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingMilestone, setPendingMilestone] = useState<{
    projectId: string | null;
    date: string;
    x: number;
    y: number;
  } | null>(null);
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState<{
    title: string;
    type: ProjectMilestoneType;
    date: string;
    note: string;
    projectId: string;
  }>({ title: '', type: 'Custom', date: todayKey(), note: '', projectId: '' });
  const [milestoneDraftTouched, setMilestoneDraftTouched] = useState(false);
  const [milestoneDraftError, setMilestoneDraftError] = useState<string | null>(null);
  const [isSavingMilestone, setIsSavingMilestone] = useState(false);
  const [milestoneDetail, setMilestoneDetail] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectType, setNewProjectType] = useState<ProjectTypeKind>('code');
  const [newProjectLeadId, setNewProjectLeadId] = useState('');
  const [newProjectNoteIds, setNewProjectNoteIds] = useState<string[]>([]);
  const [newProjectNotes, setNewProjectNotes] = useState<NoteOption[]>([]);
  const [isLoadingNewProjectNotes, setIsLoadingNewProjectNotes] = useState(false);
  const [newProjectNotesSearch, setNewProjectNotesSearch] = useState('');
  const [isNewProjectNotesExpanded, setIsNewProjectNotesExpanded] = useState(false);
  const [isCreatingProjectNow, setIsCreatingProjectNow] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(makeEmptyProjectDraft());
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    'medium'
  );
  const [newTaskDueDate, setNewTaskDueDate] = useState(todayKey());
  const [newTaskDueTime, setNewTaskDueTime] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskMilestoneId, setNewTaskMilestoneId] = useState('');
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isTaskComposerOpen, setIsTaskComposerOpen] = useState(false);
  const [actionsGroupBy, setActionsGroupBy] = useState<ActionsGroupBy>('type');
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [expandedMilestoneId, setExpandedMilestoneId] = useState<string | null>(null);
  const [actionDraft, setActionDraft] = useState({
    title: '',
    dueDate: '',
    dueTime: '',
    priority: 'medium',
    assignee: '',
    milestoneId: '',
    notes: '',
  });
  const [milestoneInlineDraft, setMilestoneInlineDraft] = useState({
    title: '',
    date: '',
    type: 'Custom' as ProjectMilestoneType,
    note: '',
  });
  const [isSavingActionDraft, setIsSavingActionDraft] = useState(false);
  const [isSavingMilestoneDraft, setIsSavingMilestoneDraft] = useState(false);
  const [taskNotesTaskId, setTaskNotesTaskId] = useState<string | null>(null);
  const [taskNotesDraft, setTaskNotesDraft] = useState('');
  const [isSavingTaskNotes, setIsSavingTaskNotes] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [linkedNotes, setLinkedNotes] = useState<ProjectNoteLink[]>([]);
  const [overviewNoteLinkCounts, setOverviewNoteLinkCounts] = useState<Record<string, number>>({});
  const [workspaceEvents, setWorkspaceEvents] = useState<ProjectCalendarEvent[]>([]);
  const [workspaceReminders, setWorkspaceReminders] = useState<ProjectCalendarReminder[]>([]);
  const [isLoadingLinkedNotes, setIsLoadingLinkedNotes] = useState(false);
  const [isLinkNoteModalOpen, setIsLinkNoteModalOpen] = useState(false);
  const [linkNoteTargetProjectId, setLinkNoteTargetProjectId] = useState<string | null>(null);
  const [isLinkingNote, setIsLinkingNote] = useState(false);
  const [selectedLinkNoteIds, setSelectedLinkNoteIds] = useState<string[]>([]);
  const [linkableNotes, setLinkableNotes] = useState<NoteOption[]>([]);
  const [isLoadingLinkableNotes, setIsLoadingLinkableNotes] = useState(false);
  const [linkNotesSearch, setLinkNotesSearch] = useState('');
  const [projectEvents, setProjectEvents] = useState<ProjectCalendarEvent[]>([]);
  const [projectReminders, setProjectReminders] = useState<ProjectCalendarReminder[]>([]);
  const [isLoadingProjectCalendarItems, setIsLoadingProjectCalendarItems] = useState(false);
  const [isLinkCalendarModalOpen, setIsLinkCalendarModalOpen] = useState(false);
  const [calendarLinkKind, setCalendarLinkKind] = useState<CalendarLinkKind>('event');
  const [calendarLinkSearch, setCalendarLinkSearch] = useState('');
  const [isLinkingCalendarItem, setIsLinkingCalendarItem] = useState(false);
  const [linkableCalendarEvents, setLinkableCalendarEvents] = useState<ProjectCalendarEvent[]>([]);
  const [linkableCalendarReminders, setLinkableCalendarReminders] = useState<
    ProjectCalendarReminder[]
  >([]);
  const [isLoadingLinkableCalendarItems, setIsLoadingLinkableCalendarItems] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [activeTab, setActiveTab] = useState<ProjectTab>('overview');
  const [projectsOverviewView, setProjectsOverviewView] =
    useState<ProjectsOverviewView>('timeline');
  const [projectsOverviewRange, setProjectsOverviewRange] =
    useState<ProjectsOverviewRange>('all');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingBrief, setIsEditingBrief] = useState(false);
  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed;
  const taskComposerRef = useRef<HTMLDivElement | null>(null);
  const taskTitleInputRef = useRef<HTMLInputElement | null>(null);

  const handleWorkspaceRefresh = useCallback(() => {
    setWorkspaceRefreshToken((current) => current + 1);
  }, []);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: [
      'projects',
      'tasks',
      'notes',
      'project_note_links',
      'project_milestones',
      'events',
      'reminders',
    ],
    enabled: Boolean(user && activeWorkspaceId),
    onChange: handleWorkspaceRefresh,
  });

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

  const selectedProjectMilestones = useMemo(() => {
    return workspaceMilestones
      .filter((milestone) => milestone.project_id === selectedProjectId)
      .sort((left, right) => String(left.milestone_date).localeCompare(String(right.milestone_date)));
  }, [selectedProjectId, workspaceMilestones]);

  const selectedProjectMilestoneById = useMemo(() => {
    return new Map(selectedProjectMilestones.map((milestone) => [milestone.id, milestone]));
  }, [selectedProjectMilestones]);

  const selectedProjectTasksByMilestone = useMemo(() => {
    const groups = new Map<string, TaskRow[]>();
    for (const task of selectedProjectTasks) {
      const milestoneId = task.milestone_id ?? '';
      groups.set(milestoneId, [...(groups.get(milestoneId) ?? []), task]);
    }
    return groups;
  }, [selectedProjectTasks]);

  const taskCounts = useMemo(() => {
    const active = selectedProjectTasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'cancelled'
    ).length;
    const completed = selectedProjectTasks.filter((task) => task.status === 'completed').length;
    return { active, completed, total: selectedProjectTasks.length };
  }, [selectedProjectTasks]);

  const projectTaskStats = useMemo(() => {
    const stats = new Map<string, { active: number; completed: number; total: number }>();
    for (const task of tasks) {
      if (!task.project_id) continue;
      const current = stats.get(task.project_id) ?? { active: 0, completed: 0, total: 0 };
      current.total += 1;
      if (task.status === 'completed') {
        current.completed += 1;
      } else if (task.status !== 'cancelled') {
        current.active += 1;
      }
      stats.set(task.project_id, current);
    }
    return stats;
  }, [tasks]);

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

  const recentProjectActivity = useMemo(() => {
    const events: Array<{ id: string; label: string; at: string | null }> = [];
    if (selectedProject?.updated_at) {
      events.push({
        id: 'project-updated',
        label: 'Project updated',
        at: selectedProject.updated_at,
      });
    }
    for (const event of projectEvents.slice(0, 3)) {
      events.push({
        id: `event-${event.id}`,
        label: `Event linked: ${event.title}`,
        at: event.updated_at ?? event.created_at ?? null,
      });
    }
    for (const reminder of projectReminders.slice(0, 3)) {
      events.push({
        id: `reminder-${reminder.id}`,
        label: `Reminder linked: ${reminder.title}`,
        at: reminder.updated_at ?? reminder.created_at ?? null,
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
  }, [completedProjectTasks, projectEvents, projectReminders, selectedProject?.updated_at]);

  const workspaceMemberById = useMemo(() => {
    return new Map(workspaceMembers.map((member) => [member.user_id, member]));
  }, [workspaceMembers]);

  const getAssigneeLabel = useCallback(
    (assigneeId: string | null | undefined) => {
      if (!assigneeId) return 'Unassigned';
      return displayMemberName(workspaceMemberById.get(assigneeId) ?? null);
    },
    [workspaceMemberById]
  );

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

  const isSharedWorkspace = workspaceMembers.length > 1;
  const workspaceLabel = activeWorkspace?.name?.trim() || 'Current workspace';
  const projectMetaLine = selectedProject
    ? `${projectStatusLabels[projectDraft.status]} · ${projectDraft.completeness}% · ${workspaceLabel}`
    : '';
  const overviewProjectStats = useMemo(() => {
    const total = projects.length;
    const active = projects.filter((project) => {
      const semantic = parseProjectStatus(String(project.status));
      return semantic !== 'completed' && semantic !== 'paused';
    }).length;
    const completed = projects.filter(
      (project) => parseProjectStatus(String(project.status)) === 'completed'
    ).length;
    const withoutDates = projects.filter((project) => !project.start_date && !project.end_date).length;
    const withoutActions = projects.filter(
      (project) => (projectTaskStats.get(project.id)?.active ?? 0) === 0
    ).length;
    const notes = Object.values(overviewNoteLinkCounts).reduce((sum, count) => sum + count, 0);
    return {
      total,
      active,
      completed,
      withoutDates,
      withoutActions,
      notes,
      events: workspaceEvents.length,
      reminders: workspaceReminders.length,
    };
  }, [overviewNoteLinkCounts, projectTaskStats, projects, workspaceEvents.length, workspaceReminders.length]);

  const timelineRange = useMemo(() => {
    const dated = projects
      .flatMap((project) => [parseTimelineDate(project.start_date), parseTimelineDate(project.end_date)])
      .filter((date): date is Date => Boolean(date));
    const now = new Date();
    const fallbackStart = startOfMonth(now);
    const fallbackEnd = addMonths(fallbackStart, projectsOverviewRange === 'month' ? 1 : 3);
    if (dated.length === 0) {
      return { start: fallbackStart, end: fallbackEnd };
    }
    if (projectsOverviewRange === 'month') {
      const anchor = startOfMonth(now);
      return { start: anchor, end: addMonths(anchor, 1) };
    }
    if (projectsOverviewRange === 'quarter') {
      const anchor = startOfQuarter(now);
      return { start: anchor, end: addMonths(anchor, 3) };
    }
    const min = new Date(Math.min(...dated.map((date) => date.getTime())));
    const max = new Date(Math.max(...dated.map((date) => date.getTime())));
    return {
      start: startOfMonth(addMonths(min, -1)),
      end: addMonths(startOfMonth(max), 3),
    };
  }, [projects, projectsOverviewRange]);

  const timelineMonths = useMemo(() => {
    const months: Date[] = [];
    let cursor = startOfMonth(timelineRange.start);
    const maxMonths = projectsOverviewRange === 'all' ? 18 : projectsOverviewRange === 'quarter' ? 3 : 1;
    while (cursor < timelineRange.end && months.length < maxMonths) {
      months.push(cursor);
      cursor = addMonths(cursor, 1);
    }
    return months;
  }, [projectsOverviewRange, timelineRange]);

  const timelineDays = daysBetween(timelineRange.start, timelineRange.end);
  const datedProjects = useMemo(
    () =>
      projects
        .filter((project) => project.start_date || project.end_date)
        .sort((left, right) =>
          String(left.start_date ?? left.end_date ?? '').localeCompare(
            String(right.start_date ?? right.end_date ?? '')
          )
        ),
    [projects]
  );
  const visibleDatedProjects = useMemo(
    () =>
      datedProjects.filter((project) => {
        if (projectsOverviewRange === 'all') return true;
        const start = parseTimelineDate(project.start_date) ?? parseTimelineDate(project.end_date);
        const end = parseTimelineDate(project.end_date) ?? parseTimelineDate(project.start_date);
        if (!start || !end) return false;
        return end >= timelineRange.start && start < timelineRange.end;
      }),
    [datedProjects, projectsOverviewRange, timelineRange]
  );
  const datelessProjects = useMemo(
    () => projects.filter((project) => !project.start_date && !project.end_date),
    [projects]
  );
  const workspaceMilestonesByProject = useMemo(() => {
    const grouped = new Map<string, ProjectMilestoneRow[]>();
    for (const milestone of workspaceMilestones) {
      const items = grouped.get(milestone.project_id) ?? [];
      items.push(milestone);
      grouped.set(milestone.project_id, items);
    }
    for (const items of grouped.values()) {
      items.sort((left, right) => String(left.milestone_date).localeCompare(String(right.milestone_date)));
    }
    return grouped;
  }, [workspaceMilestones]);
  const milestoneDetailRow = useMemo(
    () =>
      milestoneDetail
        ? workspaceMilestones.find((milestone) => milestone.id === milestoneDetail.id) ?? null
        : null,
    [milestoneDetail, workspaceMilestones]
  );
  const milestoneDetailProject = milestoneDetailRow
    ? projects.find((project) => project.id === milestoneDetailRow.project_id) ?? null
    : null;
  const overviewActivity = useMemo(() => {
    const events: Array<{ id: string; label: string; at: string | null }> = [
      ...projects.map((project) => ({
        id: `project-${project.id}`,
        label: `${project.name} updated`,
        at: project.updated_at ?? project.created_at ?? null,
      })),
      ...workspaceEvents.map((event) => ({
        id: `event-${event.id}`,
        label: `${event.title} linked`,
        at: event.updated_at ?? event.created_at ?? null,
      })),
      ...workspaceReminders.map((reminder) => ({
        id: `reminder-${reminder.id}`,
        label: `${reminder.title} linked`,
        at: reminder.updated_at ?? reminder.created_at ?? null,
      })),
    ];
    return events
      .filter((event) => event.at)
      .sort((left, right) => String(right.at).localeCompare(String(left.at)))
      .slice(0, 4);
  }, [projects, workspaceEvents, workspaceReminders]);
  const upcomingItems = useMemo(() => {
    if (!selectedProject) return [];
    const items: Array<{ id: string; title: string; meta: string; kind: string }> = [];
    if (projectDraft.endDate) {
      items.push({
        id: 'project-deadline',
        title: `${projectDraft.name || selectedProject.name} deadline`,
        meta: formatShortDate(projectDraft.endDate),
        kind: 'Deadline',
      });
    }
    for (const event of projectEvents.slice(0, 3)) {
      items.push({
        id: `event-${event.id}`,
        title: event.title,
        meta: formatEventDateLabel(event),
        kind: 'Event',
      });
    }
    for (const reminder of projectReminders.slice(0, 3)) {
      items.push({
        id: `reminder-${reminder.id}`,
        title: reminder.title,
        meta: formatReminderDateLabel(reminder),
        kind: 'Reminder',
      });
    }
    for (const task of activeProjectTasks.filter((item) => item.due_date).slice(0, 2)) {
      items.push({
        id: `task-${task.id}`,
        title: task.title,
        meta: task.due_time
          ? `${formatShortDate(task.due_date)} · ${task.due_time}`
          : formatShortDate(task.due_date),
        kind: 'Action',
      });
    }
    return items.slice(0, 6);
  }, [
    activeProjectTasks,
    projectDraft.endDate,
    projectDraft.name,
    projectEvents,
    projectReminders,
    selectedProject,
  ]);

  const linkedObjectCounts = {
    notes: linkedNotes.length,
    events: projectEvents.length,
    reminders: projectReminders.length,
    captures: 0,
  };

  const filteredNewProjectNotes = useMemo(() => {
    const term = newProjectNotesSearch.trim().toLowerCase();
    if (!term) return newProjectNotes;
    return newProjectNotes.filter((note) =>
      [note.title, note.preview, note.updated_at ? formatShortDate(note.updated_at) : '']
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [newProjectNotes, newProjectNotesSearch]);

  const projectMenuPosition = useMemo(() => {
    if (!projectContextMenu) return null;
    return getClampedMenuPosition(projectContextMenu.x, projectContextMenu.y, 208, 304);
  }, [projectContextMenu]);

  const taskMenuPosition = useMemo(() => {
    if (!taskContextMenu) return null;
    return getClampedMenuPosition(taskContextMenu.x, taskContextMenu.y, 256, 520);
  }, [taskContextMenu]);
  const linkedNoteMenuPosition = useMemo(() => {
    if (!linkedNoteContextMenu) return null;
    return getClampedMenuPosition(linkedNoteContextMenu.x, linkedNoteContextMenu.y, 208, 144);
  }, [linkedNoteContextMenu]);

  const milestoneEditorPosition = useMemo(() => {
    if (!pendingMilestone) return null;
    return getClampedMenuPosition(pendingMilestone.x + 10, pendingMilestone.y + 10, 320, 560);
  }, [pendingMilestone]);

  const milestoneDetailPosition = useMemo(() => {
    if (!milestoneDetail) return null;
    return getClampedMenuPosition(milestoneDetail.x + 10, milestoneDetail.y + 10, 280, 320);
  }, [milestoneDetail]);

  const timelineMenuPosition = useMemo(() => {
    if (!timelineContextMenu) return null;
    const width = 248;
    const contextProject =
      timelineContextMenu.kind === 'grid'
        ? null
        : projects.find((project) => project.id === timelineContextMenu.projectId) ?? null;
    const height =
      timelineContextMenu.kind === 'grid'
        ? 224
        : timelineContextMenu.kind === 'marker'
        ? 244
        : timelineContextMenu.kind === 'project' &&
          contextProject &&
          parseProjectStatus(String(contextProject.status)) === 'completed'
        ? 240
        : 304;
    return getClampedMenuPosition(timelineContextMenu.x, timelineContextMenu.y, width, height);
  }, [projects, timelineContextMenu]);

  const timelineContextProject = useMemo(() => {
    if (!timelineContextMenu || timelineContextMenu.kind === 'grid') return null;
    if (timelineContextMenu.kind === 'project') {
      return projects.find((project) => project.id === timelineContextMenu.projectId) ?? null;
    }
    if (timelineContextMenu.projectId) {
      return projects.find((project) => project.id === timelineContextMenu.projectId) ?? null;
    }
    return null;
  }, [projects, timelineContextMenu]);

  const timelineContextProjectStatus = timelineContextProject
    ? parseProjectStatus(String(timelineContextProject.status))
    : null;
  const timelineContextProjectHasDates = Boolean(
    timelineContextProject?.start_date || timelineContextProject?.end_date
  );

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

  const filteredLinkableCalendarItems = useMemo(() => {
    const term = calendarLinkSearch.trim().toLowerCase();
    if (calendarLinkKind === 'event') {
      return linkableCalendarEvents.filter((event) => {
        const haystack = [
          event.title,
          event.notes ?? '',
          formatEventDateLabel(event),
        ]
          .join(' ')
          .toLowerCase();
        return !term || haystack.includes(term);
      });
    }

    return linkableCalendarReminders.filter((reminder) => {
      const haystack = [
        reminder.title,
        reminder.notes ?? '',
        formatReminderDateLabel(reminder),
      ]
        .join(' ')
        .toLowerCase();
      return !term || haystack.includes(term);
    });
  }, [
    calendarLinkKind,
    calendarLinkSearch,
    linkableCalendarEvents,
    linkableCalendarReminders,
  ]);

  const syncDraftFromProject = useCallback((project: ProjectRow) => {
    setProjectDraft({
      name: project.name,
      description: project.description ?? '',
      status: parseProjectStatus(String(project.status)),
      completeness: Math.max(0, Math.min(100, Number(project.completeness) || 0)),
      color: project.color || '#007AFF',
      startDate: project.start_date ?? '',
      endDate: project.end_date ?? '',
      projectType: projectTypeOptions.some((option) => option.id === project.project_type)
        ? (project.project_type as ProjectTypeKind)
        : 'other',
      leadId: project.lead_id ?? '',
    });
    isDirtyRef.current = false;
  }, []);

  const loadProjects = useCallback(async () => {
    if (!user || !activeWorkspaceId) {
      setProjects([]);
      setSelectedProjectId(null);
      setProjectDraft(makeEmptyProjectDraft());
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

        isDirtyRef.current = false;
        setProjectDraft(makeEmptyProjectDraft());
        return null;
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load projects.');
      setProjects([]);
      setSelectedProjectId(null);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [api, activeWorkspaceId, user]);

  const loadTasks = useCallback(async () => {
    if (!user || !activeWorkspaceId) {
      setTasks([]);
      setIsLoadingTasks(false);
      return;
    }

    setIsLoadingTasks(true);
    setTaskError(null);

    try {
      const data = await api.getTasks();
      const rows = (data ?? []) as TaskRow[];
      setTasks(rows);
      setSelectedTaskId((current) => {
        if (!selectedProjectId) return null;
        if (current && rows.some((task) => task.id === current && task.project_id === selectedProjectId)) {
          return current;
        }
        return rows.find((task) => task.project_id === selectedProjectId)?.id ?? null;
      });
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

  const resetTaskComposer = useCallback(() => {
    setNewTaskTitle('');
    setNewTaskPriority('medium');
    setNewTaskDueDate(todayKey());
    setNewTaskDueTime('');
    setNewTaskAssignee('');
    setNewTaskMilestoneId('');
    setTaskError(null);
  }, []);

  const selectProject = useCallback(
    async (project: ProjectRow) => {
      if (selectedProjectId === project.id) return;
      const saved = await flushProjectDraft();
      if (!saved && isDirtyRef.current) return;
      setSelectedProjectId(project.id);
      syncDraftFromProject(project);
      setSelectedTaskId(null);
      setActiveTab('overview');
      setIsEditingTitle(false);
      setIsEditingBrief(false);
      setIsTaskComposerOpen(false);
      resetTaskComposer();
    },
    [flushProjectDraft, resetTaskComposer, selectedProjectId, syncDraftFromProject]
  );

  const selectProjectsOverview = useCallback(async () => {
    if (!selectedProjectId) return;
    const saved = await flushProjectDraft();
    if (!saved && isDirtyRef.current) return;
    setSelectedProjectId(null);
    setSelectedTaskId(null);
    setActiveTab('overview');
    setIsEditingTitle(false);
    setIsEditingBrief(false);
    setIsTaskComposerOpen(false);
    resetTaskComposer();
    isDirtyRef.current = false;
    setProjectDraft(makeEmptyProjectDraft());
  }, [flushProjectDraft, resetTaskComposer, selectedProjectId]);

  const getProjectById = useCallback(
    (projectId: string) => projects.find((project) => project.id === projectId) ?? null,
    [projects]
  );

  const openProjectById = useCallback(
    async (projectId: string) => {
      const project = getProjectById(projectId);
      if (!project) return;
      await selectProject(project);
    },
    [getProjectById, selectProject]
  );

  const createTimelineTodo = useCallback((label: string, projectId: string, extra?: string) => {
    console.debug(`[projects timeline] TODO: ${label}`, { projectId, extra });
  }, []);

  const openTimelineGridMenu = useCallback((x: number, y: number, date: string | null) => {
    setTimelineContextMenu({ kind: 'grid', x, y, date });
  }, []);

  const openTimelineProjectMenu = useCallback(
    (x: number, y: number, projectId: string, date: string | null = null) => {
      setTimelineContextMenu({ kind: 'project', x, y, projectId, date });
    },
    []
  );

  const openTimelineMarkerMenu = useCallback(
    (
      x: number,
      y: number,
      markerId: string,
      projectId: string | null,
      label: string,
      markerType: 'milestone' | 'event' | 'reminder'
    ) => {
      setTimelineContextMenu({ kind: 'marker', x, y, markerId, projectId, label, markerType });
    },
    []
  );

  const getDateFromTimelinePosition = useCallback(
    (clientX: number, surface: HTMLElement | null) => {
      if (!surface || timelineDays <= 0) return null;
      const rect = surface.getBoundingClientRect();
      if (!rect.width) return null;
      const clampedX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const timelineRatio = clampedX / rect.width;
      const dayOffset = Math.round(timelineRatio * Math.max(0, timelineDays - 1));
      const snappedDate = addDays(timelineRange.start, dayOffset);
      return formatDateKey(snappedDate);
    },
    [timelineDays, timelineRange.start]
  );

  const getTimelinePositionFromDate = useCallback(
    (value: string | null | undefined) => {
      const date = parseTimelineDate(value);
      if (!date || timelineDays <= 0) return 0;
      return timelineOffsetPercent(timelineRange.start, date, timelineDays);
    },
    [timelineDays, timelineRange.start]
  );

  const handleTimelineGridContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const surface = timelineCanvasRef.current ?? timelineFieldRef.current ?? (event.currentTarget as HTMLElement | null);
      const date = getDateFromTimelinePosition(event.clientX, surface);
      openTimelineGridMenu(event.clientX, event.clientY, date);
    },
    [getDateFromTimelinePosition, openTimelineGridMenu]
  );

  const handleTimelineProjectContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, projectId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const date = getDateFromTimelinePosition(event.clientX, timelineCanvasRef.current);
      openTimelineProjectMenu(event.clientX, event.clientY, projectId, date);
    },
    [getDateFromTimelinePosition, openTimelineProjectMenu]
  );

  const handleTimelineProjectRowContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, projectId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isProjectBar = Boolean(target?.closest('[data-timeline-project-bar="true"]'));
      if (isProjectBar) {
        const date = getDateFromTimelinePosition(event.clientX, timelineCanvasRef.current);
        openTimelineProjectMenu(event.clientX, event.clientY, projectId, date);
        return;
      }

      const surface = timelineCanvasRef.current;
      const date = getDateFromTimelinePosition(event.clientX, surface);
      openTimelineGridMenu(event.clientX, event.clientY, date);
    },
    [getDateFromTimelinePosition, openTimelineGridMenu, openTimelineProjectMenu]
  );

  const handleTimelineMarkerContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      markerId: string,
      projectId: string | null,
      label: string,
      markerType: 'milestone' | 'event' | 'reminder'
    ) => {
      event.preventDefault();
      event.stopPropagation();
      openTimelineMarkerMenu(event.clientX, event.clientY, markerId, projectId, label, markerType);
    },
    [openTimelineMarkerMenu]
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

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;

    setIsCreatingProjectNow(true);
    setError(null);

    try {
      const data = await api.createProject({
        name,
        description: newProjectDescription.trim() || null,
        color: getProjectTypeOption(newProjectType).color,
        start_date: null,
        end_date: null,
        status: 'NotStarted',
        project_type: newProjectType,
        lead_id: newProjectLeadId || null,
      });
      const created = data as ProjectRow;
      let linkNoteError: string | null = null;
      setProjects((prev) => {
        const next = prev.filter(
          (project) =>
            normalizeProjectNameKey(project.name) !== normalizeProjectNameKey(created.name)
        );
        return [created, ...next];
      });
      if (newProjectNoteIds.length > 0) {
        try {
          for (const noteId of newProjectNoteIds) {
            await api.linkProjectNote(created.id, noteId);
          }
        } catch (linkError) {
          linkNoteError =
            linkError instanceof Error ? linkError.message : 'Could not link one or more notes.';
        }
      }
      setSelectedProjectId(created.id);
      syncDraftFromProject(created);
      setNewProjectName('');
      setNewProjectDescription('');
      setNewProjectType('code');
      setNewProjectLeadId('');
      setNewProjectNoteIds([]);
      setNewProjectNotesSearch('');
      setIsNewProjectNotesExpanded(false);
      setIsCreatingProject(false);
      if (linkNoteError) {
        setError(linkNoteError);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create project.');
    } finally {
      setIsCreatingProjectNow(false);
    }
  }, [
    api,
    newProjectDescription,
    newProjectLeadId,
    newProjectName,
    newProjectNoteIds,
    newProjectType,
    syncDraftFromProject,
  ]);

  const openCreateProjectComposer = useCallback(() => {
    setIsCreatingProject(true);
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectType('code');
    setNewProjectLeadId(user?.id ?? '');
    setNewProjectNoteIds([]);
    setNewProjectNotesSearch('');
    setError(null);
    void (async () => {
      setIsLoadingNewProjectNotes(true);
      try {
        const payload = await api.getNotes();
        const rows = Array.isArray((payload as { notes?: unknown[] } | null)?.notes)
          ? ((payload as { notes?: unknown[] } | null)?.notes ?? [])
          : Array.isArray(payload)
          ? payload
          : [];
        const options = rows
          .filter((row): row is { id: string; title?: string; content?: string; content_html?: string; updated_at?: string | null } =>
            Boolean(row && typeof row === 'object' && 'id' in row)
          )
          .map((row) => ({
            id: String(row.id),
            title: String(row.title ?? 'Untitled note').trim(),
            preview: String(row.content ?? row.content_html ?? '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 120),
            updated_at: row.updated_at ?? null,
          }));
        setNewProjectNotes(options);
      } catch (error) {
        setNewProjectNotes([]);
        setError(error instanceof Error ? error.message : 'Could not load notes.');
      } finally {
        setIsLoadingNewProjectNotes(false);
      }
    })();
    window.setTimeout(() => {
      createProjectInputRef.current?.focus();
      createProjectInputRef.current?.select();
    }, 60);
  }, [api, user?.id]);

  const closeCreateProjectComposer = useCallback(() => {
    if (isCreatingProjectNow) return;
    setIsCreatingProject(false);
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectType('code');
    setNewProjectLeadId('');
    setNewProjectNoteIds([]);
    setNewProjectNotes([]);
    setNewProjectNotesSearch('');
    setIsNewProjectNotesExpanded(false);
  }, [isCreatingProjectNow]);

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
          setProjectDraft(makeEmptyProjectDraft());
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

  const createTask = useCallback(async (options?: { keepOpen?: boolean }) => {
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
        assigned_to: newTaskAssignee || null,
        milestone_id: newTaskMilestoneId || null,
        status: 'todo',
      });
      const created = data as TaskRow;
      setTasks((prev) => [created, ...prev]);
      if (options?.keepOpen) {
        setNewTaskTitle('');
        setNewTaskDueDate(todayKey());
        setNewTaskDueTime('');
        setTaskError(null);
        window.setTimeout(() => taskTitleInputRef.current?.focus(), 0);
      } else {
        setIsTaskComposerOpen(false);
        resetTaskComposer();
      }
    } catch (createError) {
      setTaskError(createError instanceof Error ? createError.message : 'Could not create task.');
    } finally {
      setIsCreatingTask(false);
    }
  }, [
    api,
    newTaskDueDate,
    newTaskDueTime,
    newTaskAssignee,
    newTaskMilestoneId,
    newTaskPriority,
    newTaskTitle,
    resetTaskComposer,
    selectedProjectId,
  ]);

  const closeTaskComposer = useCallback(
    (options?: { preserveDraft?: boolean }) => {
      setIsTaskComposerOpen(false);
      if (!options?.preserveDraft) {
        resetTaskComposer();
      }
    },
    [resetTaskComposer]
  );

  const taskComposerHasContent = Boolean(
    newTaskTitle.trim() ||
      newTaskPriority !== 'medium' ||
      newTaskDueDate !== todayKey() ||
      newTaskAssignee ||
      newTaskMilestoneId ||
      newTaskDueTime.trim()
  );

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

  const openActionInlineEditor = useCallback((task: TaskRow) => {
    setExpandedMilestoneId(null);
    setExpandedActionId(task.id);
    setActionDraft({
      title: task.title,
      dueDate: task.due_date ?? '',
      dueTime: task.due_time ?? '',
      priority: String(task.priority || 'medium'),
      assignee: task.assigned_to ?? '',
      milestoneId: task.milestone_id ?? '',
      notes: task.notes ?? '',
    });
  }, []);

  const closeActionInlineEditor = useCallback(() => {
    setExpandedActionId(null);
    setActionDraft({
      title: '',
      dueDate: '',
      dueTime: '',
      priority: 'medium',
      assignee: '',
      milestoneId: '',
      notes: '',
    });
  }, []);

  const saveActionInlineDraft = useCallback(
    async (task: TaskRow) => {
      const title = actionDraft.title.trim();
      if (!title) {
        setTaskError('Action title required.');
        return;
      }

      setIsSavingActionDraft(true);
      setTaskError(null);
      try {
        const updated = (await api.updateTask(task.id, {
          title,
          due_date: actionDraft.dueDate || null,
          due_time: actionDraft.dueTime || null,
          priority: actionDraft.priority,
          assigned_to: actionDraft.assignee || null,
          milestone_id: actionDraft.milestoneId || null,
          notes: actionDraft.notes.trim() || null,
        })) as TaskRow;
        setTasks((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        closeActionInlineEditor();
      } catch (updateError) {
        setTaskError(updateError instanceof Error ? updateError.message : 'Could not update action.');
      } finally {
        setIsSavingActionDraft(false);
      }
    },
    [actionDraft, api, closeActionInlineEditor]
  );

  const attachTaskToMilestone = useCallback(
    async (task: TaskRow, milestoneId: string | null) => {
      try {
        const updated = (await api.updateTask(task.id, {
          milestone_id: milestoneId,
        })) as TaskRow;
        setTasks((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      } catch (updateError) {
        setTaskError(updateError instanceof Error ? updateError.message : 'Could not attach action.');
      }
    },
    [api]
  );

  const duplicateTask = useCallback(
    async (task: TaskRow) => {
      try {
        const created = (await api.createTask({
          title: `${task.title} copy`,
          description: task.description,
          notes: task.notes,
          due_date: task.due_date,
          due_time: task.due_time,
          priority: task.priority,
          project_id: selectedProjectId,
          milestone_id: task.milestone_id ?? null,
          status: 'todo',
          tags: task.tags,
        })) as TaskRow;
        setTasks((prev) => [created, ...prev]);
      } catch (createError) {
        setTaskError(createError instanceof Error ? createError.message : 'Could not duplicate action.');
      }
    },
    [api, selectedProjectId]
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

  const loadProjectCalendarItems = useCallback(
    async (projectId: string) => {
      setIsLoadingProjectCalendarItems(true);
      try {
        const [eventsPayload, remindersPayload] = await Promise.all([
          api.getEvents(undefined, undefined, { projectId }),
          api.getReminders({ projectId }),
        ]);
        setProjectEvents(Array.isArray(eventsPayload) ? (eventsPayload as ProjectCalendarEvent[]) : []);
        setProjectReminders(
          Array.isArray(remindersPayload) ? (remindersPayload as ProjectCalendarReminder[]) : []
        );
      } catch (error) {
        console.error('Failed to load project calendar items:', error);
        setError(error instanceof Error ? error.message : 'Could not load project calendar items.');
        setProjectEvents([]);
        setProjectReminders([]);
      } finally {
        setIsLoadingProjectCalendarItems(false);
      }
    },
    [api]
  );

  const loadWorkspaceProjectContext = useCallback(async () => {
    if (!user || !activeWorkspaceId) {
      setOverviewNoteLinkCounts({});
      setWorkspaceEvents([]);
      setWorkspaceReminders([]);
      setWorkspaceMilestones([]);
      return;
    }

    try {
      const [eventsPayload, remindersPayload, milestonesPayload, noteLinkPayloads] = await Promise.all([
        api.getEvents(),
        api.getReminders(),
        api.getWorkspaceProjectMilestones(),
        Promise.all(
          projects.map(async (project) => {
            try {
              const payload = (await api.getProjectNoteLinks(project.id)) as {
                links?: ProjectNoteLink[];
              };
              return [project.id, Array.isArray(payload?.links) ? payload.links.length : 0] as const;
            } catch {
              return [project.id, 0] as const;
            }
          })
        ),
      ]);

      const projectIds = new Set(projects.map((project) => project.id));
      setWorkspaceEvents(
        Array.isArray(eventsPayload)
          ? (eventsPayload as ProjectCalendarEvent[]).filter((event) =>
              event.project_id ? projectIds.has(event.project_id) : false
            )
          : []
      );
      setWorkspaceReminders(
        Array.isArray(remindersPayload)
          ? (remindersPayload as ProjectCalendarReminder[]).filter((reminder) =>
              reminder.project_id ? projectIds.has(reminder.project_id) : false
            )
          : []
      );
      setWorkspaceMilestones(
        Array.isArray(milestonesPayload)
          ? (milestonesPayload as ProjectMilestoneRow[]).filter((milestone) =>
              milestone.project_id ? projectIds.has(milestone.project_id) : false
            )
          : []
      );
      setOverviewNoteLinkCounts(Object.fromEntries(noteLinkPayloads));
    } catch (error) {
      console.error('Failed to load workspace project context:', error);
      setWorkspaceEvents([]);
      setWorkspaceReminders([]);
      setWorkspaceMilestones([]);
      setOverviewNoteLinkCounts({});
    }
  }, [activeWorkspaceId, api, projects, user]);

  const loadLinkableNotes = useCallback(async (projectId: string) => {
    setIsLoadingLinkableNotes(true);
    try {
      const [projectLinksPayload, notesPayload] = await Promise.all([
        api.getProjectNoteLinks(projectId),
        api.getNotes(),
      ]);
      const linkedSet = new Set(
        Array.isArray((projectLinksPayload as { links?: ProjectNoteLink[] } | null)?.links)
          ? ((projectLinksPayload as { links?: ProjectNoteLink[] } | null)?.links ?? []).map(
              (item) => item.note_id
            )
          : []
      );
      const payload = notesPayload as {
        notes?: Array<{
          id: string;
          title?: string;
          content?: string;
          content_html?: string;
          updated_at?: string | null;
        }>;
      };
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
  }, [api]);

  const loadLinkableCalendarItems = useCallback(
    async () => {
      if (!selectedProjectId) return;
      setIsLoadingLinkableCalendarItems(true);
      try {
        const [eventsPayload, remindersPayload] = await Promise.all([
          api.getEvents(),
          api.getReminders(),
        ]);
        const allEvents = Array.isArray(eventsPayload) ? (eventsPayload as ProjectCalendarEvent[]) : [];
        const allReminders = Array.isArray(remindersPayload)
          ? (remindersPayload as ProjectCalendarReminder[])
          : [];
        setLinkableCalendarEvents(
          allEvents.filter((item) => item.id && item.project_id !== selectedProjectId)
        );
        setLinkableCalendarReminders(
          allReminders.filter((item) => item.id && item.project_id !== selectedProjectId)
        );
      } catch (error) {
        console.error('Failed to load linkable calendar items:', error);
        setError(error instanceof Error ? error.message : 'Could not load calendar items.');
        setLinkableCalendarEvents([]);
        setLinkableCalendarReminders([]);
      } finally {
        setIsLoadingLinkableCalendarItems(false);
      }
    },
    [api, selectedProjectId]
  );

  const openLinkNoteModal = useCallback(async (projectId: string | null = selectedProjectId) => {
    if (!projectId) return;
    setLinkNoteTargetProjectId(projectId);
    setIsLinkNoteModalOpen(true);
    setLinkNotesSearch('');
    setSelectedLinkNoteIds([]);
    await loadLinkableNotes(projectId);
  }, [loadLinkableNotes, selectedProjectId]);

  const openLinkCalendarModal = useCallback(
    async (kind: CalendarLinkKind) => {
      if (!selectedProjectId) return;
      setCalendarLinkKind(kind);
      setCalendarLinkSearch('');
      setIsLinkCalendarModalOpen(true);
      await loadLinkableCalendarItems();
    },
    [loadLinkableCalendarItems, selectedProjectId]
  );

  const handleAddAction = useCallback(
    async (projectId: string) => {
      await openProjectById(projectId);
      setActiveTab('actions');
      setIsTaskComposerOpen(true);
    },
    [openProjectById]
  );

  const handleEditDates = useCallback(
    async (projectId: string) => {
      createTimelineTodo('edit dates', projectId);
      await openProjectById(projectId);
      setActiveTab('overview');
    },
    [createTimelineTodo, openProjectById]
  );

  const handleAddDates = useCallback(
    async (projectId: string) => {
      createTimelineTodo('add dates', projectId);
      await openProjectById(projectId);
      setActiveTab('overview');
    },
    [createTimelineTodo, openProjectById]
  );

  const handleArchiveProject = useCallback(
    async (projectId: string) => {
      await updateProjectStatus(projectId, 'paused');
    },
    [updateProjectStatus]
  );

  const handleReviewProject = useCallback(
    async (projectId: string) => {
      await openProjectById(projectId);
      setActiveTab('activity');
    },
    [openProjectById]
  );

  const handleReopenProject = useCallback(
    async (projectId: string) => {
      await updateProjectStatus(projectId, 'in_progress');
    },
    [updateProjectStatus]
  );

  const handleNewProjectAtDate = useCallback((date: string | null) => {
    createTimelineTodo('new project at date', '__new__', date ?? undefined);
    setIsCreatingProject(true);
  }, [createTimelineTodo]);

  const handleAddReminderAtDate = useCallback((date: string | null) => {
    createTimelineTodo('add reminder at date', '__new__', date ?? undefined);
  }, [createTimelineTodo]);

  const handleCreateNoteAtDate = useCallback((date: string | null) => {
    createTimelineTodo('create note at date', '__new__', date ?? undefined);
  }, [createTimelineTodo]);

  const resetMilestoneDraft = useCallback(() => {
    setMilestoneDraft({
      title: '',
      type: 'Custom',
      date: todayKey(),
      note: '',
      projectId: '',
    });
    setMilestoneDraftTouched(false);
    setMilestoneDraftError(null);
  }, []);

  const cancelMilestonePlacement = useCallback(() => {
    setIsMilestonePlacementActive(false);
    setMilestonePlacementHint('Click a project row to place a milestone.');
    setMilestoneHover(null);
    setPendingMilestone(null);
    setEditingMilestoneId(null);
    setMilestoneDetail(null);
    resetMilestoneDraft();
  }, [resetMilestoneDraft]);

  const enterMilestonePlacementMode = useCallback(() => {
    if (viewportWidth < 760 || 'ontouchstart' in window) {
      const project = selectedProject ?? projects[0] ?? null;
      const date = project?.end_date ?? todayKey();
      setPendingMilestone({
        projectId: project?.id ?? null,
        date,
        x: Math.min(window.innerWidth - 280, Math.max(24, window.innerWidth / 2 - 140)),
        y: 180,
      });
      setEditingMilestoneId(null);
      setMilestoneDraft({
        title: '',
        type: 'Custom',
        date,
        note: '',
        projectId: project?.id ?? '',
      });
      setMilestoneDraftTouched(false);
      setMilestoneDraftError(null);
      setIsMilestonePlacementActive(false);
      window.setTimeout(() => milestoneNameInputRef.current?.focus(), 60);
      return;
    }

    setIsMilestonePlacementActive(true);
    setMilestonePlacementHint('Click a project row to place a milestone.');
    setTimelineContextMenu(null);
      setMilestoneDetail(null);
      setPendingMilestone(null);
      setEditingMilestoneId(null);
      resetMilestoneDraft();
  }, [projects, resetMilestoneDraft, selectedProject, viewportWidth]);

  const openMilestoneEditor = useCallback(
    (projectId: string | null, date: string, position: { x: number; y: number }) => {
      const project = projectId ? getProjectById(projectId) : null;
      setPendingMilestone({
        projectId,
        date,
        x: position.x,
        y: position.y,
      });
      setEditingMilestoneId(null);
      setMilestoneDraft({
        title: '',
        type: 'Custom',
        date,
        note: '',
        projectId: project?.id ?? (projects.length === 1 ? projects[0].id : ''),
      });
      setMilestoneDraftTouched(false);
      setMilestoneDraftError(null);
      setMilestoneDetail(null);
      window.setTimeout(() => milestoneNameInputRef.current?.focus(), 60);
    },
    [getProjectById, projects]
  );

  const handleAddMilestone = useCallback(
    async (projectId: string, date?: string | null, position?: { x: number; y: number }) => {
      const project = getProjectById(projectId);
      const nextDate = date || project?.end_date || todayKey();
      openMilestoneEditor(projectId, nextDate, position ?? { x: window.innerWidth / 2, y: 220 });
    },
    [getProjectById, openMilestoneEditor]
  );

  const handleAddMilestoneAtDate = useCallback(
    (date: string | null, position?: { x: number; y: number }) => {
      const nextDate = date || todayKey();
      const projectId = selectedProject?.id ?? (projects.length === 1 ? projects[0].id : null);
      openMilestoneEditor(projectId, nextDate, position ?? { x: window.innerWidth / 2, y: 220 });
    },
    [openMilestoneEditor, projects, selectedProject]
  );

  const saveMilestone = useCallback(async () => {
    const title = milestoneDraft.title.trim();
    const projectId = milestoneDraft.projectId || pendingMilestone?.projectId || '';
    const date = milestoneDraft.date || pendingMilestone?.date || '';
    if (!title) {
      setMilestoneDraftError('Name this milestone.');
      milestoneNameInputRef.current?.focus();
      return;
    }
    if (!projectId || !date) {
      setMilestoneDraftError(projectId ? 'Choose a date.' : 'Choose a project.');
      return;
    }

    setIsSavingMilestone(true);
    setMilestoneDraftError(null);
    try {
      const saved = editingMilestoneId
        ? ((await api.updateProjectMilestone(editingMilestoneId, {
            title,
            milestone_date: date,
            type: milestoneDraft.type,
            note: milestoneDraft.note.trim() || null,
            project_id: projectId,
          })) as ProjectMilestoneRow)
        : ((await api.createProjectMilestone(projectId, {
            title,
            milestone_date: date,
            type: milestoneDraft.type,
            note: milestoneDraft.note.trim() || null,
          })) as ProjectMilestoneRow);
      setWorkspaceMilestones((prev) =>
        [saved, ...prev.filter((milestone) => milestone.id !== saved.id)].sort((left, right) =>
          String(left.milestone_date).localeCompare(String(right.milestone_date))
        )
      );
      setPendingMilestone(null);
      setEditingMilestoneId(null);
      setIsMilestonePlacementActive(false);
      setMilestoneHover(null);
      resetMilestoneDraft();
    } catch (error) {
      setMilestoneDraftError(error instanceof Error ? error.message : 'Could not save milestone.');
    } finally {
      setIsSavingMilestone(false);
    }
  }, [api, editingMilestoneId, milestoneDraft, pendingMilestone, resetMilestoneDraft]);

  const openMilestoneDetail = useCallback((milestoneId: string, x: number, y: number) => {
    setMilestoneDetail({ id: milestoneId, x, y });
    setTimelineContextMenu(null);
    setPendingMilestone(null);
  }, []);

  const handleMilestoneCompleteToggle = useCallback(
    async (milestoneId: string) => {
      const current = workspaceMilestones.find((milestone) => milestone.id === milestoneId);
      if (!current) return;
      try {
        const updated = (await api.updateProjectMilestone(milestoneId, {
          completed: !current.completed,
        })) as ProjectMilestoneRow;
        setWorkspaceMilestones((prev) =>
          prev.map((milestone) => (milestone.id === updated.id ? updated : milestone))
        );
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update milestone.');
      }
    },
    [api, workspaceMilestones]
  );

  const openMilestoneInlineEditor = useCallback((milestone: ProjectMilestoneRow) => {
    setExpandedActionId(null);
    setExpandedMilestoneId(milestone.id);
    setMilestoneInlineDraft({
      title: milestone.title,
      date: milestone.milestone_date,
      type: projectMilestoneTypes.includes(milestone.type as ProjectMilestoneType)
        ? (milestone.type as ProjectMilestoneType)
        : 'Custom',
      note: milestone.note ?? '',
    });
  }, []);

  const closeMilestoneInlineEditor = useCallback(() => {
    setExpandedMilestoneId(null);
    setMilestoneInlineDraft({
      title: '',
      date: '',
      type: 'Custom',
      note: '',
    });
  }, []);

  const saveMilestoneInlineDraft = useCallback(
    async (milestone: ProjectMilestoneRow) => {
      const title = milestoneInlineDraft.title.trim();
      if (!title) {
        setError('Milestone title required.');
        return;
      }
      setIsSavingMilestoneDraft(true);
      try {
        const updated = (await api.updateProjectMilestone(milestone.id, {
          title,
          milestone_date: milestoneInlineDraft.date || milestone.milestone_date,
          type: milestoneInlineDraft.type,
          note: milestoneInlineDraft.note.trim() || null,
        })) as ProjectMilestoneRow;
        setWorkspaceMilestones((prev) =>
          prev.map((row) => (row.id === updated.id ? updated : row))
        );
        closeMilestoneInlineEditor();
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : 'Could not update milestone.');
      } finally {
        setIsSavingMilestoneDraft(false);
      }
    },
    [api, closeMilestoneInlineEditor, milestoneInlineDraft]
  );

  const handleMilestoneDateChange = useCallback(
    async (milestoneId: string, date: string) => {
      try {
        const updated = (await api.updateProjectMilestone(milestoneId, {
          milestone_date: date,
        })) as ProjectMilestoneRow;
        setWorkspaceMilestones((prev) =>
          prev.map((milestone) => (milestone.id === updated.id ? updated : milestone))
        );
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update milestone date.');
      }
    },
    [api]
  );

  const handleMilestoneDelete = useCallback(
    async (milestoneId: string) => {
      try {
        await api.deleteProjectMilestone(milestoneId);
        setWorkspaceMilestones((prev) => prev.filter((milestone) => milestone.id !== milestoneId));
        setMilestoneDetail(null);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not delete milestone.');
      }
    },
    [api]
  );

  const linkSelectedNotesToProject = useCallback(async () => {
    const projectId = linkNoteTargetProjectId ?? selectedProjectId;
    if (!projectId || selectedLinkNoteIds.length === 0) return;

    setIsLinkingNote(true);
    try {
      for (const noteId of selectedLinkNoteIds) {
        await api.linkProjectNote(projectId, noteId);
      }
      await loadLinkedNotes(projectId);
      setLinkableNotes((prev) => prev.filter((note) => !selectedLinkNoteIds.includes(note.id)));
      setSelectedLinkNoteIds([]);
      setIsLinkNoteModalOpen(false);
      setLinkNoteTargetProjectId(null);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not link note.');
    } finally {
      setIsLinkingNote(false);
    }
  }, [
    api,
    loadLinkedNotes,
    linkNoteTargetProjectId,
    selectedLinkNoteIds,
    selectedProjectId,
  ]);

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

  const linkCalendarItemToProject = useCallback(
    async (kind: CalendarLinkKind, itemId: string) => {
      if (!selectedProjectId) return;
      setIsLinkingCalendarItem(true);
      try {
        if (kind === 'event') {
          const updated = (await api.updateEvent(itemId, {
            project_id: selectedProjectId,
          })) as ProjectCalendarEvent;
          setProjectEvents((prev) =>
            prev.some((item) => item.id === updated.id)
              ? prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
              : [updated, ...prev]
          );
          setLinkableCalendarEvents((prev) => prev.filter((item) => item.id !== itemId));
        } else {
          const updated = (await api.updateReminder(itemId, {
            project_id: selectedProjectId,
          })) as ProjectCalendarReminder;
          setProjectReminders((prev) =>
            prev.some((item) => item.id === updated.id)
              ? prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
              : [updated, ...prev]
          );
          setLinkableCalendarReminders((prev) => prev.filter((item) => item.id !== itemId));
        }
        setIsLinkCalendarModalOpen(false);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Could not link calendar item to project.'
        );
      } finally {
        setIsLinkingCalendarItem(false);
      }
    },
    [api, selectedProjectId]
  );

  const unlinkCalendarItemFromProject = useCallback(
    async (kind: CalendarLinkKind, itemId: string) => {
      if (!selectedProjectId) return;
      try {
        if (kind === 'event') {
          const updated = (await api.updateEvent(itemId, { project_id: null })) as ProjectCalendarEvent;
          setProjectEvents((prev) => prev.filter((item) => item.id !== updated.id));
        } else {
          const updated = (await api.updateReminder(itemId, { project_id: null })) as ProjectCalendarReminder;
          setProjectReminders((prev) => prev.filter((item) => item.id !== updated.id));
        }
        void loadLinkableCalendarItems();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not unlink calendar item.');
        if (selectedProjectId) {
          void loadProjectCalendarItems(selectedProjectId);
        }
      }
    },
    [api, loadLinkableCalendarItems, loadProjectCalendarItems, selectedProjectId]
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
  }, [loadProjects, workspaceRefreshToken]);

  useEffect(() => {
    setLeftPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.projects.left)
    );
    setRightPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.projects.right)
    );
    if (viewportWidth < 760) {
      setIsLeftPaneCollapsed(true);
    }
    setIsRightPaneCollapsed(true);
  }, [viewportWidth]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks, workspaceRefreshToken]);

  useEffect(() => {
    void loadWorkspaceProjectContext();
  }, [loadWorkspaceProjectContext, workspaceRefreshToken]);

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
      setProjectEvents([]);
      setProjectReminders([]);
      setIsLoadingProjectCalendarItems(false);
      return;
    }
    setProjectEvents([]);
    setProjectReminders([]);
    void loadLinkedNotes(selectedProjectId);
    void loadProjectCalendarItems(selectedProjectId);
  }, [loadLinkedNotes, loadProjectCalendarItems, selectedProjectId, workspaceRefreshToken]);

  useEffect(() => {
    setIsRightPaneCollapsed(true);
  }, [workspaceRefreshToken]);

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
    setProjectsOverviewView('timeline');
    setProjectsOverviewRange('all');
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
      setProjectsOverviewView('timeline');
      setProjectsOverviewRange('all');
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
    if (!timelineContextMenu) return;

    const closeMenu = () => setTimelineContextMenu(null);
    const onPointerDown = (event: MouseEvent) => {
      if (timelineContextRef.current?.contains(event.target as Node)) return;
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
  }, [timelineContextMenu]);

  useEffect(() => {
    if (!isMilestonePlacementActive && !pendingMilestone && !milestoneDetail) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (pendingMilestone || isMilestonePlacementActive) {
        cancelMilestonePlacement();
        return;
      }
      setMilestoneDetail(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (pendingMilestone) {
        if (milestoneEditorRef.current?.contains(event.target as Node)) return;
        if (milestoneDraftTouched) return;
        setPendingMilestone(null);
        setEditingMilestoneId(null);
        resetMilestoneDraft();
        return;
      }
      if (milestoneDetail) {
        if (milestoneDetailRef.current?.contains(event.target as Node)) return;
        setMilestoneDetail(null);
      }
    };

    window.addEventListener('keydown', onEscape);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [
    cancelMilestonePlacement,
    isMilestonePlacementActive,
    milestoneDetail,
    milestoneDraftTouched,
    pendingMilestone,
    resetMilestoneDraft,
  ]);

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

  useEffect(() => {
    if (!isTaskComposerOpen) return;

    window.setTimeout(() => {
      taskTitleInputRef.current?.focus();
    }, 0);
  }, [isTaskComposerOpen]);

  useEffect(() => {
    if (!isTaskComposerOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (taskComposerRef.current?.contains(event.target as Node)) return;
      if (taskComposerHasContent) return;
      setIsTaskComposerOpen(false);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (taskComposerHasContent) return;
      setIsTaskComposerOpen(false);
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isTaskComposerOpen, taskComposerHasContent]);

  useEffect(() => {
    if (!expandedActionId && !expandedMilestoneId) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeActionInlineEditor();
      closeMilestoneInlineEditor();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    closeActionInlineEditor,
    closeMilestoneInlineEditor,
    expandedActionId,
    expandedMilestoneId,
  ]);

  const renderTaskRow = (task: TaskRow, completed = false, interactive = false) => {
    const linkedMilestone = task.milestone_id
      ? selectedProjectMilestoneById.get(task.milestone_id) ?? null
      : null;
    const expanded = interactive && expandedActionId === task.id;
    const draftDirty =
      expanded &&
      (actionDraft.title !== task.title ||
        actionDraft.dueDate !== (task.due_date ?? '') ||
        actionDraft.dueTime !== (task.due_time ?? '') ||
        actionDraft.priority !== String(task.priority || 'medium') ||
        actionDraft.assignee !== (task.assigned_to ?? '') ||
        actionDraft.milestoneId !== (task.milestone_id ?? '') ||
        actionDraft.notes !== (task.notes ?? ''));

    return (
      <div
        id={`task-row-${task.id}`}
        key={task.id}
        onClick={() => {
          if (interactive && !expanded) openActionInlineEditor(task);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setTaskContextMenu({
            x: e.clientX,
            y: e.clientY,
            taskId: task.id,
          });
        }}
        className={`group w-full rounded-lg px-2 py-2.5 text-left transition ${
          interactive && !expanded ? 'cursor-pointer hover:bg-[var(--ledger-surface-hover)]' : ''
        } ${expanded ? 'bg-[var(--ledger-background)]' : ''}`}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void updateTaskStatus(task, completed ? 'todo' : 'completed');
            }}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
              completed
                ? 'border-[color:rgba(50,213,131,0.35)] bg-[color:rgba(50,213,131,0.16)]'
                : 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-muted)]'
            }`}
            aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
          >
            {completed && <CheckCircle2 size={10} className="text-[rgb(22,163,74)]" />}
          </button>
          <div className="min-w-0 flex-1">
            <p
              className={`truncate text-sm font-medium ${
                completed
                  ? 'text-[var(--ledger-text-muted)] line-through'
                  : 'text-[var(--ledger-text-primary)]'
              }`}
            >
              {task.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
              {task.due_date ? `Due ${formatShortDate(task.due_date)}` : 'No due date'}
              {' · '}
              {getAssigneeLabel(task.assigned_to)}
              {linkedMilestone ? ` · ${linkedMilestone.title}` : ''}
              {task.notes ? ' · Has notes' : ''}
            </p>
          </div>
          {!completed && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-[0_1px_0_rgba(255,255,255,0.45)] ${
                taskPriorityTone[String(task.priority)] ??
                'border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]'
              }`}
            >
              {taskPriorityLabels[String(task.priority)] ?? 'Medium'}
            </span>
          )}
          {interactive && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setTaskContextMenu({
                  x: rect.right,
                  y: rect.bottom + 6,
                  taskId: task.id,
                });
              }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] opacity-0 transition ${
                expanded
                  ? 'pointer-events-none'
                  : 'hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] group-hover:opacity-100'
              }`}
              aria-label="Action options"
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        {expanded && (
          <div className="ml-6 mt-2 border-l border-[color:var(--ledger-border-subtle)] pl-3" onClick={(event) => event.stopPropagation()}>
            <input
              value={actionDraft.title}
              onChange={(event) =>
                setActionDraft((current) => ({ ...current, title: event.target.value }))
              }
              className="w-full rounded-md border border-transparent bg-transparent px-0 py-1 text-sm font-medium text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-subtle)] focus:bg-[var(--ledger-background)] focus:px-2"
            />
            <div className="mt-1 grid gap-1.5 md:grid-cols-[140px_130px_1fr_1fr]">
              <input
                type="date"
                value={actionDraft.dueDate}
                onChange={(event) =>
                  setActionDraft((current) => ({ ...current, dueDate: event.target.value }))
                }
                className="h-8 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 text-xs text-[var(--ledger-text-secondary)] outline-none"
              />
              <div className="relative min-w-0">
                <select
                  value={actionDraft.priority}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, priority: event.target.value }))
                  }
                  className="h-8 w-full appearance-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 pr-8 text-xs text-[var(--ledger-text-secondary)] outline-none"
                >
                  {Object.entries(taskPriorityLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                />
              </div>
              <div className="relative min-w-0">
                <select
                  value={actionDraft.assignee}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, assignee: event.target.value }))
                  }
                  className="h-8 w-full appearance-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 pr-8 text-xs text-[var(--ledger-text-secondary)] outline-none"
                >
                  <option value="">Unassigned</option>
                  {workspaceMembers.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {displayMemberName(member)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                />
              </div>
              <div className="relative min-w-0">
                <select
                  value={actionDraft.milestoneId}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, milestoneId: event.target.value }))
                  }
                  className="h-8 w-full appearance-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 pr-8 text-xs text-[var(--ledger-text-secondary)] outline-none"
                >
                  <option value="">No milestone</option>
                  {selectedProjectMilestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                />
              </div>
            </div>
            <textarea
              value={actionDraft.notes}
              onChange={(event) =>
                setActionDraft((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder="Details, links, blockers, or handoff notes."
              className="mt-1.5 h-14 w-full resize-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 py-1.5 text-xs text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeActionInlineEditor();
                }}
                className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void saveActionInlineDraft(task);
                }}
                disabled={!draftDirty || isSavingActionDraft}
                className="rounded-md bg-[var(--ledger-accent)] px-2.5 py-1 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
              >
                {isSavingActionDraft ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMilestoneRow = (milestone: ProjectMilestoneRow, interactive = false) => {
    const isOverdue =
      !milestone.completed &&
      parseTimelineDate(milestone.milestone_date) !== null &&
      parseTimelineDate(milestone.milestone_date)!.getTime() < new Date(todayKey()).getTime();
    const linkedActions = selectedProjectTasksByMilestone.get(milestone.id) ?? [];
    const expanded = interactive && expandedMilestoneId === milestone.id;
    const draftDirty =
      expanded &&
      (milestoneInlineDraft.title !== milestone.title ||
        milestoneInlineDraft.date !== milestone.milestone_date ||
        milestoneInlineDraft.type !== milestone.type ||
        milestoneInlineDraft.note !== (milestone.note ?? ''));

    return (
      <div
        key={milestone.id}
        className={`group rounded-lg px-2 py-2 transition ${
          interactive && !expanded ? 'cursor-pointer hover:bg-[var(--ledger-surface-hover)]' : ''
        } ${expanded ? 'bg-[var(--ledger-background)]' : ''}`}
        onClick={() => {
          if (interactive && !expanded) openMilestoneInlineEditor(milestone);
        }}
      >
        <div className="flex w-full items-center gap-2 text-left">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleMilestoneCompleteToggle(milestone.id);
            }}
            className={`flex h-3.5 w-3.5 shrink-0 rotate-45 items-center justify-center rounded-[4px] border transition ${
              milestone.completed
                ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-text-muted)]'
                : isOverdue
                ? 'border-[color:rgba(217,45,32,0.32)] bg-[color:rgba(217,45,32,0.12)]'
                : 'border-[color:var(--ledger-accent)] bg-[var(--ledger-surface-card)]'
            }`}
            aria-label={milestone.completed ? 'Mark milestone incomplete' : 'Mark milestone complete'}
          />
          <div className="min-w-0 flex-1">
            <p
              className={`truncate text-sm font-medium ${
                milestone.completed
                  ? 'text-[var(--ledger-text-muted)] line-through'
                  : 'text-[var(--ledger-text-primary)]'
              }`}
            >
              {milestone.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
              {milestone.type} · {formatShortDate(milestone.milestone_date)} ·{' '}
              {linkedActions.length} linked {linkedActions.length === 1 ? 'action' : 'actions'}
            </p>
          </div>
          {interactive && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openMilestoneDetail(milestone.id, event.clientX, event.clientY);
              }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] opacity-0 transition ${
                expanded
                  ? 'pointer-events-none'
                  : 'hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] group-hover:opacity-100'
              }`}
              aria-label="Milestone options"
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        {expanded && (
          <div className="ml-5 mt-3 border-l border-[color:var(--ledger-border-subtle)] pl-3" onClick={(event) => event.stopPropagation()}>
            <input
              value={milestoneInlineDraft.title}
              onChange={(event) =>
                setMilestoneInlineDraft((current) => ({ ...current, title: event.target.value }))
              }
              className="w-full rounded-md border border-transparent bg-transparent px-0 py-1 text-sm font-medium text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-subtle)] focus:bg-[var(--ledger-background)] focus:px-2"
            />
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <input
                type="date"
                value={milestoneInlineDraft.date}
                onChange={(event) =>
                  setMilestoneInlineDraft((current) => ({ ...current, date: event.target.value }))
                }
                className="h-8 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 text-xs text-[var(--ledger-text-secondary)] outline-none"
              />
              <div className="relative min-w-0">
                <select
                  value={milestoneInlineDraft.type}
                  onChange={(event) =>
                    setMilestoneInlineDraft((current) => ({
                      ...current,
                      type: event.target.value as ProjectMilestoneType,
                    }))
                  }
                  className="h-8 w-full appearance-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2 pr-8 text-xs text-[var(--ledger-text-secondary)] outline-none"
                >
                  {projectMilestoneTypes.map((type) => (
                    <option key={type} value={type}>
                      {projectMilestoneTypeLabels[type]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                />
              </div>
            </div>
            <textarea
              value={milestoneInlineDraft.note}
              onChange={(event) =>
                setMilestoneInlineDraft((current) => ({ ...current, note: event.target.value }))
              }
              placeholder="Milestone note"
              className="mt-2 h-16 w-full resize-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-placeholder)]"
            />
            <div className="mt-3 space-y-1">
              {linkedActions.length === 0 ? (
                <p className="px-1 py-1 text-xs text-[var(--ledger-text-muted)]">
                  No linked actions yet.
                </p>
              ) : (
                linkedActions.slice(0, 4).map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 text-xs text-[var(--ledger-text-secondary)]"
                  >
                    <span className="min-w-0 truncate">{action.title}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void attachTaskToMilestone(action, null);
                      }}
                      className="shrink-0 text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-danger)]"
                    >
                      Unlink
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setNewTaskMilestoneId(milestone.id);
                  setIsTaskComposerOpen(true);
                  window.setTimeout(() => taskTitleInputRef.current?.focus(), 0);
                }}
                className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                Add linked action
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeMilestoneInlineEditor();
                  }}
                  className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void saveMilestoneInlineDraft(milestone);
                  }}
                  disabled={!draftDirty || isSavingMilestoneDraft}
                  className="rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
                >
                  {isSavingMilestoneDraft ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTaskComposer = () =>
    isTaskComposerOpen ? (
      <div ref={taskComposerRef} className="mt-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-3">
        <input
          ref={taskTitleInputRef}
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void createTask({ keepOpen: e.metaKey || e.ctrlKey });
            }
            if (e.key === 'Escape' && !taskComposerHasContent) {
              e.preventDefault();
              closeTaskComposer();
            }
          }}
          placeholder="Add a next action..."
          className="w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,140px)_minmax(0,140px)] lg:grid-cols-[minmax(0,1fr)_140px_140px_150px_150px_auto_auto]">
          <div className="relative min-w-0">
            <select
              value={newTaskPriority}
              onChange={(e) => setNewTaskPriority(e.target.value as typeof newTaskPriority)}
              className="w-full min-w-0 appearance-none rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] py-2 pl-3 pr-9 text-sm text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            >
              {Object.entries(taskPriorityLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
            />
          </div>
          <input
            type="date"
            value={newTaskDueDate}
            onChange={(e) => setNewTaskDueDate(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 py-2 text-sm text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />
          <div className="relative min-w-0">
            <select
              value={newTaskAssignee}
              onChange={(e) => setNewTaskAssignee(e.target.value)}
              className="w-full min-w-0 appearance-none rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 py-2 pr-8 text-sm text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            >
              <option value="">Unassigned</option>
              {workspaceMembers.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {displayMemberName(member)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
            />
          </div>
          <div className="relative min-w-0">
            <select
              value={newTaskMilestoneId}
              onChange={(e) => setNewTaskMilestoneId(e.target.value)}
              className="w-full min-w-0 appearance-none rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 py-2 pr-8 text-sm text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            >
              <option value="">No milestone</option>
              {selectedProjectMilestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
            />
          </div>
          <input
            type="time"
            value={newTaskDueTime}
            onChange={(e) => setNewTaskDueTime(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 py-2 text-sm text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />
          <button
            type="button"
            onClick={() => closeTaskComposer()}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void createTask()}
            disabled={!newTaskTitle.trim() || isCreatingTask}
            className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
          >
            {isCreatingTask ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    ) : null;

  const renderSectionShell = (
    title: string,
    action: ReactNode,
    children: ReactNode,
    className = ''
  ) => (
    <section className={`min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] pb-2">
        <h3 className="text-sm font-medium text-[var(--ledger-text-primary)]">{title}</h3>
        {action}
      </div>
      <div className="pt-2">{children}</div>
    </section>
  );

  const renderActionTaskGroup = (
    label: string,
    items: TaskRow[],
    options?: { completed?: boolean; interactive?: boolean }
  ) =>
    items.length > 0 ? (
      <div className="mt-4 first:mt-0">
        <p className="mb-1 text-xs font-medium text-[var(--ledger-text-muted)]">{label}</p>
        <div className="space-y-1">
          {items.map((task) => renderTaskRow(task, Boolean(options?.completed), Boolean(options?.interactive)))}
        </div>
      </div>
    ) : null;

  const getDueDateGroups = (items: TaskRow[]) => {
    const today = todayKey();
    const weekEnd = formatDateKey(addDays(new Date(today), 7));
    return {
      overdue: items.filter((task) => task.due_date && task.due_date < today),
      today: items.filter((task) => task.due_date === today),
      week: items.filter((task) => task.due_date && task.due_date > today && task.due_date <= weekEnd),
      later: items.filter((task) => !task.due_date || task.due_date > weekEnd),
    };
  };

  const renderActionsContent = (interactive: boolean) => {
    if (isLoadingTasks) {
      return (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonTaskItem key={i} />
          ))}
        </div>
      );
    }

    if (selectedProjectTasks.length === 0 && selectedProjectMilestones.length === 0) {
      return (
        <div className="mt-3 py-2">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">No next actions yet.</p>
          <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
            Add the first action to keep this project moving.
          </p>
        </div>
      );
    }

    if (interactive && actionsGroupBy === 'due_date') {
      const groups = getDueDateGroups(activeProjectTasks);
      return (
        <div className="mt-2">
          {renderActionTaskGroup('Overdue', groups.overdue, { interactive })}
          {renderActionTaskGroup('Today', groups.today, { interactive })}
          {renderActionTaskGroup('This week', groups.week, { interactive })}
          {renderActionTaskGroup('Later', groups.later, { interactive })}
          {renderActionTaskGroup('Done', completedProjectTasks, { completed: true, interactive })}
        </div>
      );
    }

    if (interactive && actionsGroupBy === 'milestone') {
      const unlinkedActions = activeProjectTasks.filter((task) => !task.milestone_id);
      return (
        <div className="mt-2">
          {renderActionTaskGroup('Unlinked actions', unlinkedActions, { interactive })}
          {selectedProjectMilestones.map((milestone) => {
            const linked = (selectedProjectTasksByMilestone.get(milestone.id) ?? []).filter(
              (task) => task.status !== 'completed' && task.status !== 'cancelled'
            );
            return (
              <div key={milestone.id} className="mt-4">
                {renderMilestoneRow(milestone, interactive)}
                {linked.length > 0 && (
                  <div className="ml-5 mt-1 space-y-1">
                    {linked.map((task) => renderTaskRow(task, false, interactive))}
                  </div>
                )}
              </div>
            );
          })}
          {renderActionTaskGroup('Done', completedProjectTasks, { completed: true, interactive })}
        </div>
      );
    }

    const visibleActiveTasks = interactive ? activeProjectTasks : activeProjectTasks.slice(0, 4);
    const visibleMilestones = interactive
      ? selectedProjectMilestones
      : selectedProjectMilestones.slice(0, 4);

    return (
      <div className="mt-2 space-y-1">
        {visibleActiveTasks.length === 0 ? (
          <p className="px-2 py-2 text-sm text-[var(--ledger-text-muted)]">No active next actions.</p>
        ) : (
          <div className="space-y-1">
            {visibleActiveTasks.map((task) => renderTaskRow(task, false, interactive))}
          </div>
        )}
        {visibleMilestones.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-[var(--ledger-text-muted)]">Milestones</p>
            <div className="space-y-1">
              {visibleMilestones.map((milestone) => renderMilestoneRow(milestone, interactive))}
            </div>
          </div>
        )}
        {interactive && completedProjectTasks.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-[var(--ledger-text-muted)]">Done</p>
            <div className="space-y-1">
              {completedProjectTasks.map((task) => renderTaskRow(task, true, interactive))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderNextActionsSection = (showAll = false) =>
    renderSectionShell(
      'Next actions',
      <div className="flex items-center gap-2">
        {showAll && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--ledger-text-muted)]">
            <span>Group by</span>
            <select
              value={actionsGroupBy}
              onChange={(event) => setActionsGroupBy(event.target.value as ActionsGroupBy)}
              className="h-7 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-xs text-[var(--ledger-text-secondary)] outline-none"
            >
              <option value="type">Type</option>
              <option value="due_date">Due date</option>
              <option value="milestone">Milestone</option>
            </select>
          </label>
        )}
        <span className="hidden text-xs text-[var(--ledger-text-muted)] sm:inline">
          {taskCounts.active} active · {taskCounts.completed} done
        </span>
        <button
          type="button"
          onClick={() => {
            if (isTaskComposerOpen) {
              closeTaskComposer();
              return;
            }
            setIsTaskComposerOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          {isTaskComposerOpen ? <span className="text-xs leading-none">×</span> : <Plus size={12} />}
          {isTaskComposerOpen ? 'Cancel' : 'Add action'}
        </button>
      </div>,
      <>
        {renderTaskComposer()}
        {taskError && (
          <div className="mt-3 rounded-lg border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] px-3 py-2 text-sm text-[var(--ledger-danger)]">
            {taskError}
          </div>
        )}
        {renderActionsContent(showAll)}
      </>
    );

  const renderProjectNotesSection = () =>
    renderSectionShell(
      'Project notes',
      <button
        type="button"
        onClick={() => {
          void openLinkNoteModal();
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
      >
        <Plus size={12} />
        Link note
      </button>,
      <>
        {isLoadingLinkedNotes ? (
          <p className="mt-2 text-sm text-[var(--ledger-text-muted)]">Loading linked notes...</p>
        ) : linkedNotes.length === 0 ? (
          <div className="mt-2 py-2">
            <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
              No notes linked yet.
            </p>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
              Attach project notes, captures, or documents.
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            {linkedNotes.slice(0, 4).map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => openLinkedNoteInNotesModule(link.note_id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setLinkedNoteContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    noteId: link.note_id,
                    source: 'center',
                  });
                }}
                className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                    {link.note.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
                    {link.note.preview || 'Linked note'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-[var(--ledger-text-muted)]">Note</p>
                  <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                    {link.note.updated_at ? formatRelativeFromNow(link.note.updated_at) : 'Linked'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    );

  const renderCalendarItemRow = (
    kind: CalendarLinkKind,
    item: ProjectCalendarEvent | ProjectCalendarReminder
  ) => {
    const dateLabel =
      kind === 'event'
        ? formatEventDateLabel(item as ProjectCalendarEvent)
        : formatReminderDateLabel(item as ProjectCalendarReminder);
    const notes = item.notes?.trim() || null;
    return (
      <div
        key={item.id}
        className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--ledger-surface-hover)]"
      >
        <div className="min-w-0 py-0.5">
          <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
            {item.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
            {kind === 'event' ? 'Event' : 'Reminder'} · {dateLabel}
            {notes ? ` · ${notes}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void unlinkCalendarItemFromProject(kind, item.id)}
          className="shrink-0 text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-danger)]"
        >
          Remove
        </button>
      </div>
    );
  };

  const renderCalendarSection = () =>
    renderSectionShell(
      'Calendar',
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void openLinkCalendarModal('event')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          <Plus size={12} />
          Link event
        </button>
        <button
          type="button"
          onClick={() => void openLinkCalendarModal('reminder')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          <Plus size={12} />
          Link reminder
        </button>
      </div>,
      <>
        <div className="flex items-center gap-1 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-0.5 text-xs text-[var(--ledger-text-muted)]">
          <span className="rounded-md bg-[var(--ledger-surface-card)] px-2 py-0.5 text-[var(--ledger-text-primary)]">
            List
          </span>
          <span className="px-2 py-0.5">Timeline</span>
          <span className="px-2 py-0.5">Calendar</span>
        </div>

        {isLoadingProjectCalendarItems ? (
          <p className="mt-3 text-sm text-[var(--ledger-text-muted)]">Loading calendar items...</p>
        ) : projectEvents.length === 0 && projectReminders.length === 0 ? (
          <div className="mt-3 py-2">
            <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
              No calendar items linked yet.
            </p>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
              Attach events or reminders that belong to this project.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-5">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Events</p>
                <span className="text-xs text-[var(--ledger-text-muted)]">
                  {projectEvents.length}
                </span>
              </div>
              {projectEvents.length === 0 ? (
                <p className="py-1 text-sm text-[var(--ledger-text-muted)]">No events linked.</p>
              ) : (
                <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
                  {projectEvents
                    .slice()
                    .sort((left, right) => String(left.start_at).localeCompare(String(right.start_at)))
                    .map((event) => renderCalendarItemRow('event', event))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Reminders</p>
                <span className="text-xs text-[var(--ledger-text-muted)]">
                  {projectReminders.length}
                </span>
              </div>
              {projectReminders.length === 0 ? (
                <p className="py-1 text-sm text-[var(--ledger-text-muted)]">No reminders linked.</p>
              ) : (
                <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
                  {projectReminders
                    .slice()
                    .sort((left, right) => String(left.remind_at).localeCompare(String(right.remind_at)))
                    .map((reminder) => renderCalendarItemRow('reminder', reminder))}
                </div>
              )}
            </section>
          </div>
        )}
      </>
    );

  const renderUpcomingSection = () =>
    renderSectionShell(
      'Upcoming',
      <button
        type="button"
        onClick={() => setActiveTab('calendar')}
        className="text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
      >
        View
      </button>,
      upcomingItems.length === 0 ? (
        <div className="py-2">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">No upcoming dates.</p>
          <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
            Add an event, reminder, or deadline.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {upcomingItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg px-2 py-2"
            >
              <CalendarDays size={14} className="shrink-0 self-center text-[var(--ledger-text-muted)]" />
              <div className="min-w-0 flex-1 py-0.5">
                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">
                  {item.kind} · {item.meta}
                </p>
              </div>
            </div>
          ))}
        </div>
      )
    );

  const renderRecentActivitySection = () =>
    renderSectionShell(
      'Recent updates',
      <button
        type="button"
        onClick={() => setActiveTab('activity')}
        className="text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
      >
        View
      </button>,
      recentProjectActivity.length === 0 ? (
        <p className="py-2 text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>
      ) : (
        <div className="space-y-1">
          {recentProjectActivity.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2"
            >
              <p className="min-w-0 truncate text-sm font-normal text-[var(--ledger-text-secondary)]">
                {item.label}
              </p>
              <span className="shrink-0 text-xs text-[var(--ledger-text-muted)]">
                {formatRelativeFromNow(item.at)}
              </span>
            </div>
          ))}
        </div>
      )
    );

  const renderMemberStack = (size = 'h-5 w-5') =>
    isSharedWorkspace && workspaceMembers.length > 0 ? (
      <div className="flex -space-x-1">
        {workspaceMembers.slice(0, 5).map((member) => {
          const name = displayMemberName(member);
          return (
            <span
              key={member.user_id}
              title={name}
              className={`flex ${size} items-center justify-center rounded-full border border-[color:var(--ledger-surface-card)] bg-[var(--ledger-surface-hover)] text-[9px] font-semibold text-[var(--ledger-text-secondary)]`}
            >
              {getInitials(name)}
            </span>
          );
        })}
        {workspaceMembers.length > 5 && (
          <span
            title={`+${workspaceMembers.length - 5} more members`}
            className={`flex ${size} items-center justify-center rounded-full border border-[color:var(--ledger-surface-card)] bg-[var(--ledger-surface-hover)] text-[9px] font-semibold text-[var(--ledger-text-secondary)]`}
          >
            +{workspaceMembers.length - 5}
          </span>
        )}
      </div>
    ) : null;

  const renderCreatorBubble = (name: string, size = 'h-5 w-5') => (
    <span
      title={name}
      className={`flex ${size} items-center justify-center rounded-full border border-[color:var(--ledger-surface-card)] bg-[var(--ledger-surface-hover)] text-[9px] font-semibold text-[var(--ledger-text-secondary)]`}
    >
      {getInitials(name)}
    </span>
  );

  const renderProjectsTimelineOverview = () => {
    const timelineRailWidth = 300;
    const timelineMonthWidth = 220;
    const timelineRowPitch = 126;
    const timelineBarHeight = 42;
    const timelineWidth = Math.max(1180, timelineMonths.length * timelineMonthWidth);
    const timelineCanvasHeight = Math.max(
      720,
      viewportHeight - 324,
      240 + visibleDatedProjects.length * timelineRowPitch
    );
    const timelineBodyHeight = Math.max(600, timelineCanvasHeight - 72);
    const timelineSubdivisions = 4;
    const todayLeft = getTimelinePositionFromDate(todayKey());
    const showTodayMarker = todayLeft > 0 && todayLeft < 100;
    const [todayMonthLabel, todayDayLabel] = formatShortDate(todayKey()).split(' ');
    const getMonthTickDays = (month: Date) => {
      if (projectsOverviewRange === 'all') return [];
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      if (projectsOverviewRange === 'month') {
        return [1, 5, 10, 15, 20, 25, daysInMonth];
      }
      return [1, 15];
    };
    const getProjectLane = (project: ProjectRow) => {
      const start = parseTimelineDate(project.start_date) ?? parseTimelineDate(project.end_date);
      const end = parseTimelineDate(project.end_date) ?? parseTimelineDate(project.start_date);
      if (!start || !end) return { left: 0, width: 0 };
      const left = timelineOffsetPercent(timelineRange.start, start, timelineDays);
      const right = Math.max(left + 2, timelineOffsetPercent(timelineRange.start, addDays(end, 1), timelineDays));
      return { left, width: right - left };
    };
    const dateToX = (date: string) => {
      const parsed = parseTimelineDate(date);
      if (!parsed || timelineDays <= 0) return 0;
      return timelineOffsetPercent(timelineRange.start, parsed, timelineDays);
    };
    const needsAttention = [
      ...datelessProjects.slice(0, 1).map((project) => ({
        id: `dates-${project.id}`,
        label: `${project.name} has no dates set.`,
        action: 'Add dates',
        onClick: () => void selectProject(project),
      })),
      ...projects
        .filter((project) => (projectTaskStats.get(project.id)?.active ?? 0) === 0)
        .slice(0, 1)
        .map((project) => ({
          id: `actions-${project.id}`,
          label: `${project.name} has no next actions.`,
          action: 'Add action',
          onClick: () => {
            void selectProject(project).then(() => setIsTaskComposerOpen(true));
          },
        })),
      ...projects
        .filter((project) => parseProjectStatus(String(project.status)) === 'completed')
        .slice(0, 1)
        .map((project) => ({
          id: `complete-${project.id}`,
          label: `${project.name} is complete.`,
          action: 'Review',
          onClick: () => void selectProject(project),
        })),
    ].slice(0, 3);
    const currentProjects = visibleDatedProjects.filter(
      (project) => parseProjectStatus(String(project.status)) !== 'completed'
    );
    const completedProjects = visibleDatedProjects.filter(
      (project) => parseProjectStatus(String(project.status)) === 'completed'
    );
    const groupedProjects = [
      { id: 'current', label: 'Current', projects: currentProjects },
      { id: 'completed', label: 'Completed', projects: completedProjects },
    ].filter((group) => group.projects.length > 0);
    const listProjects =
      projectsOverviewRange === 'all'
        ? [...datedProjects, ...datelessProjects]
        : [...visibleDatedProjects, ...datelessProjects];
    const viewOptions: Array<{ id: ProjectsOverviewView; label: string }> = [
      { id: 'timeline', label: 'Roadmap' },
      { id: 'list', label: 'List' },
    ];
    const rangeOptions: Array<{ id: ProjectsOverviewRange; label: string }> = [
      { id: 'month', label: 'Month' },
      { id: 'quarter', label: 'Quarter' },
      { id: 'all', label: 'All' },
    ];

    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-5">
        <section className="flex flex-col gap-4 border-b border-[color:var(--ledger-border-subtle)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--ledger-text-muted)]">
              <span>{workspaceLabel}</span>
              {isSharedWorkspace ? (
                <span className="flex items-center gap-2">
                  <span>·</span>
                  {renderMemberStack('h-5 w-5')}
                </span>
              ) : (
                <span>· Personal workspace</span>
              )}
            </div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--ledger-text-primary)]">
              Projects roadmap
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ledger-text-secondary)]">
              See how outcomes, notes, and next actions unfold across this workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-0.5 text-xs font-medium">
              {viewOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setProjectsOverviewView(option.id)}
                  className={`rounded px-2.5 py-1 transition ${
                    projectsOverviewView === option.id
                      ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)]'
                      : 'text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex h-8 items-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-0.5 text-xs font-medium">
              {rangeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setProjectsOverviewRange(option.id)}
                  className={`rounded px-2 py-1 transition ${
                    projectsOverviewRange === option.id
                      ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)]'
                      : 'text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (isCreatingProject) {
                  closeCreateProjectComposer();
                  return;
                }
                openCreateProjectComposer();
              }}
              title={isCreatingProject ? 'Cancel new project' : 'Create a new project'}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-2.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
            >
              <Plus size={12} />
              {isCreatingProject ? 'Cancel' : 'New project'}
            </button>
            <button
              type="button"
              onClick={
                isMilestonePlacementActive || pendingMilestone
                  ? cancelMilestonePlacement
                  : enterMilestonePlacementMode
              }
              title={isMilestonePlacementActive ? 'Cancel milestone placement' : 'Place a milestone'}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
                isMilestonePlacementActive || pendingMilestone
                  ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                  : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              {isMilestonePlacementActive || pendingMilestone ? <X size={12} /> : <Flag size={12} />}
            </button>
          </div>
        </section>

        {(isMilestonePlacementActive || milestonePlacementHint !== 'Click a project row to place a milestone.') && (
          <section className="flex items-center gap-2 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-text-secondary)]">
            <Flag size={13} className="shrink-0 text-[var(--ledger-accent)]" />
            <span className="font-medium text-[var(--ledger-text-primary)]">Place a milestone</span>
            <span>{milestonePlacementHint}</span>
          </section>
        )}

        {needsAttention.length > 0 && (
          <section className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <p className="shrink-0 text-xs font-semibold text-[var(--ledger-text-primary)]">
                Needs attention
              </p>
              <div className="relative min-w-0 flex-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-6 bg-linear-to-r from-[var(--ledger-surface-muted)] to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-8 bg-linear-to-l from-[var(--ledger-surface-muted)] to-transparent" />
                <div className="overflow-x-auto pr-2 [scrollbar-width:thin]">
                  <div className="flex min-w-max items-center gap-2">
                    {needsAttention.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={item.onClick}
                        className="inline-flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-accent)] text-[9px] font-semibold leading-none text-white">
                          !
                        </span>
                        <span className="min-w-0 truncate">{item.label}</span>
                        <span className="shrink-0 font-medium text-[var(--ledger-accent)]">
                          {item.action}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {projects.length === 0 ? (
          <section className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-6 py-10 text-center">
            <div className="max-w-sm">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)]">
                <Folder size={18} className="text-[var(--ledger-text-secondary)]" />
              </div>
              <h3 className="mt-4 text-xl font-semibold tracking-tight text-[var(--ledger-text-primary)]">
                Start a project
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-secondary)]">
                Projects keep outcomes, notes, calendar context, and next actions connected.
              </p>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => {
                  if (isCreatingProject) {
                    closeCreateProjectComposer();
                    return;
                  }
                  openCreateProjectComposer();
                }}
                title={isCreatingProject ? 'Cancel new project' : 'Create a new project'}
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-[var(--ledger-accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
              >
                <Plus size={16} />
                {isCreatingProject ? 'Cancel' : 'New project'}
              </button>
            </div>
          </section>
        ) : projectsOverviewView === 'list' ? (
          <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-none">
            <div className="border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                Project list
              </p>
              <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                {projectsOverviewRange === 'month'
                  ? 'Month view'
                  : projectsOverviewRange === 'quarter'
                  ? 'Quarter view'
                  : 'All dated and unscheduled projects'}
              </p>
            </div>
            <div className="overflow-auto">
              <div className="min-w-[880px] divide-y divide-[color:var(--ledger-border-subtle)]">
                <div className="grid grid-cols-[minmax(260px,1.5fr)_120px_140px_minmax(150px,0.9fr)_minmax(180px,1fr)] gap-2 px-4 py-2 text-xs font-medium text-[var(--ledger-text-muted)]">
                  <span>Project</span>
                  <span>Status</span>
                  <span>Timeline</span>
                  <span>Context</span>
                  <span>Workspace</span>
                </div>
                {listProjects.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-[var(--ledger-text-muted)]">
                    No projects in this range.
                  </div>
                ) : (
                  listProjects.map((project) => {
                    const semantic = parseProjectStatus(String(project.status));
                    const completeness = Math.max(
                      0,
                      Math.min(100, Number(project.completeness) || 0)
                    );
                    const stats = projectTaskStats.get(project.id) ?? {
                      active: 0,
                      completed: 0,
                      total: 0,
                    };
                    const linkedEvents = workspaceEvents.filter(
                      (event) => event.project_id === project.id
                    ).length;
                    const linkedReminders = workspaceReminders.filter(
                      (reminder) => reminder.project_id === project.id
                    ).length;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => void selectProject(project)}
                        onContextMenu={(event) => handleTimelineProjectContextMenu(event, project.id)}
                        className="grid w-full grid-cols-[minmax(260px,1.5fr)_120px_140px_minmax(150px,0.9fr)_minmax(180px,1fr)] gap-2 px-4 py-2.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: project.color || '#FF5F40' }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                              {project.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-[var(--ledger-text-muted)]">
                              {project.description?.trim() || 'No brief yet'}
                            </span>
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                            {projectStatusLabels[semantic]}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--ledger-text-muted)]">
                            {completeness}%
                          </span>
                        </span>
                        <span className="truncate text-sm text-[var(--ledger-text-secondary)]">
                          {formatDateRange(project.start_date, project.end_date)}
                        </span>
                        <span className="min-w-0 text-sm text-[var(--ledger-text-secondary)]">
                          <span className="block truncate">
                            {stats.active} actions · {overviewNoteLinkCounts[project.id] ?? 0} notes
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--ledger-text-muted)]">
                            {(linkedEvents || linkedReminders) > 0
                              ? `${linkedEvents + linkedReminders} linked dates`
                              : 'No linked dates'}
                          </span>
                        </span>
                        <span className="min-w-0 text-sm text-[var(--ledger-text-secondary)]">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 truncate">{workspaceLabel}</span>
                            {isSharedWorkspace && (
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="text-[var(--ledger-text-muted)]">·</span>
                                {renderMemberStack('h-4 w-4')}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_18px_50px_rgba(17,24,39,0.06)]">
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <div className="flex-1 overflow-auto">
                  <div
                    className="relative flex min-h-full flex-1 flex-col"
                    style={{
                      width: `${timelineRailWidth + timelineWidth}px`,
                      minHeight: `${timelineCanvasHeight}px`,
                    }}
                  >
                    <div
                      className="grid min-h-full"
                      style={{ gridTemplateColumns: `${timelineRailWidth}px minmax(0, 1fr)` }}
                    >
                      <aside
                        className={`sticky left-0 top-0 z-20 h-full overflow-hidden rounded-l-xl border-r border-[color:var(--ledger-border-subtle)] ${
                          isWindowsPlatform
                            ? 'bg-[var(--ledger-surface-muted)]/96'
                            : 'bg-[var(--ledger-surface-muted)]/75 backdrop-blur'
                        }`}
                      >
                        <div className="flex h-full flex-col">
                          <div className="border-b border-[color:var(--ledger-border-subtle)] px-3 py-2.5">
                            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                              Workspace projects
                            </p>
                            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                              {overviewProjectStats.active} active · {overviewProjectStats.completed} completed
                            </p>
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto p-2.5">
                            {groupedProjects.map((group) => (
                              <div key={group.id} className="mb-3 last:mb-0">
                                <p className="mb-1 px-1 text-[11px] font-semibold text-[var(--ledger-text-muted)]">
                                  {group.label}
                                </p>
                                <div className="space-y-1">
                                  {group.projects.map((project) => {
                                    const semantic = parseProjectStatus(String(project.status));
                                    const stats = projectTaskStats.get(project.id) ?? {
                                      active: 0,
                                      completed: 0,
                                      total: 0,
                                    };
                                    return (
                                      <button
                                        key={project.id}
                                        type="button"
                                        onClick={() => void selectProject(project)}
                                        onContextMenu={(event) =>
                                          handleTimelineProjectContextMenu(event, project.id)
                                        }
                                        className="group w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                                      >
                                        <div className="flex items-start gap-2">
                                          <span
                                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: project.color || '#FF5F40' }}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <p className="truncate text-[13px] font-semibold text-[var(--ledger-text-primary)]">
                                              {project.name}
                                            </p>
                                            <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">
                                              {projectStatusLabels[semantic]} · {stats.active} actions
                                            </p>
                                            <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">
                                              {isSharedWorkspace
                                                ? `${workspaceLabel} · ${workspaceMembers.length} members`
                                                : workspaceLabel}
                                            </p>
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                            {datelessProjects.length > 0 && (
                              <div className="border-t border-[color:var(--ledger-border-subtle)] pt-3">
                                <p className="mb-1 px-1 text-[11px] font-semibold text-[var(--ledger-text-muted)]">
                                  Needs dates
                                </p>
                                <div className="space-y-1">
                                  {datelessProjects.map((project) => (
                                    <button
                                      key={project.id}
                                      type="button"
                                      onClick={() => void selectProject(project)}
                                      onContextMenu={(event) =>
                                        handleTimelineProjectContextMenu(event, project.id)
                                      }
                                      className="w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                                    >
                                      <p className="truncate text-[13px] font-semibold text-[var(--ledger-text-primary)]">
                                        {project.name}
                                      </p>
                                      <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                                        No dates set · Add start or due date
                                      </p>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </aside>

                      <div
                        ref={timelineSurfaceRef}
                        data-timeline-surface="true"
                        className="relative min-w-0 overflow-hidden"
                        onContextMenu={handleTimelineGridContextMenu}
                      >
                        <div
                          ref={timelineFieldRef}
                          className="relative h-full min-h-[560px]"
                        >
                          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-linear-to-r from-[var(--ledger-surface-card)] to-transparent" />
                          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-linear-to-l from-[var(--ledger-surface-card)] to-transparent" />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-linear-to-t from-[var(--ledger-surface-card)] to-transparent" />
                          <div className="h-full overflow-auto">
                            <div
                              ref={timelineCanvasRef}
                              className="relative min-h-full"
                              style={{ width: `${timelineWidth}px`, minHeight: `${timelineCanvasHeight}px` }}
                            >
                              {showTodayMarker && (
                                <div
                                  className="pointer-events-none absolute z-[7] -translate-x-1/2"
                                  style={{ left: `${dateToX(todayKey())}%`, top: 0, bottom: 0 }}
                                >
                                  <span className="absolute left-1/2 top-4 z-[8] flex min-w-[38px] -translate-x-1/2 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-2 py-0.5 text-[10px] font-semibold leading-none text-white shadow-[0_10px_20px_rgba(255,95,64,0.18)]">
                                    <span className="flex flex-col items-center justify-center gap-0.5 text-center">
                                      <span className="block">{todayMonthLabel}</span>
                                      <span className="block">{todayDayLabel}</span>
                                    </span>
                                  </span>
                                  <span
                                    className="absolute left-1/2 top-[38px] bottom-0 w-px -translate-x-1/2 bg-[var(--ledger-accent)]/60"
                                    aria-hidden="true"
                                  />
                                  <span
                                    className="absolute left-1/2 top-[38px] z-[8] h-0.5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--ledger-accent)]/75"
                                    aria-hidden="true"
                                  />
                                </div>
                              )}
                              <div className="sticky top-0 z-[5] border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]/96">
                                <div
                                  className="grid h-[58px]"
                                  style={{
                                    gridTemplateColumns: `repeat(${timelineMonths.length}, minmax(${timelineMonthWidth}px, 1fr))`,
                                    backgroundImage:
                                      'linear-gradient(to right, color-mix(in srgb, var(--ledger-border-subtle) 40%, transparent) 1px, transparent 1px)',
                                    backgroundSize: `${timelineWidth / Math.max(1, timelineMonths.length * timelineSubdivisions)}px 100%`,
                                  }}
                                >
                                  {timelineMonths.map((month) => (
                                    <div
                                      key={month.toISOString()}
                                      className="border-r border-[color:var(--ledger-border-subtle)] px-3 py-2 last:border-r-0"
                                    >
                                      <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ledger-text-secondary)]">
                                        {month.toLocaleDateString([], { month: 'short' })}
                                      </p>
                                      {projectsOverviewRange !== 'all' && (
                                        <div
                                          className="mt-1 grid text-[10px] text-[var(--ledger-text-muted)]"
                                          style={{
                                            gridTemplateColumns: `repeat(${getMonthTickDays(month).length}, minmax(0, 1fr))`,
                                          }}
                                        >
                                          {getMonthTickDays(month).map((day) => (
                                            <span key={day} className="tabular-nums leading-none">
                                              {day}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div
                                className="relative"
                                style={{
                                  minHeight: `${timelineBodyHeight}px`,
                                  backgroundImage:
                                    'linear-gradient(to right, color-mix(in srgb, var(--ledger-border-subtle) 72%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--ledger-border-subtle) 28%, transparent) 1px, transparent 1px)',
                                  backgroundSize: `${timelineWidth / Math.max(1, timelineMonths.length * timelineSubdivisions)}px 100%`,
                                }}
                              >
                                {visibleDatedProjects.length === 0 ? (
                                  <div className="flex h-72 items-center justify-center px-6 text-center">
                                    <div className="max-w-sm">
                                      <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                                        No dated projects yet.
                                      </p>
                                      <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                                        Add start or due dates to place projects on the workspace timeline.
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                              <div className="relative flex-1" style={{ minHeight: `${timelineBodyHeight}px` }}>
                                    {visibleDatedProjects.map((project, index) => {
                          const semantic = parseProjectStatus(String(project.status));
                          const lane = getProjectLane(project);
                          const completeness = Math.max(0, Math.min(100, Number(project.completeness) || 0));
                          const barTop = 82 + index * timelineRowPitch + (index % 2 === 0 ? 0 : 24);
                          const labelTop = Math.max(20, barTop - 36);
                          const stats = projectTaskStats.get(project.id) ?? {
                            active: 0,
                            completed: 0,
                            total: 0,
                          };
                          const projectMilestones = workspaceMilestonesByProject.get(project.id) ?? [];
                          const visibleProjectMilestones =
                            projectsOverviewRange === 'all'
                              ? projectMilestones
                              : projectMilestones.filter((milestone) => {
                                  const milestoneDate = parseTimelineDate(milestone.milestone_date);
                                  if (!milestoneDate) return false;
                                  return (
                                    milestoneDate >= timelineRange.start &&
                                    milestoneDate < timelineRange.end
                                  );
                                });
                          const todayDate = parseTimelineDate(todayKey());
                          const todayX = dateToX(todayKey());
                          const sortedMilestoneLayouts = visibleProjectMilestones
                            .map((milestone) => {
                              const milestoneDate = parseTimelineDate(milestone.milestone_date);
                              const markerLeft = dateToX(milestone.milestone_date);
                              const markerX = (markerLeft / 100) * timelineWidth;
                              const daysFromToday =
                                milestoneDate && todayDate
                                  ? Math.round(
                                      (milestoneDate.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000)
                                    )
                                  : 999;
                              const isActive = daysFromToday === 0;
                              const isUpcomingSoon = daysFromToday > 0 && daysFromToday <= 21;
                              const isDeadline = milestone.type.toLowerCase() === 'deadline';
                              const isOverdue = !milestone.completed && daysFromToday < 0;
                              const priority =
                                (isActive ? 100 : 0) +
                                (isUpcomingSoon ? 70 : 0) +
                                (isDeadline ? 35 : 0) +
                                (milestone.completed ? -45 : 0) +
                                (isOverdue ? 25 : 0);
                              const labelWidth = Math.min(144, Math.max(76, milestone.title.length * 6.3));
                              const tooCloseToToday =
                                !isActive &&
                                showTodayMarker &&
                                Math.abs(markerLeft - todayX) < (30 / Math.max(timelineWidth, 1)) * 100;

                              return {
                                milestone,
                                markerLeft,
                                markerX,
                                labelWidth,
                                priority,
                                isActive,
                                isOverdue,
                                labelVisible: !tooCloseToToday,
                                labelLane: 0,
                              };
                            })
                            .sort((left, right) => right.priority - left.priority);
                          const labelOccupancy: Array<Array<[number, number]>> = [[], [], []];
                          const milestoneLayouts = sortedMilestoneLayouts
                            .map((layout) => {
                              if (!layout.labelVisible) return layout;
                              const halfWidth = layout.labelWidth / 2;
                              const nextInterval: [number, number] = [
                                layout.markerX - halfWidth - 10,
                                layout.markerX + halfWidth + 10,
                              ];
                              const lane = labelOccupancy.findIndex((intervals) =>
                                intervals.every(
                                  ([start, end]) => nextInterval[1] < start || nextInterval[0] > end
                                )
                              );
                              if (lane === -1) return { ...layout, labelVisible: false };
                              labelOccupancy[lane].push(nextInterval);
                              return { ...layout, labelLane: lane };
                            })
                            .sort((left, right) => left.markerX - right.markerX);
                          return (
                            <div
                              key={project.id}
                              onClick={(event) => {
                                if (!isMilestonePlacementActive) return;
                                event.preventDefault();
                                event.stopPropagation();
                                const date =
                                  getDateFromTimelinePosition(event.clientX, timelineCanvasRef.current) ??
                                  project.end_date ??
                                  todayKey();
                                openMilestoneEditor(project.id, date, {
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                              onMouseMove={(event) => {
                                if (!isMilestonePlacementActive) return;
                                const date = getDateFromTimelinePosition(
                                  event.clientX,
                                  timelineCanvasRef.current
                                );
                                if (!date) {
                                  setMilestonePlacementHint('Choose a project row.');
                                  setMilestoneHover(null);
                                  return;
                                }
                                setMilestonePlacementHint('Click a project row to place a milestone.');
                                setMilestoneHover({
                                  projectId: project.id,
                                  date,
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                              onMouseLeave={() => {
                                if (milestoneHover?.projectId === project.id) setMilestoneHover(null);
                              }}
                              onContextMenu={(event) =>
                                handleTimelineProjectRowContextMenu(event, project.id)
                              }
                              title={`${project.name} · ${formatDateRange(project.start_date, project.end_date)} · ${stats.active} active actions · ${overviewNoteLinkCounts[project.id] ?? 0} notes`}
                              className={`absolute left-0 block h-28 w-full text-left ${
                                isMilestonePlacementActive ? 'cursor-crosshair' : 'cursor-default'
                              }`}
                              style={{ top: `${barTop - 52}px` }}
                            >
                              {isMilestonePlacementActive &&
                                milestoneHover?.projectId === project.id &&
                                milestoneHover.date && (
                                  <div
                                    className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-[var(--ledger-accent)]/25"
                                    style={{ left: `${dateToX(milestoneHover.date)}%` }}
                                  />
                                )}
                              <button
                                type="button"
                                data-timeline-project-bar="true"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (isMilestonePlacementActive) {
                                    const date =
                                      getDateFromTimelinePosition(event.clientX, timelineCanvasRef.current) ??
                                      project.end_date ??
                                      todayKey();
                                    openMilestoneEditor(project.id, date, {
                                      x: event.clientX,
                                      y: event.clientY,
                                    });
                                    return;
                                  }
                                  void selectProject(project);
                                }}
                                onContextMenu={(event) =>
                                  handleTimelineProjectRowContextMenu(event, project.id)
                                }
                                className="absolute rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] shadow-[0_10px_28px_rgba(17,24,39,0.05)] transition hover:border-[color:var(--ledger-border-strong)] hover:shadow-[0_14px_34px_rgba(17,24,39,0.08)]"
                                style={{
                                  left: `${lane.left}%`,
                                  top: '52px',
                                  width: `${Math.max(5, lane.width)}%`,
                                  height: `${timelineBarHeight}px`,
                                }}
                              >
                                  <div
                                    className="h-full rounded-[inherit] opacity-20"
                                    style={{
                                      width: `${semantic === 'completed' ? 100 : completeness}%`,
                                      backgroundColor: project.color || '#FF5F40',
                                    }}
                                  />
                                </button>
                                {milestoneLayouts.map(({ milestone, markerLeft, labelVisible, labelLane, isActive, isOverdue }) => {
                                  return (
                                    <div
                                      key={milestone.id}
                                      className="group absolute z-[3] -translate-x-1/2"
                                      style={{ left: `${markerLeft}%`, top: '64px' }}
                                    >
                                      <span
                                        title={`${milestone.title}\n${milestone.type} · ${formatShortDate(
                                          milestone.milestone_date
                                        )}\n${project.name}`}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          openMilestoneDetail(milestone.id, event.clientX, event.clientY);
                                        }}
                                        onContextMenu={(event) =>
                                          handleTimelineMarkerContextMenu(
                                            event,
                                            milestone.id,
                                            project.id,
                                            milestone.title,
                                            'milestone'
                                          )
                                        }
                                        className={`mx-auto flex h-[18px] w-[18px] rotate-45 items-center justify-center rounded-[4px] border shadow-[0_8px_18px_rgba(17,24,39,0.05)] transition ${
                                          isActive
                                            ? 'border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)]'
                                            : milestone.completed
                                            ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-text-muted)]/70'
                                            : isOverdue
                                            ? 'border-[color:rgba(217,45,32,0.46)] bg-[var(--ledger-surface-card)]'
                                            : 'border-[color:var(--ledger-accent)] bg-[var(--ledger-surface-card)]'
                                        }`}
                                      >
                                        {milestone.completed && (
                                          <CheckCircle2
                                            size={11}
                                            className="-rotate-45 text-[var(--ledger-surface-card)] opacity-0 transition group-hover:opacity-100"
                                          />
                                        )}
                                        {isActive && (
                                          <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                                        )}
                                      </span>
                                      {labelVisible && (
                                        <span
                                          className={`absolute left-1/2 w-36 -translate-x-1/2 truncate text-center text-[11px] font-medium leading-tight text-[var(--ledger-text-muted)] ${
                                            milestone.completed ? 'opacity-55' : 'opacity-[0.82]'
                                          }`}
                                          style={{
                                            top: `${22 + labelLane * 16}px`,
                                          }}
                                        >
                                          {milestone.title}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                                {pendingMilestone?.projectId === project.id && (
                                  <span
                                    className="pointer-events-none absolute z-[4] flex h-[18px] w-[18px] -translate-x-1/2 rotate-45 items-center justify-center rounded-[4px] border border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)]/20"
                                    style={{ left: `${dateToX(pendingMilestone.date)}%`, top: '64px' }}
                                  />
                                )}
                                {isMilestonePlacementActive &&
                                  milestoneHover?.projectId === project.id &&
                                  milestoneHover.date && (
                                    <div
                                      className="pointer-events-none absolute top-4 z-[4] -translate-x-1/2"
                                      style={{ left: `${dateToX(milestoneHover.date)}%` }}
                                    >
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ledger-text-secondary)] shadow-[var(--ledger-shadow)]">
                                          {formatShortDate(milestoneHover.date)}
                                        </span>
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--ledger-accent)] bg-[var(--ledger-surface-card)] text-[var(--ledger-accent)] opacity-80">
                                          <Flag size={11} />
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                <button
                                  type="button"
                                  className="absolute flex max-w-[420px] items-center gap-2 text-left"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void selectProject(project);
                                  }}
                                  onContextMenu={(event) =>
                                    handleTimelineProjectRowContextMenu(event, project.id)
                                  }
                                  style={{
                                    left: `${Math.max(0, Math.min(94, lane.left))}%`,
                                    top: `${labelTop - (barTop - 52)}px`,
                                  }}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: project.color || '#FF5F40' }}
                                  />
                                  <span className="truncate text-[13px] font-semibold text-[var(--ledger-text-secondary)]">
                                    {project.name}
                                  </span>
                                  <span className="shrink-0 text-[13px] font-medium text-[var(--ledger-text-muted)]">
                                    {projectStatusLabels[semantic]}
                                  </span>
                                </button>
                            </div>
                            );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
          </section>
        )}
      </div>
    );
  };

  const renderTabContent = () => {
    if (activeTab === 'actions') return renderNextActionsSection(true);
    if (activeTab === 'notes') return renderProjectNotesSection();
    if (activeTab === 'calendar') return renderCalendarSection();
    if (activeTab === 'activity') return renderRecentActivitySection();

    return (
      <div className={`grid gap-6 ${isCompactLayout ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.8fr)]'}`}>
        <div className="space-y-6">
          {renderNextActionsSection(false)}
          {renderProjectNotesSection()}
        </div>
        <div className="space-y-6">
          {renderUpcomingSection()}
          {renderRecentActivitySection()}
        </div>
      </div>
    );
  };

  const attemptCloseProjects = useCallback(() => {
    if (isSavingProject || isSavingTaskNotes || isDirtyRef.current) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('projects');
  }, [isSavingProject, isSavingTaskNotes]);

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-none"
      style={{ scrollbarGutter: isLinkNoteModalOpen || showCloseGuardModal ? 'auto' : 'stable' }}
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
        subtitle="Outcomes, notes, and next actions in one place."
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
              onClick={() => void selectProjectsOverview()}
              title="Show projects roadmap"
            >
              Roadmap
            </ModuleHeaderActionButton>
            <ModuleHeaderActionButton
              onClick={() => {
                if (isCreatingProject) {
                  closeCreateProjectComposer();
                  return;
                }
                openCreateProjectComposer();
              }}
              title={isCreatingProject ? 'Cancel new project' : 'Create a new project'}
            >
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
        <div className="border-b border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] px-5 py-2 text-xs text-[var(--ledger-danger)]">
          {error}
        </div>
      )}

      <ModalOverlay
        isOpen={isCreatingProject}
        onClose={closeCreateProjectComposer}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[620px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">New project</p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Add a brief, choose a type, assign the lead, and attach context.
            </p>
          </div>
          <ModalCloseButton
            onClick={closeCreateProjectComposer}
            ariaLabel="Close new project modal"
            className="shrink-0"
          />
        </div>

        <div className="space-y-4 px-5 py-5">
          <input
            ref={createProjectInputRef}
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void createProject();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeCreateProjectComposer();
              }
            }}
            placeholder="Project name"
            className="h-10 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <textarea
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
            placeholder="Brief description"
            rows={3}
            className="w-full resize-none rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <div className="flex flex-wrap items-center gap-2">
            {projectTypeOptions.map((option) => {
              const active = newProjectType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setNewProjectType(option.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
                    active
                      ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                      : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  {(() => {
                    const TypeIcon = option.icon;
                    return <TypeIcon size={12} />;
                  })()}
                  {option.label}
                </button>
              );
            })}

            <select
              value={newProjectLeadId}
              onChange={(e) => setNewProjectLeadId(e.target.value)}
              className="inline-flex h-8 min-w-[144px] items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-xs font-medium text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            >
              <option value="">Working on it</option>
              {user && (
                <option value={user.id}>{user.user_metadata?.full_name?.trim() || user.email || 'You'}</option>
              )}
              {workspaceMembers
                .filter((member) => member.user_id !== user?.id)
                .map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {displayMemberName(member)}
                  </option>
                ))}
            </select>

            <button
              type="button"
              onClick={() => setIsNewProjectNotesExpanded((current) => !current)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
                isNewProjectNotesExpanded || newProjectNoteIds.length > 0
                  ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                  : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              <Link2 size={12} />
              {newProjectNoteIds.length > 0 ? `${newProjectNoteIds.length} notes` : 'Link notes'}
            </button>
          </div>

          {isNewProjectNotesExpanded && (
            <div className="space-y-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-3">
              <input
                value={newProjectNotesSearch}
                onChange={(e) => setNewProjectNotesSearch(e.target.value)}
                placeholder="Search notes"
                className="h-9 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
              />
              <div className="max-h-[220px] overflow-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]">
                {isLoadingNewProjectNotes ? (
                  <p className="p-3 text-sm text-[var(--ledger-text-muted)]">Loading notes…</p>
                ) : filteredNewProjectNotes.length === 0 ? (
                  <p className="p-3 text-sm text-[var(--ledger-text-muted)]">No notes found.</p>
                ) : (
                  filteredNewProjectNotes.map((note) => {
                    const selected = newProjectNoteIds.includes(note.id);
                    return (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => {
                          setNewProjectNoteIds((current) =>
                            current.includes(note.id)
                              ? current.filter((id) => id !== note.id)
                              : [...current, note.id]
                          );
                        }}
                        className="flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            selected
                              ? 'border-[color:var(--ledger-accent)] bg-[color:rgba(255,95,64,0.12)]'
                              : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]'
                          }`}
                          aria-hidden="true"
                        >
                          {selected && <Check size={11} className="text-[var(--ledger-accent)]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                            {note.title}
                          </p>
                          <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                            {note.preview || 'No content'}
                          </p>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {newProjectNoteIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {newProjectNoteIds.map((noteId) => {
                const note = newProjectNotes.find((item) => item.id === noteId);
                return (
                  <button
                    key={noteId}
                    type="button"
                    onClick={() =>
                      setNewProjectNoteIds((current) => current.filter((id) => id !== noteId))
                    }
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    title={note?.title ?? 'Linked note'}
                  >
                    <FileText size={11} />
                    <span className="max-w-[160px] truncate">{note?.title ?? 'Linked note'}</span>
                    <X size={10} />
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
            <button
              type="button"
              onClick={closeCreateProjectComposer}
              className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createProject()}
              disabled={!newProjectName.trim() || isCreatingProjectNow}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
            >
              {isCreatingProjectNow ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </div>
      </ModalOverlay>

      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed ? (
          <>
            <aside
              className="flex shrink-0 flex-col overflow-hidden border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]"
              style={{ width: `${leftPaneWidth}px` }}
            >
              <div className={`${isCompactLayout ? 'p-3' : 'p-4'} border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                        Project library
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">
                        {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                      </p>
                    </div>
                    <button
                      onClick={() => setIsLeftPaneCollapsed(true)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                      title="Hide left panel"
                      aria-label="Hide left panel"
                    >
                      <ChevronLeft size={13} strokeWidth={2.25} className="-translate-x-px" />
                    </button>
                  </div>
                  <span className="text-[11px] text-[var(--ledger-text-muted)]">
                    {isLoadingProjects ? 'Syncing...' : 'Live'}
                  </span>
                </div>

                <div className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects"
                    className="h-9 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] pl-9 pr-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                  />
                </div>

                <div className="relative mt-3">
                  <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex w-max items-center gap-1.5 pr-8">
                      {statusOrder.map((filter) => (
                        <button
                          key={filter}
                          onClick={() => setStatusFilter(filter)}
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition ${
                            statusFilter === filter
                              ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                              : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
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
                  <div className="pointer-events-none absolute right-0 top-0 h-7 w-7 bg-linear-to-l from-[var(--ledger-surface-muted)] to-transparent" />
                </div>

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
                  <div className="rounded-2xl border border-dashed border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-5">
                    <p className="text-sm font-medium text-[var(--ledger-text-primary)]">No matching projects.</p>
                    <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                      Create one for outcomes, notes, and next actions.
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
                    const dueLabel = isSharedWorkspace
                      ? `${workspaceLabel} · ${workspaceMembers.length} members`
                      : workspaceLabel;
                    const rowTaskStats = projectTaskStats.get(project.id) ?? {
                      active: 0,
                      completed: 0,
                      total: 0,
                    };
                    const statusLabel =
                      semantic === 'completed'
                        ? 'Completed'
                        : semantic === 'not_started'
                        ? 'Not started'
                        : projectStatusLabels[semantic];
                    const actionLabel =
                      rowTaskStats.total > 0
                        ? `${rowTaskStats.active} active`
                        : `${displayCompleteness}%`;

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
                        className={`group relative w-full rounded-lg border px-3 py-2.5 text-left transition ${
                          active
                            ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)]'
                            : 'border-transparent bg-transparent hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)]'
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
                            <p className="truncate text-[13px] font-semibold text-[var(--ledger-text-primary)]">
                              {project.name}
                            </p>
                          </div>
                          <p className="mt-1 text-[11px] text-[var(--ledger-text-secondary)]">
                            {statusLabel} · {actionLabel}
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">{dueLabel}</p>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]/90">
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
              className="w-1.5 cursor-col-resize bg-[var(--ledger-border-subtle)] transition hover:bg-[var(--ledger-border-strong)] touch-none"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingLeftPane(true);
              }}
            />
          </>
        ) : (
          <div className="flex w-10 shrink-0 items-start justify-center border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pt-4">
            <button
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
              title="Show left panel"
              aria-label="Show left panel"
            >
              <ChevronRight size={14} strokeWidth={2.25} />
            </button>
          </div>
        )}

        <main className="flex-1 overflow-hidden bg-[var(--ledger-background)]">
          <div className={`h-full overflow-auto ${isCompactLayout ? 'p-4' : 'p-6'}`}>
            {selectedProject ? (
              <div className="w-full min-w-0">
                <section className="border-b border-[color:var(--ledger-border-subtle)] pb-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-[var(--ledger-text-muted)]">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: projectDraft.color || '#FF5F40' }}
                        />
                        <span>{workspaceLabel}</span>
                        <span className="text-[var(--ledger-text-muted)]">·</span>
                        {renderCreatorBubble(creatorDisplayName, 'h-5 w-5')}
                      </div>

                      {isEditingTitle ? (
                        <input
                          autoFocus
                          value={projectDraft.name}
                          onChange={(e) => updateProjectDraft({ name: e.target.value })}
                          onBlur={() => {
                            setIsEditingTitle(false);
                            void flushProjectDraft();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              setIsEditingTitle(false);
                              void flushProjectDraft();
                            }
                          }}
                          className="mt-2 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-[2rem] font-semibold tracking-tight text-[var(--ledger-text-primary)] outline-none shadow-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsEditingTitle(true)}
                          className="mt-2 block max-w-full rounded-xl text-left transition hover:bg-[var(--ledger-surface-hover)]"
                        >
                          <h2 className="truncate px-2 py-1 text-[2rem] font-semibold tracking-tight text-[var(--ledger-text-primary)]">
                            {projectDraft.name || 'Untitled project'}
                          </h2>
                        </button>
                      )}

                      <div className="mt-2">
                        {isEditingBrief ? (
                          <textarea
                            autoFocus
                            value={projectDraft.description}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(e) => updateProjectDraft({ description: e.target.value })}
                            onBlur={() => {
                              setIsEditingBrief(false);
                              void flushProjectDraft();
                            }}
                            placeholder="Add a brief..."
                            className="min-h-20 w-full resize-none rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-sm leading-6 text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsEditingBrief(true)}
                            className="block w-full rounded-xl text-left transition hover:bg-[var(--ledger-surface-hover)]"
                          >
                            <p className="px-2 py-1 text-sm leading-6 text-[var(--ledger-text-secondary)]">
                              {projectDraft.description?.trim() || 'Add a brief...'}
                            </p>
                          </button>
                        )}
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-[var(--ledger-text-muted)]">
                        <div className="min-w-0 truncate">{projectMetaLine}</div>
                        <div className="min-w-0 truncate">
                          {formatDateRange(projectDraft.startDate, projectDraft.endDate)}
                        </div>
                        <div className="min-w-0 truncate">
                          {isSavingProject ? 'Saving...' : isDirtyRef.current ? 'Unsaved' : 'Saved'}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <div className="relative">
                        <select
                          value={projectDraft.status}
                          onChange={(e) =>
                            void updateProjectStatus(
                              selectedProject.id,
                              e.target.value as ProjectSemanticStatus
                            )
                          }
                          className="h-8 appearance-none rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-0 pl-2.5 pr-7 text-xs font-medium text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
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
                          size={12}
                          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsTaskComposerOpen(true)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-2.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
                      >
                        <Plus size={12} />
                        Add action
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void openLinkNoteModal();
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        <Link2 size={12} />
                        Link note
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setProjectContextMenu({
                            x: rect.right,
                            y: rect.bottom + 6,
                            projectId: selectedProject.id,
                          });
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                        aria-label="Project actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <div className="flex items-center justify-between text-xs text-[var(--ledger-text-muted)]">
                        <span>Progress</span>
                        <span>{projectDraft.completeness}%</span>
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
                        style={
                          {
                            '--ledger-range-fill': projectDraft.color || '#FF5F40',
                            '--ledger-range-progress': `${Math.max(
                              0,
                              Math.min(100, projectDraft.completeness)
                            )}%`,
                          } as any
                        }
                        className="ledger-range mt-2 w-full"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-[var(--ledger-text-secondary)]">
                      <label>
                        <span className="mb-1 block text-[var(--ledger-text-muted)]">Start</span>
                        <input
                          type="date"
                          value={projectDraft.startDate}
                          onChange={(e) => updateProjectDraft({ startDate: e.target.value })}
                          className="h-8 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 text-xs text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[var(--ledger-text-muted)]">Due</span>
                        <input
                          type="date"
                          value={projectDraft.endDate}
                          onChange={(e) => updateProjectDraft({ endDate: e.target.value })}
                          className="h-8 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 text-xs text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                        />
                      </label>
                    </div>
                  </div>
                </section>

                <div className="mt-4 overflow-x-auto border-b border-[color:var(--ledger-border-subtle)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex w-max items-center gap-1">
                    {projectTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative px-3 py-2 text-sm font-medium transition ${
                          activeTab === tab.id
                            ? 'text-[var(--ledger-text-primary)]'
                            : 'text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
                        }`}
                      >
                        {tab.label}
                        {activeTab === tab.id && (
                          <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--ledger-accent)]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="py-6">{renderTabContent()}</div>
              </div>
            ) : (
              renderProjectsTimelineOverview()
            )}
          </div>
        </main>

        {!isRightPaneCollapsed ? (
          <>
            <div
              className="w-1.5 cursor-col-resize bg-[var(--ledger-border-subtle)] transition hover:bg-[var(--ledger-border-strong)] touch-none"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingRightPane(true);
              }}
            />

            <aside
              className="flex shrink-0 flex-col overflow-hidden border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]"
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="flex-1 overflow-auto p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                      {selectedProject ? 'Project context' : 'Workspace context'}
                    </p>
                    <p className="mt-1 truncate text-xs text-[var(--ledger-text-muted)]">
                      {selectedProject ? projectDraft.name : workspaceLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsRightPaneCollapsed(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
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
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                          aria-label="Project context actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {isContextMenuOpen && (
                          <div className="absolute right-0 top-9 z-50 min-w-44 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]">
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                setActiveTab('overview');
                                setIsEditingBrief(true);
                              }}
                            >
                              Edit brief
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                void openLinkNoteModal();
                              }}
                            >
                              Link note
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                void openLinkCalendarModal('event');
                              }}
                            >
                              Link event
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                void openLinkCalendarModal('reminder');
                              }}
                            >
                              Link reminder
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                if (!selectedProject) return;
                                const url = new URL(window.location.href);
                                url.searchParams.set('focusProjectId', selectedProject.id);
                                void navigator.clipboard?.writeText(url.toString());
                              }}
                            >
                              Copy project link
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              onClick={() => {
                                setIsContextMenuOpen(false);
                                if (!selectedProject) return;
                                void updateProjectStatus(selectedProject.id, 'paused');
                              }}
                            >
                              <Pause size={14} className="mr-2 inline-block align-[-2px]" />
                              Pause project
                            </button>
                            <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                            <button
                              className="w-full px-3 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
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
                  <div className="mt-5 space-y-5">
                    <section className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Projects</p>
                      <div className="space-y-2 text-sm">
                        {[
                          ['Total', String(overviewProjectStats.total)],
                          ['Active', String(overviewProjectStats.active)],
                          ['Completed', String(overviewProjectStats.completed)],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-3">
                            <span className="text-[var(--ledger-text-muted)]">{label}</span>
                            <span className="text-[var(--ledger-text-primary)]">{value}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Workspace</p>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--ledger-text-muted)]">Workspace</span>
                          <span className="max-w-[58%] truncate text-right text-[var(--ledger-text-primary)]">
                            {workspaceLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[var(--ledger-text-muted)]">Members</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {isSharedWorkspace ? `${workspaceMembers.length} members` : 'Only you'}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">
                        Needs attention
                      </p>
                      <div className="space-y-2 text-sm">
                        {[
                          ['Without dates', String(overviewProjectStats.withoutDates)],
                          ['Without actions', String(overviewProjectStats.withoutActions)],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-3">
                            <span className="text-[var(--ledger-text-muted)]">{label}</span>
                            <span className="text-[var(--ledger-text-primary)]">{value}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Linked context</p>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {[
                          ['Notes', overviewProjectStats.notes],
                          ['Events', overviewProjectStats.events],
                          ['Reminders', overviewProjectStats.reminders],
                          ['Captures', 0],
                        ].map(([label, count]) => (
                          <div
                            key={label}
                            className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-1.5"
                          >
                            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">{count}</p>
                            <p className="text-xs text-[var(--ledger-text-muted)]">{label}</p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Recent activity</p>
                      {overviewActivity.length === 0 ? (
                        <p className="text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>
                      ) : (
                        <div className="space-y-1">
                          {overviewActivity.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                              <Clock3 size={13} className="shrink-0 text-[var(--ledger-text-muted)]" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                  {item.label}
                                </p>
                                <p className="text-xs text-[var(--ledger-text-muted)]">
                                  {formatRelativeFromNow(item.at)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                ) : (
                  <div className="mt-5 space-y-5">
                    <section className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Workspace</p>
                      <div className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2">
                        <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                          {workspaceLabel}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">
                          {isSharedWorkspace
                            ? `${workspaceLabel} · ${workspaceMembers.length} members`
                            : 'Personal workspace'}
                        </p>
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">
                        {isSharedWorkspace ? 'Members' : 'Viewing'}
                      </p>
                      {isSharedWorkspace ? (
                        <div className="space-y-1.5">
                          {workspaceMembers.slice(0, 6).map((member) => {
                            const name = displayMemberName(member);
                            const role =
                              member.user_id === selectedProject.created_by ? 'Owner' : 'Member';
                            return (
                              <div key={member.user_id} className="flex items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] text-[10px] font-semibold text-[var(--ledger-text-secondary)]">
                                  {getInitials(name)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                    {name}
                                  </p>
                                  <p className="text-xs text-[var(--ledger-text-muted)]">{role}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[var(--ledger-text-muted)]">Viewing</span>
                            <span className="text-[var(--ledger-text-primary)]">{projectViewingSummary}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[var(--ledger-text-muted)]">Created by</span>
                            <span className="text-[var(--ledger-text-primary)]">{creatorDisplayName}</span>
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Details</p>
                      <div className="space-y-2 text-sm">
                        {[
                          ['Status', projectStatusLabels[projectDraft.status]],
                          ['Progress', `${projectDraft.completeness}%`],
                          ['Start', projectDraft.startDate ? formatShortDate(projectDraft.startDate) : 'Not set'],
                          ['Due', projectDraft.endDate ? formatShortDate(projectDraft.endDate) : 'Not set'],
                          ['Active', String(taskCounts.active)],
                          ['Done', String(taskCounts.completed)],
                          ['Updated', formatRelativeFromNow(selectedProject.updated_at)],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-3">
                            <span className="text-[var(--ledger-text-muted)]">{label}</span>
                            <span className="max-w-[60%] truncate text-right text-[var(--ledger-text-primary)]">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Linked</p>
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--ledger-accent)] transition hover:text-[var(--ledger-accent-hover)]"
                          onClick={() => {
                            void openLinkNoteModal();
                          }}
                        >
                          Link note
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {[
                          ['Notes', linkedObjectCounts.notes],
                          ['Events', linkedObjectCounts.events],
                          ['Reminders', linkedObjectCounts.reminders],
                          ['Captures', linkedObjectCounts.captures],
                        ].map(([label, count]) => (
                          <div key={label} className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-1.5">
                            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">{count}</p>
                            <p className="text-xs text-[var(--ledger-text-muted)]">{label}</p>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-2">
                        {projectEvents.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                              Events
                            </p>
                            {projectEvents.slice(0, 2).map((event) => (
                              <div
                                key={event.id}
                                className="mt-1 rounded-md px-1 py-1 transition hover:bg-[var(--ledger-surface-hover)]"
                              >
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                  {event.title}
                                </p>
                                <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                                  {formatEventDateLabel(event)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                        {projectReminders.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                              Reminders
                            </p>
                            {projectReminders.slice(0, 2).map((reminder) => (
                              <div
                                key={reminder.id}
                                className="mt-1 rounded-md px-1 py-1 transition hover:bg-[var(--ledger-surface-hover)]"
                              >
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                  {reminder.title}
                                </p>
                                <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                                  {formatReminderDateLabel(reminder)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {linkedNotes.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {linkedNotes.slice(0, 3).map((link) => (
                            <button
                              key={link.id}
                              type="button"
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
                              className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                            >
                              <FileText size={13} className="shrink-0 text-[var(--ledger-text-muted)]" />
                              <span className="min-w-0 truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                {link.note.title}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">Recent activity</p>
                      {recentProjectActivity.length === 0 ? (
                        <p className="text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>
                      ) : (
                        <div className="space-y-1">
                          {recentProjectActivity.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 rounded-md px-1 py-1.5"
                            >
                              <Clock3 size={13} className="shrink-0 text-[var(--ledger-text-muted)]" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                  {item.label}
                                </p>
                                <p className="text-xs text-[var(--ledger-text-muted)]">
                                  {formatRelativeFromNow(item.at)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            </aside>
          </>
        ) : (
          <div className="flex w-10 shrink-0 items-start justify-center border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pt-4">
            <button
              onClick={() => setIsRightPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
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
          classNameContainer="w-full max-w-xl overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
        >
          <div>
            <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ledger-text-muted)]">
                  Task notes
                </p>
                <p className="mt-1 truncate text-base font-semibold text-[var(--ledger-text-primary)]">
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
                className="h-48 w-full resize-none rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setTaskNotesTaskId(null);
                    setTaskNotesDraft('');
                  }}
                  className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveTaskNotes()}
                  disabled={isSavingTaskNotes}
                  className="rounded-xl bg-[var(--ledger-accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
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
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
          >
            <Trash2 size={14} />
            Unlink note
          </button>
        </div>
      )}

      {pendingMilestone && milestoneEditorPosition && (
      <div
          ref={milestoneEditorRef}
          className="fixed z-50 max-h-[calc(100vh-16px)] w-[320px] overflow-auto rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
          style={{ left: `${milestoneEditorPosition.x}px`, top: `${milestoneEditorPosition.y}px` }}
          role="dialog"
          aria-label="New milestone"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
              {editingMilestoneId ? 'Edit milestone' : 'New milestone'}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
              {getProjectById(milestoneDraft.projectId)?.name || 'Choose a project'} ·{' '}
              {formatShortDate(milestoneDraft.date)}
            </p>
          </div>
          <div className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">
                Date
              </span>
              <input
                type="date"
                value={milestoneDraft.date}
                onChange={(event) => {
                  setMilestoneDraftTouched(true);
                  setMilestoneDraft((current) => ({ ...current, date: event.target.value }));
                  setPendingMilestone((current) =>
                    current ? { ...current, date: event.target.value } : current
                  );
                }}
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">
                Milestone name
              </span>
              <input
                ref={milestoneNameInputRef}
                value={milestoneDraft.title}
                onChange={(event) => {
                  setMilestoneDraftTouched(true);
                  setMilestoneDraftError(null);
                  setMilestoneDraft((current) => ({ ...current, title: event.target.value }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveMilestone();
                  }
                }}
                placeholder="Launch review"
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">
                Type
              </span>
              <select
                value={milestoneDraft.type}
                onChange={(event) => {
                  setMilestoneDraftTouched(true);
                  setMilestoneDraft((current) => ({
                    ...current,
                    type: event.target.value as ProjectMilestoneType,
                  }));
                }}
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
              >
                {projectMilestoneTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">
                Optional note
              </span>
              <textarea
                value={milestoneDraft.note}
                onChange={(event) => {
                  setMilestoneDraftTouched(true);
                  setMilestoneDraft((current) => ({ ...current, note: event.target.value }));
                }}
                placeholder="Add context for this moment."
                className="h-20 w-full resize-none rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
              />
            </label>
            {milestoneDraftError && (
              <p className="text-xs font-medium text-[var(--ledger-danger)]">{milestoneDraftError}</p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3">
            <button
              type="button"
              onClick={cancelMilestonePlacement}
              className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveMilestone()}
              disabled={isSavingMilestone}
              className="rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
            >
              {isSavingMilestone
                ? 'Saving...'
                : editingMilestoneId
                ? 'Save changes'
                : 'Save milestone'}
            </button>
          </div>
        </div>
      )}

      {milestoneDetailRow && milestoneDetailPosition && (
        <div
          ref={milestoneDetailRef}
          className="fixed z-50 max-h-[calc(100vh-16px)] w-[280px] overflow-auto rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
          style={{ left: `${milestoneDetailPosition.x}px`, top: `${milestoneDetailPosition.y}px` }}
          role="dialog"
          aria-label="Milestone detail"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
            <p className="truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
              {milestoneDetailRow.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
              {milestoneDetailRow.type} · {formatShortDate(milestoneDetailRow.milestone_date)}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
              {milestoneDetailProject?.name ?? 'Project'}
            </p>
          </div>
          {milestoneDetailRow.note && (
            <p className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-sm leading-5 text-[var(--ledger-text-secondary)]">
              {milestoneDetailRow.note}
            </p>
          )}
          <div className="py-1">
            <button
              type="button"
              onClick={() => void handleMilestoneCompleteToggle(milestoneDetailRow.id)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <CheckCircle2 size={14} />
              {milestoneDetailRow.completed ? 'Mark incomplete' : 'Mark complete'}
            </button>
            <label className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">
              <CalendarDays size={14} />
              <span className="flex-1">Change date</span>
              <input
                type="date"
                value={milestoneDetailRow.milestone_date}
                onChange={(event) =>
                  void handleMilestoneDateChange(milestoneDetailRow.id, event.target.value)
                }
                className="h-7 max-w-[132px] rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-1.5 text-xs text-[var(--ledger-text-primary)] outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setMilestoneDetail(null);
                void openLinkNoteModal(milestoneDetailRow.project_id);
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <Link2 size={14} />
              Link note
            </button>
            <button
              type="button"
              onClick={() => {
                setMilestoneDetail(null);
                createTimelineTodo('create reminder from milestone', milestoneDetailRow.project_id, milestoneDetailRow.id);
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <Bell size={14} />
              Create reminder
            </button>
            <button
              type="button"
              onClick={() => {
                setMilestoneDetail(null);
                void openProjectById(milestoneDetailRow.project_id);
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <Folder size={14} />
              Open project
            </button>
          </div>
        </div>
      )}

      <ModalOverlay
        isOpen={isLinkNoteModalOpen}
        onClose={() => {
          setIsLinkNoteModalOpen(false);
          setLinkNoteTargetProjectId(null);
          setSelectedLinkNoteIds([]);
        }}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">Link note</p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Attach a workspace note to this project
            </p>
          </div>
          <ModalCloseButton
            onClick={() => {
              setIsLinkNoteModalOpen(false);
              setLinkNoteTargetProjectId(null);
              setSelectedLinkNoteIds([]);
            }}
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
            className="w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />
          <p className="text-xs text-[var(--ledger-text-muted)]">
            Select one or more notes, then import them into this project.
          </p>
          <div className="max-h-80 overflow-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]">
            {isLoadingLinkableNotes ? (
              <p className="p-3 text-sm text-[var(--ledger-text-muted)]">Loading notes…</p>
            ) : filteredLinkableNotes.length === 0 ? (
              <p className="p-3 text-sm text-[var(--ledger-text-muted)]">No available notes to link.</p>
            ) : (
              filteredLinkableNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  disabled={isLinkingNote}
                  onClick={() => {
                    setSelectedLinkNoteIds((current) =>
                      current.includes(note.id)
                        ? current.filter((id) => id !== note.id)
                        : [...current, note.id]
                    );
                  }}
                  className="flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selectedLinkNoteIds.includes(note.id)
                        ? 'border-[color:var(--ledger-accent)] bg-[color:rgba(255,95,64,0.12)]'
                        : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]'
                    }`}
                    aria-hidden="true"
                  >
                    {selectedLinkNoteIds.includes(note.id) && (
                      <Check size={11} className="text-[var(--ledger-accent)]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">{note.title}</p>
                    <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                      {note.preview || 'No content'}
                    </p>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
          <p className="text-xs text-[var(--ledger-text-muted)]">
            {selectedLinkNoteIds.length} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsLinkNoteModalOpen(false);
                setLinkNoteTargetProjectId(null);
                setSelectedLinkNoteIds([]);
              }}
              className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void linkSelectedNotesToProject()}
              disabled={isLinkingNote || selectedLinkNoteIds.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
            >
              {isLinkingNote && <Loader2 size={14} className="animate-spin" />}
              {isLinkingNote
                ? 'Importing…'
                : `Import ${selectedLinkNoteIds.length} note${selectedLinkNoteIds.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isLinkCalendarModalOpen}
        onClose={() => setIsLinkCalendarModalOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[460px] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
              Link {calendarLinkKind === 'event' ? 'event' : 'reminder'}
            </p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Attach an existing workspace {calendarLinkKind === 'event' ? 'event' : 'reminder'} to
              this project
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setIsLinkCalendarModalOpen(false)}
            ariaLabel="Close link calendar modal"
            className="shrink-0"
          />
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCalendarLinkKind('event')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                calendarLinkKind === 'event'
                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                  : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              Events
            </button>
            <button
              type="button"
              onClick={() => setCalendarLinkKind('reminder')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                calendarLinkKind === 'reminder'
                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                  : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              Reminders
            </button>
          </div>
          <input
            type="text"
            value={calendarLinkSearch}
            onChange={(e) => setCalendarLinkSearch(e.target.value)}
            placeholder={`Search ${calendarLinkKind === 'event' ? 'events' : 'reminders'}`}
            className="w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />
          <div className="max-h-80 overflow-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]">
            {isLoadingLinkableCalendarItems ? (
              <p className="p-3 text-sm text-[var(--ledger-text-muted)]">Loading items...</p>
            ) : filteredLinkableCalendarItems.length === 0 ? (
              <p className="p-3 text-sm text-[var(--ledger-text-muted)]">No items found.</p>
            ) : (
              filteredLinkableCalendarItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={isLinkingCalendarItem}
                  onClick={() => void linkCalendarItemToProject(calendarLinkKind, item.id)}
                  className="w-full border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
                >
                  <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                    {item.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
                    {calendarLinkKind === 'event'
                      ? formatEventDateLabel(item as ProjectCalendarEvent)
                      : formatReminderDateLabel(item as ProjectCalendarReminder)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={() => setIsLinkCalendarModalOpen(false)}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
        </div>
      </ModalOverlay>

      {projectContextMenu && projectMenuPosition && (
        <div
          ref={projectContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <Folder size={14} />
            Open
          </button>
          <button
            onClick={() => {
              void updateProjectStatus(projectContextMenu.projectId, 'in_progress');
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <Play size={14} />
            Mark active
          </button>
          <button
            onClick={() => {
              void updateProjectStatus(projectContextMenu.projectId, 'paused');
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <Pause size={14} />
            Mark paused
          </button>
          <button
            onClick={() => {
              void updateProjectStatus(projectContextMenu.projectId, 'completed');
              setProjectContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <CheckCircle2 size={14} />
            Mark complete
          </button>
          <div className="px-4 py-2">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ledger-text-muted)]">
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
                className="h-4 w-4 rounded-full border border-[color:rgba(255,255,255,0.1)] transition hover:scale-110"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {timelineContextMenu && timelineMenuPosition && (
        <div
          ref={timelineContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]"
          style={{ left: `${timelineMenuPosition.x}px`, top: `${timelineMenuPosition.y}px` }}
          role="menu"
          aria-label="Timeline actions"
          onClick={(event) => event.stopPropagation()}
        >
          {timelineContextMenu.kind === 'grid' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  handleNewProjectAtDate(timelineContextMenu.date);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Plus size={14} />
                {timelineContextMenu.date
                  ? `New project on ${formatShortDateLong(timelineContextMenu.date)}`
                  : 'New project here'}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleAddMilestoneAtDate(timelineContextMenu.date, {
                    x: timelineContextMenu.x,
                    y: timelineContextMenu.y,
                  });
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Flag size={14} />
                {timelineContextMenu.date
                  ? `Add milestone on ${formatShortDateLong(timelineContextMenu.date)}`
                  : 'Add milestone here'}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleAddReminderAtDate(timelineContextMenu.date);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Bell size={14} />
                {timelineContextMenu.date
                  ? `Add reminder on ${formatShortDateLong(timelineContextMenu.date)}`
                  : 'Add reminder here'}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleCreateNoteAtDate(timelineContextMenu.date);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <FileText size={14} />
                {timelineContextMenu.date
                  ? `Create note on ${formatShortDateLong(timelineContextMenu.date)}`
                  : 'Create note for this date'}
              </button>
            </>
          ) : timelineContextMenu.kind === 'marker' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (timelineContextMenu.markerType === 'milestone') {
                    openMilestoneDetail(
                      timelineContextMenu.markerId,
                      timelineContextMenu.x,
                      timelineContextMenu.y
                    );
                  } else if (timelineContextMenu.projectId) {
                    void openProjectById(timelineContextMenu.projectId);
                  }
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <CircleDot size={14} />
                Open milestone
              </button>
              <button
                type="button"
                onClick={() => {
                  const milestone =
                    timelineContextMenu.markerType === 'milestone'
                      ? workspaceMilestones.find((item) => item.id === timelineContextMenu.markerId)
                      : null;
                  if (milestone) {
                    setPendingMilestone({
                      projectId: milestone.project_id,
                      date: milestone.milestone_date,
                      x: timelineContextMenu.x,
                      y: timelineContextMenu.y,
                    });
                    setEditingMilestoneId(milestone.id);
                    setMilestoneDraft({
                      title: milestone.title,
                      type: projectMilestoneTypes.includes(milestone.type as ProjectMilestoneType)
                        ? (milestone.type as ProjectMilestoneType)
                        : 'Custom',
                      date: milestone.milestone_date,
                      note: milestone.note ?? '',
                      projectId: milestone.project_id,
                    });
                    setMilestoneDraftTouched(false);
                    setMilestoneDraftError(null);
                    window.setTimeout(() => milestoneNameInputRef.current?.focus(), 60);
                  } else {
                    console.debug('[projects timeline] TODO: rename marker', timelineContextMenu);
                  }
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <FileText size={14} />
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  const milestone =
                    timelineContextMenu.markerType === 'milestone'
                      ? workspaceMilestones.find((item) => item.id === timelineContextMenu.markerId)
                      : null;
                  if (milestone) {
                    openMilestoneDetail(milestone.id, timelineContextMenu.x, timelineContextMenu.y);
                  } else {
                    console.debug('[projects timeline] TODO: change marker date', timelineContextMenu);
                  }
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <CalendarDays size={14} />
                Change date
              </button>
              <button
                type="button"
                onClick={() => {
                  if (timelineContextMenu.projectId) {
                    void openLinkNoteModal(timelineContextMenu.projectId);
                  } else {
                    console.debug('[projects timeline] TODO: link note to marker', timelineContextMenu);
                  }
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Link2 size={14} />
                Link note
              </button>
              <button
                type="button"
                onClick={() => {
                  createTimelineTodo(
                    'create reminder from milestone',
                    timelineContextMenu.projectId ?? '__none__',
                    timelineContextMenu.markerId
                  );
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Bell size={14} />
                Convert to reminder
              </button>
              {timelineContextMenu.markerType === 'milestone' && (
                <button
                  type="button"
                  onClick={() => {
                    void handleMilestoneCompleteToggle(timelineContextMenu.markerId);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <CheckCircle2 size={14} />
                  {workspaceMilestones.find((item) => item.id === timelineContextMenu.markerId)
                    ?.completed
                    ? 'Mark incomplete'
                    : 'Mark complete'}
                </button>
              )}
              <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  if (timelineContextMenu.markerType === 'milestone') {
                    void handleMilestoneDelete(timelineContextMenu.markerId);
                  } else {
                    console.debug('[projects timeline] TODO: delete marker', timelineContextMenu);
                  }
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </>
          ) : timelineContextProject && timelineContextProjectStatus === 'completed' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void handleReviewProject(timelineContextProject.id);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Clock3 size={14} />
                Review project
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleReopenProject(timelineContextProject.id);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Play size={14} />
                Reopen project
              </button>
              <button
                type="button"
                onClick={() => {
                  void openLinkNoteModal(timelineContextProject.id);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Link2 size={14} />
                Link note
              </button>
              <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  void handleArchiveProject(timelineContextProject.id);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Pause size={14} />
                Pause
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteProject(timelineContextProject.id);
                  setTimelineContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
              >
                <Trash2 size={14} />
                Delete project
              </button>
            </>
          ) : timelineContextProject ? (
            timelineContextProjectHasDates ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void openProjectById(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Folder size={14} />
                  Open project
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleAddAction(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Plus size={14} />
                  Add action
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleAddMilestone(timelineContextProject.id, timelineContextMenu.date, {
                      x: timelineContextMenu.x,
                      y: timelineContextMenu.y,
                    });
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Flag size={14} />
                  Add milestone
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openLinkNoteModal(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Link2 size={14} />
                  Link note
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleEditDates(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <CalendarDays size={14} />
                  Edit dates
                </button>
                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                <button
                  type="button"
                  onClick={() => {
                    void handleArchiveProject(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Pause size={14} />
                  Pause
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteProject(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
                >
                  <Trash2 size={14} />
                  Delete project
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void openProjectById(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Folder size={14} />
                  Open project
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleAddDates(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <CalendarDays size={14} />
                  Add dates
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleAddAction(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Plus size={14} />
                  Add action
                </button>
                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                <button
                  type="button"
                  onClick={() => {
                    void handleArchiveProject(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
                >
                  <Trash2 size={14} />
                  Pause
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteProject(timelineContextProject.id);
                    setTimelineContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
                >
                  <Trash2 size={14} />
                  Delete project
                </button>
              </>
            )
          ) : null}
        </div>
      )}

      {taskContextMenu && taskMenuPosition && (
        <div
          ref={taskContextRef}
          className="fixed z-50 min-w-56 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]"
          style={{ left: `${taskMenuPosition.x}px`, top: `${taskMenuPosition.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) openActionInlineEditor(task);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <Folder size={14} />
            Open action
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) openActionInlineEditor(task);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <FileText size={14} />
            Edit action
          </button>
          <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) void updateTaskStatus(task, 'todo');
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <CheckCircle2 size={14} />
            Mark complete
          </button>
          {selectedProjectMilestones.length > 0 && (
            <div className="px-4 py-2">
              <p className="mb-1 text-[11px] font-medium text-[var(--ledger-text-muted)]">
                Attach to milestone
              </p>
              <div className="space-y-0.5">
                {selectedProjectMilestones.slice(0, 5).map((milestone) => (
                  <button
                    key={milestone.id}
                    type="button"
                    onClick={() => {
                      const task = tasks.find((item) => item.id === taskContextMenu.taskId);
                      if (task) void attachTaskToMilestone(task, milestone.id);
                      setTaskContextMenu(null);
                    }}
                    className="block w-full truncate rounded-md px-1 py-1 text-left text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                  >
                    {milestone.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) openTaskNotes(task);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <FileText size={14} />
            Link note
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId);
              if (task) void duplicateTask(task);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <Plus size={14} />
            Duplicate
          </button>
          <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
          <button
            onClick={() => {
              void deleteTask(taskContextMenu.taskId);
              setTaskContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]"
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
