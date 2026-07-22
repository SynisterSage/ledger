import {
  ArrowRight,
  BriefcaseBusiness,
  Bell,
  CalendarDays,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  CheckCircle2,
  Circle,
  Code2,
  Folder,
  FolderKanban,
  Link2,
  LayoutList,
  Loader2,
  MoreHorizontal,
  Plus,
  Palette,
  Funnel,
  Info,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  FileText,
  Sparkles,
  Map as MapIcon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  AppWindow,
  Zap,
  UserRound,
  UserCheck,
  X,
  Users,
} from 'lucide-react';
import { ToastProvider } from './components/Common/ToastProvider';
import { NotificationMonitor } from './components/Common/NotificationMonitor';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from './context/AuthContext';
import { useWorkspaceContext } from './context/WorkspaceContext';
import { useWorkspaceRealtimeRefresh } from './hooks/useWorkspaceRealtimeRefresh';
import { useApi } from './hooks/useApi';
import { useSidebar } from './context/SidebarContext';
import { MainLayout } from './components/Common/MainLayout';
import {
  ModuleHeaderActionButton,
  ModuleHeaderStripAction,
  ModuleHeaderSegmentedButton,
  ModuleHeaderSegmentedGroup,
  ModuleWindowHeader,
} from './components/Common/ModuleWindowHeader';
import { CloseGuardModal } from './components/Common/CloseGuardModal';
import { ModalCloseButton } from './components/Common/ModalCloseButton';
import { ModalOverlay } from './components/Common/ModalOverlay';
import LoginForm from './components/Common/LoginForm';
import CalendarWindow from './components/Calendar/CalendarWindow';
import CircleWindow from './components/Circle/CircleWindow';
import NotesWindow from './components/Notes/NotesWindow';
import ProjectsWindow from './components/Projects/ProjectsWindow';
import TeamsWindow from './components/Teams/TeamsWindow';
import TeamSettingsWindow from './components/Teams/TeamSettingsWindow';
import IntakeWindow from './components/Inbox/InboxWindow';
import { NotificationCenterWindow } from './components/Notifications/NotificationCenterWindow';
import {
  NotificationTray,
  NOTIFICATION_TRAY_TOGGLE_EVENT,
} from './components/Notifications/NotificationTray';
import { NotificationCenterProvider } from './components/Notifications/NotificationCenterContext';
import SettingsWindow from './components/Settings/SettingsWindow';
import { SearchModal } from './components/Search/SearchModal';
import { SearchProvider } from './context/SearchContext';
import { useSearch } from './context/SearchContext';
import { QuickCaptureWindow } from './components/Common/QuickCaptureWindow';
import { CreateNoteModal } from './components/Notes/CreateNoteModal';
import { saveSidebarPreferences, type SidebarPosition } from './config/sidebarPreferences';
import { useToast } from './components/Common/ToastProvider';
import { getProjectTypeOption } from './utils/projectTypes';
import { useWorkspaceRouteHistory } from './hooks/useWorkspaceRouteHistory';
import { NewTabWindow } from './components/Common/NewTabWindow';
import { PageFindBar } from './components/Common/PageFindBar';
import { FigmaPluginAuthorizationPage } from './components/Integrations/FigmaPluginAuthorizationPage';
import { McpAuthorizationPage } from './components/Integrations/McpAuthorizationPage';
import { McpScopeUpgradeAuthorizationPage } from './components/Integrations/McpScopeUpgradeAuthorizationPage';

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'ready';
type OnboardingStep = 'welcome' | 'workspace-type' | 'workspace' | 'team-invite' | 'position';
type OnboardingWorkspaceMode = 'create' | 'join';
type OnboardingWorkspaceType = 'personal' | 'team';
type ModuleKind =
  | 'new-tab'
  | 'circle'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'quick-follow-up'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event'
  | 'quick-reminder'
  | null;

const windowParams = new URLSearchParams(window.location.search);
const pathnameModuleKind =
  window.location.pathname === '/intake' || window.location.pathname === '/inbox'
    ? ('inbox' as const)
    : null;
const isModuleWindow = windowParams.get('window') === 'module' || pathnameModuleKind !== null;
const moduleKind = (windowParams.get('module') as ModuleKind) ?? pathnameModuleKind ?? null;
const moduleFocusContext = windowParams.get('focusContext')?.trim() ?? '';
const moduleSection = windowParams.get('section')?.trim() ?? '';
type WorkspaceShellRoute = Omit<ModuleFocusPayload, 'kind'> & { kind: ModuleKind | null };

type KeepAliveModuleKey =
  | 'calendar'
  | 'circle'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'inbox'
  | 'settings'
  | 'team-settings';

const getKeepAliveModuleKey = (
  kind: ModuleKind | null,
  focusContext: string
): KeepAliveModuleKey | null => {
  if (kind === 'teams' && focusContext.startsWith('team-settings:')) return 'team-settings';
  if (
    kind === 'calendar' ||
    kind === 'circle' ||
    kind === 'notes' ||
    kind === 'projects' ||
    kind === 'teams' ||
    kind === 'dashboard' ||
    kind === 'notifications' ||
    kind === 'inbox' ||
    kind === 'settings'
  ) {
    return kind;
  }
  return null;
};

const isNewTabRoute = (route: WorkspaceShellRoute | ModuleFocusPayload | null | undefined) =>
  route?.kind === 'new-tab';

const getWorkspaceShellRouteFromLocation = (): WorkspaceShellRoute => {
  const params = new URLSearchParams(window.location.search);
  return {
    kind: (params.get('module') as ModuleKind) ?? null,
    focusDate: params.get('focusDate'),
    focusProjectId: params.get('focusProjectId'),
    focusNoteId: params.get('focusNoteId'),
    focusTaskId: params.get('focusTaskId'),
    focusContext: params.get('focusContext'),
    focusSection: params.get('section'),
  };
};
const buildWorkspaceShellSearch = (route: WorkspaceShellRoute) => {
  const searchParams = new URLSearchParams();
  searchParams.set('window', 'module');
  if (route.kind) searchParams.set('module', route.kind);
  if (route.focusDate) searchParams.set('focusDate', route.focusDate);
  if (route.focusProjectId) searchParams.set('focusProjectId', route.focusProjectId);
  if (route.focusNoteId) searchParams.set('focusNoteId', route.focusNoteId);
  if (route.focusTaskId) searchParams.set('focusTaskId', route.focusTaskId);
  if (route.focusContext) searchParams.set('focusContext', route.focusContext);
  if (route.focusSection) searchParams.set('section', route.focusSection);
  return searchParams.toString();
};
const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties & { WebkitAppRegion: 'drag' };
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties & {
  WebkitAppRegion: 'no-drag';
};
const dashboardSkeletonSurface = 'var(--ledger-surface-muted)';
const dashboardSkeletonFill = 'var(--ledger-surface-hover)';
const dashboardSkeletonBorder = 'var(--ledger-border-subtle)';

const dashboardTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none',
  content: 'bg-[var(--ledger-background)]',
  page: 'mx-auto max-w-6xl space-y-10',
  hero: 'max-w-3xl space-y-8',
  title: 'text-[34px] font-normal leading-tight tracking-tight text-[var(--ledger-text-primary)]',
  subtitle: 'text-lg font-light text-[var(--ledger-text-muted)]',
  sectionLabel: 'text-xs font-medium text-[var(--ledger-text-muted)]',
  sectionAction:
    'inline-flex items-center whitespace-nowrap text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]',
  queueLabel:
    'text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ledger-text-muted)]',
  queuePrimary:
    'rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 py-4',
  queuePrimaryTitle: 'text-sm font-medium text-[var(--ledger-text-primary)]',
  queuePrimaryStatus: 'text-xs font-medium text-[var(--ledger-text-secondary)]',
  queuePrimaryBody: 'text-xs leading-5 text-[var(--ledger-text-muted)]',
  queueSecondaryLine: 'text-xs leading-5 text-[var(--ledger-text-muted)]',
  queueCta:
    'inline-flex items-center justify-center rounded-2xl bg-[var(--ledger-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]',
  queueLink:
    'text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]',
  sectionRow:
    'group flex w-full items-start justify-between gap-3 rounded-2xl border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left transition hover:bg-[var(--ledger-surface-hover)]',
  sectionRowCompact:
    'group flex w-full items-start gap-3 rounded-2xl border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left transition hover:bg-[var(--ledger-surface-hover)]',
  sectionRowDense:
    'group flex w-full items-start gap-3 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-3 text-left transition hover:bg-[var(--ledger-surface-hover)]',
  rowTitle: 'text-[13px] font-medium leading-5 text-[var(--ledger-text-primary)]',
  rowMeta: 'text-[11px] leading-4 text-[var(--ledger-text-muted)]',
  rowMetaStrong: 'text-[11px] font-medium leading-4 text-[var(--ledger-text-secondary)]',
  summaryPill:
    'inline-flex min-h-9 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-[11px] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  summaryValue: 'font-semibold text-[var(--ledger-text-primary)]',
  summaryValueAccent: 'font-semibold text-[var(--ledger-accent)]',
  panel: 'space-y-6',
  rightPanel:
    'space-y-6 border-t border-[color:var(--ledger-border-subtle)] pt-8 lg:sticky lg:top-0 lg:self-start lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0',
  subtleRule: 'h-px w-12 bg-[var(--ledger-border-subtle)]',
  emptyText: 'text-sm font-light italic text-[var(--ledger-text-muted)]',
  emptyBody: 'text-sm font-light text-[var(--ledger-text-muted)]',
  mutedBody: 'text-xs text-[var(--ledger-text-muted)]',
  body: 'text-sm text-[var(--ledger-text-secondary)]',
  chip: 'whitespace-nowrap rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  chipSelected:
    'whitespace-nowrap rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-primary)]',
  actionLink:
    'inline-flex items-center whitespace-nowrap text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]',
  actionLinkMuted:
    'inline-flex items-center whitespace-nowrap text-xs font-medium text-[var(--ledger-text-muted)] transition',
  hoverRow:
    'transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
};

type OverviewDensity = 'list' | 'compact';
type OverviewGroupBy = 'none' | 'status' | 'type' | 'project' | 'dueDate' | 'assignee' | 'team';
type OverviewProperty =
  | 'priority'
  | 'project'
  | 'dueDate'
  | 'assignee'
  | 'team'
  | 'members'
  | 'progress'
  | 'linkedNotes'
  | 'updated';

type OverviewLayoutPreferences = {
  density: OverviewDensity;
  groupBy: OverviewGroupBy;
  visibleProperties: OverviewProperty[];
};

const defaultOverviewLayoutPreferences: OverviewLayoutPreferences = {
  density: 'list',
  groupBy: 'none',
  visibleProperties: ['priority', 'project', 'dueDate', 'assignee', 'team', 'members', 'progress'],
};

const overviewPopoverClassName =
  'absolute right-0 top-full z-40 mt-2 w-[320px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_14px_34px_rgba(15,23,42,0.12)]';
const overviewPopoverSectionLabelClassName =
  'px-3 pb-1 pt-2 text-[10px] font-medium text-[var(--ledger-text-muted)]';

const OverviewPopoverRow = ({
  children,
  onClick,
  selected = false,
  role,
  ariaChecked,
  ariaSelected,
}: {
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
  role?: 'menuitemradio' | 'menuitemcheckbox';
  ariaChecked?: boolean;
  ariaSelected?: boolean;
}) => (
  <button
    type="button"
    role={role}
    aria-checked={ariaChecked}
    aria-selected={ariaSelected}
    onClick={onClick}
    className={`flex min-h-8 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ledger-accent)]/30 ${
      selected
        ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
    }`}
  >
    {children}
  </button>
);

const OverviewPopoverDivider = () => (
  <div className="my-1 border-t border-[color:var(--ledger-border-subtle)]" />
);

const overviewProjectTypeOptions = [
  { id: 'code', label: 'Code', color: '#3B82F6', icon: Code2 },
  { id: 'design', label: 'Design', color: '#FF5F40', icon: Palette },
  { id: 'personal', label: 'Personal', color: '#22C55E', icon: UserRound },
  { id: 'ops', label: 'Ops', color: '#F59E0B', icon: BriefcaseBusiness },
  { id: 'writing', label: 'Writing', color: '#14B8A6', icon: FileText },
  { id: 'other', label: 'Other', color: '#6B7280', icon: Sparkles },
] as const;
const OPEN_LEDGER_URL = (
  import.meta.env.VITE_LEDGER_OPEN_URL?.trim() || window.location.origin
).replace(/\/$/, '');
const buildOpenLedgerUrl = (workspaceName?: string | null) => {
  const target = new URL(OPEN_LEDGER_URL, window.location.origin);
  const name = workspaceName?.trim();
  if (name) {
    target.searchParams.set('workspace', name);
  }
  return target.toString();
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

const todayKey = () => new Date().toISOString().slice(0, 10);

const DashboardSkeletonTaskItem = () => (
  <div
    className="flex items-start gap-3 rounded-2xl border px-4 py-3 animate-pulse"
    style={{ backgroundColor: dashboardSkeletonSurface, borderColor: dashboardSkeletonBorder }}
  >
    <div
      className="mt-0.5 h-5 w-5 shrink-0 rounded-full"
      style={{ backgroundColor: dashboardSkeletonFill }}
    />
    <div className="flex-1 space-y-1.5">
      <div className="h-4 rounded w-3/4" style={{ backgroundColor: dashboardSkeletonFill }} />
      <div className="h-3 rounded w-1/2" style={{ backgroundColor: dashboardSkeletonFill }} />
    </div>
    <div
      className="mt-0.5 h-5 w-5 shrink-0 rounded"
      style={{ backgroundColor: dashboardSkeletonFill }}
    />
  </div>
);

const isUpcomingEventActive = (event: {
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}) => {
  if (String(event.status ?? '').toLowerCase() === 'done') return false;
  const endAt = new Date(event.end_at ?? event.start_at ?? 0).getTime();
  return Number.isFinite(endAt) && endAt > Date.now();
};

const formatExpiryCounter = (task: { due_date?: string | null; due_time?: string | null }) => {
  if (!task.due_date) return null;

  const dueAt = task.due_time
    ? new Date(
        `${task.due_date}T${task.due_time.length === 5 ? `${task.due_time}:00` : task.due_time}`
      )
    : new Date(`${task.due_date}T23:59:59`);

  if (Number.isNaN(dueAt.getTime())) return null;

  const diffMs = dueAt.getTime() - Date.now();
  if (diffMs <= 0) return 'Expires now';

  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `Expires in ${minutes}m`;

  const hours = Math.max(1, Math.round(diffMs / 3600000));
  if (hours < 24) return `Expires in ${hours}h`;

  const days = Math.max(1, Math.round(diffMs / 86400000));
  return `Expires in ${days}d`;
};

type CompletedFocusTask = {
  id: string;
  title: string;
  workspace_name?: string | null;
  project_name?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  completed_at: string;
};

const DASHBOARD_COMPLETED_FOCUS_STORAGE_KEY = 'ledger:dashboard:completed-focus:v1';

const loadCompletedFocusTasks = (): CompletedFocusTask[] => {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_COMPLETED_FOCUS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as { day?: string; items?: CompletedFocusTask[] | null } | null;

    if (parsed?.day !== todayKey()) return [];
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
};

function AuthStatusScreen({
  title,
  subtitle,
  isExiting = false,
}: {
  title: string;
  subtitle: string;
  isExiting?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-screen items-center justify-center overflow-hidden bg-transparent p-3 text-[var(--ledger-text-primary)] transition-all duration-150 ease-out ${
        isExiting ? 'opacity-0 scale-[0.985] translate-y-1' : 'opacity-100 scale-100 translate-y-0'
      }`}
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" />
      <div className="relative z-10 flex min-h-[calc(100vh-1.5rem)] w-full items-center justify-center rounded-3xl px-6 py-8">
        <div className="flex flex-col items-center text-center" style={noDragRegionStyle}>
          <img src="./logo-color.svg" alt="Ledger" className="h-11 w-11" />
          <h2 className="mt-4 text-[22px] font-medium leading-tight text-[var(--ledger-text-primary)]">
            {title}
          </h2>
          <p className="mt-1.5 max-w-[18rem] text-sm leading-6 text-[var(--ledger-text-muted)]">
            {subtitle}
          </p>
          <Loader2 size={14} className="mt-4 animate-spin text-[var(--ledger-text-muted)]" />
        </div>
      </div>
    </div>
  );
}

function InviteSuccessScreen({
  workspaceName,
  onOpenLedger,
}: {
  workspaceName: string;
  onOpenLedger: () => void;
}) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-transparent p-3 text-[var(--ledger-text-primary)]"
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" />
      <div className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8">
        <div className="w-full max-w-sm rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-6 py-7 text-center shadow-[0_18px_50px_rgba(17,24,39,0.18)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:rgba(255,95,64,0.12)]">
            <CheckCircle2 size={24} className="text-[#FF5F40]" />
          </div>
          <h2 className="mt-5 text-[28px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
            Joined {workspaceName}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-muted)]">
            You’re now a member of this workspace.
          </p>
          <button
            type="button"
            onClick={onOpenLedger}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ledger-accent)] px-4 text-sm font-semibold text-white shadow-[var(--ledger-shadow-accent)] transition-colors hover:bg-[var(--ledger-accent-hover)]"
          >
            Open Ledger
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthSessionToastReset() {
  const { user } = useAuthContext();
  const { clear } = useToast();
  const previousUserIdRef = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const nextUserId = user?.id ?? null;

    if (previousUserId && !nextUserId) {
      clear();
    }

    previousUserIdRef.current = nextUserId;
  }, [clear, user?.id]);

  return null;
}

function OnboardingFlow({
  step,
  mode,
  workspaceName,
  inviteValue,
  selectedPosition,
  selectedWorkspaceType,
  isSaving,
  error,
  onStepChange,
  onModeChange,
  onWorkspaceNameChange,
  onInviteValueChange,
  onPositionChange,
  onWorkspaceTypeChange,
  onSkipSetup,
  onInviteSubmit,
  onInviteSkip,
  onWorkspaceSubmit,
  onOpenLedger,
}: {
  step: OnboardingStep;
  mode: OnboardingWorkspaceMode;
  workspaceName: string;
  inviteValue: string;
  selectedPosition: SidebarPosition;
  selectedWorkspaceType: OnboardingWorkspaceType | null;
  isSaving: boolean;
  error: string | null;
  onStepChange: (step: OnboardingStep) => void;
  onModeChange: (mode: OnboardingWorkspaceMode) => void;
  onWorkspaceNameChange: (value: string) => void;
  onInviteValueChange: (value: string) => void;
  onPositionChange: (position: SidebarPosition) => void;
  onWorkspaceTypeChange: (type: OnboardingWorkspaceType) => void;
  onSkipSetup: () => void;
  onInviteSubmit: (emails: string[], role: 'admin' | 'member') => Promise<string[]>;
  onInviteSkip: () => void;
  onWorkspaceSubmit: () => Promise<void>;
  onOpenLedger: (position: SidebarPosition) => Promise<void>;
}) {
  const [inviteDraft, setInviteDraft] = useState('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [failedInviteEmails, setFailedInviteEmails] = useState<string[]>([]);

  const isValidInviteEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const addInviteEmail = () => {
    const email = inviteDraft.trim().toLowerCase();
    if (!email) return;
    if (!isValidInviteEmail(email)) {
      setInviteError('Enter a valid email address.');
      return;
    }
    if (inviteEmails.includes(email)) {
      setInviteError('That email has already been added.');
      return;
    }

    setInviteEmails((current) => [...current, email]);
    setInviteDraft('');
    setInviteError(null);
  };

  const submitInvites = async () => {
    const draftEmail = inviteDraft.trim().toLowerCase();
    if (draftEmail) {
      if (!isValidInviteEmail(draftEmail)) {
        setInviteError('Enter a valid email address.');
        return;
      }
      if (inviteEmails.includes(draftEmail)) {
        setInviteError('That email has already been added.');
        return;
      }
    }

    const emails = draftEmail ? [...inviteEmails, draftEmail] : inviteEmails;
    if (emails.length === 0) return;

    setInviteEmails(draftEmail ? emails : inviteEmails);
    setInviteDraft('');
    setInviteError(null);
    const failed = await onInviteSubmit(emails, inviteRole);
    setFailedInviteEmails(failed);
    setInviteEmails(failed);
    if (failed.length === 0) {
      onStepChange('position');
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-transparent p-3 text-[var(--ledger-text-primary)]"
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" />
      <button
        type="button"
        onClick={() => {
          void window.desktopWindow?.quitApp();
        }}
        aria-label="Close"
        className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        style={noDragRegionStyle}
      >
        <X size={16} />
      </button>

      <div
        className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-5 py-8 sm:px-8"
        style={dragRegionStyle}
      >
        <div
          className={`w-full transition-all duration-150 ease-out ${
            step === 'welcome' ? 'max-w-md' : 'max-w-[460px]'
          }`}
        >
          {step === 'welcome' ? (
            <div className="mx-auto text-center" style={noDragRegionStyle}>
              <img src="./logo-color.svg" alt="Ledger" className="mx-auto mb-5 h-10 w-10" />
              <h1 className="text-[30px] font-regular leading-tight text-[var(--ledger-text-primary)]">
                Welcome to Ledger
              </h1>
              <p className="mx-auto mt-3 max-w-sm text-base leading-6 text-[var(--ledger-text-secondary)]">
                Let’s set up a workspace that fits how you work.
              </p>
              <div className="mt-7 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onStepChange('workspace-type')}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--ledger-accent)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]"
                >
                  Get started
                </button>
                <button
                  type="button"
                  onClick={onSkipSetup}
                  className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  Skip setup
                </button>
              </div>
            </div>
          ) : null}

          {step === 'workspace-type' ? (
            <div className="mx-auto" style={noDragRegionStyle}>
              <button
                type="button"
                onClick={() => onStepChange('welcome')}
                className="mb-5 inline-flex h-8 items-center px-0.5 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:underline"
              >
                Back
              </button>
              <div className="mb-7">
                <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Step 1 of 4</p>
                <h1 className="mt-3 text-[28px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                  How will you use Ledger?
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-muted)]">
                  Choose the workspace type that fits how you work.
                </p>
              </div>

              <div className="space-y-3" role="radiogroup" aria-label="Workspace type">
                {[
                  {
                    type: 'personal' as const,
                    title: 'Personal workspace',
                    description: 'Organize your own notes, tasks, projects, and calendar.',
                    icon: UserRound,
                  },
                  {
                    type: 'team' as const,
                    title: 'Team workspace',
                    description: 'Collaborate on shared work with your team.',
                    icon: Users,
                  },
                ].map((option) => {
                  const isSelected = selectedWorkspaceType === option.type;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.type}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={selectedWorkspaceType === null || isSelected ? 0 : -1}
                      onClick={() => onWorkspaceTypeChange(option.type)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                          event.preventDefault();
                          onWorkspaceTypeChange('team');
                        }
                        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                          event.preventDefault();
                          onWorkspaceTypeChange('personal');
                        }
                      }}
                      className={`flex min-h-[68px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]/40 ${
                        isSelected
                          ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-selected)]'
                          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)]'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                          isSelected
                            ? 'border-[color:var(--ledger-border-strong)] text-[var(--ledger-text-secondary)]'
                            : 'border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-muted)]'
                        }`}
                      >
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm font-semibold ${
                            isSelected
                              ? 'text-[var(--ledger-text-primary)]'
                              : 'text-[var(--ledger-text-secondary)]'
                          }`}
                        >
                          {option.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--ledger-text-muted)]">
                          {option.description}
                        </span>
                      </span>
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          isSelected
                            ? 'border-[var(--ledger-accent)]'
                            : 'border-[color:var(--ledger-border-strong)]'
                        }`}
                      >
                        {isSelected ? (
                          <span className="h-2 w-2 rounded-full bg-[var(--ledger-accent)]" />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  disabled={selectedWorkspaceType === null}
                  onClick={() => onStepChange('workspace')}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--ledger-accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 'workspace' ? (
            <div className="mx-auto" style={noDragRegionStyle}>
              <button
                type="button"
                onClick={() => onStepChange('workspace-type')}
                className="mb-5 inline-flex h-8 items-center px-0.5 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:underline"
              >
                Back
              </button>
              <div className="mb-7">
                <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Step 2 of 4</p>
                <h1 className="mt-3 text-[28px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                  {mode === 'create'
                    ? selectedWorkspaceType === 'team'
                      ? 'Name your team workspace'
                      : 'Name your personal workspace'
                    : 'Join a workspace'}
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-muted)]">
                  {mode === 'create'
                    ? 'You can change this later.'
                    : 'Paste an invite code or link to join an existing Ledger workspace.'}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-medium text-[var(--ledger-text-secondary)]">
                  {mode === 'create' ? 'Workspace name' : 'Invite code or link'}
                </span>
                <input
                  value={mode === 'create' ? workspaceName : inviteValue}
                  onChange={(event) =>
                    mode === 'create'
                      ? onWorkspaceNameChange(event.target.value)
                      : onInviteValueChange(event.target.value)
                  }
                  placeholder={mode === 'create' ? 'My Workspace' : 'https://ledger.app/invite/...'}
                  className="h-11 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-input-background)] px-4 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-2 focus:ring-[color:var(--ledger-border-strong)]/20"
                />
              </label>

              <button
                type="button"
                onClick={() => onModeChange(mode === 'create' ? 'join' : 'create')}
                className="mt-3 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:underline"
              >
                {mode === 'create'
                  ? 'Have an invite? Join an existing workspace'
                  : 'Back to create a workspace'}
              </button>

              {error ? (
                <div className="mt-5 rounded-2xl border border-[color:rgba(239,68,68,0.2)] bg-[color:rgba(239,68,68,0.08)] px-4 py-3 text-sm text-[color:#FCA5A5]">
                  {error}
                </div>
              ) : null}

              <div className="mt-8 flex items-center justify-end gap-4">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    void onWorkspaceSubmit();
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--ledger-accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
                >
                  {isSaving ? <Loader2 size={17} className="animate-spin" /> : null}
                  {isSaving
                    ? mode === 'create'
                      ? 'Creating...'
                      : 'Joining...'
                    : mode === 'create'
                    ? 'Continue'
                    : 'Join workspace'}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'team-invite' ? (
            <div className="mx-auto" style={noDragRegionStyle}>
              <button
                type="button"
                onClick={() => onStepChange('workspace')}
                className="mb-5 inline-flex h-8 items-center px-0.5 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:underline"
              >
                Back
              </button>
              <div className="mb-7">
                <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Step 3 of 4</p>
                <h1 className="mt-3 text-[28px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                  Invite your team
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-muted)]">
                  Add people now, or do this later from Members &amp; access.
                </p>
              </div>

              <div>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-[var(--ledger-text-secondary)]">
                    Email address
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteDraft}
                      onChange={(event) => {
                        setInviteDraft(event.target.value);
                        setInviteError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault();
                          addInviteEmail();
                        }
                      }}
                      placeholder="teammate@example.com"
                      className="h-11 min-w-0 flex-1 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-input-background)] px-4 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-2 focus:ring-[color:var(--ledger-border-strong)]/20"
                    />
                    <span className="relative h-11 w-[112px] shrink-0">
                      <select
                        value={inviteRole}
                        onChange={(event) =>
                          setInviteRole(event.target.value as 'admin' | 'member')
                        }
                        aria-label="Invitation role"
                        className="h-11 w-full appearance-none rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-input-background)] px-3 pr-8 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-border-strong)] focus:ring-2 focus:ring-[color:var(--ledger-border-strong)]/20"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <ChevronDown
                        size={15}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ledger-text-secondary)]"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={addInviteEmail}
                      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-3 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:border-[color:var(--ledger-border-strong)] hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]/40"
                    >
                      <Plus size={14} />
                      Add another
                    </button>
                  </div>
                </label>

                {inviteEmails.length > 0 ? (
                  <div className="mt-3 space-y-2" aria-label="Invited teammates">
                    {inviteEmails.map((email) => (
                      <div
                        key={email}
                        className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-secondary)]"
                      >
                        <span className="truncate">{email}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setInviteEmails((current) => current.filter((item) => item !== email));
                            setFailedInviteEmails((current) =>
                              current.filter((item) => item !== email)
                            );
                          }}
                          aria-label={`Remove ${email}`}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]/40"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {inviteError ? (
                  <p className="mt-2 text-xs text-[var(--ledger-danger)]" role="alert">
                    {inviteError}
                  </p>
                ) : null}

                {failedInviteEmails.length > 0 ? (
                  <p className="mt-3 text-xs leading-5 text-[var(--ledger-danger)]" role="alert">
                    Could not invite {failedInviteEmails.join(', ')}. You can retry or continue and
                    invite them later from Members &amp; access.
                  </p>
                ) : null}
              </div>

              <div className="mt-8 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onInviteSkip}
                  className="inline-flex h-11 items-center justify-center rounded-lg px-1 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:underline"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  disabled={
                    isSaving || (inviteEmails.length === 0 && !isValidInviteEmail(inviteDraft))
                  }
                  onClick={() => {
                    void submitInvites();
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--ledger-accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSaving ? <Loader2 size={17} className="animate-spin" /> : null}
                  {isSaving ? 'Sending...' : 'Continue'}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'position' ? (
            <div className="mx-auto" style={noDragRegionStyle}>
              <button
                type="button"
                disabled={isSaving}
                onClick={() =>
                  onStepChange(selectedWorkspaceType === 'team' ? 'team-invite' : 'workspace')
                }
                className="mb-5 inline-flex h-8 items-center px-0.5 text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:underline disabled:opacity-60"
              >
                Back
              </button>
              <div className="mb-7">
                <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                  {selectedWorkspaceType === 'team' ? 'Step 4 of 4' : 'Step 3 of 3'}
                </p>
                <h1 className="mt-3 text-[28px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                  Choose a sidebar position
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-muted)]">
                  Choose where Ledger starts. You can change this anytime.
                </p>
              </div>

              <div
                className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2"
                role="radiogroup"
                aria-label="Sidebar position"
              >
                {[
                  { value: 'right' as const, label: 'Right', icon: PanelRight },
                  { value: 'left' as const, label: 'Left', icon: PanelLeft },
                  { value: 'bottom' as const, label: 'Bottom', icon: PanelBottom },
                  { value: 'top' as const, label: 'Top', icon: PanelTop },
                  { value: 'floating' as const, label: 'Floating', icon: AppWindow },
                ].map((option, optionIndex, options) => {
                  const isSelected = selectedPosition === option.value;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => onPositionChange(option.value)}
                      onKeyDown={(event) => {
                        if (
                          !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
                        ) {
                          return;
                        }
                        event.preventDefault();
                        const direction =
                          event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
                        const nextIndex =
                          (optionIndex + direction + options.length) % options.length;
                        onPositionChange(options[nextIndex].value);
                      }}
                      className={`flex h-[52px] items-center gap-2.5 rounded-lg border px-3.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]/40 ${
                        option.value === 'floating' ? 'min-[420px]:col-span-2' : ''
                      } ${
                        isSelected
                          ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-selected)] text-[var(--ledger-text-primary)]'
                          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)]'
                      }`}
                    >
                      <Icon
                        size={18}
                        strokeWidth={1.8}
                        className={
                          isSelected
                            ? 'text-[var(--ledger-text-secondary)]'
                            : 'text-[var(--ledger-text-muted)]'
                        }
                      />
                      <span className="text-[13px] font-medium">{option.label}</span>
                      {option.value === 'floating' ? (
                        <span
                          tabIndex={0}
                          aria-label="More information about Floating"
                          className={`group relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--ledger-text-muted)] outline-none hover:text-[var(--ledger-text-secondary)] focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/30 ${
                            isSelected ? '' : 'ml-auto'
                          }`}
                        >
                          <Info size={13} />
                          <span className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-64 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-xs font-normal leading-5 text-[var(--ledger-text-secondary)] shadow-[0_10px_24px_rgba(15,23,42,0.14)] group-hover:block group-focus:block">
                            Floating keeps Ledger in a movable window that you can place beside your
                            work.
                          </span>
                        </span>
                      ) : null}
                      {isSelected ? (
                        <Check size={15} className="ml-auto text-[var(--ledger-accent)]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-[color:rgba(239,68,68,0.2)] bg-[color:rgba(239,68,68,0.08)] px-4 py-3 text-sm text-[color:#FCA5A5]">
                  {error}
                </div>
              ) : null}

              <div className="mt-8 flex items-center justify-end gap-4">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    void onOpenLedger(selectedPosition);
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--ledger-accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
                >
                  {isSaving ? <Loader2 size={17} className="animate-spin" /> : null}
                  {isSaving ? 'Opening...' : 'Open Ledger'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type DashboardCacheState = Record<string, unknown>;

const DASHBOARD_CACHE_MAX_AGE = 45_000;
const dashboardCache = new Map<
  string,
  { updatedAt: number; refreshToken: number; state: DashboardCacheState }
>();

// Dashboard content component
function DashboardContent() {
  const { user } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();
  const { workspaceShellLayout } = useSidebar();
  const toast = useToast();

  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [todayTasks, setTodayTasks] = useState<
    Array<{
      id: string;
      kind?: 'task' | 'reminder';
      client_id?: string | null;
      title: string;
      status: string;
      due_date?: string | null;
      due_time?: string | null;
      remind_at?: string | null;
      priority?: string | null;
      project_id?: string | null;
      project_name?: string | null;
      workspace_id?: string | null;
      workspace_name?: string | null;
      workspace_color?: string | null;
      calendar_name?: string | null;
      assigned_to?: string | null;
      assigned_to_user_id?: string | null;
      assigned_to_team_id?: string | null;
      assigned_team_id?: string | null;
      task_horizon?: 'today' | 'long_term' | null;
      is_today_focus?: boolean;
      show_in_today?: boolean;
      completed_at?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>
  >([]);
  const [upcomingReminders, setUpcomingReminders] = useState<Array<(typeof todayTasks)[number]>>(
    []
  );
  const [workspaceTasks, setWorkspaceTasks] = useState<
    Array<{
      id: string;
      title: string;
      status?: string | null;
      due_date?: string | null;
      due_time?: string | null;
      priority?: string | null;
      project_id?: string | null;
      milestone_id?: string | null;
      assigned_to?: string | null;
      assigned_to_user_id?: string | null;
      assigned_to_team_id?: string | null;
      assigned_team_id?: string | null;
      task_horizon?: 'today' | 'long_term' | null;
      show_in_today?: boolean;
      is_today_focus?: boolean;
      workspace_id?: string | null;
      workspace_name?: string | null;
      workspace_color?: string | null;
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
      project_type?: string | null;
      color?: string | null;
      end_date?: string | null;
      owner_team_id?: string | null;
      lead_id?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>
  >([]);
  const [upcoming, setUpcoming] = useState<
    Array<{
      id: string;
      title: string;
      start_at: string;
      end_at: string;
      color?: string;
      assigned_to_user_id?: string | null;
      assigned_to_team_id?: string | null;
      assigned_team_id?: string | null;
      workspace_name?: string | null;
      workspace_color?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>
  >([]);
  const [notes, setNotes] = useState<
    Array<{ id: string; title: string; content: string; updated_at: string }>
  >([]);
  const optimisticNotesRef = useRef<
    Array<{ id: string; title: string; content: string; updated_at: string }>
  >([]);
  const [workspaceTeams, setWorkspaceTeams] = useState<
    Array<{ id: string; name: string; identifier?: string | null }>
  >([]);
  const [noteProjectLinks, setNoteProjectLinks] = useState<
    Array<{ note_id: string; project_id: string; project_name: string }>
  >([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<
    Array<{ user_id: string; full_name: string | null; email: string | null }>
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
      assigned_to?: string | null;
      assigned_to_user_id?: string | null;
      assigned_to_team_id?: string | null;
      assigned_team_id?: string | null;
    }>
  >([]);
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [githubAttention, setGithubAttention] = useState<Array<{ id: string; target_type?: string | null; target_id?: string | null; attention_type: string; title: string; reason: string; metadata?: { canonicalUrl?: string | null; repositoryFullName?: string | null } }>>([]);
  const [overviewTaskMode, setOverviewTaskMode] = useState<'focus' | 'today' | 'long_term'>(
    'focus'
  );
  const [overviewTaskTitle, setOverviewTaskTitle] = useState('');
  const [overviewTaskDueDate, setOverviewTaskDueDate] = useState('');
  const [overviewTaskAssigneeValue, setOverviewTaskAssigneeValue] = useState('');
  const [isSavingOverviewTask, setIsSavingOverviewTask] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [focusActionId, setFocusActionId] = useState<string | null>(null);
  const [completedFocusTasks, setCompletedFocusTasks] = useState<CompletedFocusTask[]>(() =>
    loadCompletedFocusTasks()
  );
  const [isFocusPickerOpen, setIsFocusPickerOpen] = useState(false);
  const [isOverviewTaskModalOpen, setIsOverviewTaskModalOpen] = useState(false);
  const [isOverviewViewMenuOpen, setIsOverviewViewMenuOpen] = useState(false);
  const [isOverviewCreateMenuOpen, setIsOverviewCreateMenuOpen] = useState(false);
  const [isUpcomingQuickCreateOpen, setIsUpcomingQuickCreateOpen] = useState(false);
  const [upcomingQuickCreateKind, setUpcomingQuickCreateKind] = useState<'event' | 'reminder'>(
    'event'
  );
  const [upcomingQuickTitle, setUpcomingQuickTitle] = useState('');
  const [upcomingQuickDate, setUpcomingQuickDate] = useState(todayKey());
  const [upcomingQuickTime, setUpcomingQuickTime] = useState('09:00');
  const [upcomingQuickNotes, setUpcomingQuickNotes] = useState('');
  const [upcomingQuickCalendarId, setUpcomingQuickCalendarId] = useState('');
  const [upcomingQuickCalendars, setUpcomingQuickCalendars] = useState<
    Array<{ id: string; name: string; color?: string | null }>
  >([]);
  const [isLoadingUpcomingQuickCalendars, setIsLoadingUpcomingQuickCalendars] = useState(false);
  const [upcomingQuickTeamId, setUpcomingQuickTeamId] = useState('');
  const [upcomingQuickTeams, setUpcomingQuickTeams] = useState<
    Array<{ id: string; name: string; identifier?: string | null }>
  >([]);
  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      setGithubAttention([]);
      return;
    }
    let cancelled = false;
    void api.getGithubAttention()
      .then((rows) => {
        if (!cancelled) setGithubAttention(Array.isArray(rows) ? (rows as typeof githubAttention) : []);
      })
      .catch(() => {
        if (!cancelled) setGithubAttention([]);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, api, dashboardRefreshToken, user]);
  const [isLoadingUpcomingQuickTeams, setIsLoadingUpcomingQuickTeams] = useState(false);
  const [isOverviewLinkProjectOpen, setIsOverviewLinkProjectOpen] = useState(false);
  const [overviewLinkTargetNoteId, setOverviewLinkTargetNoteId] = useState<string | null>(null);
  const [isOverviewCreateNoteOpen, setIsOverviewCreateNoteOpen] = useState(false);
  const [isOverviewCreateProjectOpen, setIsOverviewCreateProjectOpen] = useState(false);
  const [overviewProjectName, setOverviewProjectName] = useState('');
  const [overviewProjectDescription, setOverviewProjectDescription] = useState('');
  const [overviewProjectType, setOverviewProjectType] =
    useState<(typeof overviewProjectTypeOptions)[number]['id']>('code');
  const [overviewProjectLeadId, setOverviewProjectLeadId] = useState('');
  const [overviewProjectOwnerTeamId, setOverviewProjectOwnerTeamId] = useState('');
  const [overviewProjectTeams, setOverviewProjectTeams] = useState<
    Array<{ id: string; name: string; identifier?: string | null }>
  >([]);
  const [isLoadingOverviewProjectTeams, setIsLoadingOverviewProjectTeams] = useState(false);
  const [isSavingOverviewProject, setIsSavingOverviewProject] = useState(false);
  const [overviewLinkableProjects, setOverviewLinkableProjects] = useState<
    Array<{
      id: string;
      name: string;
      status?: string | null;
      completeness?: number | null;
      end_date?: string | null;
    }>
  >([]);
  const [isLoadingOverviewLinkableProjects, setIsLoadingOverviewLinkableProjects] = useState(false);
  const [overviewLinkProjectSearch, setOverviewLinkProjectSearch] = useState('');
  const [isSavingUpcomingQuickItem, setIsSavingUpcomingQuickItem] = useState(false);
  const [upcomingQuickError, setUpcomingQuickError] = useState<string | null>(null);
  const overviewTaskTitleRef = useRef<HTMLInputElement | null>(null);
  const upcomingQuickTitleRef = useRef<HTMLInputElement | null>(null);
  const overviewProjectNameRef = useRef<HTMLInputElement | null>(null);
  const overviewFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const overviewCreateMenuRef = useRef<HTMLDivElement | null>(null);
  const overviewViewMenuRef = useRef<HTMLDivElement | null>(null);
  const overviewDisplayMenuRef = useRef<HTMLDivElement | null>(null);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [calendarScope, setCalendarScope] = useState<
    'current_workspace' | 'all_accessible_workspaces'
  >('current_workspace');
  const isPersonalWorkspace = Boolean(activeWorkspace?.is_personal);
  const effectiveCalendarScope = isPersonalWorkspace ? 'current_workspace' : calendarScope;
  const autoExpireTodayTaskIdsRef = useRef<Set<string>>(new Set());
  const workspaceMemberById = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers]
  );
  const workspaceTeamById = useMemo(
    () => new Map(workspaceTeams.map((team) => [team.id, team])),
    [workspaceTeams]
  );
  const workspaceTaskById = useMemo(
    () => new Map(workspaceTasks.map((task) => [task.id, task])),
    [workspaceTasks]
  );
  const overviewFilterKeyList = useMemo(
    () =>
      [
        'type',
        'status',
        'assignment',
        'team',
        'project',
        'date',
        'priority',
        'progress',
        'has',
        'noteType',
        'linkedContext',
      ] as const,
    []
  );
  const createEmptyOverviewFilterValues = useCallback(
    () =>
      overviewFilterKeyList.reduce((values, key) => {
        values[key] = [];
        return values;
      }, {} as OverviewFilterValues),
    [overviewFilterKeyList]
  );
  const createEmptyOverviewFilters = useCallback(
    () => ({
      all: createEmptyOverviewFilterValues(),
      assigned: createEmptyOverviewFilterValues(),
      today: createEmptyOverviewFilterValues(),
      projects: createEmptyOverviewFilterValues(),
      notes: createEmptyOverviewFilterValues(),
    }),
    [createEmptyOverviewFilterValues]
  );
  const countOverviewFilters = useCallback(
    (filters: OverviewFilterValues) =>
      overviewFilterKeyList.reduce((total, key) => total + (filters[key]?.length ?? 0), 0),
    [overviewFilterKeyList]
  );
  const getWorkspaceTaskMetadata = () => ({
    workspace_id: activeWorkspaceId ?? null,
    workspace_name: activeWorkspace?.name?.trim() || null,
    workspace_color: activeWorkspace?.color ?? null,
  });

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkspaceMembers([]);
      return;
    }

    let cancelled = false;
    const loadWorkspaceMembers = async () => {
      try {
        const payload = (await api.getWorkspaceMembers(activeWorkspaceId)) as {
          members?: Array<{ user_id: string; full_name?: string | null; email?: string | null }>;
        };
        if (cancelled) return;
        const members = Array.isArray(payload?.members)
          ? payload.members.map((member) => ({
              user_id: member.user_id,
              full_name: member.full_name ?? null,
              email: member.email ?? null,
            }))
          : [];
        setWorkspaceMembers(members);
      } catch {
        if (!cancelled) setWorkspaceMembers([]);
      }
    };

    void loadWorkspaceMembers();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);
  const [dashboardContextMenu, setDashboardContextMenu] = useState<
    | { x: number; y: number; type: 'followup'; taskId: string }
    | { x: number; y: number; type: 'timeline'; eventId: string }
    | { x: number; y: number; type: 'project'; projectId: string }
    | { x: number; y: number; type: 'note'; noteId: string }
    | { x: number; y: number; type: 'checkin' }
    | {
        x: number;
        y: number;
        type: 'overview-row';
        rowId: string;
        rowKind: 'task' | 'reminder' | 'project' | 'note' | 'event' | 'milestone' | 'capture';
        sourceId: string;
      }
    | null
  >(null);
  const [isOverviewRescheduleOpen, setIsOverviewRescheduleOpen] = useState(false);
  const [overviewRescheduleDate, setOverviewRescheduleDate] = useState('');
  const currentDashboardSection =
    new URLSearchParams(window.location.search).get('section')?.trim() ?? moduleSection;
  type OverviewTab = 'all' | 'assigned' | 'today' | 'projects' | 'notes';
  type OverviewFilterKey =
    | 'type'
    | 'status'
    | 'assignment'
    | 'team'
    | 'project'
    | 'date'
    | 'priority'
    | 'progress'
    | 'has'
    | 'noteType'
    | 'linkedContext';
  type OverviewFilterValues = Record<OverviewFilterKey, string[]>;
  type OverviewFilters = Record<OverviewTab, OverviewFilterValues>;
  const [overviewTab, setOverviewTab] = useState<OverviewTab>(
    ['all', 'assigned', 'today', 'projects', 'notes'].includes(currentDashboardSection)
      ? (currentDashboardSection as OverviewTab)
      : 'all'
  );
  const [overviewTeamScopeId, setOverviewTeamScopeId] = useState<string | null>(() => {
    const raw = String(moduleFocusContext ?? '').trim();
    if (!raw.startsWith('team:')) return null;
    return raw.slice('team:'.length).trim() || null;
  });
  useEffect(() => {
    if (isPersonalWorkspace) setOverviewTeamScopeId(null);
  }, [activeWorkspaceId, isPersonalWorkspace]);
  useEffect(() => {
    if (isPersonalWorkspace && overviewTab === 'assigned') setOverviewTab('all');
  }, [isPersonalWorkspace, overviewTab]);
  const [overviewLayoutPreferences, setOverviewLayoutPreferences] =
    useState<OverviewLayoutPreferences>(defaultOverviewLayoutPreferences);
  const [isOverviewFilterOpen, setIsOverviewFilterOpen] = useState(false);
  const [isOverviewDisplayOpen, setIsOverviewDisplayOpen] = useState(false);
  const [overviewFilters, setOverviewFilters] = useState<OverviewFilters>(() => ({
    all: {
      type: [],
      status: [],
      assignment: [],
      team: [],
      project: [],
      date: [],
      priority: [],
      progress: [],
      has: [],
      noteType: [],
      linkedContext: [],
    },
    assigned: {
      type: [],
      status: [],
      assignment: [],
      team: [],
      project: [],
      date: [],
      priority: [],
      progress: [],
      has: [],
      noteType: [],
      linkedContext: [],
    },
    today: {
      type: [],
      status: [],
      assignment: [],
      team: [],
      project: [],
      date: [],
      priority: [],
      progress: [],
      has: [],
      noteType: [],
      linkedContext: [],
    },
    projects: {
      type: [],
      status: [],
      assignment: [],
      team: [],
      project: [],
      date: [],
      priority: [],
      progress: [],
      has: [],
      noteType: [],
      linkedContext: [],
    },
    notes: {
      type: [],
      status: [],
      assignment: [],
      team: [],
      project: [],
      date: [],
      priority: [],
      progress: [],
      has: [],
      noteType: [],
      linkedContext: [],
    },
  }));
  const [overviewFilterOpenSections, setOverviewFilterOpenSections] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedOverviewRowId, setSelectedOverviewRowId] = useState<string | null>(null);
  const [collapsedOverviewGroups, setCollapsedOverviewGroups] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem('ledger:overview:collapsed-groups:v1');
      return new Set(Array.isArray(JSON.parse(stored || '[]')) ? JSON.parse(stored || '[]') : []);
    } catch {
      return new Set();
    }
  });
  const hasLoadedDashboardRef = useRef(false);
  const dashboardHydrationRef = useRef(false);
  const dashboardCacheWriteTokenRef = useRef(0);
  const dashboardDayRef = useRef(todayKey());
  const handleDashboardWorkspaceRefresh = useCallback(() => {
    setDashboardRefreshToken((current) => current + 1);
  }, []);

  const hydrateDashboardCache = (cached: { state: DashboardCacheState }) => {
    setDaily(cached.state.daily as typeof daily);
    setTodayTasks(cached.state.todayTasks as typeof todayTasks);
    setUpcomingReminders(cached.state.upcomingReminders as typeof upcomingReminders);
    setWorkspaceTasks(cached.state.workspaceTasks as typeof workspaceTasks);
    setProjects(cached.state.projects as typeof projects);
    setUpcoming(cached.state.upcoming as typeof upcoming);
    setNotes(cached.state.notes as typeof notes);
    setWorkspaceTeams(cached.state.workspaceTeams as typeof workspaceTeams);
    setNoteProjectLinks(cached.state.noteProjectLinks as typeof noteProjectLinks);
    setFollowUpTasks(cached.state.followUpTasks as typeof followUpTasks);
  };

  useEffect(() => {
    if (!activeWorkspaceId || !hasLoadedDashboardRef.current || isLoadingDashboard) return;
    if (dashboardHydrationRef.current) {
      dashboardHydrationRef.current = false;
      return;
    }
    dashboardCache.set(activeWorkspaceId, {
      updatedAt: Date.now(),
      refreshToken: dashboardCacheWriteTokenRef.current,
      state: {
        daily,
        todayTasks,
        upcomingReminders,
        workspaceTasks,
        projects,
        upcoming,
        notes,
        workspaceTeams,
        noteProjectLinks,
        followUpTasks,
      },
    });
  }, [
    activeWorkspaceId,
    daily,
    followUpTasks,
    isLoadingDashboard,
    noteProjectLinks,
    notes,
    projects,
    todayTasks,
    upcoming,
    upcomingReminders,
    workspaceTasks,
    workspaceTeams,
  ]);

  const openOverviewLinkProjectModal = useCallback(
    async (noteId: string) => {
      setDashboardContextMenu(null);
      setOverviewLinkTargetNoteId(noteId);
      setOverviewLinkProjectSearch('');
      setIsOverviewLinkProjectOpen(true);
      setIsLoadingOverviewLinkableProjects(true);

      try {
        const projectsPayload = await api.getProjects();
        const projects = Array.isArray(projectsPayload)
          ? (projectsPayload as Array<{
              id: string;
              name: string;
              status?: string | null;
              completeness?: number | null;
              end_date?: string | null;
            }>)
          : [];
        setOverviewLinkableProjects(
          projects.filter((project) => {
            const status = String(project.status ?? '').toLowerCase();
            return status !== 'completed' && status !== 'paused' && status !== 'archived';
          })
        );
      } catch (error) {
        console.error('Failed to load overview linkable projects:', error);
        setOverviewLinkableProjects([]);
      } finally {
        setIsLoadingOverviewLinkableProjects(false);
      }
    },
    [api]
  );

  const openOverviewCreateProjectModal = useCallback(() => {
    setIsOverviewCreateProjectOpen(true);
    setOverviewProjectName('');
    setOverviewProjectDescription('');
    setOverviewProjectType('code');
    setOverviewProjectLeadId(user?.id ?? '');
    setOverviewProjectOwnerTeamId('');
  }, [user?.id]);

  const getSortTimestamp = (item: {
    created_at?: string | null;
    updated_at?: string | null;
    start_at?: string | null;
    due_date?: string | null;
  }) => {
    return (
      item.created_at ??
      item.updated_at ??
      item.start_at ??
      (item.due_date ? `${item.due_date}T23:59:59` : null) ??
      ''
    );
  };

  const sortNewestFirst = <
    T extends {
      created_at?: string | null;
      updated_at?: string | null;
      start_at?: string | null;
      due_date?: string | null;
    }
  >(
    items: T[]
  ) =>
    [...items].sort(
      (left, right) =>
        new Date(getSortTimestamp(right)).getTime() - new Date(getSortTimestamp(left)).getTime()
    );

  const closeOverviewCreateProjectModal = useCallback(() => {
    if (isSavingOverviewProject) return;
    setIsOverviewCreateProjectOpen(false);
    setOverviewProjectName('');
    setOverviewProjectDescription('');
    setOverviewProjectType('code');
    setOverviewProjectLeadId('');
    setOverviewProjectOwnerTeamId('');
    setOverviewProjectTeams([]);
  }, [isSavingOverviewProject]);

  useEffect(() => {
    if (!isOverviewCreateProjectOpen || !user || !activeWorkspaceId) return;

    let cancelled = false;
    const loadOverviewProjectTeams = async () => {
      setIsLoadingOverviewProjectTeams(true);
      try {
        const payload = (await api.getTeams()) as
          | Array<{ id: string; name: string; identifier?: string | null }>
          | { teams?: Array<{ id: string; name: string; identifier?: string | null }> }
          | null;
        if (cancelled) return;
        const teams = Array.isArray(payload)
          ? payload
          : Array.isArray(
              (
                payload as {
                  teams?: Array<{ id: string; name: string; identifier?: string | null }> | null;
                } | null
              )?.teams
            )
          ? (payload as { teams: Array<{ id: string; name: string; identifier?: string | null }> })
              .teams ?? []
          : [];
        setOverviewProjectTeams(
          teams
            .map((team) => ({
              id: team.id,
              name: team.name,
              identifier: team.identifier ?? null,
            }))
            .filter((team) => Boolean(team.id && team.name))
        );
      } catch {
        if (!cancelled) {
          setOverviewProjectTeams([]);
        }
      } finally {
        if (!cancelled) setIsLoadingOverviewProjectTeams(false);
      }
    };

    void loadOverviewProjectTeams();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, isOverviewCreateProjectOpen, user]);

  useEffect(() => {
    if (!isOverviewCreateProjectOpen) return;
    const timer = window.setTimeout(() => {
      overviewProjectNameRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [isOverviewCreateProjectOpen]);

  const createOverviewProject = useCallback(async () => {
    const name = overviewProjectName.trim();
    if (!name || isSavingOverviewProject || !activeWorkspaceId) return;

    setIsSavingOverviewProject(true);
    try {
      const created = await api.createProject({
        name,
        description: overviewProjectDescription.trim() || null,
        color:
          overviewProjectTypeOptions.find((option) => option.id === overviewProjectType)?.color ??
          '#6B7280',
        start_date: null,
        end_date: null,
        status: 'NotStarted',
        project_type: overviewProjectType,
        lead_id: overviewProjectLeadId || null,
        owner_team_id: overviewProjectOwnerTeamId || null,
      });
      if (created && typeof created === 'object') {
        const project = created as {
          id: string;
          name: string;
          status?: string | null;
          completeness?: number | null;
          project_type?: string | null;
          color?: string | null;
          end_date?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        setProjects((current) =>
          sortNewestFirst([
            {
              id: project.id,
              name: project.name,
              status: project.status ?? 'NotStarted',
              completeness: typeof project.completeness === 'number' ? project.completeness : 0,
              project_type: project.project_type ?? 'other',
              color: project.color ?? null,
              end_date: project.end_date ?? null,
              created_at: project.created_at ?? null,
              updated_at: project.updated_at ?? null,
            },
            ...current.filter((item) => item.id !== project.id),
          ]).slice(0, 4)
        );
        handleDashboardWorkspaceRefresh();
        window.desktopWindow?.toggleModule('projects', {
          kind: 'projects',
          focusProjectId: project.id,
        });
      }
      closeOverviewCreateProjectModal();
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Could not create project.');
    } finally {
      setIsSavingOverviewProject(false);
    }
  }, [
    activeWorkspaceId,
    api,
    closeOverviewCreateProjectModal,
    handleDashboardWorkspaceRefresh,
    isSavingOverviewProject,
    overviewProjectDescription,
    overviewProjectLeadId,
    overviewProjectName,
    overviewProjectOwnerTeamId,
    overviewProjectType,
  ]);

  const linkOverviewNoteToProject = useCallback(
    async (projectId: string) => {
      const noteId = overviewLinkTargetNoteId;
      if (!noteId) return;
      try {
        await api.linkProjectNote(projectId, noteId);
        setIsOverviewLinkProjectOpen(false);
        setOverviewLinkTargetNoteId(null);
        handleDashboardWorkspaceRefresh();
      } catch (error) {
        console.error('Failed to link overview note to project:', error);
      }
    },
    [api, handleDashboardWorkspaceRefresh, overviewLinkTargetNoteId]
  );

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: ['notes', 'projects', 'tasks', 'events', 'reminders', 'project_note_links'],
    enabled: Boolean(user && activeWorkspaceId),
    onChange: handleDashboardWorkspaceRefresh,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DASHBOARD_COMPLETED_FOCUS_STORAGE_KEY,
        JSON.stringify({ day: todayKey(), items: completedFocusTasks })
      );
    } catch {
      // No-op when storage is unavailable.
    }
  }, [completedFocusTasks]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const loadCalendarSettings = async () => {
      try {
        const payload = (await api.getUserSettings()) as {
          preferences?: {
            calendarScope?: 'current_workspace' | 'all_accessible_workspaces';
            showTrayIcon?: boolean;
            runInBackground?: boolean;
          } | null;
        };
        if (cancelled) return;
        setCalendarScope(
          !activeWorkspace?.is_personal &&
            payload?.preferences?.calendarScope === 'all_accessible_workspaces'
            ? 'all_accessible_workspaces'
            : 'current_workspace'
        );
        window.ipcRenderer?.send('tray:update-state', {
          showTrayIcon: payload?.preferences?.showTrayIcon !== false,
          runInBackground: payload?.preferences?.runInBackground !== false,
        });
      } catch {
        if (!cancelled) {
          setCalendarScope('current_workspace');
          window.ipcRenderer?.send('tray:update-state', {
            showTrayIcon: true,
            runInBackground: true,
          });
        }
      }
    };

    void loadCalendarSettings();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.is_personal, api, user]);

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
        if (cancelled) return;
        setNotificationCount(Number(payload?.counts?.active ?? 0));
      } catch {
        if (!cancelled) {
          setNotificationCount(0);
        }
      }
    };

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ activeCount?: number }>).detail;
      setNotificationCount(Number(detail?.activeCount ?? 0));
    };

    void loadNotificationSummary();
    window.addEventListener(
      'ledger:notifications-summary',
      handleNotificationsSummary as EventListener
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        'ledger:notifications-summary',
        handleNotificationsSummary as EventListener
      );
    };
  }, [api, user]);

  useEffect(() => {
    window.ipcRenderer?.send('tray:update-state', {
      inboxCount,
      notificationCount,
    });
  }, [inboxCount, notificationCount]);

  useEffect(() => {
    const syncCompletedFocusDay = () => {
      const currentDay = todayKey();
      if (dashboardDayRef.current === currentDay) return;

      dashboardDayRef.current = currentDay;
      setCompletedFocusTasks([]);
      try {
        window.localStorage.removeItem(DASHBOARD_COMPLETED_FOCUS_STORAGE_KEY);
      } catch {
        // No-op when storage is unavailable.
      }
    };

    syncCompletedFocusDay();
    const timer = window.setInterval(syncCompletedFocusDay, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
      setUpcomingReminders([]);
      setNotes([]);
      optimisticNotesRef.current = [];
      setWorkspaceTeams([]);
      setFollowUpTasks([]);
      setWorkspaceTasks([]);
      return;
    }

    let cancelled = false;

    const loadDashboard = async () => {
      const isInitialLoad = !hasLoadedDashboardRef.current;
      const cached = dashboardCache.get(activeWorkspaceId);

      if (cached && cached.refreshToken === dashboardRefreshToken) {
        dashboardHydrationRef.current = true;
        dashboardCacheWriteTokenRef.current = cached.refreshToken;
        hydrateDashboardCache(cached);
        hasLoadedDashboardRef.current = true;
        setIsLoadingDashboard(false);
        if (Date.now() - cached.updatedAt < DASHBOARD_CACHE_MAX_AGE) return;
      }

      try {
        if (isInitialLoad && !cached) {
          setIsLoadingDashboard(true);
          setDashboardError(null);
        }

        const [
          dailyData,
          todayData,
          projectData,
          upcomingData,
          upcomingReminderData,
          noteData,
          taskData,
          projectNoteLinksData,
          teamsData,
        ] = await Promise.allSettled([
          api.getDailyAccountability(),
          api.getToday(),
          api.getProjects(),
          api.getUpcomingEvents({ scope: effectiveCalendarScope }),
          api.getReminders({ scope: effectiveCalendarScope }),
          api.getNotes(),
          api.getTasks(),
          api.getWorkspaceProjectNoteLinks(activeWorkspaceId),
          api.getTeams(),
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
        const activeReminders =
          todayData.status === 'fulfilled' &&
          Array.isArray((todayData.value as { reminders?: unknown[] } | null)?.reminders)
            ? (todayData.value as { reminders: Array<(typeof todayTasks)[number]> }).reminders
            : [];

        setTodayTasks(
          sortNewestFirst([
            ...activeToday
              .filter((item) => !isOverviewDeletePending('task', item.id))
              .map((item) => ({ ...item, kind: 'task' as const })),
            ...activeReminders
              .filter((item) => !isOverviewDeletePending('reminder', item.id))
              .map((item) => ({
                ...item,
                kind: 'reminder' as const,
                is_today_focus: false,
                show_in_today: true,
              })),
          ])
        );

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

        const noteProjectLinks =
          projectNoteLinksData.status === 'fulfilled'
            ? Array.isArray(projectNoteLinksData.value)
              ? (projectNoteLinksData.value as Array<{
                  note_id: string;
                  project_id: string;
                  project_name: string;
                }>)
              : Array.isArray(
                  (
                    projectNoteLinksData.value as {
                      links?: Array<{
                        note_id: string;
                        project_id: string;
                        project_name: string;
                      }>;
                    } | null
                  )?.links
                )
              ? (
                  projectNoteLinksData.value as {
                    links: Array<{
                      note_id: string;
                      project_id: string;
                      project_name: string;
                    }>;
                  }
                ).links
              : []
            : [];

        const normalizedTeams =
          teamsData.status === 'fulfilled'
            ? Array.isArray(teamsData.value)
              ? (teamsData.value as Array<{
                  id: string;
                  name: string;
                  identifier?: string | null;
                }>)
              : Array.isArray(
                  (
                    teamsData.value as {
                      teams?: Array<{
                        id: string;
                        name: string;
                        identifier?: string | null;
                      }> | null;
                    } | null
                  )?.teams
                )
              ? (
                  teamsData.value as {
                    teams: Array<{ id: string; name: string; identifier?: string | null }>;
                  }
                ).teams ?? []
              : []
            : [];
        setWorkspaceTeams(
          normalizedTeams
            .map((team) => ({
              id: team.id,
              name: team.name,
              identifier: team.identifier ?? null,
            }))
            .filter((team) => Boolean(team.id && team.name))
        );

        setProjects(
          projectData.status === 'fulfilled'
            ? (
                (projectData.value ?? []) as Array<{
                  id: string;
                  name: string;
                  status: string;
                  completeness: number;
                  project_type?: string | null;
                  color?: string | null;
                  end_date?: string | null;
                  owner_team_id?: string | null;
                  lead_id?: string | null;
                  created_at?: string | null;
                  updated_at?: string | null;
                }>
              )
                .filter((project) => !isOverviewDeletePending('project', project.id))
                .map((project) => ({
                  ...project,
                  created_at: project.created_at ?? null,
                  updated_at: project.updated_at ?? null,
                }))
                .sort(
                  (left, right) =>
                    new Date(getSortTimestamp(right)).getTime() -
                    new Date(getSortTimestamp(left)).getTime()
                )
                .slice(0, 4)
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
                  assigned_to_user_id?: string | null;
                  assigned_to_team_id?: string | null;
                  assigned_team_id?: string | null;
                  status?: string | null;
                  workspace_name?: string | null;
                  workspace_color?: string | null;
                  created_at?: string | null;
                  updated_at?: string | null;
                }>
              )
                .filter((event) => !isOverviewDeletePending('event', event.id))
                .filter(isUpcomingEventActive)
                .sort(
                  (left, right) =>
                    new Date(left.start_at).getTime() - new Date(right.start_at).getTime()
                )
                .slice(0, 4)
            : []
        );
        const normalizedUpcomingReminders =
          upcomingReminderData.status === 'fulfilled' && Array.isArray(upcomingReminderData.value)
            ? (
                upcomingReminderData.value as Array<{
                  id: string;
                  title: string;
                  remind_at?: string | null;
                  is_done?: boolean;
                  status?: string | null;
                  project_id?: string | null;
                  project_name?: string | null;
                  workspace_id?: string | null;
                  workspace_name?: string | null;
                  workspace_color?: string | null;
                  calendar_name?: string | null;
                  created_at?: string | null;
                  updated_at?: string | null;
                }>
              )
                .filter((reminder) => {
                  const remindAt = new Date(reminder.remind_at ?? '').getTime();
                  return (
                    !reminder.is_done &&
                    String(reminder.status ?? '').toLowerCase() !== 'completed' &&
                    Number.isFinite(remindAt) &&
                    remindAt > Date.now() &&
                    new Date(reminder.remind_at ?? '').toDateString() !== new Date().toDateString()
                  );
                })
                .sort(
                  (left, right) =>
                    new Date(left.remind_at ?? 0).getTime() -
                    new Date(right.remind_at ?? 0).getTime()
                )
                .slice(0, 6)
                .map((reminder) => ({
                  ...reminder,
                  kind: 'reminder' as const,
                  status: reminder.status ?? 'todo',
                  remind_at: reminder.remind_at ?? null,
                  show_in_today: false,
                  is_today_focus: false,
                }))
            : [];
        setUpcomingReminders(normalizedUpcomingReminders);
        const mergedNotes = [
          ...normalizedNotes.filter((note) => !isOverviewDeletePending('note', note.id)),
          ...optimisticNotesRef.current.filter(
            (optimistic) =>
              !normalizedNotes.some((note) => note.id === optimistic.id) &&
              !isOverviewDeletePending('note', optimistic.id)
          ),
        ]
          .sort(
            (left, right) =>
              new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime()
          )
          .slice(0, 4);
        setNotes(mergedNotes);
        optimisticNotesRef.current = optimisticNotesRef.current.filter(
          (optimistic) => !normalizedNotes.some((note) => note.id === optimistic.id)
        );
        setNoteProjectLinks(noteProjectLinks);
        const rawTasks =
          taskData.status === 'fulfilled' && Array.isArray(taskData.value)
            ? (taskData.value as Array<{
                id: string;
                title: string;
                status?: string | null;
                description?: string | null;
                notes?: string | null;
                due_date?: string | null;
                due_time?: string | null;
                priority?: string | null;
                project_id?: string | null;
                milestone_id?: string | null;
                assigned_to?: string | null;
                assigned_to_user_id?: string | null;
                assigned_to_team_id?: string | null;
                assigned_team_id?: string | null;
                task_horizon?: 'today' | 'long_term' | null;
                show_in_today?: boolean;
                is_today_focus?: boolean;
                workspace_id?: string | null;
                workspace_name?: string | null;
                workspace_color?: string | null;
                updated_at?: string;
                created_at?: string | null;
              }>)
            : [];
        setWorkspaceTasks(
          rawTasks.filter(
            (task) =>
              String(task.status ?? '').toLowerCase() !== 'completed' &&
              !isOverviewDeletePending('task', task.id)
          )
        );
        const calendarFollowUps = rawTasks
          .filter(
            (task) =>
              String(task.description ?? '').startsWith('calendar_followup:') &&
              !isOverviewDeletePending('task', task.id)
          )
          .map((task) => {
            const marker = String(task.description ?? '');
            const eventId = marker.startsWith('calendar_followup:')
              ? marker.slice('calendar_followup:'.length).trim()
              : '';
            const noteText = String(task.notes ?? '');
            const noteTitle = noteText.startsWith('Follow-up from calendar: ')
              ? noteText.slice('Follow-up from calendar: '.length).split(/\r?\n/, 1)[0].trim()
              : '';
            const fallbackTitle = String(task.title ?? '')
              .replace(/^Follow\s*-?\s*up:\s*/i, '')
              .trim();
            const eventTitle = noteTitle || fallbackTitle;
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
        dashboardCacheWriteTokenRef.current = dashboardRefreshToken;
        const failedSections = [
          dailyData.status === 'rejected' ? 'daily check-in' : null,
          todayData.status === 'rejected' ? 'today feed' : null,
          projectData.status === 'rejected' ? 'projects' : null,
          upcomingData.status === 'rejected' ? 'upcoming events' : null,
          upcomingReminderData.status === 'rejected' ? 'upcoming reminders' : null,
          noteData.status === 'rejected' ? 'notes' : null,
          projectNoteLinksData.status === 'rejected' ? 'note links' : null,
          taskData.status === 'rejected' ? 'follow-ups' : null,
          teamsData.status === 'rejected' ? 'teams' : null,
        ].filter(Boolean);

        if (failedSections.length > 0) {
          setDashboardError(`Some overview sections could not load: ${failedSections.join(', ')}.`);
        } else {
          setDashboardError(null);
        }
      } catch (error) {
        if (!cancelled) {
          if (isInitialLoad) {
            setDashboardError(error instanceof Error ? error.message : 'Could not load overview.');
            setDaily({
              focusItems: [],
              finished: '',
              blocked: '',
              firstTaskTomorrow: '',
            });
            setTodayTasks([]);
            setProjects([]);
            setUpcoming([]);
            setUpcomingReminders([]);
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
  }, [activeWorkspaceId, api, effectiveCalendarScope, dashboardRefreshToken, user]);

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
        console.error('Failed to load dashboard inbox count:', error);
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
  }, [api, activeWorkspaceId, user]);

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
    if (!dashboardContextMenu) return;
    const close = () => {
      setDashboardContextMenu(null);
      setIsOverviewRescheduleOpen(false);
    };
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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'ledger:overview:collapsed-groups:v1',
        JSON.stringify(Array.from(collapsedOverviewGroups))
      );
    } catch {
      // Keep group collapse state as a personal preference when storage is available.
    }
  }, [collapsedOverviewGroups]);

  useEffect(() => {
    const storageKey = activeWorkspaceId ? `ledger:overview:filters:v1:${activeWorkspaceId}` : null;
    if (!storageKey) {
      setOverviewFilters(createEmptyOverviewFilters());
      return;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        setOverviewFilters(createEmptyOverviewFilters());
        return;
      }

      const parsed = JSON.parse(stored) as Partial<OverviewFilters> | null;
      const nextFilters = createEmptyOverviewFilters();
      (['all', 'assigned', 'today', 'projects', 'notes'] as OverviewTab[]).forEach((tab) => {
        const tabFilters = parsed?.[tab];
        if (!tabFilters || typeof tabFilters !== 'object') return;
        overviewFilterKeyList.forEach((key) => {
          const values = Array.isArray(tabFilters[key])
            ? tabFilters[key].filter((value): value is string => typeof value === 'string')
            : [];
          nextFilters[tab][key] = Array.from(new Set(values));
        });
      });
      setOverviewFilters(nextFilters);
    } catch {
      setOverviewFilters(createEmptyOverviewFilters());
    }
  }, [activeWorkspaceId, createEmptyOverviewFilters, overviewFilterKeyList]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    try {
      window.localStorage.setItem(
        `ledger:overview:filters:v1:${activeWorkspaceId}`,
        JSON.stringify(overviewFilters)
      );
    } catch {
      // Keep overview filters as a workspace preference when storage is available.
    }
  }, [activeWorkspaceId, overviewFilters]);

  useEffect(() => {
    const storageKey = activeWorkspaceId ? `ledger:overview:layout:v1:${activeWorkspaceId}` : null;
    if (!storageKey) {
      setOverviewLayoutPreferences(defaultOverviewLayoutPreferences);
      return;
    }

    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(storageKey) || 'null'
      ) as Partial<OverviewLayoutPreferences> | null;
      const validDensities: OverviewDensity[] = ['list', 'compact'];
      const validGroups: OverviewGroupBy[] = [
        'none',
        'status',
        'type',
        'project',
        'dueDate',
        'assignee',
        'team',
      ];
      const validProperties: OverviewProperty[] = [
        'priority',
        'project',
        'dueDate',
        'assignee',
        'team',
        'members',
        'progress',
        'linkedNotes',
        'updated',
      ];
      const visibleProperties = Array.isArray(parsed?.visibleProperties)
        ? parsed.visibleProperties.filter((value): value is OverviewProperty =>
            validProperties.includes(value as OverviewProperty)
          )
        : defaultOverviewLayoutPreferences.visibleProperties;
      const previousDefaultProperties: OverviewProperty[] = [
        'priority',
        'project',
        'dueDate',
        'assignee',
        'progress',
      ];
      const normalizedVisibleProperties = Array.from(new Set(visibleProperties));
      const usesPreviousDefaultProperties =
        normalizedVisibleProperties.length === previousDefaultProperties.length &&
        previousDefaultProperties.every((property) =>
          normalizedVisibleProperties.includes(property)
        );
      setOverviewLayoutPreferences({
        density: validDensities.includes(parsed?.density as OverviewDensity)
          ? (parsed?.density as OverviewDensity)
          : defaultOverviewLayoutPreferences.density,
        groupBy: validGroups.includes(parsed?.groupBy as OverviewGroupBy)
          ? (parsed?.groupBy as OverviewGroupBy)
          : defaultOverviewLayoutPreferences.groupBy,
        visibleProperties: usesPreviousDefaultProperties
          ? defaultOverviewLayoutPreferences.visibleProperties
          : normalizedVisibleProperties,
      });
    } catch {
      setOverviewLayoutPreferences(defaultOverviewLayoutPreferences);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    try {
      window.localStorage.setItem(
        `ledger:overview:layout:v1:${activeWorkspaceId}`,
        JSON.stringify(overviewLayoutPreferences)
      );
    } catch {
      // Keep layout as a best-effort workspace preference when storage is unavailable.
    }
  }, [activeWorkspaceId, overviewLayoutPreferences]);

  useEffect(() => {
    const applyTeamFocusContext = (focusContext: string | null | undefined) => {
      const raw = String(focusContext ?? '').trim();
      if (!raw.startsWith('team:')) return;
      const teamId = raw.slice('team:'.length).trim();
      if (!teamId) return;

      setOverviewTeamScopeId(teamId);
      setOverviewTab('assigned');
      setOverviewFilters((current) => ({
        ...current,
        assigned: {
          ...current.assigned,
          assignment: ['assigned', 'my_teams', `team:${teamId}`],
          team: [`team:${teamId}`],
        },
      }));
      setSelectedOverviewRowId(null);
    };

    applyTeamFocusContext(moduleFocusContext);

    const focusContextListener = (
      _event: unknown,
      payload: { kind?: string; focusContext?: string | null }
    ) => {
      if (payload?.kind !== 'dashboard') return;
      applyTeamFocusContext(payload.focusContext);
    };

    window.ipcRenderer?.on('module:focus-context', focusContextListener);
    return () => {
      window.ipcRenderer?.off('module:focus-context', focusContextListener);
    };
  }, []);

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

  const sortedTodayTasks = useMemo(() => sortNewestFirst(todayTasks), [todayTasks]);
  const isOverviewReminderTask = useCallback(
    (task: { kind?: string | null; remind_at?: string | null }) =>
      task.kind === 'reminder' || Boolean(task.remind_at),
    []
  );
  const focusTasks = sortedTodayTasks.filter(
    (task) => !isOverviewReminderTask(task) && task.is_today_focus
  );
  const focusTasksForDisplay = focusTasks.slice(0, 1);
  const focusTaskIdsForDisplay = useMemo(
    () => new Set(focusTasksForDisplay.map((task) => task.id)),
    [focusTasksForDisplay]
  );
  const activeTodayTasks = sortedTodayTasks.filter((task) =>
    isOverviewReminderTask(task)
      ? true
      : !task.is_today_focus && !focusTaskIdsForDisplay.has(task.id)
  );
  const recentNotes = useMemo(() => sortNewestFirst(notes), [notes]);
  const todayLabel = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
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
              priority?: string | null;
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
    const reminders = Array.isArray((data as { reminders?: unknown[] } | null)?.reminders)
      ? (
          data as {
            reminders: Array<{
              id: string;
              title: string;
              status: string;
              remind_at?: string | null;
              project_id?: string | null;
              project_name?: string | null;
              workspace_id?: string | null;
              workspace_name?: string | null;
              workspace_color?: string | null;
              calendar_name?: string | null;
              assigned_to?: string | null;
              is_today_focus?: boolean;
              show_in_today?: boolean;
              completed_at?: string | null;
              created_at?: string | null;
              updated_at?: string | null;
            }>;
          }
        ).reminders
      : [];
    setTodayTasks([
      ...active
        .filter((item) => !isOverviewDeletePending('task', item.id))
        .map((item) => ({ ...item, kind: 'task' as const })),
      ...reminders
        .filter((item) => !isOverviewDeletePending('reminder', item.id))
        .map((item) => ({
          ...item,
          kind: 'reminder' as const,
          is_today_focus: false,
          show_in_today: true,
        })),
    ]);
  };

  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      autoExpireTodayTaskIdsRef.current.clear();
      return;
    }
    autoExpireTodayTaskIdsRef.current.clear();
  }, [activeWorkspaceId, user]);

  const openOverviewTaskModal = useCallback((mode: 'focus' | 'today' | 'long_term') => {
    setOverviewTaskMode(mode);
    setOverviewTaskTitle('');
    setOverviewTaskAssigneeValue('');
    setOverviewTaskDueDate('');
    setIsOverviewTaskModalOpen(true);
  }, []);

  const closeOverviewTaskModal = useCallback(() => {
    if (isSavingOverviewTask) return;
    setIsOverviewTaskModalOpen(false);
    setOverviewTaskTitle('');
    setOverviewTaskAssigneeValue('');
    setOverviewTaskDueDate('');
    setOverviewTaskMode('focus');
  }, [isSavingOverviewTask]);

  useEffect(() => {
    if (!isOverviewTaskModalOpen) return;
    const timer = window.setTimeout(() => {
      overviewTaskTitleRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [isOverviewTaskModalOpen]);

  const createOverviewTask = async () => {
    const title = overviewTaskTitle.trim();
    if (!title || isSavingOverviewTask) return;

    const { assigned_to_user_id, assigned_to_team_id } =
      parseAssignmentValue(overviewTaskAssigneeValue);
    const dueDate = overviewTaskMode === 'long_term' ? overviewTaskDueDate.trim() || null : null;
    const showInToday = overviewTaskMode !== 'long_term';
    const isTodayFocus = overviewTaskMode === 'focus';
    const taskHorizon = overviewTaskMode === 'long_term' ? 'long_term' : 'today';
    const tempId = `overview-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticTask = {
      id: tempId,
      title,
      status: 'todo',
      due_date: dueDate,
      show_in_today: showInToday,
      is_today_focus: isTodayFocus,
      task_horizon: taskHorizon as 'today' | 'long_term',
      assigned_to_user_id,
      assigned_to_team_id,
      created_at: new Date().toISOString(),
      ...getWorkspaceTaskMetadata(),
    };
    if (showInToday) {
      setTodayTasks((prev) => sortNewestFirst([optimisticTask, ...prev]));
    }
    setWorkspaceTasks((prev) => sortNewestFirst([optimisticTask, ...prev]));
    setIsSavingOverviewTask(true);
    try {
      const created = await api.createTask({
        title,
        status: 'todo',
        show_in_today: showInToday,
        is_today_focus: isTodayFocus,
        due_date: dueDate,
        task_horizon: taskHorizon,
        assigned_to_user_id,
        assigned_to_team_id,
      });
      if (created && typeof created === 'object') {
        const createdTask = created as {
          id?: string;
          workspace_id?: string | null;
          workspace_name?: string | null;
          workspace_color?: string | null;
        };
        const createdId = createdTask.id ?? tempId;
        const mergedTask = {
          ...optimisticTask,
          ...createdTask,
          id: createdId,
          ...getWorkspaceTaskMetadata(),
        };
        if (showInToday) {
          setTodayTasks((prev) =>
            sortNewestFirst([
              mergedTask,
              ...prev.filter((item) => item.id !== tempId && item.id !== createdId),
            ])
          );
        } else {
          setTodayTasks((prev) =>
            prev.filter((item) => item.id !== tempId && item.id !== createdId)
          );
        }
        setWorkspaceTasks((prev) =>
          sortNewestFirst([
            mergedTask,
            ...prev.filter((item) => item.id !== tempId && item.id !== createdId),
          ])
        );
      }
      setIsOverviewTaskModalOpen(false);
      setOverviewTaskTitle('');
      setOverviewTaskAssigneeValue('');
      setOverviewTaskDueDate('');
      setOverviewTaskMode('focus');
      await refreshTodayTasks();
    } catch (error) {
      setTodayTasks((prev) => prev.filter((item) => item.id !== tempId));
      setWorkspaceTasks((prev) => prev.filter((item) => item.id !== tempId));
      setDashboardError(error instanceof Error ? error.message : 'Could not create task.');
    } finally {
      setIsSavingOverviewTask(false);
    }
  };

  const resetUpcomingQuickCreate = () => {
    setUpcomingQuickCreateKind('event');
    setUpcomingQuickTitle('');
    setUpcomingQuickDate(todayKey());
    setUpcomingQuickTime('09:00');
    setUpcomingQuickNotes('');
    setUpcomingQuickCalendarId('');
    setUpcomingQuickTeamId('');
    setUpcomingQuickError(null);
  };

  const openUpcomingQuickCreate = (kind: 'event' | 'reminder' = 'event') => {
    resetUpcomingQuickCreate();
    setUpcomingQuickCreateKind(kind);
    setUpcomingQuickError(null);
    setIsUpcomingQuickCreateOpen(true);
  };

  const closeUpcomingQuickCreate = () => {
    setIsUpcomingQuickCreateOpen(false);
    resetUpcomingQuickCreate();
  };

  useEffect(() => {
    if (!isUpcomingQuickCreateOpen || !user || !activeWorkspaceId) return;

    let cancelled = false;
    const loadUpcomingQuickCalendars = async () => {
      setIsLoadingUpcomingQuickCalendars(true);
      try {
        const payload = (await api.getCalendars({ scope: 'current_workspace' })) as
          | Array<{ id: string; name: string; color?: string | null }>
          | { calendars?: Array<{ id: string; name: string; color?: string | null }> }
          | null;
        if (cancelled) return;
        const calendars = Array.isArray(payload)
          ? payload
          : Array.isArray(
              (
                payload as {
                  calendars?: Array<{ id: string; name: string; color?: string | null }> | null;
                } | null
              )?.calendars
            )
          ? (payload as { calendars: Array<{ id: string; name: string; color?: string | null }> })
              .calendars ?? []
          : [];
        const normalizedCalendars = calendars
          .map((calendar) => ({
            id: calendar.id,
            name: calendar.name,
            color: calendar.color ?? null,
          }))
          .filter((calendar) => Boolean(calendar.id && calendar.name));
        setUpcomingQuickCalendars(normalizedCalendars);
        setUpcomingQuickCalendarId((current) => current || normalizedCalendars[0]?.id || '');
      } catch {
        if (!cancelled) {
          setUpcomingQuickCalendars([]);
        }
      } finally {
        if (!cancelled) setIsLoadingUpcomingQuickCalendars(false);
      }
    };

    void loadUpcomingQuickCalendars();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, isUpcomingQuickCreateOpen, user]);

  useEffect(() => {
    if (!isUpcomingQuickCreateOpen || !user || !activeWorkspaceId) return;

    if (isPersonalWorkspace) {
      setUpcomingQuickTeams([]);
      setUpcomingQuickTeamId('');
      setIsLoadingUpcomingQuickTeams(false);
      return;
    }

    let cancelled = false;
    const loadUpcomingQuickTeams = async () => {
      setIsLoadingUpcomingQuickTeams(true);
      try {
        const payload = (await api.getTeams()) as
          | Array<{ id: string; name: string; identifier?: string | null }>
          | { teams?: Array<{ id: string; name: string; identifier?: string | null }> }
          | null;
        if (cancelled) return;
        const teams = Array.isArray(payload)
          ? payload
          : Array.isArray(
              (
                payload as {
                  teams?: Array<{ id: string; name: string; identifier?: string | null }> | null;
                } | null
              )?.teams
            )
          ? (payload as { teams: Array<{ id: string; name: string; identifier?: string | null }> })
              .teams ?? []
          : [];
        const normalizedTeams = teams
          .map((team) => ({
            id: team.id,
            name: team.name,
            identifier: team.identifier ?? null,
          }))
          .filter((team) => Boolean(team.id && team.name));
        setUpcomingQuickTeams(normalizedTeams);
      } catch {
        if (!cancelled) {
          setUpcomingQuickTeams([]);
        }
      } finally {
        if (!cancelled) setIsLoadingUpcomingQuickTeams(false);
      }
    };

    void loadUpcomingQuickTeams();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, isPersonalWorkspace, isUpcomingQuickCreateOpen, user]);

  useEffect(() => {
    if (!isUpcomingQuickCreateOpen) return;
    const timer = window.setTimeout(() => {
      upcomingQuickTitleRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [isUpcomingQuickCreateOpen]);

  useEffect(() => {
    if (!isOverviewFilterOpen) return;

    const closeFilterMenu = (event: MouseEvent | PointerEvent) => {
      if (overviewFilterMenuRef.current?.contains(event.target as Node)) return;
      setIsOverviewFilterOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOverviewFilterOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeFilterMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeFilterMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverviewFilterOpen]);

  useEffect(() => {
    if (!isOverviewCreateMenuOpen) return;

    const closeCreateMenu = (event: MouseEvent | PointerEvent) => {
      if (overviewCreateMenuRef.current?.contains(event.target as Node)) return;
      setIsOverviewCreateMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOverviewCreateMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeCreateMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeCreateMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverviewCreateMenuOpen]);

  useEffect(() => {
    if (!isOverviewDisplayOpen) return;
    const closeDisplayMenu = (event: MouseEvent | PointerEvent) => {
      if (overviewDisplayMenuRef.current?.contains(event.target as Node)) return;
      setIsOverviewDisplayOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOverviewDisplayOpen(false);
    };
    window.addEventListener('pointerdown', closeDisplayMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeDisplayMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverviewDisplayOpen]);

  useEffect(() => {
    if (!isOverviewViewMenuOpen) return;

    const closeViewMenu = (event: MouseEvent | PointerEvent) => {
      if (overviewViewMenuRef.current?.contains(event.target as Node)) return;
      setIsOverviewViewMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOverviewViewMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeViewMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeViewMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverviewViewMenuOpen]);

  const saveUpcomingQuickCreate = async () => {
    const title = upcomingQuickTitle.trim();
    if (!title || isSavingUpcomingQuickItem || !activeWorkspaceId) return;

    const selectedCalendar =
      upcomingQuickCalendars.find((calendar) => calendar.id === upcomingQuickCalendarId) ??
      upcomingQuickCalendars[0] ??
      null;
    const assignedTeamId = isPersonalWorkspace ? null : upcomingQuickTeamId.trim() || null;
    if (!selectedCalendar) {
      setUpcomingQuickError('Choose a calendar first.');
      return;
    }
    if (assignedTeamId && !upcomingQuickTeams.some((team) => team.id === assignedTeamId)) {
      setUpcomingQuickError('Choose a valid team.');
      return;
    }

    const start = new Date(`${upcomingQuickDate}T${upcomingQuickTime}:00`);
    if (Number.isNaN(start.getTime())) {
      setUpcomingQuickError('Choose a valid date and time.');
      return;
    }

    setIsSavingUpcomingQuickItem(true);
    setUpcomingQuickError(null);

    try {
      if (upcomingQuickCreateKind === 'reminder') {
        const createdReminderResponse = await api.createReminder({
          title,
          remind_at: start.toISOString(),
          calendar_id: selectedCalendar.id,
          assigned_to_team_id: assignedTeamId,
          color: selectedCalendar.color ?? undefined,
          is_done: false,
          notes: upcomingQuickNotes.trim() || null,
        });

        const createdReminders = Array.isArray(
          (createdReminderResponse as { created?: Array<{ id: string }> })?.created
        )
          ? (createdReminderResponse as { created: Array<{ id: string }> }).created ?? []
          : createdReminderResponse
          ? [createdReminderResponse as { id?: string }]
          : [];

        if (createdReminders.length === 0) {
          throw new Error('Could not create reminder.');
        }

        toast.show('Saved reminder', {
          detail: title,
          variant: 'success',
        });
      } else {
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const createdEvent = (await api.createEvent({
          title,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          calendar_id: selectedCalendar.id,
          assigned_to_team_id: assignedTeamId,
          color: selectedCalendar.color ?? undefined,
          status: 'planned',
          visibility: 'workspace',
          notes: upcomingQuickNotes.trim() || null,
        })) as
          | { id: string; title: string; start_at: string; end_at: string; color?: string | null }
          | {
              created?: Array<{
                id: string;
                title: string;
                start_at: string;
                end_at: string;
                color?: string | null;
              }>;
            }
          | null;

        const createdEvents = Array.isArray((createdEvent as { created?: unknown[] })?.created)
          ? (
              createdEvent as {
                created: Array<{
                  id: string;
                  title: string;
                  start_at: string;
                  end_at: string;
                  color?: string | null;
                }>;
              }
            ).created ?? []
          : createdEvent
          ? [
              createdEvent as {
                id: string;
                title: string;
                start_at: string;
                end_at: string;
                color?: string | null;
              },
            ]
          : [];

        const created = createdEvents[0];
        if (!created?.id) {
          throw new Error('Could not create event.');
        }

        setUpcoming((prev) =>
          sortNewestFirst([
            ...prev.filter((item) => item.id !== created.id),
            {
              id: created.id,
              title: created.title,
              start_at: created.start_at,
              end_at: created.end_at,
              color: created.color ?? selectedCalendar.color ?? undefined,
              created_at: new Date().toISOString(),
            },
          ])
        );

        toast.show('Saved event', {
          detail: title,
          variant: 'success',
        });
      }

      setUpcomingQuickCalendarId(selectedCalendar.id);
      setUpcomingQuickTitle('');
      setUpcomingQuickNotes('');
      setUpcomingQuickDate(todayKey());
      setUpcomingQuickTime('09:00');
      setIsUpcomingQuickCreateOpen(false);
      setDashboardRefreshToken((current) => current + 1);
    } catch (error) {
      setUpcomingQuickError(error instanceof Error ? error.message : 'Could not create item.');
    } finally {
      setIsSavingUpcomingQuickItem(false);
    }
  };

  useEffect(() => {
    const handleTaskCreated = (
      _event: unknown,
      detail: {
        source?: string;
        client_id?: string;
        optimistic?: boolean;
        rollback?: boolean;
        task?: {
          id?: string;
          title?: string;
          workspace_id?: string | null;
          workspace_name?: string | null;
          workspace_color?: string | null;
          task_horizon?: 'today' | 'long_term' | null;
          is_today_focus?: boolean;
          show_in_today?: boolean;
          due_date?: string | null;
          due_time?: string | null;
          created_at?: string | null;
        };
      }
    ) => {
      if (detail?.source !== 'sidebar') return;
      if (!detail.task?.id || !detail.task?.title) return;
      const clientId = detail.client_id ?? null;
      if (detail.rollback) {
        setTodayTasks((prev) =>
          prev.filter((item) => item.id !== detail.task?.id && item.client_id !== clientId)
        );
        return;
      }
      const isTodayTask =
        Boolean(detail.task.is_today_focus) ||
        Boolean(detail.task.show_in_today) ||
        String(detail.task.task_horizon ?? '') === 'today';
      if (!isTodayTask) return;
      if (detail.task.workspace_id && detail.task.workspace_id !== activeWorkspaceId) return;
      const taskId = detail.task.id;

      const nextTask = {
        id: taskId,
        client_id: clientId,
        title: detail.task.title,
        status: 'todo',
        due_date: detail.task.due_date ?? todayKey(),
        due_time: detail.task.due_time ?? null,
        project_id: null,
        project_name: null,
        workspace_id: detail.task.workspace_id ?? activeWorkspaceId ?? null,
        workspace_name: detail.task.workspace_name ?? activeWorkspace?.name?.trim() ?? null,
        workspace_color: detail.task.workspace_color ?? activeWorkspace?.color ?? null,
        is_today_focus: Boolean(detail.task.is_today_focus),
        show_in_today: Boolean(detail.task.show_in_today ?? isTodayTask),
        task_horizon: String(detail.task.task_horizon ?? (isTodayTask ? 'today' : 'long_term')) as
          | 'today'
          | 'long_term',
        created_at: detail.task.created_at ?? new Date().toISOString(),
      };

      setTodayTasks((prev) => [
        nextTask,
        ...prev.filter(
          (item) => item.id !== taskId && (clientId ? item.client_id !== clientId : true)
        ),
      ]);
    };

    window.ipcRenderer?.on('dashboard:today-task-created', handleTaskCreated);
    return () => {
      window.ipcRenderer?.off('dashboard:today-task-created', handleTaskCreated);
    };
  }, [activeWorkspace?.color, activeWorkspace?.name, activeWorkspaceId]);

  useEffect(() => {
    const handleTaskDeleted = (
      _event: unknown,
      detail: {
        source?: string;
        client_id?: string;
        optimistic?: boolean;
        rollback?: boolean;
        task?: {
          id?: string;
          title?: string;
          workspace_id?: string | null;
          workspace_name?: string | null;
          workspace_color?: string | null;
          task_horizon?: 'today' | 'long_term' | null;
          is_today_focus?: boolean;
          show_in_today?: boolean;
          due_date?: string | null;
          due_time?: string | null;
          created_at?: string | null;
        };
      }
    ) => {
      if (detail?.source !== 'sidebar') return;
      if (!detail.task?.id) return;
      const clientId = detail.client_id ?? null;

      if (detail.rollback) {
        const restoredTask = {
          id: detail.task.id,
          client_id: clientId,
          title: detail.task.title ?? 'Untitled task',
          status: 'todo',
          due_date: detail.task.due_date ?? todayKey(),
          due_time: detail.task.due_time ?? null,
          project_id: null,
          project_name: null,
          workspace_id: detail.task.workspace_id ?? activeWorkspaceId ?? null,
          workspace_name: detail.task.workspace_name ?? activeWorkspace?.name?.trim() ?? null,
          workspace_color: detail.task.workspace_color ?? activeWorkspace?.color ?? null,
          is_today_focus: Boolean(detail.task.is_today_focus),
          show_in_today: Boolean(detail.task.show_in_today ?? true),
          task_horizon: String(detail.task.task_horizon ?? 'today') as 'today' | 'long_term',
          created_at: detail.task.created_at ?? new Date().toISOString(),
        };

        setTodayTasks((prev) => [
          restoredTask,
          ...prev.filter(
            (item) => item.id !== restoredTask.id && (clientId ? item.client_id !== clientId : true)
          ),
        ]);
        return;
      }

      setTodayTasks((prev) =>
        prev.filter(
          (item) => item.id !== detail.task?.id && (clientId ? item.client_id !== clientId : true)
        )
      );
    };

    window.ipcRenderer?.on('dashboard:today-task-deleted', handleTaskDeleted);
    return () => {
      window.ipcRenderer?.off('dashboard:today-task-deleted', handleTaskDeleted);
    };
  }, [activeWorkspace?.color, activeWorkspace?.name, activeWorkspaceId]);

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

  type OverviewTaskTarget = {
    id: string;
    title: string;
    status?: string | null;
    kind?: 'task' | 'reminder';
    workspace_id?: string | null;
    workspace_name?: string | null;
    workspace_color?: string | null;
    due_date?: string | null;
    due_time?: string | null;
    project_id?: string | null;
    project_name?: string | null;
    assigned_to?: string | null;
    show_in_today?: boolean;
    is_today_focus?: boolean;
    task_horizon?: 'today' | 'long_term' | null;
    remind_at?: string | null;
  };

  type OverviewActionRowKind =
    | 'task'
    | 'reminder'
    | 'project'
    | 'note'
    | 'event'
    | 'milestone'
    | 'capture';

  const findOverviewTaskTarget = (taskId: string): OverviewTaskTarget | null => {
    const todayTask = todayTasks.find((task) => task.id === taskId);
    if (todayTask) return todayTask;

    const workspaceTask = workspaceTasks.find((task) => task.id === taskId);
    if (workspaceTask) {
      return {
        ...workspaceTask,
        kind: 'task' as const,
      };
    }

    const followUpTask = followUpTasks.find((task) => task.id === taskId);
    if (followUpTask) {
      return {
        ...followUpTask,
        kind: 'task' as const,
      };
    }

    return null;
  };

  const addTaskToFocus = async (taskId: string) => {
    const target = findOverviewTaskTarget(taskId);
    if (!target || focusTasks.length >= 3) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;

    setFocusActionId(taskId);
    const focusedTarget = {
      ...target,
      kind: target.kind ?? 'task',
      status: String(target.status ?? 'todo'),
      is_today_focus: true,
      show_in_today: true,
      task_horizon: 'today' as const,
    } as (typeof todayTasks)[number];

    setTodayTasks((prev) =>
      prev.some((item) => item.id === taskId)
        ? prev.map((item) =>
            item.id === taskId
              ? {
                  ...item,
                  is_today_focus: true,
                  show_in_today: true,
                  task_horizon: 'today' as const,
                }
              : item
          )
        : [focusedTarget, ...prev]
    );
    setWorkspaceTasks((prev) =>
      prev.map((item) =>
        item.id === taskId
          ? {
              ...item,
              is_today_focus: true,
              show_in_today: true,
              task_horizon: 'today' as const,
            }
          : item
      )
    );

    try {
      if (target.kind === 'reminder') {
        await api.updateReminder(taskId, {
          is_today_focus: true,
          show_in_today: true,
          task_horizon: 'today',
        });
      } else if (target.workspace_id) {
        await api.updateTaskInWorkspace(taskId, target.workspace_id, {
          is_today_focus: true,
          show_in_today: true,
          task_horizon: 'today',
        });
      } else {
        await api.updateTask(taskId, {
          is_today_focus: true,
          show_in_today: true,
          task_horizon: 'today',
        });
      }
      await refreshTodayTasks();
    } catch (error) {
      console.error('Failed to add overview task to focus:', error);
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
    } finally {
      setFocusActionId(null);
    }
  };

  const copyOverviewRowLink = async (row: { kind: string; sourceId: string }) => {
    try {
      await navigator.clipboard.writeText(`ledger://${row.kind}/${row.sourceId}`);
    } catch (error) {
      console.error('Failed to copy overview link:', error);
    } finally {
      setDashboardContextMenu(null);
    }
  };

  const completeOverviewRow = async (row: { kind: OverviewActionRowKind; sourceId: string }) => {
    if (row.kind !== 'task' && row.kind !== 'reminder') return;
    const target = findOverviewTaskTarget(row.sourceId);
    if (!target) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;
    const previousFollowUpTasks = followUpTasks;

    if (row.kind === 'reminder') {
      setTodayTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
    } else {
      setTodayTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
      setWorkspaceTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
      setFollowUpTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
    }

    setDashboardContextMenu(null);

    try {
      if (row.kind === 'reminder') {
        await api.updateReminder(row.sourceId, { status: 'completed' });
      } else if (target.workspace_id) {
        await api.updateTaskInWorkspace(row.sourceId, target.workspace_id, { status: 'completed' });
      } else {
        await api.updateTask(row.sourceId, { status: 'completed' });
      }
      handleDashboardWorkspaceRefresh();
      void refreshTodayTasks();
    } catch (error) {
      console.error('Failed to complete overview row:', error);
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
      setFollowUpTasks(previousFollowUpTasks);
    }
  };

  const moveOverviewRowToToday = async (row: { kind: OverviewActionRowKind; sourceId: string }) => {
    if (row.kind !== 'task' && row.kind !== 'reminder') return;

    const target = findOverviewTaskTarget(row.sourceId);
    if (!target) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;

    const optimisticTask = {
      ...target,
      kind: 'task' as const,
      status: target.status ?? 'todo',
      show_in_today: true,
      is_today_focus: false,
      task_horizon: 'today' as const,
      workspace_id: target.workspace_id ?? null,
      workspace_name: target.workspace_name ?? null,
      workspace_color: target.workspace_color ?? null,
    } as (typeof todayTasks)[number];

    setTodayTasks((prev) => [optimisticTask, ...prev.filter((item) => item.id !== row.sourceId)]);
    setWorkspaceTasks((prev) =>
      prev.map((task) =>
        task.id === row.sourceId
          ? {
              ...task,
              status: task.status ?? 'todo',
              show_in_today: true,
              is_today_focus: false,
              task_horizon: 'today' as const,
            }
          : task
      )
    );

    setDashboardContextMenu(null);

    try {
      if (row.kind === 'reminder') {
        await api.updateReminder(row.sourceId, {
          status: 'active',
          is_done: false,
          show_in_today: true,
          is_today_focus: false,
          task_horizon: 'today',
        });
      } else if (target.workspace_id) {
        await api.updateTaskInWorkspace(row.sourceId, target.workspace_id, {
          status: 'todo',
          show_in_today: true,
          is_today_focus: false,
          task_horizon: 'today',
        });
      } else {
        await api.updateTask(row.sourceId, {
          status: 'todo',
          show_in_today: true,
          is_today_focus: false,
          task_horizon: 'today',
        });
      }
      handleDashboardWorkspaceRefresh();
      void refreshTodayTasks();
    } catch (error) {
      console.error('Failed to move overview row to today:', error);
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
    }
  };

  const moveOverviewRowToLongTerm = async (row: {
    kind: OverviewActionRowKind;
    sourceId: string;
  }) => {
    if (row.kind !== 'task' && row.kind !== 'reminder') return;
    const target = findOverviewTaskTarget(row.sourceId);
    if (!target) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;

    setTodayTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
    setWorkspaceTasks((prev) =>
      prev.map((task) =>
        task.id === row.sourceId
          ? {
              ...task,
              status: task.status ?? 'todo',
              show_in_today: false,
              is_today_focus: false,
              task_horizon: 'long_term' as const,
            }
          : task
      )
    );

    setDashboardContextMenu(null);

    try {
      if (row.kind === 'reminder') {
        await api.updateReminder(row.sourceId, {
          status: 'active',
          is_done: false,
          show_in_today: false,
          is_today_focus: false,
          task_horizon: 'long_term',
        });
      } else if (target.workspace_id) {
        await api.updateTaskInWorkspace(row.sourceId, target.workspace_id, {
          status: 'todo',
          show_in_today: false,
          is_today_focus: false,
          task_horizon: 'long_term',
        });
      } else {
        await api.updateTask(row.sourceId, {
          status: 'todo',
          show_in_today: false,
          is_today_focus: false,
          task_horizon: 'long_term',
        });
      }
      handleDashboardWorkspaceRefresh();
      void refreshTodayTasks();
    } catch (error) {
      console.error('Failed to move overview row to long-term:', error);
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
    }
  };

  const rescheduleOverviewTask = async (
    row: { kind: OverviewActionRowKind; sourceId: string },
    dueDate: string | null
  ) => {
    if (row.kind !== 'task' && row.kind !== 'reminder') return;
    const target = findOverviewTaskTarget(row.sourceId);
    if (!target) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;
    setTodayTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
    setWorkspaceTasks((prev) =>
      prev.map((task) =>
        task.id === row.sourceId
          ? { ...task, due_date: dueDate, show_in_today: false, is_today_focus: false }
          : task
      )
    );
    setDashboardContextMenu(null);
    setIsOverviewRescheduleOpen(false);

    try {
      if (row.kind === 'reminder') {
        const existingTime = target.remind_at
          ? new Date(target.remind_at).toTimeString().slice(0, 5)
          : '09:00';
        const remindAt = dueDate ? new Date(`${dueDate}T${existingTime}:00`).toISOString() : null;
        await api.updateReminder(row.sourceId, {
          remind_at: remindAt,
          status: 'active',
          is_done: false,
          show_in_today: false,
          is_today_focus: false,
        });
      } else if (target.workspace_id) {
        await api.updateTaskInWorkspace(row.sourceId, target.workspace_id, {
          due_date: dueDate,
          show_in_today: false,
          is_today_focus: false,
          ...(target.task_horizon ? { task_horizon: target.task_horizon } : {}),
        });
      } else {
        await api.updateTask(row.sourceId, {
          due_date: dueDate,
          show_in_today: false,
          is_today_focus: false,
          ...(target.task_horizon ? { task_horizon: target.task_horizon } : {}),
        });
      }
      handleDashboardWorkspaceRefresh();
      void refreshTodayTasks();
    } catch (error) {
      console.error('Failed to reschedule overview row:', error);
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
    }
  };

  const deleteOverviewRow = async (row: { kind: OverviewActionRowKind; sourceId: string }) => {
    if (row.kind === 'project') {
      await deleteDashboardProject(row.sourceId);
      handleDashboardWorkspaceRefresh();
      return;
    }

    if (row.kind === 'note') {
      await deleteDashboardNote(row.sourceId);
      handleDashboardWorkspaceRefresh();
      return;
    }

    if (row.kind === 'event') {
      await deleteTimelineEvent(row.sourceId);
      handleDashboardWorkspaceRefresh();
      return;
    }

    const target = findOverviewTaskTarget(row.sourceId);
    if (!target) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;
    const previousFollowUpTasks = followUpTasks;

    markOverviewDeletePending(row.kind, row.sourceId);
    clearSelectedOverviewRowForSource(row.sourceId);
    setTodayTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
    setWorkspaceTasks((prev) => prev.filter((item) => item.id !== row.sourceId));
    setFollowUpTasks((prev) => prev.filter((item) => item.id !== row.sourceId));

    setDashboardContextMenu(null);

    try {
      if (target.kind === 'reminder') {
        await api.deleteReminder(row.sourceId);
      } else if (target.workspace_id) {
        await api.deleteTaskInWorkspace(row.sourceId, target.workspace_id);
      } else {
        await api.deleteTask(row.sourceId);
      }
      handleDashboardWorkspaceRefresh();
      void refreshTodayTasks();
    } catch (error) {
      console.error('Failed to delete overview row:', error);
      clearOverviewDeletePending(row.kind, row.sourceId);
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
      setFollowUpTasks(previousFollowUpTasks);
    }
  };

  const openModule = (
    kind: 'calendar' | 'notes' | 'projects',
    focus?: string | ModuleFocusPayload
  ) => {
    void window.desktopWindow?.openModule(kind, focus);
  };

  const openContextMenu = (
    event: { preventDefault: () => void; clientX: number; clientY: number },
    menu:
      | { type: 'followup'; taskId: string }
      | { type: 'timeline'; eventId: string }
      | { type: 'project'; projectId: string }
      | { type: 'note'; noteId: string }
      | { type: 'checkin' }
      | {
          type: 'overview-row';
          rowId: string;
          rowKind: 'task' | 'reminder' | 'project' | 'note' | 'event' | 'milestone' | 'capture';
          sourceId: string;
        }
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

  type OverviewAssignmentTarget =
    | { kind: 'clear' }
    | { kind: 'user'; id: string }
    | { kind: 'team'; id: string };

  const updateOverviewAssignment = async (row: OverviewRow, target: OverviewAssignmentTarget) => {
    const assigned_to_user_id = target.kind === 'user' ? target.id : null;
    const assigned_to_team_id = target.kind === 'team' ? target.id : null;

    setDashboardContextMenu(null);

    if (row.kind === 'project') {
      const previous = projects;
      setProjects((prev) =>
        prev.map((project) =>
          project.id === row.sourceId
            ? {
                ...project,
                lead_id: assigned_to_user_id,
                owner_team_id: assigned_to_team_id,
              }
            : project
        )
      );
      try {
        await api.updateProject(row.sourceId, {
          lead_id: assigned_to_user_id,
          owner_team_id: assigned_to_team_id,
        });
        handleDashboardWorkspaceRefresh();
      } catch {
        setProjects(previous);
      }
      return;
    }

    if (row.kind === 'event') {
      const previous = upcoming;
      setUpcoming((prev) =>
        prev.map((event) =>
          event.id === row.sourceId
            ? {
                ...event,
                assigned_to_user_id,
                assigned_to_team_id,
                assigned_team_id: assigned_to_team_id,
              }
            : event
        )
      );
      try {
        await api.updateEvent(row.sourceId, {
          assigned_to_user_id,
          assigned_to_team_id,
        });
        handleDashboardWorkspaceRefresh();
      } catch {
        setUpcoming(previous);
      }
      return;
    }

    if (row.kind !== 'task' && row.kind !== 'reminder') return;
    const targetTask = findOverviewTaskTarget(row.sourceId);
    if (!targetTask) return;

    const previousTodayTasks = todayTasks;
    const previousWorkspaceTasks = workspaceTasks;
    const previousFollowUpTasks = followUpTasks;

    const applyAssignment = <
      T extends {
        id: string;
        assigned_to?: string | null;
        assigned_to_user_id?: string | null;
        assigned_to_team_id?: string | null;
        assigned_team_id?: string | null;
      }
    >(
      item: T
    ) =>
      item.id === row.sourceId
        ? {
            ...item,
            assigned_to: assigned_to_user_id,
            assigned_to_user_id,
            assigned_to_team_id,
            assigned_team_id: assigned_to_team_id,
          }
        : item;

    setTodayTasks((prev) => prev.map(applyAssignment));
    setWorkspaceTasks((prev) => prev.map(applyAssignment));
    setFollowUpTasks((prev) => prev.map(applyAssignment));

    try {
      const payload = {
        assigned_to_user_id,
        assigned_to_team_id,
      };

      if (row.kind === 'reminder' || targetTask.kind === 'reminder') {
        await api.updateReminder(row.sourceId, payload);
      } else if (targetTask.workspace_id) {
        await api.updateTaskInWorkspace(row.sourceId, targetTask.workspace_id, payload);
      } else {
        await api.updateTask(row.sourceId, payload);
      }

      handleDashboardWorkspaceRefresh();
      void refreshTodayTasks();
    } catch {
      setTodayTasks(previousTodayTasks);
      setWorkspaceTasks(previousWorkspaceTasks);
      setFollowUpTasks(previousFollowUpTasks);
    }
  };

  const pendingOverviewDeleteKeysRef = useRef<Set<string>>(new Set());
  const getOverviewDeleteKey = useCallback((kind: string, sourceId: string) => {
    return `${kind}:${sourceId}`;
  }, []);
  const markOverviewDeletePending = useCallback(
    (kind: string, sourceId: string) => {
      pendingOverviewDeleteKeysRef.current.add(getOverviewDeleteKey(kind, sourceId));
    },
    [getOverviewDeleteKey]
  );
  const clearOverviewDeletePending = useCallback(
    (kind: string, sourceId: string) => {
      pendingOverviewDeleteKeysRef.current.delete(getOverviewDeleteKey(kind, sourceId));
    },
    [getOverviewDeleteKey]
  );
  const isOverviewDeletePending = useCallback(
    (kind: string, sourceId: string) =>
      pendingOverviewDeleteKeysRef.current.has(getOverviewDeleteKey(kind, sourceId)),
    [getOverviewDeleteKey]
  );
  const clearSelectedOverviewRowForSource = useCallback((sourceId: string) => {
    setSelectedOverviewRowId((current) =>
      current && current.endsWith(`:${sourceId}`) ? null : current
    );
  }, []);

  const deleteDashboardProject = async (projectId: string) => {
    const previous = projects;
    markOverviewDeletePending('project', projectId);
    clearSelectedOverviewRowForSource(projectId);
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    setDashboardContextMenu(null);
    try {
      await api.deleteProject(projectId);
    } catch {
      clearOverviewDeletePending('project', projectId);
      setProjects(previous);
    }
  };

  const deleteDashboardNote = async (noteId: string) => {
    const previous = notes;
    markOverviewDeletePending('note', noteId);
    clearSelectedOverviewRowForSource(noteId);
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    setDashboardContextMenu(null);
    try {
      await api.deleteNote(noteId);
    } catch {
      clearOverviewDeletePending('note', noteId);
      setNotes(previous);
    }
  };

  const deleteTimelineEvent = async (eventId: string) => {
    const previous = upcoming;
    markOverviewDeletePending('event', eventId);
    clearSelectedOverviewRowForSource(eventId);
    setUpcoming((prev) => prev.filter((item) => item.id !== eventId));
    setDashboardContextMenu(null);
    try {
      await api.deleteEvent(eventId);
    } catch {
      clearOverviewDeletePending('event', eventId);
      setUpcoming(previous);
    }
  };

  const attentionProjects = sortNewestFirst(projects).slice(0, 4);
  const noteProjectNamesById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of noteProjectLinks) {
      if (!link.note_id || !link.project_name) continue;
      const next = map.get(link.note_id) ?? [];
      if (!next.includes(link.project_name)) next.push(link.project_name);
      map.set(link.note_id, next);
    }
    return map;
  }, [noteProjectLinks]);
  const noteProjectIdsById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of noteProjectLinks) {
      if (!link.note_id || !link.project_id) continue;
      const next = map.get(link.note_id) ?? [];
      if (!next.includes(link.project_id)) next.push(link.project_id);
      map.set(link.note_id, next);
    }
    return map;
  }, [noteProjectLinks]);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const projectNoteCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of noteProjectLinks) {
      if (!link.project_id) continue;
      map.set(link.project_id, (map.get(link.project_id) ?? 0) + 1);
    }
    return map;
  }, [noteProjectLinks]);
  const projectOpenActionCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of workspaceTasks) {
      if (!task.project_id) continue;
      if (String(task.status ?? '').toLowerCase() === 'completed') continue;
      map.set(task.project_id, (map.get(task.project_id) ?? 0) + 1);
    }
    return map;
  }, [workspaceTasks]);
  const projectMilestoneProxyCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of workspaceTasks) {
      if (!task.project_id || !task.milestone_id) continue;
      map.set(task.project_id, (map.get(task.project_id) ?? 0) + 1);
    }
    return map;
  }, [workspaceTasks]);
  const filteredOverviewLinkableProjects = useMemo(() => {
    const query = overviewLinkProjectSearch.trim().toLowerCase();
    if (!query) return overviewLinkableProjects;
    return overviewLinkableProjects.filter((project) => {
      const haystack = `${project.name} ${project.status ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [overviewLinkProjectSearch, overviewLinkableProjects]);

  type OverviewRow = {
    id: string;
    sourceId: string;
    kind: 'task' | 'reminder' | 'project' | 'note' | 'event' | 'milestone' | 'capture';
    title: string;
    meta: string;
    chips: string[];
    contextLabel?: string;
    contextIcon?: ReactNode;
    dateLabel?: string;
    group: string;
    icon: ReactNode;
    taskIcon?: ReactNode;
    accent?: string;
    progress?: number;
    assignee?: {
      kind: 'user' | 'team';
      label: string;
      name: string;
    };
    assignment?: {
      userId?: string | null;
      userLabel?: string | null;
      teamId?: string | null;
      teamLabel?: string | null;
    };
    ownerTeam?: {
      name: string;
      identifier?: string | null;
    };
    leadName?: string;
    linkedContext?: Array<[string, string]>;
    taskTypeLabel?: string;
    taskStatusLabel?: string;
    isOverdue?: boolean;
    overdueLabel?: string;
    filterValues: OverviewFilterValues;
    open: () => void;
  };

  const formatShortDate = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatTime = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const isPastDue = (dueDate?: string | null, dueTime?: string | null) => {
    if (!dueDate) return false;

    const normalizedTime = dueTime?.trim();
    const dueAt = normalizedTime
      ? new Date(
          `${dueDate}T${normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime}`
        )
      : new Date(`${dueDate}T23:59:59.999`);

    if (Number.isNaN(dueAt.getTime())) return false;
    return dueAt.getTime() < Date.now();
  };

  const isOverdueTask = (task: {
    due_date?: string | null;
    due_time?: string | null;
    status?: string | null;
  }) => {
    const status = String(task.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'cancelled') return false;
    return isPastDue(task.due_date, task.due_time);
  };

  const isOverdueProject = (project: { end_date?: string | null; status?: string | null }) => {
    const status = String(project.status ?? '').toLowerCase();
    if (status.includes('complete')) return false;
    return isPastDue(project.end_date, null);
  };

  const projectStatusLabel = (statusValue: string) => {
    const status = String(statusValue ?? '').toLowerCase();
    if (status.includes('complete')) return 'Completed';
    if (status.includes('pause')) return 'Paused';
    if (status.includes('progress')) return 'In progress';
    return 'Not started';
  };

  const getMemberInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  };

  const getWorkspaceMemberLabel = (userId?: string | null) => {
    if (!userId) return '';
    const member = workspaceMemberById.get(userId) ?? null;
    return member?.full_name?.trim() || member?.email?.trim() || '';
  };

  const getWorkspaceTeamLabel = (teamId?: string | null) => {
    if (!teamId) return '';
    const team = workspaceTeamById.get(teamId) ?? null;
    return team?.name?.trim() || '';
  };

  const normalizeOverviewPriority = (priority?: string | null) => {
    const normalized = String(priority ?? '')
      .trim()
      .toLowerCase();
    if (normalized === 'urgent') return 'urgent';
    if (normalized === 'high') return 'high';
    if (normalized === 'medium') return 'medium';
    if (normalized === 'low') return 'low';
    return 'no_priority';
  };

  const getOverviewDateBucket = (value?: string | null) => {
    if (!value) return 'no_date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'no_date';

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((target.getTime() - startOfToday.getTime()) / 86_400_000);

    if (diffDays < 0) return 'overdue';
    if (diffDays === 0) return 'today';
    if (diffDays <= 6) return 'this_week';
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
      return 'this_month';
    }
    return 'later';
  };

  const buildOverviewFilterValues = (
    values: Partial<OverviewFilterValues>
  ): OverviewFilterValues => {
    const next = createEmptyOverviewFilterValues();
    overviewFilterKeyList.forEach((key) => {
      const incoming = values[key];
      if (!Array.isArray(incoming)) return;
      next[key] = Array.from(
        new Set(incoming.map((value) => String(value).trim()).filter(Boolean))
      );
    });
    return next;
  };

  const filterOverviewRow = (
    rowValues: OverviewFilterValues,
    activeFilters: OverviewFilterValues
  ) =>
    overviewFilterKeyList.every((key) => {
      const selected = activeFilters[key];
      if (!selected || selected.length === 0) return true;
      const candidateValues =
        key === 'team'
          ? [
              ...(rowValues.team ?? []),
              ...(rowValues.assignment ?? []).filter((value) => value.startsWith('team:')),
            ]
          : rowValues[key] ?? [];
      return candidateValues.some((value) => selected.includes(value));
    });

  const parseAssignmentValue = useCallback((value: string) => {
    if (!value) return { assigned_to_user_id: null, assigned_to_team_id: null };
    const [kind, id] = value.split(':', 2);
    if (!id) return { assigned_to_user_id: null, assigned_to_team_id: null };
    if (kind === 'team') return { assigned_to_user_id: null, assigned_to_team_id: id };
    if (kind === 'user') return { assigned_to_user_id: id, assigned_to_team_id: null };
    return { assigned_to_user_id: null, assigned_to_team_id: null };
  }, []);

  const buildTaskRow = (
    task: (typeof todayTasks)[number],
    group: string,
    chips: string[] = []
  ): OverviewRow => {
    const workspaceTask = workspaceTaskById.get(task.id) ?? null;
    const resolvedTask = workspaceTask ? { ...task, ...workspaceTask } : task;
    const isReminder = isOverviewReminderTask(resolvedTask);
    const reminderDateLabel = isReminder ? formatShortDate(resolvedTask.remind_at) : null;
    const reminderTimeLabel = isReminder ? formatTime(resolvedTask.remind_at) : null;
    const reminderScheduleLabel = [reminderDateLabel, reminderTimeLabel]
      .filter(Boolean)
      .join(' · ');
    const dueLabel = formatShortDate(resolvedTask.due_date);
    const timeLabel = resolvedTask.due_time || reminderTimeLabel;
    const teamId = resolvedTask.assigned_to_team_id ?? resolvedTask.assigned_team_id ?? null;
    const assigneeUserId = resolvedTask.assigned_to_user_id ?? resolvedTask.assigned_to ?? null;
    const assignedMember = assigneeUserId ? workspaceMemberById.get(assigneeUserId) ?? null : null;
    const assigneeName = assignedMember?.full_name?.trim() || assignedMember?.email?.trim() || '';
    const teamRecord = teamId ? workspaceTeamById.get(teamId) ?? null : null;
    const teamName = teamRecord?.name?.trim() || '';
    const teamIdentifier = teamRecord?.identifier?.trim() || teamName;
    const assignmentLabel = teamId
      ? teamIdentifier
        ? `Assigned to Team ${teamIdentifier}`
        : 'Team'
      : assigneeName
      ? `Assigned to ${assigneeName}`
      : '';
    const filterValues = createEmptyOverviewFilterValues();
    filterValues.type = [isReminder ? 'reminder' : 'task'];
    filterValues.status = [
      'open',
      isReminder
        ? 'upcoming'
        : resolvedTask.is_today_focus
        ? 'needs_attention'
        : resolvedTask.task_horizon === 'long_term'
        ? 'long_term'
        : 'today',
    ];
    filterValues.assignment = [];
    if (!assigneeUserId && !teamId) {
      filterValues.assignment.push('unassigned');
    }
    if (assigneeUserId) {
      filterValues.assignment.push('assigned', `person:${assigneeUserId}`);
      filterValues.assignment.push(assigneeUserId === user?.id ? 'me' : 'others');
    }
    if (teamId) {
      filterValues.assignment.push('assigned', 'my_teams', `team:${teamId}`);
    }
    filterValues.team = teamId ? [`team:${teamId}`] : [];
    filterValues.project = resolvedTask.project_id ? [`project:${resolvedTask.project_id}`] : [];
    filterValues.date = [
      getOverviewDateBucket(
        isReminder ? resolvedTask.remind_at ?? resolvedTask.due_date : resolvedTask.due_date
      ),
    ];
    filterValues.priority = [normalizeOverviewPriority(resolvedTask.priority)];
    filterValues.noteType = [];
    filterValues.linkedContext = [];
    filterValues.progress = [];
    filterValues.has = [];
    return {
      id: `${group}:${task.id}`,
      sourceId: task.id,
      kind: isReminder ? 'reminder' : 'task',
      title: resolvedTask.title,
      meta: [
        resolvedTask.project_name ||
          resolvedTask.workspace_name ||
          activeWorkspace?.name ||
          'Workspace',
        isReminder ? reminderScheduleLabel : dueLabel ? `Due ${dueLabel}` : timeLabel,
      ]
        .filter(Boolean)
        .join(' · '),
      chips:
        chips.length > 0
          ? chips
          : [
              isReminder
                ? 'Reminder'
                : resolvedTask.is_today_focus
                ? 'Focus'
                : resolvedTask.task_horizon === 'long_term'
                ? 'Long-term'
                : 'Short-term',
            ],
      group,
      icon: isReminder ? (
        <Bell size={13} />
      ) : group === 'Today' ? (
        <Zap size={13} />
      ) : group === 'Long-term tasks' ? (
        <MapIcon size={13} />
      ) : group === 'Needs attention' ? (
        <CircleAlert size={13} />
      ) : (
        <Circle size={13} />
      ),
      taskIcon: isReminder ? (
        <Bell size={13} />
      ) : resolvedTask.is_today_focus ? (
        <CircleAlert size={13} />
      ) : resolvedTask.task_horizon === 'long_term' ? (
        <MapIcon size={13} />
      ) : (
        <Zap size={13} />
      ),
      accent: isReminder ? 'var(--ledger-accent)' : undefined,
      assignee: assigneeName
        ? {
            kind: 'user',
            label: getMemberInitials(assigneeName),
            name: assigneeName,
          }
        : teamIdentifier
        ? {
            kind: 'team',
            label: teamIdentifier,
            name: teamName || teamIdentifier,
          }
        : undefined,
      contextIcon: assigneeName ? (
        <UserCheck size={10} />
      ) : teamId ? (
        <Users size={10} />
      ) : undefined,
      contextLabel: assignmentLabel,
      assignment: {
        userId: assigneeUserId,
        userLabel: assigneeName || null,
        teamId,
        teamLabel: teamName || null,
      },
      taskTypeLabel: isReminder ? 'Reminder' : resolvedTask.is_today_focus ? 'Focus' : 'Task',
      taskStatusLabel: isReminder
        ? 'Reminder'
        : resolvedTask.is_today_focus
        ? 'Needs attention'
        : resolvedTask.task_horizon === 'long_term'
        ? 'Long-term'
        : 'Today',
      dateLabel: isReminder
        ? reminderScheduleLabel || dueLabel || undefined
        : resolvedTask.is_today_focus
        ? 'Not set'
        : resolvedTask.task_horizon === 'long_term'
        ? dueLabel || 'Not set'
        : 'Today',
      linkedContext: [
        resolvedTask.project_name ? ['Project', resolvedTask.project_name] : null,
        assignmentLabel ? ['Assignment', assignmentLabel] : null,
      ].filter((entry): entry is [string, string] => Boolean(entry)),
      isOverdue: isOverdueTask(resolvedTask),
      overdueLabel: isOverdueTask(resolvedTask)
        ? `Overdue since ${dueLabel ?? reminderDateLabel ?? 'an earlier date'}`
        : undefined,
      filterValues,
      open: () => {
        setSelectedOverviewRowId(`${group}:${task.id}`);
      },
    };
  };

  const projectRows = attentionProjects.map<OverviewRow>((project) => {
    const dueLabel = formatShortDate(project.end_date);
    const progress = Math.max(0, Math.min(100, Number(project.completeness ?? 0)));
    const ProjectTypeIcon = getProjectTypeOption(project.project_type).icon;
    const ownerTeamName = getWorkspaceTeamLabel(project.owner_team_id ?? null);
    const leadName = getWorkspaceMemberLabel(project.lead_id ?? null);
    const rawStatus = String(project.status ?? '').toLowerCase();
    const statusKey = rawStatus.includes('complete')
      ? 'completed'
      : rawStatus.includes('pause')
      ? 'paused'
      : rawStatus.includes('archive')
      ? 'archived'
      : progress >= 90
      ? 'near_done'
      : 'active';
    const assignmentValues = [] as string[];
    if (!project.lead_id && !project.owner_team_id) {
      assignmentValues.push('unassigned');
    }
    if (project.lead_id) {
      assignmentValues.push('assigned', `person:${project.lead_id}`);
      assignmentValues.push(project.lead_id === user?.id ? 'me' : 'others');
    }
    if (project.owner_team_id) {
      assignmentValues.push('assigned', 'my_teams', `team:${project.owner_team_id}`);
    }
    const filterValues = buildOverviewFilterValues({
      type: ['project'],
      status: [statusKey],
      assignment: assignmentValues,
      team: project.owner_team_id ? [`team:${project.owner_team_id}`] : [],
      project: [`project:${project.id}`],
      date: [getOverviewDateBucket(project.end_date)],
      priority: ['no_priority'],
      progress: [
        progress >= 100 ? 'complete' : progress >= 75 ? '75_99' : progress >= 25 ? '25_75' : '0_25',
      ],
      has: [
        ...(projectNoteCountById.get(project.id) ? ['notes'] : []),
        ...(projectOpenActionCountById.get(project.id) ? ['open_actions'] : []),
        ...(projectMilestoneProxyCountById.get(project.id) ? ['milestones'] : []),
      ],
    });
    return {
      id: `Active projects:${project.id}`,
      sourceId: project.id,
      kind: 'project',
      title: project.name,
      meta: [
        projectStatusLabel(project.status),
        `${progress}%`,
        dueLabel ? `Due ${dueLabel}` : 'No due date',
      ].join(' · '),
      chips: progress >= 90 ? ['Near done'] : ['Project'],
      contextLabel: [
        ownerTeamName ? `Team ${ownerTeamName}` : null,
        leadName ? `Lead ${leadName}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      contextIcon: ownerTeamName ? (
        <Users size={10} />
      ) : leadName ? (
        <UserCheck size={10} />
      ) : undefined,
      assignee: leadName
        ? {
            kind: 'user',
            label: getMemberInitials(leadName),
            name: leadName,
          }
        : ownerTeamName
        ? {
            kind: 'team',
            label: ownerTeamName,
            name: ownerTeamName,
          }
        : undefined,
      ownerTeam: ownerTeamName ? { name: ownerTeamName } : undefined,
      leadName: leadName || undefined,
      assignment: {
        userId: project.lead_id ?? null,
        userLabel: leadName || null,
        teamId: project.owner_team_id ?? null,
        teamLabel: ownerTeamName || null,
      },
      dateLabel: dueLabel ? `Due ${dueLabel}` : undefined,
      group: 'Active projects',
      icon: <ProjectTypeIcon size={13} />,
      accent: project.color || 'var(--ledger-accent)',
      progress,
      linkedContext: [
        ownerTeamName ? ['Team', ownerTeamName] : null,
        leadName ? ['Lead', leadName] : null,
      ].filter((entry): entry is [string, string] => Boolean(entry)),
      isOverdue: isOverdueProject(project),
      overdueLabel: isOverdueProject(project)
        ? `Overdue since ${dueLabel ?? 'an earlier date'}`
        : undefined,
      filterValues,
      open: () =>
        openModule('projects', {
          kind: 'projects',
          focusProjectId: project.id,
        }),
    };
  });

  const activeTodayTaskIds = new Set(
    activeTodayTasks.filter((task) => !isOverviewReminderTask(task)).map((task) => task.id)
  );
  const longTermTaskRows = workspaceTasks
    .filter((task) => task.task_horizon === 'long_term' && !activeTodayTaskIds.has(task.id))
    .slice(0, 8)
    .map<OverviewRow>((task) =>
      buildTaskRow(task as (typeof todayTasks)[number], 'Long-term tasks', ['Long-term'])
    );

  const noteRows = recentNotes.slice(0, 6).map<OverviewRow>((note) => ({
    id: `Recent notes:${note.id}`,
    sourceId: note.id,
    kind: 'note',
    title: note.title || 'Untitled note',
    meta: [
      activeWorkspace?.name || 'Workspace',
      `${formatShortDate(note.updated_at) ?? 'Recently'}`,
    ]
      .filter(Boolean)
      .join(' · '),
    chips: noteProjectNamesById.get(note.id)?.length ? ['Linked note'] : ['Regular note'],
    contextLabel: noteProjectNamesById.get(note.id)?.length
      ? `Linked to ${noteProjectNamesById.get(note.id)?.[0]}`
      : undefined,
    contextIcon: noteProjectNamesById.get(note.id)?.length ? <Link2 size={10} /> : undefined,
    dateLabel: formatShortDate(note.updated_at) ?? undefined,
    group: 'Recent notes',
    icon: <StickyNote size={13} />,
    filterValues: buildOverviewFilterValues({
      type: ['note'],
      status: [noteProjectIdsById.get(note.id)?.length ? 'linked_note' : 'regular_note'],
      assignment: ['unassigned'],
      team:
        noteProjectIdsById
          .get(note.id)
          ?.flatMap((projectId) => {
            const project = projectById.get(projectId) ?? null;
            return project?.owner_team_id ? [`team:${project.owner_team_id}`] : [];
          })
          .filter((value): value is string => Boolean(value)) ?? [],
      project: (noteProjectIdsById.get(note.id) ?? []).map((projectId) => `project:${projectId}`),
      date: [getOverviewDateBucket(note.updated_at)],
      priority: ['no_priority'],
      noteType: [noteProjectIdsById.get(note.id)?.length ? 'linked_note' : 'regular_note'],
      linkedContext: [
        noteProjectIdsById.get(note.id)?.length ? 'linked_to_project' : 'unlinked',
        ...(noteProjectIdsById.get(note.id)?.length ? ['linked_to_team'] : []),
      ],
      progress: [],
      has: [],
    }),
    open: () => openModule('notes', { kind: 'notes', focusNoteId: note.id }),
  }));

  const upcomingReminderRows = upcomingReminders.map<OverviewRow>((reminder) =>
    buildTaskRow(reminder, 'Upcoming', ['Reminder'])
  );

  const eventRows = upcoming.slice(0, 6).map<OverviewRow>((event) => {
    const start = new Date(event.start_at);
    const now = new Date();
    const isToday =
      start.toDateString() === now.toDateString() ||
      (start.getTime() <= now.getTime() && new Date(event.end_at).getTime() > now.getTime());
    const dayLabel = isToday ? 'Today' : formatShortDate(event.start_at);
    const timeLabel = formatTime(event.start_at);
    const eventTeamId = event.assigned_to_team_id ?? event.assigned_team_id ?? null;
    const eventUserId = event.assigned_to_user_id ?? null;
    const eventUserLabel = eventUserId ? getWorkspaceMemberLabel(eventUserId) : '';
    const eventTeamLabel = eventTeamId ? getWorkspaceTeamLabel(eventTeamId) : '';
    const eventAssignmentLabel = eventUserLabel
      ? `Assigned to ${eventUserLabel}`
      : eventTeamLabel
      ? `Assigned to Team ${eventTeamLabel}`
      : '';
    const filterValues = buildOverviewFilterValues({
      type: ['event'],
      status: ['open', 'upcoming'],
      assignment: eventUserId
        ? ['assigned', `person:${eventUserId}`, eventUserId === user?.id ? 'me' : 'others']
        : eventTeamId
        ? ['assigned', 'my_teams', `team:${eventTeamId}`]
        : ['unassigned'],
      team: eventTeamId ? [`team:${eventTeamId}`] : [],
      project: [],
      date: [getOverviewDateBucket(event.start_at)],
      priority: ['no_priority'],
      progress: [],
      has: [],
    });
    return {
      id: `Upcoming:${event.id}`,
      sourceId: event.id,
      kind: 'event',
      title: event.title,
      meta: [
        'Event',
        dayLabel,
        timeLabel,
        calendarScope === 'all_accessible_workspaces' ? event.workspace_name : null,
      ]
        .filter(Boolean)
        .join(' · '),
      chips: [isToday ? 'Today' : 'Upcoming'],
      dateLabel: [dayLabel, timeLabel].filter(Boolean).join(' · ') || undefined,
      group: isToday ? 'Today' : 'Upcoming',
      icon: <CalendarDays size={13} />,
      assignee: eventUserLabel
        ? {
            kind: 'user',
            label: getMemberInitials(eventUserLabel),
            name: eventUserLabel,
          }
        : eventTeamLabel
        ? {
            kind: 'team',
            label: eventTeamLabel,
            name: eventTeamLabel,
          }
        : undefined,
      assignment: {
        userId: eventUserId,
        userLabel: eventUserLabel || null,
        teamId: eventTeamId,
        teamLabel: eventTeamLabel || null,
      },
      contextLabel: eventAssignmentLabel || undefined,
      contextIcon: eventUserLabel ? (
        <UserCheck size={10} />
      ) : eventTeamId ? (
        <Users size={10} />
      ) : undefined,
      filterValues,
      open: () =>
        openModule('calendar', {
          kind: 'calendar',
          focusContext: `focus-event:${event.id}`,
        }),
    };
  });

  const followUpRows = followUpTasks
    .filter((task) => task.status !== 'done')
    .slice(0, 4)
    .map<OverviewRow>((task) => ({
      id: `Needs attention:${task.id}`,
      sourceId: task.id,
      kind: 'task',
      title: task.title,
      meta: [
        task.eventTitle || 'Meeting follow-up',
        'Action',
        formatShortDate(task.updated_at) ?? 'Recent',
      ]
        .filter(Boolean)
        .join(' · '),
      chips: ['Follow-up'],
      dateLabel: formatShortDate(task.updated_at) ?? undefined,
      group: 'Needs attention',
      icon: <CircleAlert size={13} />,
      linkedContext: task.eventTitle ? [['Event', task.eventTitle]] : undefined,
      filterValues: buildOverviewFilterValues({
        type: ['task'],
        status: ['open', 'needs_attention'],
        assignment: ['unassigned'],
        team: [],
        project: [],
        date: [getOverviewDateBucket(task.updated_at)],
        priority: ['no_priority'],
        progress: [],
        has: [],
      }),
      open: () => openFollowUpEvent(task.id),
    }));

  const githubAttentionRows = githubAttention.slice(0, 8).map<OverviewRow>((signal) => ({
    id: `GitHub attention:${signal.id}`,
    sourceId: signal.target_id ?? signal.id,
    kind: signal.target_type === 'project' ? 'project' : signal.target_type === 'note' ? 'note' : 'task',
    title: signal.title,
    meta: [signal.reason, signal.metadata?.repositoryFullName].filter(Boolean).join(' · '),
    chips: ['GitHub'],
    group: 'Needs attention',
    icon: <CircleAlert size={13} />,
    filterValues: buildOverviewFilterValues({ type: ['task'], status: ['needs_attention'], assignment: [], team: [], project: [], date: ['no_date'], priority: ['no_priority'], progress: [], has: ['linked_context'] }),
    open: () => {
      if (signal.target_type === 'project' && signal.target_id) openModule('projects', { kind: 'projects', focusProjectId: signal.target_id });
      else if (signal.target_type === 'note' && signal.target_id) openModule('notes', { kind: 'notes', focusNoteId: signal.target_id });
      else if (signal.target_id) setSelectedOverviewRowId(`GitHub attention:${signal.id}`);
    },
  }));

  const overviewRows: OverviewRow[] = [
    ...githubAttentionRows,
    ...focusTasksForDisplay.map((task) => buildTaskRow(task, 'Needs attention', ['Focus'])),
    ...followUpRows,
    ...activeTodayTasks.slice(0, 6).map((task) => buildTaskRow(task, 'Today')),
    ...longTermTaskRows,
    ...projectRows,
    ...noteRows,
    ...upcomingReminderRows,
    ...eventRows.filter((row) => row.group === 'Upcoming'),
    ...eventRows.filter((row) => row.group === 'Today'),
  ];

  const activeOverviewFilters = overviewFilters[overviewTab];

  const assignedRows = workspaceTasks
    .filter(
      (task) =>
        Boolean(
          task.assigned_to ||
            task.assigned_to_user_id ||
            task.assigned_to_team_id ||
            task.assigned_team_id
        ) && String(task.status ?? '').toLowerCase() !== 'completed'
    )
    .slice(0, 8)
    .map<OverviewRow>((task) =>
      buildTaskRow(
        task as (typeof todayTasks)[number],
        task.is_today_focus
          ? 'Needs attention'
          : task.task_horizon === 'long_term'
          ? 'Long-term tasks'
          : 'Today'
      )
    );

  const overviewBaseRows =
    overviewTab === 'projects'
      ? projectRows
      : overviewTab === 'notes'
      ? noteRows
      : overviewTab === 'today'
      ? overviewRows.filter(
          (row) => row.group === 'Today' || row.filterValues.date.includes('today')
        )
      : overviewTab === 'assigned'
      ? assignedRows
      : overviewRows;

  const visibleOverviewRows = Array.from(
    new Map(
      overviewBaseRows
        .filter((row) => filterOverviewRow(row.filterValues, activeOverviewFilters))
        .map((row) => [row.id, row])
    ).values()
  );

  const getOverviewCustomGroup = (row: OverviewRow) => {
    const groupBy = overviewLayoutPreferences.groupBy;
    if (groupBy === 'none') return row.group;
    if (groupBy === 'type') {
      return row.kind === 'reminder'
        ? 'Reminder'
        : row.kind.charAt(0).toUpperCase() + row.kind.slice(1);
    }
    if (groupBy === 'status') return row.taskStatusLabel ?? row.chips[0] ?? 'No status';
    if (groupBy === 'project') {
      if (row.kind === 'project') return row.title;
      const linkedProject = row.linkedContext?.find(([label]) => label === 'Project')?.[1];
      if (linkedProject) return linkedProject;
      if (row.contextLabel?.startsWith('Linked to ')) return row.contextLabel.slice(10);
      return 'No project';
    }
    if (groupBy === 'assignee') return row.assignee?.name ?? 'Unassigned';
    if (groupBy === 'team') {
      return row.assignment?.teamLabel || row.ownerTeam?.name || 'No team';
    }
    const dateBucket = row.filterValues.date?.[0];
    return (
      (
        {
          overdue: 'Overdue',
          today: 'Today',
          this_week: 'Upcoming',
          this_month: 'Later',
          later: 'Later',
          no_date: 'No due date',
        } as Record<string, string>
      )[dateBucket ?? 'no_date'] ?? 'No due date'
    );
  };

  const overviewGroups = (() => {
    if (overviewLayoutPreferences.groupBy === 'none') {
      return [
        'Needs attention',
        'Today',
        'Long-term tasks',
        'Active projects',
        'Upcoming',
        'Recent notes',
      ]
        .map((group) => ({
          id: group,
          label: group,
          rows: visibleOverviewRows.filter((row) => row.group === group),
        }))
        .filter((group) => group.rows.length > 0);
    }

    const grouped = new Map<string, OverviewRow[]>();
    visibleOverviewRows.forEach((row) => {
      const key = getOverviewCustomGroup(row);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    });
    const fallbackGroupLabels = new Set([
      'No status',
      'No project',
      'Unassigned',
      'No team',
      'No due date',
    ]);
    return Array.from(grouped, ([label, rows]) => ({ id: label, label, rows })).sort(
      (left, right) =>
        Number(fallbackGroupLabels.has(left.label)) - Number(fallbackGroupLabels.has(right.label))
    );
  })();

  const overviewPropertyLabels: Record<OverviewProperty, string> = {
    priority: 'Priority',
    project: 'Project',
    dueDate: 'Due date',
    assignee: 'Assignee',
    team: 'Team',
    members: 'Members',
    progress: 'Progress',
    linkedNotes: 'Linked notes',
    updated: 'Updated',
  };
  const overviewPropertyOptions = (
    Object.keys(overviewPropertyLabels) as OverviewProperty[]
  ).filter((property) => !(isPersonalWorkspace && property === 'members'));
  const getOverviewPropertyValue = (row: OverviewRow, property: OverviewProperty) => {
    if (property === 'priority') {
      const value = row.filterValues.priority?.[0];
      if (!value || value === 'no_priority') return null;
      return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
    }
    if (property === 'project') {
      return row.linkedContext?.find(([label]) => label === 'Project')?.[1] ?? null;
    }
    if (property === 'dueDate') return row.dateLabel ?? null;
    if (property === 'assignee') {
      // Assignees are represented by the compact initials/team marker in the row.
      // Keep team assignment text available, but never duplicate a person's name.
      return row.assignment?.userLabel ? null : row.assignment?.teamLabel ?? null;
    }
    if (property === 'team') {
      return row.assignment?.teamLabel ?? row.ownerTeam?.name ?? null;
    }
    if (property === 'members') return null;
    if (property === 'progress') {
      return typeof row.progress === 'number' ? `${row.progress}%` : null;
    }
    if (property === 'linkedNotes') {
      return row.chips.includes('Linked note') ? 'Linked' : null;
    }
    return row.dateLabel ?? null;
  };

  const selectedOverviewRow =
    visibleOverviewRows.find((row) => row.id === selectedOverviewRowId) ?? null;

  const overviewEmptyState = (() => {
    if (overviewTab === 'today') {
      return {
        icon: <CalendarDays size={15} />,
        title: 'No today items',
        body: 'Today will show tasks, reminders, and events scheduled for today.',
      };
    }
    if (overviewTab === 'assigned') {
      return {
        icon: <UserCheck size={15} />,
        title: 'Nothing assigned',
        body: 'Assigned work will appear here once it is linked to this workspace.',
      };
    }
    if (overviewTab === 'projects') {
      return {
        icon: <FolderKanban size={15} />,
        title: 'No projects yet',
        body: 'Projects will show up here once they have activity or due dates.',
      };
    }
    if (overviewTab === 'notes') {
      return {
        icon: <StickyNote size={15} />,
        title: 'No notes yet',
        body: 'Recent notes and meeting notes will appear here when they are created.',
      };
    }
    return {
      icon: <CircleAlert size={15} />,
      title: 'Nothing to show yet',
      body: 'Create a task, note, project, event, or reminder to populate the overview.',
    };
  })();

  const selectedOverviewTypeLabel = selectedOverviewRow
    ? selectedOverviewRow.kind === 'task'
      ? selectedOverviewRow.taskTypeLabel ?? 'Task'
      : selectedOverviewRow.kind === 'project'
      ? 'Project'
      : selectedOverviewRow.kind === 'note'
      ? 'Note'
      : selectedOverviewRow.kind === 'event'
      ? 'Event'
      : selectedOverviewRow.kind === 'reminder'
      ? 'Reminder'
      : selectedOverviewRow.kind
    : '';
  const overviewDetailSections = selectedOverviewRow
    ? [
        {
          title: 'Details',
          rows: [
            [
              'Type',
              selectedOverviewRow.kind === 'task' || selectedOverviewRow.kind === 'reminder'
                ? selectedOverviewRow.taskTypeLabel ?? selectedOverviewTypeLabel
                : selectedOverviewTypeLabel,
            ],
            [
              'Status',
              selectedOverviewRow.kind === 'note'
                ? 'Recent note'
                : selectedOverviewRow.kind === 'task' || selectedOverviewRow.kind === 'reminder'
                ? selectedOverviewRow.taskStatusLabel ?? selectedOverviewRow.group
                : selectedOverviewRow.group,
            ],
            ['Workspace', activeWorkspace?.name ?? 'Workspace'],
            ['Date', selectedOverviewRow.dateLabel ?? 'Not set'],
          ],
        },
        {
          title: selectedOverviewRow.kind === 'project' ? 'Project context' : 'Linked context',
          rows:
            selectedOverviewRow.kind === 'project'
              ? [
                  [
                    'Progress',
                    typeof selectedOverviewRow.progress === 'number'
                      ? `${selectedOverviewRow.progress}%`
                      : 'Not set',
                  ],
                  ['Team', selectedOverviewRow.ownerTeam?.name || 'None'],
                  ['Lead', selectedOverviewRow.leadName || 'None'],
                  ['Active actions', selectedOverviewRow.chips.includes('Near done') ? '2' : '0'],
                  ['Milestones', '0'],
                  ['Recent notes', '0'],
                ]
              : selectedOverviewRow.kind === 'task' || selectedOverviewRow.kind === 'reminder'
              ? selectedOverviewRow.linkedContext?.length
                ? selectedOverviewRow.linkedContext
                : [['Linked', 'None']]
              : selectedOverviewRow.kind === 'event'
              ? [
                  ...(selectedOverviewRow.assignment?.userLabel ||
                  selectedOverviewRow.assignment?.teamLabel
                    ? [
                        [
                          'Assignment',
                          selectedOverviewRow.assignment?.userLabel
                            ? `Assigned to ${selectedOverviewRow.assignment.userLabel}`
                            : `Assigned to Team ${selectedOverviewRow.assignment.teamLabel}`,
                        ] as [string, string],
                      ]
                    : []),
                  ['Project', 'None'],
                  ['Actions', '0'],
                  ['Milestones', '0'],
                ]
              : selectedOverviewRow.kind === 'note'
              ? [
                  ['Actions', '0'],
                  ['Milestones', '0'],
                ]
              : [
                  ['Project', 'None'],
                  ['Actions', '0'],
                  ['Milestones', '0'],
                ],
        },
      ]
    : [];

  const renderOverviewDetailRow = (label: string, value: string) => (
    <div key={label} className="flex items-center justify-between gap-3 rounded-md px-1 py-1">
      <span className="text-[12px] text-[var(--ledger-text-muted)]">{label}</span>
      <span className="max-w-44 truncate text-right text-[12px] font-medium capitalize text-[var(--ledger-text-primary)]">
        {value}
      </span>
    </div>
  );

  const openSelectedOverviewRow = () => {
    selectedOverviewRow?.open();
  };

  const selectedOverviewTaskQuickActions = selectedOverviewRow
    ? (() => {
        if (selectedOverviewRow.kind !== 'task' && selectedOverviewRow.kind !== 'reminder') {
          return [];
        }

        const actions: Array<{
          label: string;
          icon: ReactNode;
          action: () => void;
          disabled: boolean;
        }> = [
          {
            label: 'Mark done',
            icon: <CheckCircle2 size={13} />,
            action: () =>
              void completeOverviewRow({
                kind: selectedOverviewRow.kind,
                sourceId: selectedOverviewRow.sourceId,
              }),
            disabled: false,
          },
        ];

        if (selectedOverviewRow.kind === 'reminder') {
          return actions;
        }

        const isFocusTask = selectedOverviewRow.chips.includes('Focus');
        const isTodayTask = selectedOverviewRow.group === 'Today';
        const isLongTermTask = selectedOverviewRow.group === 'Long-term tasks';
        const isNeedsAttention = selectedOverviewRow.group === 'Needs attention';

        if (isFocusTask || isNeedsAttention) {
          actions.push(
            {
              label: 'Move to today',
              icon: <CalendarDays size={13} />,
              action: () =>
                void moveOverviewRowToToday({
                  kind: selectedOverviewRow.kind,
                  sourceId: selectedOverviewRow.sourceId,
                }),
              disabled: false,
            },
            {
              label: 'Move to long term',
              icon: <CalendarDays size={13} />,
              action: () =>
                void moveOverviewRowToLongTerm({
                  kind: selectedOverviewRow.kind,
                  sourceId: selectedOverviewRow.sourceId,
                }),
              disabled: false,
            }
          );
        } else if (isTodayTask) {
          actions.push(
            {
              label: 'Move to focus',
              icon: <Circle size={13} />,
              action: () => void addTaskToFocus(selectedOverviewRow.sourceId),
              disabled: false,
            },
            {
              label: 'Move to long term',
              icon: <CalendarDays size={13} />,
              action: () =>
                void moveOverviewRowToLongTerm({
                  kind: selectedOverviewRow.kind,
                  sourceId: selectedOverviewRow.sourceId,
                }),
              disabled: false,
            }
          );
        } else if (isLongTermTask) {
          actions.push(
            {
              label: 'Move to today',
              icon: <CalendarDays size={13} />,
              action: () =>
                void moveOverviewRowToToday({
                  kind: selectedOverviewRow.kind,
                  sourceId: selectedOverviewRow.sourceId,
                }),
              disabled: false,
            },
            {
              label: 'Move to focus',
              icon: <Circle size={13} />,
              action: () => void addTaskToFocus(selectedOverviewRow.sourceId),
              disabled: false,
            }
          );
        }
        return actions;
      })()
    : [];

  const selectedOverviewQuickActions = selectedOverviewRow
    ? [
        ...(selectedOverviewRow.kind === 'task' || selectedOverviewRow.kind === 'reminder'
          ? selectedOverviewTaskQuickActions
          : [
              {
                label:
                  selectedOverviewRow.kind === 'project'
                    ? 'Open project'
                    : selectedOverviewRow.kind === 'note'
                    ? 'Open note'
                    : 'Open',
                icon: <ArrowRight size={13} />,
                action: openSelectedOverviewRow,
                disabled: false,
              },
            ]),
        ...(selectedOverviewRow.kind === 'project'
          ? [
              {
                label: 'Add action',
                icon: <Plus size={13} />,
                action: () => window.desktopWindow?.toggleModule('quick-task' as any),
                disabled: false,
              },
              {
                label: 'Add milestone',
                icon: <Plus size={13} />,
                action: () => undefined,
                disabled: true,
              },
            ]
          : selectedOverviewRow.kind === 'note'
          ? [
              {
                label: 'Create action',
                icon: <Plus size={13} />,
                action: () => window.desktopWindow?.toggleModule('quick-task' as any),
                disabled: false,
              },
              {
                label: 'Link to project',
                icon: <Folder size={13} />,
                action: () => openOverviewLinkProjectModal(selectedOverviewRow.sourceId),
                disabled: false,
              },
            ]
          : []),
        {
          label: 'Clear selection',
          icon: <X size={13} />,
          action: () => setSelectedOverviewRowId(null),
          disabled: false,
        },
      ]
    : [];

  const toggleOverviewGroup = (groupId: string) => {
    setCollapsedOverviewGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const overviewFilterSections: Array<{
    id: string;
    label: string;
    key: OverviewFilterKey;
    options: Array<{ value: string; label: string }>;
  }> =
    overviewTab === 'all'
      ? [
          {
            id: 'type',
            label: 'Type',
            key: 'type',
            options: [
              ['task', 'Task'],
              ['milestone', 'Milestone'],
              ['project', 'Project'],
              ['note', 'Note'],
              ['event', 'Event'],
              ['reminder', 'Reminder'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'status',
            label: 'Status',
            key: 'status',
            options: [
              ['needs_attention', 'Needs attention'],
              ['today', 'Today'],
              ['long_term', 'Long-term'],
              ['active', 'Active'],
              ['completed', 'Completed'],
              ['upcoming', 'Upcoming'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'assignment',
            label: 'Assignment',
            key: 'assignment',
            options: [
              ['me', 'Assigned to me'],
              ['my_teams', 'Assigned to my teams'],
              ['others', 'Assigned to others'],
              ['unassigned', 'Unassigned'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'team',
            label: 'Team',
            key: 'team',
            options: workspaceTeams.map((team) => ({
              value: `team:${team.id}`,
              label: team.name,
            })),
          },
          {
            id: 'project',
            label: 'Project',
            key: 'project',
            options: projects.map((project) => ({
              value: `project:${project.id}`,
              label: project.name,
            })),
          },
          {
            id: 'date',
            label: 'Date',
            key: 'date',
            options: [
              ['today', 'Today'],
              ['this_week', 'This week'],
              ['overdue', 'Overdue'],
              ['no_date', 'No date'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'priority',
            label: 'Priority',
            key: 'priority',
            options: [
              ['urgent', 'Urgent'],
              ['high', 'High'],
              ['medium', 'Medium'],
              ['low', 'Low'],
              ['no_priority', 'No priority'],
            ].map(([value, label]) => ({ value, label })),
          },
        ]
      : overviewTab === 'assigned'
      ? [
          {
            id: 'type',
            label: 'Type',
            key: 'type',
            options: [
              ['task', 'Task'],
              ['milestone', 'Milestone'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'status',
            label: 'Status',
            key: 'status',
            options: [
              ['needs_attention', 'Needs attention'],
              ['active', 'Active'],
              ['upcoming', 'Upcoming'],
              ['completed', 'Completed'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'assignment',
            label: 'Assignment',
            key: 'assignment',
            options: [
              ['me', 'Me'],
              ['my_teams', 'My teams'],
              ['unassigned', 'Unassigned'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'people',
            label: 'Specific person',
            key: 'assignment',
            options: workspaceMembers
              .map((member) => ({
                value: `person:${member.user_id}`,
                label: member.full_name?.trim() || member.email?.trim() || 'Member',
              }))
              .filter((item) => Boolean(item.label)),
          },
          {
            id: 'teams',
            label: 'Specific team',
            key: 'assignment',
            options: workspaceTeams.map((team) => ({
              value: `team:${team.id}`,
              label: team.name,
            })),
          },
          {
            id: 'project',
            label: 'Project',
            key: 'project',
            options: projects.map((project) => ({
              value: `project:${project.id}`,
              label: project.name,
            })),
          },
          {
            id: 'date',
            label: 'Date',
            key: 'date',
            options: [
              ['today', 'Today'],
              ['this_week', 'This week'],
              ['overdue', 'Overdue'],
              ['no_date', 'No date'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'priority',
            label: 'Priority',
            key: 'priority',
            options: [
              ['urgent', 'Urgent'],
              ['high', 'High'],
              ['medium', 'Medium'],
              ['low', 'Low'],
              ['no_priority', 'No priority'],
            ].map(([value, label]) => ({ value, label })),
          },
        ]
      : overviewTab === 'today'
      ? [
          {
            id: 'type',
            label: 'Type',
            key: 'type',
            options: [
              ['task', 'Task'],
              ['event', 'Event'],
              ['reminder', 'Reminder'],
              ['milestone', 'Milestone'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'status',
            label: 'Status',
            key: 'status',
            options: [
              ['open', 'Open'],
              ['done', 'Done'],
              ['needs_attention', 'Needs attention'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'assignment',
            label: 'Assignment',
            key: 'assignment',
            options: [
              ['me', 'Assigned to me'],
              ['my_teams', 'Assigned to my teams'],
              ['unassigned', 'Unassigned'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'team',
            label: 'Team',
            key: 'team',
            options: workspaceTeams.map((team) => ({
              value: `team:${team.id}`,
              label: team.name,
            })),
          },
          {
            id: 'project',
            label: 'Project',
            key: 'project',
            options: projects.map((project) => ({
              value: `project:${project.id}`,
              label: project.name,
            })),
          },
          {
            id: 'priority',
            label: 'Priority',
            key: 'priority',
            options: [
              ['urgent', 'Urgent'],
              ['high', 'High'],
              ['medium', 'Medium'],
              ['low', 'Low'],
              ['no_priority', 'No priority'],
            ].map(([value, label]) => ({ value, label })),
          },
        ]
      : overviewTab === 'projects'
      ? [
          {
            id: 'status',
            label: 'Project status',
            key: 'status',
            options: [
              ['active', 'Active'],
              ['near_done', 'Near done'],
              ['paused', 'Paused'],
              ['completed', 'Completed'],
              ['archived', 'Archived'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'assignment',
            label: 'Assignment',
            key: 'assignment',
            options: [
              ['me', 'Assigned to me'],
              ['my_teams', 'Assigned to my teams'],
              ['unassigned', 'Unassigned'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'team',
            label: 'Owner team',
            key: 'team',
            options: workspaceTeams.map((team) => ({
              value: `team:${team.id}`,
              label: team.name,
            })),
          },
          {
            id: 'date',
            label: 'Date',
            key: 'date',
            options: [
              ['this_week', 'Due this week'],
              ['this_month', 'Due this month'],
              ['overdue', 'Overdue'],
              ['no_date', 'No due date'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'progress',
            label: 'Progress',
            key: 'progress',
            options: [
              ['0_25', '0-25%'],
              ['25_75', '25-75%'],
              ['75_99', '75-99%'],
              ['complete', 'Complete'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'has',
            label: 'Has',
            key: 'has',
            options: [
              ['milestones', 'Milestones'],
              ['notes', 'Notes'],
              ['open_actions', 'Open actions'],
            ].map(([value, label]) => ({ value, label })),
          },
        ]
      : [
          {
            id: 'noteType',
            label: 'Note type',
            key: 'noteType',
            options: [
              ['regular_note', 'Regular note'],
              ['meeting_note', 'Meeting note'],
              ['quick_note', 'Quick note'],
              ['linked_note', 'Linked note'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'linkedContext',
            label: 'Linked context',
            key: 'linkedContext',
            options: [
              ['linked_to_project', 'Linked to project'],
              ['linked_to_team', 'Linked to team'],
              ['unlinked', 'Unlinked'],
            ].map(([value, label]) => ({ value, label })),
          },
          {
            id: 'project',
            label: 'Project',
            key: 'project',
            options: projects.map((project) => ({
              value: `project:${project.id}`,
              label: project.name,
            })),
          },
          {
            id: 'team',
            label: 'Team',
            key: 'team',
            options: workspaceTeams.map((team) => ({
              value: `team:${team.id}`,
              label: team.name,
            })),
          },
          {
            id: 'date',
            label: 'Date',
            key: 'date',
            options: [
              ['today', 'Today'],
              ['this_week', 'This week'],
              ['this_month', 'This month'],
            ].map(([value, label]) => ({ value, label })),
          },
        ];

  const visibleOverviewFilterSections = overviewFilterSections
    .filter((section) => !isPersonalWorkspace || !['people', 'teams', 'team'].includes(section.id))
    .map((section) => {
      if (!isPersonalWorkspace) return section;
      if (section.id === 'linkedContext') {
        return {
          ...section,
          options: section.options.filter((option) => option.value !== 'linked_to_team'),
        };
      }
      if (section.id !== 'assignment') return section;
      return {
        ...section,
        options: section.options.filter(
          (option) =>
            option.value === 'me' || option.value === 'assigned' || option.value === 'unassigned'
        ),
      };
    });

  const activeOverviewFilterCount = countOverviewFilters(activeOverviewFilters);
  const overviewFilterButtonLabel =
    activeOverviewFilterCount > 0 ? `Filter ${activeOverviewFilterCount}` : 'Filter';
  const openOverviewFilterMenu = () => {
    const baseSections =
      overviewTab === 'all'
        ? ['type']
        : overviewTab === 'assigned'
        ? ['assignment']
        : overviewTab === 'today'
        ? ['type']
        : overviewTab === 'projects'
        ? ['status']
        : ['noteType'];
    const activeSections = overviewFilterKeyList.filter(
      (key) => activeOverviewFilters[key]?.length > 0
    );
    setOverviewFilterOpenSections(new Set([...baseSections, ...activeSections]));
    setIsOverviewFilterOpen((current) => !current);
    setIsOverviewDisplayOpen(false);
    setIsOverviewCreateMenuOpen(false);
    setIsOverviewViewMenuOpen(false);
  };
  const clearCurrentOverviewFilters = () => {
    setOverviewFilters((current) => ({
      ...current,
      [overviewTab]: createEmptyOverviewFilterValues(),
    }));
  };
  const updateOverviewLayout = (patch: Partial<OverviewLayoutPreferences>) => {
    setOverviewLayoutPreferences((current) => ({ ...current, ...patch }));
  };
  const toggleOverviewProperty = (property: OverviewProperty) => {
    setOverviewLayoutPreferences((current) => {
      const visible = new Set(current.visibleProperties);
      if (visible.has(property)) visible.delete(property);
      else visible.add(property);
      return { ...current, visibleProperties: Array.from(visible) };
    });
  };
  const isOverviewLayoutDefault =
    overviewLayoutPreferences.density === defaultOverviewLayoutPreferences.density &&
    overviewLayoutPreferences.groupBy === defaultOverviewLayoutPreferences.groupBy &&
    defaultOverviewLayoutPreferences.visibleProperties.every((property) =>
      overviewLayoutPreferences.visibleProperties.includes(property)
    ) &&
    overviewLayoutPreferences.visibleProperties.every((property) =>
      defaultOverviewLayoutPreferences.visibleProperties.includes(property)
    );
  const resetOverviewLayout = () => {
    if (!isOverviewLayoutDefault) setOverviewLayoutPreferences(defaultOverviewLayoutPreferences);
  };
  const toggleOverviewFilterSection = (sectionId: string) => {
    setOverviewFilterOpenSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };
  const toggleOverviewFilterValue = (
    key: OverviewFilterKey,
    value: string,
    tab: OverviewTab = overviewTab
  ) => {
    setOverviewFilters((current) => {
      const next = { ...current };
      const tabFilters = { ...next[tab] };
      const existing = new Set(tabFilters[key]);
      if (existing.has(value)) existing.delete(value);
      else existing.add(value);
      tabFilters[key] = Array.from(existing);
      next[tab] = tabFilters;
      return next;
    });
  };
  const renderOverviewFilterSection = (section: {
    id: string;
    label: string;
    key: OverviewFilterKey;
    options: Array<{ value: string; label: string }>;
  }) => {
    const isOpen = overviewFilterOpenSections.has(section.id);
    const selectedValues = activeOverviewFilters[section.key] ?? [];
    const selectedCount = section.options.filter((option) =>
      selectedValues.includes(option.value)
    ).length;
    return (
      <div
        key={section.id}
        className="border-b border-[color:var(--ledger-border-subtle)] last:border-b-0"
      >
        <button
          type="button"
          onClick={() => toggleOverviewFilterSection(section.id)}
          aria-expanded={isOpen}
          className="flex min-h-9 w-full items-center justify-between rounded-md px-3 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ledger-accent)]/30"
        >
          <span className="min-w-0 truncate">{section.label}</span>
          <span className="flex items-center gap-2">
            {selectedCount > 0 && (
              <span className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--ledger-text-muted)]">
                {selectedCount}
              </span>
            )}
            <ChevronRight
              size={13}
              className={`text-[var(--ledger-text-muted)] transition ${isOpen ? 'rotate-90' : ''}`}
            />
          </span>
        </button>
        {isOpen && (
          <div className="space-y-0.5 px-1 pb-2">
            {section.options.map((option) => {
              const selected = selectedValues.includes(option.value);
              return (
                <OverviewPopoverRow
                  key={option.value}
                  onClick={() => toggleOverviewFilterValue(section.key, option.value)}
                  selected={selected}
                  role="menuitemcheckbox"
                  ariaChecked={selected}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                      selected
                        ? 'border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)] text-white'
                        : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={9} />
                  </span>
                  <span className="truncate">{option.label}</span>
                </OverviewPopoverRow>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  useWorkspaceRouteHistory(
    isModuleWindow
      ? {
          kind: 'dashboard',
          focusSection: overviewTab,
          focusContext: overviewTeamScopeId ? `team:${overviewTeamScopeId}` : null,
        }
      : null,
    Boolean(isModuleWindow)
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isOverviewFilterOpen ||
        isOverviewDisplayOpen ||
        isFocusPickerOpen ||
        isOverviewTaskModalOpen ||
        isOverviewCreateMenuOpen ||
        isOverviewViewMenuOpen
      ) {
        if (event.key === 'Escape') {
          setIsOverviewFilterOpen(false);
          setIsOverviewDisplayOpen(false);
          setIsOverviewCreateMenuOpen(false);
          setIsOverviewViewMenuOpen(false);
        }
        return;
      }
      if (event.key === 'Escape') {
        setSelectedOverviewRowId(null);
        return;
      }
      if (event.key === 'Enter' && selectedOverviewRow) {
        event.preventDefault();
        selectedOverviewRow.open();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const rows = visibleOverviewRows;
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((row) => row.id === selectedOverviewRowId);
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(rows.length - 1, currentIndex + 1)
          : currentIndex < 0
          ? rows.length - 1
          : Math.max(0, currentIndex - 1);
      setSelectedOverviewRowId(rows[nextIndex]?.id ?? null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isFocusPickerOpen,
    isOverviewTaskModalOpen,
    isOverviewDisplayOpen,
    isOverviewFilterOpen,
    isOverviewCreateMenuOpen,
    isOverviewViewMenuOpen,
    selectedOverviewRow,
    selectedOverviewRowId,
    visibleOverviewRows,
  ]);

  const attemptCloseDashboard = () => {
    const hasUnsaved =
      overviewTaskTitle.trim().length > 0 ||
      overviewTaskAssigneeValue.trim().length > 0 ||
      (overviewTaskMode === 'long_term' && overviewTaskDueDate.trim().length > 0);
    if (isSavingOverviewTask || hasUnsaved) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('dashboard');
  };
  return (
    <div
      className={dashboardTheme.shell}
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
      <CloseGuardModal
        isOpen={showCloseGuardModal}
        isSaving={isSavingOverviewTask}
        hasUnsavedChanges={
          overviewTaskTitle.trim().length > 0 ||
          overviewTaskAssigneeValue.trim().length > 0 ||
          (overviewTaskMode === 'long_term' && overviewTaskDueDate.trim().length > 0)
        }
        onCancel={() => setShowCloseGuardModal(false)}
        onCloseWithoutSaving={() => {
          setShowCloseGuardModal(false);
          setOverviewTaskTitle('');
          setOverviewTaskAssigneeValue('');
          setOverviewTaskDueDate('');
          setIsOverviewTaskModalOpen(false);
          void window.desktopWindow?.closeModule('dashboard');
        }}
        onRetrySaveAndClose={() => {
          void (async () => {
            if (isSavingOverviewTask) return;
            if (overviewTaskTitle.trim()) {
              await createOverviewTask();
            }
            setShowCloseGuardModal(false);
            void window.desktopWindow?.closeModule('dashboard');
          })();
        }}
      />
      <ModuleWindowHeader
        title="Workspace overview"
        stripTitle="Workspace overview"
        icon={<img src="./logo-color.svg" alt="" className="h-5 w-5" />}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Funnel size={12} />}
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
        primaryActions={
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div ref={overviewViewMenuRef} className="relative xl:hidden">
              <button
                type="button"
                onClick={() => {
                  setIsOverviewViewMenuOpen((current) => !current);
                  setIsOverviewCreateMenuOpen(false);
                  setIsOverviewFilterOpen(false);
                  setIsOverviewDisplayOpen(false);
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                aria-haspopup="menu"
                aria-expanded={isOverviewViewMenuOpen}
                aria-label="Change overview view"
                title="Change overview view"
              >
                View:{' '}
                {overviewTab === 'assigned'
                  ? 'Assigned'
                  : overviewTab === 'today'
                  ? 'Today'
                  : overviewTab === 'projects'
                  ? 'Projects'
                  : overviewTab === 'notes'
                  ? 'Notes'
                  : 'All'}
                <ChevronDown size={12} />
              </button>
              {isOverviewViewMenuOpen && (
                <div className="absolute left-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]">
                  {[
                    { id: 'all', label: 'All', icon: <LayoutList size={10} /> },
                    ...(!isPersonalWorkspace
                      ? [{ id: 'assigned', label: 'Assigned', icon: <UserCheck size={10} /> }]
                      : []),
                    { id: 'today', label: 'Today', icon: <MapIcon size={10} /> },
                    { id: 'projects', label: 'Projects', icon: <FolderKanban size={10} /> },
                    { id: 'notes', label: 'Notes', icon: <StickyNote size={10} /> },
                  ].map(({ id, label, icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setOverviewTab(id as OverviewTab);
                        setIsOverviewViewMenuOpen(false);
                        setIsOverviewFilterOpen(false);
                        setIsOverviewDisplayOpen(false);
                        setIsOverviewCreateMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                        {icon}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden xl:block">
              <ModuleHeaderSegmentedGroup compact>
                {[
                  ['all', 'All'],
                  ...(!isPersonalWorkspace ? [['assigned', 'Assigned']] : []),
                  ['today', 'Today'],
                  ['projects', 'Projects'],
                  ['notes', 'Notes'],
                ].map(([id, label]) => (
                  <ModuleHeaderSegmentedButton
                    key={id}
                    compact
                    active={overviewTab === id}
                    onClick={() => {
                      setOverviewTab(id as OverviewTab);
                      setIsOverviewFilterOpen(false);
                      setIsOverviewDisplayOpen(false);
                      setIsOverviewCreateMenuOpen(false);
                      setIsOverviewViewMenuOpen(false);
                    }}
                    title={label}
                    ariaLabel={label}
                  >
                    {label}
                  </ModuleHeaderSegmentedButton>
                ))}
              </ModuleHeaderSegmentedGroup>
            </div>

            <div ref={overviewFilterMenuRef} className="relative">
              <ModuleHeaderActionButton
                variant="strip"
                iconOnly
                square
                icon={
                  <span className="relative inline-flex">
                    <SlidersHorizontal size={14} />
                    {activeOverviewFilterCount > 0 && (
                      <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-0.5 text-[9px] font-semibold leading-none text-white">
                        {activeOverviewFilterCount > 9 ? '9+' : activeOverviewFilterCount}
                      </span>
                    )}
                  </span>
                }
                onClick={openOverviewFilterMenu}
                active={activeOverviewFilterCount > 0}
                ariaHasPopup="menu"
                ariaExpanded={isOverviewFilterOpen}
                title={overviewFilterButtonLabel}
                ariaLabel={overviewFilterButtonLabel}
              >
                {null}
              </ModuleHeaderActionButton>
              {isOverviewFilterOpen && (
                <div
                  className={`${overviewPopoverClassName} max-h-[min(560px,calc(100vh-56px))]`}
                  role="dialog"
                  aria-label="Overview filters"
                >
                  <div className="flex items-center justify-between px-4 py-1.5">
                    <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                      Filter
                    </p>
                    {activeOverviewFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={clearCurrentOverviewFilters}
                        className="text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                  <div className="max-h-[min(480px,calc(100vh-132px))] overflow-y-auto px-1 pb-1">
                    {visibleOverviewFilterSections.map(renderOverviewFilterSection)}
                  </div>
                </div>
              )}
            </div>

            <div ref={overviewDisplayMenuRef} className="relative">
              <ModuleHeaderActionButton
                variant="strip"
                iconOnly
                square
                icon={<LayoutList size={14} />}
                onClick={() => {
                  setIsOverviewDisplayOpen((current) => !current);
                  setIsOverviewFilterOpen(false);
                  setIsOverviewCreateMenuOpen(false);
                  setIsOverviewViewMenuOpen(false);
                }}
                active={!isOverviewLayoutDefault}
                ariaHasPopup="menu"
                ariaExpanded={isOverviewDisplayOpen}
                title="Display"
                ariaLabel="Display"
              >
                {null}
              </ModuleHeaderActionButton>
              {isOverviewDisplayOpen && (
                <div
                  className={`${overviewPopoverClassName} max-h-[min(560px,calc(100vh-56px))]`}
                  role="dialog"
                  aria-label="Overview layout"
                >
                  <div className="max-h-[min(520px,calc(100vh-72px))] overflow-y-auto p-2">
                    <p className={overviewPopoverSectionLabelClassName}>Density</p>
                    <div role="radiogroup" aria-label="Density" className="space-y-0.5">
                      {(['list', 'compact'] as OverviewDensity[]).map((density) => (
                        <OverviewPopoverRow
                          key={density}
                          onClick={() => updateOverviewLayout({ density })}
                          selected={overviewLayoutPreferences.density === density}
                          role="menuitemradio"
                          ariaSelected={overviewLayoutPreferences.density === density}
                        >
                          <span
                            className={`h-3.5 w-3.5 rounded-full border ${
                              overviewLayoutPreferences.density === density
                                ? 'border-[var(--ledger-accent)] p-[3px]'
                                : 'border-[color:var(--ledger-border-subtle)]'
                            }`}
                          >
                            {overviewLayoutPreferences.density === density && (
                              <span className="block h-full w-full rounded-full bg-[var(--ledger-accent)]" />
                            )}
                          </span>
                          {density === 'list' ? 'List' : 'Compact list'}
                        </OverviewPopoverRow>
                      ))}
                    </div>

                    <OverviewPopoverDivider />
                    <p className={overviewPopoverSectionLabelClassName}>Group by</p>
                    <div role="radiogroup" aria-label="Group by" className="space-y-0.5">
                      {(
                        [
                          ['none', 'None'],
                          ['status', 'Status'],
                          ['type', 'Type'],
                          ['project', 'Project'],
                          ['dueDate', 'Due date'],
                          ['assignee', 'Assignee'],
                          ['team', 'Team'],
                        ] as Array<[OverviewGroupBy, string]>
                      )
                        .filter(
                          ([value]) =>
                            !(isPersonalWorkspace && (value === 'assignee' || value === 'team'))
                        )
                        .map(([value, label]) => (
                          <OverviewPopoverRow
                            key={value}
                            onClick={() => updateOverviewLayout({ groupBy: value })}
                            selected={overviewLayoutPreferences.groupBy === value}
                            role="menuitemradio"
                            ariaSelected={overviewLayoutPreferences.groupBy === value}
                          >
                            {label}
                            <span className="ml-auto">
                              {overviewLayoutPreferences.groupBy === value && <Check size={14} />}
                            </span>
                          </OverviewPopoverRow>
                        ))}
                    </div>

                    <OverviewPopoverDivider />
                    <p className={overviewPopoverSectionLabelClassName}>Visible properties</p>
                    <div className="grid grid-cols-2 gap-0.5">
                      {overviewPropertyOptions.map((property) => {
                        const checked =
                          overviewLayoutPreferences.visibleProperties.includes(property);
                        return (
                          <OverviewPopoverRow
                            key={property}
                            onClick={() => toggleOverviewProperty(property)}
                            selected={checked}
                            role="menuitemcheckbox"
                            ariaChecked={checked}
                          >
                            <span
                              className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                                checked
                                  ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)] text-white'
                                  : 'border-[color:var(--ledger-border-subtle)]'
                              }`}
                            >
                              {checked && <Check size={10} />}
                            </span>
                            <span className="truncate">{overviewPropertyLabels[property]}</span>
                          </OverviewPopoverRow>
                        );
                      })}
                    </div>

                    <OverviewPopoverDivider />
                    <button
                      type="button"
                      disabled={isOverviewLayoutDefault}
                      onClick={resetOverviewLayout}
                      className="flex h-8 w-full items-center rounded-md px-3 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Reset layout
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative" ref={overviewCreateMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setIsOverviewCreateMenuOpen((current) => !current);
                  setIsOverviewViewMenuOpen(false);
                  setIsOverviewFilterOpen(false);
                  setIsOverviewDisplayOpen(false);
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                aria-haspopup="menu"
                aria-expanded={isOverviewCreateMenuOpen}
                aria-label="Create new item"
                title="Create new item"
              >
                <Plus size={13} />
                New
              </button>
              {isOverviewCreateMenuOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]">
                  {[
                    {
                      label: 'Task',
                      icon: <Check size={10} />,
                      action: () => openOverviewTaskModal('focus'),
                    },
                    {
                      label: 'Project',
                      icon: <FolderKanban size={10} />,
                      action: () => openOverviewCreateProjectModal(),
                    },
                    {
                      label: 'Note',
                      icon: <StickyNote size={10} />,
                      action: () => setIsOverviewCreateNoteOpen(true),
                    },
                    {
                      label: 'Event',
                      icon: <CalendarDays size={10} />,
                      action: () => openUpcomingQuickCreate('event'),
                    },
                    {
                      label: 'Reminder',
                      icon: <Bell size={10} />,
                      action: () => openUpcomingQuickCreate('reminder'),
                    },
                  ].map(({ label, icon, action }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setIsOverviewCreateMenuOpen(false);
                        action();
                      }}
                      className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                        {icon}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
        closeLabel="Close overview"
        minimizeLabel="Minimize overview"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('dashboard');
        }}
        fullscreenLabel="Fullscreen overview"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('dashboard');
        }}
        onClose={attemptCloseDashboard}
        compact
        showBodyHeader={false}
      />

      <div
        className={`flex-1 min-h-0 overflow-auto ${dashboardTheme.content} px-4 py-4 lg:px-5 lg:py-5`}
        style={{ scrollbarGutter: 'auto' }}
      >
        <div className="flex h-full min-h-[680px] w-full flex-col rounded-[18px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_18px_44px_rgba(66,42,24,0.06)]">
          <header className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
            <div className="min-w-0">
              <p className="mt-1 text-[13px] text-[var(--ledger-text-muted)]">
                Everything happening across {activeWorkspace?.name ?? 'this workspace'}.
              </p>
            </div>
          </header>

          {dashboardError && (
            <div className="mx-5 mt-4 rounded-2xl border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] px-4 py-3 text-sm text-[var(--ledger-danger)]">
              {dashboardError}
            </div>
          )}

          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_280px]">
            <main className="flex min-h-0 min-w-0 flex-col overflow-auto px-3 py-3">
              {isLoadingDashboard ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <DashboardSkeletonTaskItem key={i} />
                  ))}
                </div>
              ) : visibleOverviewRows.length === 0 ? (
                activeOverviewFilterCount > 0 ? (
                  <div className="flex flex-1 items-center justify-center p-6">
                    <div className="inline-flex items-center gap-3 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 py-3 shadow-sm">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                        <SlidersHorizontal size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                          No results match these filters.
                        </p>
                        <button
                          type="button"
                          onClick={clearCurrentOverviewFilters}
                          className="mt-0.5 text-xs font-medium text-[var(--ledger-accent)] transition hover:text-[var(--ledger-accent-hover)]"
                        >
                          Clear filters
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6">
                    <div className="max-w-sm rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-5 py-4 text-center shadow-sm">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                        {overviewEmptyState.icon}
                      </div>
                      <p className="mt-3 text-sm font-medium text-[var(--ledger-text-primary)]">
                        {overviewEmptyState.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--ledger-text-muted)]">
                        {overviewEmptyState.body}
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-1.5">
                  {overviewGroups.map((group) => {
                    const isCollapsed = collapsedOverviewGroups.has(group.id);
                    const canCreateInGroup = overviewLayoutPreferences.groupBy === 'none';
                    return (
                      <section key={group.id} className="overflow-hidden">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleOverviewGroup(group.id)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            toggleOverviewGroup(group.id);
                          }}
                          className="flex h-8 cursor-pointer select-none items-center justify-between rounded-lg bg-[var(--ledger-surface-muted)] px-3"
                        >
                          <div className="flex min-w-0 items-center gap-2 text-left select-none">
                            <ChevronDown
                              size={14}
                              className={`shrink-0 text-[var(--ledger-text-muted)] transition ${
                                isCollapsed ? '-rotate-90' : 'rotate-0'
                              }`}
                            />
                            <span className="truncate text-[12px] font-medium text-[var(--ledger-text-secondary)]">
                              {group.label}
                            </span>
                            <span className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ledger-text-muted)]">
                              {group.rows.length}
                            </span>
                          </div>
                          {canCreateInGroup && (
                            <button
                              type="button"
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (group.id === 'Active projects') {
                                  openOverviewCreateProjectModal();
                                } else if (group.id === 'Upcoming') {
                                  openUpcomingQuickCreate('event');
                                } else if (group.id === 'Recent notes') {
                                  setIsOverviewCreateNoteOpen(true);
                                } else if (group.id === 'Needs attention') {
                                  openOverviewTaskModal('focus');
                                } else if (group.id === 'Today') {
                                  openOverviewTaskModal('today');
                                } else if (group.id === 'Long-term tasks') {
                                  openOverviewTaskModal('long_term');
                                } else {
                                  openOverviewTaskModal('focus');
                                }
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] select-none"
                              title={`Create item in ${group.label}`}
                            >
                              <Plus size={13} />
                            </button>
                          )}
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-1 pb-1 pt-1">
                            {group.rows.map((row) => {
                              const isSelected = selectedOverviewRow?.id === row.id;
                              const visibleMetadata = overviewLayoutPreferences.visibleProperties
                                .map((property) => getOverviewPropertyValue(row, property))
                                .filter((value): value is string => Boolean(value));
                              const rowAssignee =
                                row.assignee ??
                                (row.assignment?.userLabel
                                  ? {
                                      kind: 'user' as const,
                                      label: getMemberInitials(row.assignment.userLabel),
                                      name: row.assignment.userLabel,
                                    }
                                  : row.assignment?.teamLabel
                                  ? {
                                      kind: 'team' as const,
                                      label: row.assignment.teamLabel,
                                      name: row.assignment.teamLabel,
                                    }
                                  : undefined);
                              const showRowContextLabel = Boolean(row.contextLabel) && !rowAssignee;
                              return (
                                <div
                                  key={row.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedOverviewRowId(row.id)}
                                  onDoubleClick={() => row.open()}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      setSelectedOverviewRowId(row.id);
                                    } else if (event.key === ' ') {
                                      event.preventDefault();
                                      setSelectedOverviewRowId(row.id);
                                    }
                                  }}
                                  onContextMenu={(event) =>
                                    openContextMenu(event, {
                                      type: 'overview-row',
                                      rowId: row.id,
                                      rowKind: row.kind,
                                      sourceId: row.sourceId,
                                    })
                                  }
                                  className={`group grid min-w-0 w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 text-left transition ${
                                    overviewLayoutPreferences.density === 'compact'
                                      ? 'min-h-9 py-1'
                                      : 'min-h-10 py-1.5'
                                  } ${
                                    isSelected
                                      ? 'rounded-lg bg-[var(--ledger-surface-muted)]'
                                      : 'hover:rounded-lg hover:bg-[var(--ledger-surface-muted)]'
                                  }`}
                                >
                                  <span className="relative flex h-6 w-6 items-center justify-center overflow-visible rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[13px] text-[var(--ledger-text-secondary)]">
                                    {row.taskIcon ?? row.icon}
                                    {row.isOverdue && (
                                      <span
                                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[color:var(--ledger-surface-card)] bg-[var(--ledger-accent)] text-[8px] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(17,24,39,0.18)]"
                                        title={row.overdueLabel}
                                        aria-label={row.overdueLabel ?? 'Overdue'}
                                      >
                                        !
                                      </span>
                                    )}
                                  </span>
                                  <span className="min-w-0 overflow-hidden truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
                                    {row.title}
                                    {showRowContextLabel && row.contextLabel && (
                                      <span className="ml-2 inline-flex min-w-0 max-w-full items-center gap-1 truncate text-[11px] font-normal text-[var(--ledger-text-muted)]">
                                        {row.contextIcon}
                                        <span className="truncate">{row.contextLabel}</span>
                                      </span>
                                    )}
                                  </span>
                                  <span className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
                                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                                      {row.chips.slice(0, 2).map((chip) => (
                                        <span
                                          key={chip}
                                          className="shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-0.5 text-[10px] leading-none text-[var(--ledger-text-muted)]"
                                        >
                                          {chip}
                                        </span>
                                      ))}
                                    </span>
                                    {visibleMetadata.length > 0 && (
                                      <span className="hidden min-w-0 max-w-80 truncate whitespace-nowrap text-[11px] leading-4 text-[var(--ledger-text-muted)] md:inline">
                                        {visibleMetadata.join(' · ')}
                                      </span>
                                    )}
                                    {overviewLayoutPreferences.visibleProperties.includes(
                                      'progress'
                                    ) &&
                                      typeof row.progress === 'number' && (
                                        <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)] lg:block">
                                          <span
                                            className="block h-full rounded-full bg-[var(--ledger-accent)]"
                                            style={{
                                              width: `${row.progress}%`,
                                              backgroundColor: row.accent ?? 'var(--ledger-accent)',
                                            }}
                                          />
                                        </span>
                                      )}
                                    {overviewLayoutPreferences.visibleProperties.includes(
                                      'members'
                                    ) &&
                                      rowAssignee && (
                                        <span
                                          className={`inline-flex h-5 shrink-0 items-center justify-center border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[9px] font-semibold tracking-normal text-[var(--ledger-text-secondary)] ${
                                            rowAssignee.kind === 'team'
                                              ? 'rounded-full px-2 min-w-8'
                                              : 'w-5 rounded-full'
                                          }`}
                                          title={rowAssignee.name}
                                          aria-label={rowAssignee.name}
                                        >
                                          {rowAssignee.label}
                                        </span>
                                      )}
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        const rect = (
                                          event.currentTarget as HTMLButtonElement
                                        ).getBoundingClientRect();
                                        setDashboardContextMenu({
                                          x: rect.right,
                                          y: rect.bottom,
                                          type: 'overview-row',
                                          rowId: row.id,
                                          rowKind: row.kind,
                                          sourceId: row.sourceId,
                                        });
                                      }}
                                      className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)]"
                                      aria-label={`Open actions for ${row.title}`}
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </main>

            <aside className="min-h-0 border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]/35 p-4 md:border-l md:border-t-0">
              <div className="flex h-full min-h-0 flex-col overflow-y-auto pr-0.5">
                {!selectedOverviewRow ? (
                  <>
                    <div className="space-y-4">
                      <div>
                        <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                          {todayLabel}
                        </p>
                        <h3 className="mt-1 text-[17px] font-semibold leading-6 text-[var(--ledger-text-primary)]">
                          {activeWorkspace?.name ?? 'Workspace'}
                        </h3>
                      </div>
                      <div className="space-y-1.5">
                        {[
                          [
                            'Today',
                            `${Math.max(0, completedFocusTasks.length)}/${Math.max(
                              1,
                              todayTasks.length
                            )} complete`,
                          ],
                          [
                            'Long-term',
                            `${
                              workspaceTasks.filter((task) => task.task_horizon === 'long_term')
                                .length
                            } tasks`,
                          ],
                          [
                            'Assigned to me',
                            `${
                              todayTasks.filter((task) => task.assigned_to || task.project_name)
                                .length
                            } tasks`,
                          ],
                          ['Active projects', `${attentionProjects.length} active`],
                          ['Upcoming', `${upcoming.length} events`],
                        ]
                          .filter(([label]) => !isPersonalWorkspace || label !== 'Assigned to me')
                          .map(([label, value], index, rows) => (
                            <div
                              key={label}
                              className={`flex items-center justify-between py-1.5 ${
                                index < rows.length - 1
                                  ? 'border-b border-[color:var(--ledger-border-subtle)]'
                                  : ''
                              }`}
                            >
                              <span className="text-[11px] text-[var(--ledger-text-muted)]">
                                {label}
                              </span>
                              <span className="text-[12px] font-medium text-[var(--ledger-text-primary)]">
                                {value}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                    <div className="mt-auto space-y-2 pt-3">
                      {recentNotes[0] && (
                        <div className="border-t border-[color:var(--ledger-border-subtle)] pt-2.5">
                          <p className="text-[10px] font-medium text-[var(--ledger-text-muted)]">
                            Recent note
                          </p>
                          <p className="mt-0.5 truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">
                            {recentNotes[0].title}
                          </p>
                        </div>
                      )}
                      <div className="pt-2">
                        <p className="text-[10px] font-medium text-[var(--ledger-text-muted)]">
                          Try next
                        </p>
                        <p className="mt-0.5 truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">
                          Connect calendar
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="border-b border-[color:var(--ledger-border-subtle)] pb-3">
                      <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                        {selectedOverviewTypeLabel}
                      </p>
                      <h3 className="mt-1.5 text-[17px] font-semibold leading-6 text-[var(--ledger-text-primary)]">
                        {selectedOverviewRow.title}
                      </h3>
                      <p className="mt-1 text-[11px] leading-5 text-[var(--ledger-text-muted)]">
                        {selectedOverviewRow.meta}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedOverviewRow.chips.map((chip) => (
                          <span
                            key={chip}
                            className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-0.5 text-[10px] text-[var(--ledger-text-secondary)]"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>

                    {overviewDetailSections.map((section) => (
                      <section
                        key={section.title}
                        className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-3"
                      >
                        <p className="text-[10px] font-medium text-[var(--ledger-text-muted)]">
                          {section.title}
                        </p>
                        <div className="space-y-0.5">
                          {section.rows.map(([label, value]) =>
                            renderOverviewDetailRow(label, value)
                          )}
                        </div>
                      </section>
                    ))}

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-3">
                      <p className="text-[10px] font-medium text-[var(--ledger-text-muted)]">
                        Quick actions
                      </p>
                      <div className="space-y-1">
                        {selectedOverviewQuickActions.map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            onClick={() => action.action()}
                            disabled={action.disabled}
                            className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>{action.label}</span>
                            {action.icon}
                          </button>
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
      <ModalOverlay
        isOpen={isOverviewLinkProjectOpen}
        onClose={() => {
          setIsOverviewLinkProjectOpen(false);
          setOverviewLinkTargetNoteId(null);
        }}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
              Link to project
            </p>
            <p className="mt-1 truncate text-sm text-[var(--ledger-text-secondary)]">
              {notes.find((note) => note.id === overviewLinkTargetNoteId)?.title || 'Untitled note'}
            </p>
          </div>
          <ModalCloseButton
            onClick={() => {
              setIsOverviewLinkProjectOpen(false);
              setOverviewLinkTargetNoteId(null);
            }}
            ariaLabel="Close project link modal"
          />
        </div>

        <div className="space-y-3 p-5">
          <input
            value={overviewLinkProjectSearch}
            onChange={(event) => setOverviewLinkProjectSearch(event.target.value)}
            placeholder="Search active projects..."
            className="h-9 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <div className="max-h-[48vh] space-y-1 overflow-auto pr-1">
            {isLoadingOverviewLinkableProjects ? (
              <p className="px-1 py-2 text-sm text-[var(--ledger-text-muted)]">
                Loading projects...
              </p>
            ) : filteredOverviewLinkableProjects.length === 0 ? (
              <p className="px-1 py-2 text-sm text-[var(--ledger-text-muted)]">
                No active projects found.
              </p>
            ) : (
              filteredOverviewLinkableProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void linkOverviewNoteToProject(project.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {project.name}
                    </p>
                    <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                      {String(project.status ?? 'active')
                        .split('_')
                        .join(' ')}
                      {typeof project.completeness === 'number'
                        ? ` · ${Math.round(project.completeness)}%`
                        : ''}
                      {project.end_date ? ` · Due ${formatShortDate(project.end_date)}` : ''}
                    </p>
                  </div>
                  <span className="ml-3 shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                    Select
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </ModalOverlay>
      <CreateNoteModal
        isOpen={isOverviewCreateNoteOpen}
        onClose={() => setIsOverviewCreateNoteOpen(false)}
        compactShell
        onNoteCreated={(note) => {
          optimisticNotesRef.current = [
            {
              id: note.id,
              title: note.title,
              content: note.content,
              updated_at: note.updated_at,
            },
            ...optimisticNotesRef.current.filter((item) => item.id !== note.id),
          ].slice(0, 4);
          setNotes((current) =>
            sortNewestFirst([
              {
                id: note.id,
                title: note.title,
                content: note.content,
                updated_at: note.updated_at,
              },
              ...current.filter((item) => item.id !== note.id),
            ]).slice(0, 4)
          );
          setDashboardRefreshToken((current) => current + 1);
          window.desktopWindow?.toggleModule('notes', { focusNoteId: note.id });
        }}
      />
      <ModalOverlay
        isOpen={isOverviewCreateProjectOpen}
        onClose={closeOverviewCreateProjectModal}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">New project</p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Add a brief, choose a type, assign the lead, and attach context.
            </p>
          </div>
          <ModalCloseButton
            onClick={closeOverviewCreateProjectModal}
            ariaLabel="Close new project modal"
            className="shrink-0"
          />
        </div>

        <div className="space-y-4 px-5 py-5">
          <input
            ref={overviewProjectNameRef}
            value={overviewProjectName}
            onChange={(event) => setOverviewProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void createOverviewProject();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                closeOverviewCreateProjectModal();
              }
            }}
            placeholder="Project name"
            className="h-10 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <textarea
            value={overviewProjectDescription}
            onChange={(event) => setOverviewProjectDescription(event.target.value)}
            placeholder="Brief description"
            rows={3}
            className="w-full resize-none rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <div className="flex flex-wrap items-center gap-2">
            {overviewProjectTypeOptions.map((option) => {
              const active = overviewProjectType === option.id;
              const TypeIcon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setOverviewProjectType(option.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
                    active
                      ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                      : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  <TypeIcon size={12} />
                  {option.label}
                </button>
              );
            })}

            <select
              value={overviewProjectLeadId}
              onChange={(event) => setOverviewProjectLeadId(event.target.value)}
              className="inline-flex h-8 min-w-[144px] items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-xs font-medium text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            >
              <option value="">Working on it</option>
              {user && (
                <option value={user.id}>
                  {user.user_metadata?.full_name?.trim() || user.email || 'You'}
                </option>
              )}
              {workspaceMembers
                .filter((member) => member.user_id !== user?.id)
                .map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.full_name?.trim() || member.email?.trim() || 'Workspace member'}
                  </option>
                ))}
            </select>

            <select
              value={overviewProjectOwnerTeamId}
              onChange={(event) => setOverviewProjectOwnerTeamId(event.target.value)}
              className="inline-flex h-8 min-w-[160px] items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-xs font-medium text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            >
              <option value="">No owner team</option>
              {isLoadingOverviewProjectTeams ? (
                <option value="" disabled>
                  Loading teams...
                </option>
              ) : (
                overviewProjectTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
            <button
              type="button"
              onClick={closeOverviewCreateProjectModal}
              className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createOverviewProject()}
              disabled={!overviewProjectName.trim() || isSavingOverviewProject}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
            >
              {isSavingOverviewProject ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </div>
      </ModalOverlay>
      <ModalOverlay
        isOpen={isFocusPickerOpen}
        onClose={() => setIsFocusPickerOpen(false)}
        classNameContainer="w-full max-w-xl rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Add from Today</p>
          <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
            Pick up to three priorities from today&apos;s queue.
          </p>
        </div>
        <div className="max-h-[60vh] overflow-auto p-4 space-y-2">
          {activeTodayTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-5">
              <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
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
                className="w-full rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2.5 text-left transition hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
                      {task.title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">
                      {task.project_name || task.workspace_name || 'Workspace task'}
                      {formatExpiryCounter(task) ? ` · ${formatExpiryCounter(task)}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                    Add
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-end border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={() => setIsFocusPickerOpen(false)}
            className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Close
          </button>
        </div>
      </ModalOverlay>
      <ModalOverlay
        isOpen={isOverviewTaskModalOpen}
        onClose={closeOverviewTaskModal}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
              {overviewTaskMode === 'focus'
                ? 'New focus'
                : overviewTaskMode === 'today'
                ? 'New today task'
                : 'New long-term task'}
            </p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              {overviewTaskMode === 'focus'
                ? 'Create a priority for the day and assign it if needed.'
                : overviewTaskMode === 'today'
                ? 'Create a short-term task for today.'
                : 'Create a longer horizon task with an optional end date.'}
            </p>
          </div>
          <ModalCloseButton onClick={closeOverviewTaskModal} ariaLabel="Close task modal" />
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'focus', label: 'Focus' },
              { id: 'today', label: 'Today' },
              { id: 'long_term', label: 'Long-term' },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setOverviewTaskMode(option.id as typeof overviewTaskMode);
                  if (option.id !== 'long_term') {
                    setOverviewTaskDueDate('');
                  }
                }}
                className={
                  option.id === overviewTaskMode
                    ? 'rounded-full border border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-primary)]'
                    : 'rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            ref={overviewTaskTitleRef}
            value={overviewTaskTitle}
            onChange={(event) => setOverviewTaskTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void createOverviewTask();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeOverviewTaskModal();
              }
            }}
            placeholder="Task title"
            className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
          />
          <div
            className={
              overviewTaskMode === 'long_term' && !isPersonalWorkspace
                ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
                : 'grid grid-cols-1 gap-3'
            }
          >
            {overviewTaskMode === 'long_term' ? (
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--ledger-text-secondary)]">
                  End date
                </span>
                <input
                  type="date"
                  value={overviewTaskDueDate}
                  onChange={(event) => setOverviewTaskDueDate(event.target.value)}
                  className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
                />
              </label>
            ) : null}
            {!isPersonalWorkspace && (
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--ledger-text-secondary)]">
                  Assign to
                </span>
                <select
                  value={overviewTaskAssigneeValue}
                  onChange={(event) => setOverviewTaskAssigneeValue(event.target.value)}
                  className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
                >
                  <option value="">Unassigned</option>
                  <optgroup label="People">
                    {user?.id ? (
                      <option value={`user:${user.id}`}>
                        {getWorkspaceMemberLabel(user.id) || 'Me'}
                      </option>
                    ) : null}
                    {workspaceMembers
                      .filter((member) => member.user_id !== user?.id)
                      .map((member) => (
                        <option key={member.user_id} value={`user:${member.user_id}`}>
                          {member.full_name?.trim() || member.email?.trim() || 'Unknown'}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Teams">
                    {workspaceTeams.map((team) => (
                      <option key={team.id} value={`team:${team.id}`}>
                        {team.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            )}
          </div>
          <p className="text-sm text-[var(--ledger-text-secondary)]">
            {isPersonalWorkspace
              ? overviewTaskMode === 'focus'
                ? 'Focus items appear in Today.'
                : overviewTaskMode === 'today'
                ? 'Short-term tasks stay in Today.'
                : 'Long-term tasks can carry an end date.'
              : overviewTaskMode === 'focus'
              ? 'Focus items appear in Today and can be assigned to a person or team.'
              : overviewTaskMode === 'today'
              ? 'Short-term tasks stay in Today and can still be assigned.'
              : 'Long-term tasks can carry an end date and belong to a person or team.'}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <button
            type="button"
            onClick={closeOverviewTaskModal}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void createOverviewTask()}
            disabled={!overviewTaskTitle.trim() || isSavingOverviewTask}
            className="rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
          >
            {overviewTaskMode === 'focus'
              ? 'Add focus'
              : overviewTaskMode === 'today'
              ? 'Add today task'
              : 'Add long-term task'}
          </button>
        </div>
      </ModalOverlay>
      <ModalOverlay
        isOpen={isUpcomingQuickCreateOpen}
        onClose={closeUpcomingQuickCreate}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E8DDD4] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              {upcomingQuickCreateKind === 'reminder' ? 'New reminder' : 'New event'}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              Create an upcoming event or reminder from Overview.
            </p>
          </div>
          <ModalCloseButton
            onClick={closeUpcomingQuickCreate}
            ariaLabel="Close upcoming item modal"
            className="shrink-0"
          />
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'event' as const, label: 'Event', icon: CalendarDays },
              { id: 'reminder' as const, label: 'Reminder', icon: Bell },
            ].map((option) => {
              const active = upcomingQuickCreateKind === option.id;
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setUpcomingQuickCreateKind(option.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
                    active
                      ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                      : 'border-[color:#E2D4C4] bg-[#FFF8F2] text-gray-600 hover:bg-[#FFF1E3] hover:text-gray-900'
                  }`}
                >
                  <Icon size={12} />
                  {option.label}
                </button>
              );
            })}
          </div>

          <input
            ref={upcomingQuickTitleRef}
            value={upcomingQuickTitle}
            onChange={(e) => setUpcomingQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveUpcomingQuickCreate();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeUpcomingQuickCreate();
              }
            }}
            placeholder={upcomingQuickCreateKind === 'reminder' ? 'Reminder title' : 'Event title'}
            className="h-10 w-full rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] px-3 text-sm text-gray-800 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={upcomingQuickDate}
              onChange={(e) => setUpcomingQuickDate(e.target.value)}
              className="h-10 rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] px-3 text-sm text-gray-800 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            />
            <input
              type="time"
              value={upcomingQuickTime}
              onChange={(e) => setUpcomingQuickTime(e.target.value)}
              className="h-10 rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] px-3 text-sm text-gray-800 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
            />
          </div>

          <div className="relative">
            <select
              value={upcomingQuickCalendarId}
              onChange={(e) => setUpcomingQuickCalendarId(e.target.value)}
              disabled={isLoadingUpcomingQuickCalendars || upcomingQuickCalendars.length === 0}
              className="h-10 w-full appearance-none rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] px-3 pr-9 text-sm text-gray-800 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60 disabled:opacity-60"
            >
              {isLoadingUpcomingQuickCalendars ? (
                <option value="">Loading calendars...</option>
              ) : upcomingQuickCalendars.length === 0 ? (
                <option value="">No calendars found</option>
              ) : (
                upcomingQuickCalendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))
              )}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
          </div>

          {!isPersonalWorkspace && (
            <div className="relative">
              <select
                value={upcomingQuickTeamId}
                onChange={(e) => setUpcomingQuickTeamId(e.target.value)}
                disabled={isLoadingUpcomingQuickTeams}
                className="h-10 w-full appearance-none rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] px-3 pr-9 text-sm text-gray-800 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60 disabled:opacity-60"
              >
                <option value="">No team</option>
                {isLoadingUpcomingQuickTeams ? (
                  <option value="" disabled>
                    Loading teams...
                  </option>
                ) : (
                  upcomingQuickTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
            </div>
          )}

          <textarea
            value={upcomingQuickNotes}
            onChange={(e) => setUpcomingQuickNotes(e.target.value)}
            placeholder="Optional notes"
            rows={3}
            className="w-full resize-none rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          {upcomingQuickError && <p className="text-xs text-red-600">{upcomingQuickError}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E8DDD4] px-5 py-4">
          <button
            type="button"
            onClick={closeUpcomingQuickCreate}
            className="rounded-md border border-[#E2D4C4] bg-[#FFF8F2] px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-[#FFF1E3]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void saveUpcomingQuickCreate()}
            disabled={
              !upcomingQuickTitle.trim() ||
              isSavingUpcomingQuickItem ||
              isLoadingUpcomingQuickCalendars ||
              upcomingQuickCalendars.length === 0
            }
            className="rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
          >
            {isSavingUpcomingQuickItem
              ? 'Saving...'
              : upcomingQuickCreateKind === 'reminder'
              ? 'Create reminder'
              : 'Create event'}
          </button>
        </div>
      </ModalOverlay>
      {dashboardContextMenu &&
        createPortal(
          <div
            className="fixed z-140 min-w-46.5 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]"
            style={{
              left: `${Math.max(8, Math.min(dashboardContextMenu.x, window.innerWidth - 200))}px`,
              top: `${Math.max(8, Math.min(dashboardContextMenu.y, window.innerHeight - 240))}px`,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {dashboardContextMenu.type === 'overview-row' &&
              (() => {
                const row = overviewRows.find((item) => item.id === dashboardContextMenu.rowId);
                if (!row) return null;
                const isFollowUpTask = followUpTasks.some((task) => task.id === row.sourceId);
                const isTaskRow = row.kind === 'task' || row.kind === 'reminder';
                const canAddToFocus = isTaskRow && !row.chips.includes('Focus');
                const target = isTaskRow ? findOverviewTaskTarget(row.sourceId) : null;
                const dateBucket = target?.due_date ? getOverviewDateBucket(target.due_date) : null;
                const isOverdueTask = isTaskRow && dateBucket === 'overdue';
                const hasFutureDueDate = isTaskRow && dateBucket !== null && dateBucket !== 'overdue' && dateBucket !== 'today';
                const canReschedule = isOverdueTask || hasFutureDueDate;
                const moveLabel =
                  canReschedule
                    ? hasFutureDueDate
                      ? 'Change due date'
                      : 'Reschedule'
                    : row.group === 'Today'
                    ? 'Move to Long-term'
                    : row.group === 'Long-term tasks'
                    ? 'Move to Today'
                    : null;
                const addToFocusIcon =
                  row.kind === 'reminder' ? <Bell size={14} /> : <CircleAlert size={14} />;
                const moveLabelIcon =
                  row.group === 'Today' ? (
                    <MapIcon size={14} />
                  ) : row.group === 'Long-term tasks' ? (
                    <Zap size={14} />
                  ) : null;
                const canAssign =
                  row.kind === 'task' ||
                  row.kind === 'reminder' ||
                  row.kind === 'project' ||
                  row.kind === 'event';
                const assignmentValue = row.assignment?.teamId
                  ? `team:${row.assignment.teamId}`
                  : row.assignment?.userId
                  ? `user:${row.assignment.userId}`
                  : '';
                const deleteRow = () => {
                  if (row.kind === 'project') void deleteDashboardProject(row.sourceId);
                  else if (row.kind === 'note') void deleteDashboardNote(row.sourceId);
                  else if (row.kind === 'event') void deleteTimelineEvent(row.sourceId);
                  else if (isFollowUpTask) void deleteFollowUp(row.sourceId);
                  else void deleteOverviewRow({ kind: row.kind, sourceId: row.sourceId });
                };
                const markDone = () => {
                  if (isTaskRow) {
                    void completeOverviewRow({ kind: row.kind, sourceId: row.sourceId });
                  } else if (isFollowUpTask) {
                    void markFollowUpDone(row.sourceId);
                  } else {
                    setDashboardContextMenu(null);
                  }
                };
                const moveToToday = () => {
                  if (isTaskRow) {
                    void moveOverviewRowToToday({ kind: row.kind, sourceId: row.sourceId });
                  } else {
                    setDashboardContextMenu(null);
                  }
                };
                const moveToLongTerm = () => {
                  if (isTaskRow) {
                    void moveOverviewRowToLongTerm({ kind: row.kind, sourceId: row.sourceId });
                  } else {
                    setDashboardContextMenu(null);
                  }
                };
                const selectRescheduleDate = (dueDate: string | null) => {
                  void rescheduleOverviewTask(
                    { kind: row.kind, sourceId: row.sourceId },
                    dueDate
                  );
                };
                const getRelativeDateKey = (days: number) => {
                  const date = new Date();
                  date.setHours(0, 0, 0, 0);
                  date.setDate(date.getDate() + days);
                  return date.toISOString().slice(0, 10);
                };
                const openRow = () => {
                  row.open();
                  setDashboardContextMenu(null);
                };
                const addToFocus = () => {
                  if (isTaskRow) void addTaskToFocus(row.sourceId);
                  else setDashboardContextMenu(null);
                };
                return (
                  <>
                    {!isTaskRow && (
                      <button
                        onClick={openRow}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <ArrowRight size={14} />
                        Open
                      </button>
                    )}
                    {isTaskRow && (
                      <>
                        {canAddToFocus && (
                          <button
                            onClick={addToFocus}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                          >
                            {addToFocusIcon}
                            Add to Focus
                          </button>
                        )}
                        <button
                          onClick={markDone}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                        >
                          <CheckCircle2 size={14} />
                          Mark complete
                        </button>
                        {moveLabel && canReschedule && (
                          <>
                            <button
                              onClick={() => {
                                setIsOverviewRescheduleOpen((current) => !current);
                                setOverviewRescheduleDate(target?.due_date ?? '');
                              }}
                              className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                            >
                              <span className="flex items-center gap-2">
                                <CalendarDays size={14} />
                                {moveLabel}
                              </span>
                              <ChevronRight size={14} className="text-[var(--ledger-text-muted)]" />
                            </button>
                            {isOverviewRescheduleOpen && (
                              <div className="border-y border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5">
                                {[
                                  ['Tomorrow', getRelativeDateKey(1)],
                                  ['Later this week', getRelativeDateKey(3)],
                                  ['Next week', getRelativeDateKey(7)],
                                ].map(([label, value]) => (
                                  <button
                                    key={value}
                                    onClick={() => selectRescheduleDate(value)}
                                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                                  >
                                    {label}
                                  </button>
                                ))}
                                <div className="flex items-center gap-2 px-2 py-1.5">
                                  <input
                                    type="date"
                                    value={overviewRescheduleDate}
                                    onChange={(event) => setOverviewRescheduleDate(event.target.value)}
                                    className="h-7 min-w-0 flex-1 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-xs text-[var(--ledger-text-primary)] outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={!overviewRescheduleDate}
                                    onClick={() => selectRescheduleDate(overviewRescheduleDate)}
                                    className="rounded-md px-2 py-1 text-xs font-medium text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-40"
                                  >
                                    Pick date
                                  </button>
                                </div>
                                <button
                                  onClick={() => selectRescheduleDate(null)}
                                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                                >
                                  Remove due date
                                </button>
                              </div>
                            )}
                          </>
                        )}
                        {moveLabel && !canReschedule && (
                          <button
                            onClick={row.group === 'Today' ? moveToLongTerm : moveToToday}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                          >
                            {moveLabelIcon}
                            {moveLabel}
                          </button>
                        )}
                      </>
                    )}
                    {canAssign && (
                      <div className="relative mx-2 my-0.5 flex h-8 items-center gap-2 rounded-md px-2 text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">
                        <UserRound size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                        <select
                          aria-label="Assign to"
                          value={assignmentValue}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            if (!nextValue) {
                              void updateOverviewAssignment(row, { kind: 'clear' });
                              return;
                            }
                            const [kind, id] = nextValue.split(':', 2);
                            if (!id) return;
                            void updateOverviewAssignment(
                              row,
                              kind === 'team' ? { kind: 'team', id } : { kind: 'user', id }
                            );
                          }}
                          className="min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent p-0 pr-4 text-sm text-inherit outline-none"
                        >
                          <option value="">Assign to</option>
                          <optgroup label="People">
                            {workspaceMembers.map((member) => (
                              <option key={member.user_id} value={`user:${member.user_id}`}>
                                {member.user_id === user?.id
                                  ? 'Me'
                                  : getWorkspaceMemberLabel(member.user_id) || member.user_id}
                              </option>
                            ))}
                          </optgroup>
                          {!isPersonalWorkspace && (
                            <optgroup label="Teams">
                              {workspaceTeams.map((team) => (
                                <option key={team.id} value={`team:${team.id}`}>
                                  {team.identifier?.trim() || team.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <ChevronDown
                          size={12}
                          className="pointer-events-none absolute right-2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    )}
                    {row.kind === 'project' && (
                      <button
                        onClick={() => {
                          void updateProjectStatus(row.sourceId, 'in_progress');
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <MoreHorizontal size={14} />
                        Mark in progress
                      </button>
                    )}
                    {row.kind === 'note' && (
                      <button
                        onClick={() => openOverviewLinkProjectModal(row.sourceId)}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <Folder size={14} />
                        Link to project
                      </button>
                    )}
                    <button
                      onClick={() => void copyOverviewRowLink(row)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                    >
                      <StickyNote size={14} />
                      Copy link
                    </button>
                    <button
                      onClick={deleteRow}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
                    >
                      <Trash2 size={14} />
                      {row.kind === 'note' || row.kind === 'project' || row.kind === 'event'
                        ? 'Archive'
                        : 'Delete'}
                    </button>
                  </>
                );
              })()}
            {dashboardContextMenu.type === 'followup' && (
              <>
                <button
                  onClick={() => openFollowUpEvent(dashboardContextMenu.taskId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <CalendarDays size={14} />
                  Jump to event
                </button>
                <button
                  onClick={() => void markFollowUpDone(dashboardContextMenu.taskId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <CheckCircle2 size={14} />
                  Mark as done
                </button>
                <button
                  onClick={() => void deleteFollowUp(dashboardContextMenu.taskId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
                >
                  <Trash2 size={14} />
                  Delete follow-up
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'timeline' && (
              <>
                <button
                  onClick={() => {
                    const event = upcoming.find((item) => item.id === dashboardContextMenu.eventId);
                    if (!event) return;
                    void window.desktopWindow?.openModule('calendar', {
                      kind: 'calendar',
                      focusContext: `focus-event:${event.id}`,
                    });
                    setDashboardContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <CalendarDays size={14} />
                  Open in Calendar
                </button>
                <button
                  onClick={() => void deleteTimelineEvent(dashboardContextMenu.eventId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
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
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <Folder size={14} />
                  Navigate to project
                </button>
                <button
                  onClick={() =>
                    void updateProjectStatus(dashboardContextMenu.projectId, 'in_progress')
                  }
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <MoreHorizontal size={14} />
                  Mark in progress
                </button>
                <button
                  onClick={() => void updateProjectStatus(dashboardContextMenu.projectId, 'paused')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <MoreHorizontal size={14} />
                  Mark paused
                </button>
                <button
                  onClick={() =>
                    void updateProjectStatus(dashboardContextMenu.projectId, 'completed')
                  }
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <CheckCircle2 size={14} />
                  Mark completed
                </button>
                <button
                  onClick={() => void deleteDashboardProject(dashboardContextMenu.projectId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
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
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
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
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
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
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <StickyNote size={14} />
                  Navigate to note
                </button>
                <button
                  onClick={() => void deleteDashboardNote(dashboardContextMenu.noteId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
                >
                  <Trash2 size={14} />
                  Delete note
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'checkin' && (
              <button
                onClick={() => void clearCheckin()}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
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
  const toast = useToast();
  const { user, isLoading, error: authError } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId, refreshWorkspaces, setActiveWorkspace } =
    useWorkspaceContext();
  const api = useApi();
  const {
    state,
    setState,
    isExpanded,
    setIsExpanded,
    isVisible,
    setIsVisible,
    sidebarPreferences,
    workspaceShellLayout,
    collapseSidebar,
    collapseToRail,
    restoreSidebarView,
    setPosition,
  } = useSidebar();
  const { openSearch } = useSearch();
  const [uiMode, setUiMode] = useState<'auth' | 'app'>(user ? 'app' : 'auth');
  const [isAuthExiting, setIsAuthExiting] = useState(false);
  const [postAuthStage, setPostAuthStage] = useState<PostAuthStage>('idle');
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() =>
    getInviteTokenFromLocation()
  );
  const [isInviteOnboarding, setIsInviteOnboarding] = useState(() =>
    Boolean(getInviteTokenFromLocation())
  );
  const [inviteFlowStatus, setInviteFlowStatus] = useState<
    'idle' | 'checking' | 'awaiting-auth' | 'processing' | 'accepted' | 'already-member' | 'error'
  >('idle');
  const [inviteFlowError, setInviteFlowError] = useState<string | null>(null);
  const [inviteFlowNotice, setInviteFlowNotice] = useState<string | null>(null);
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState<string | null>(null);
  const [inviteWorkspaceName, setInviteWorkspaceName] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('welcome');
  const [onboardingWorkspaceType, setOnboardingWorkspaceType] =
    useState<OnboardingWorkspaceType | null>(null);
  const [onboardingWorkspaceId, setOnboardingWorkspaceId] = useState<string | null>(null);
  const [onboardingInviteEmails, setOnboardingInviteEmails] = useState<string[]>([]);
  const [onboardingInviteRole, setOnboardingInviteRole] = useState<'admin' | 'member'>('member');
  const [onboardingWorkspaceName, setOnboardingWorkspaceName] = useState('My Workspace');
  const [onboardingMode, setOnboardingMode] = useState<OnboardingWorkspaceMode>('create');
  const [onboardingInviteValue, setOnboardingInviteValue] = useState('');
  const [onboardingSidebarPosition, setOnboardingSidebarPosition] =
    useState<SidebarPosition>('floating');
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const onboardingResetUserRef = useRef<string | null>(null);
  const handledInviteTokenRef = useRef<string | null>(null);
  const postAuthBootstrapUserRef = useRef<string | null>(null);
  const ensuredVisibleOnBootRef = useRef(false);
  const ensuredWorkspaceStartPageRef = useRef(false);
  const authTransitionTimerRef = useRef<number | null>(null);
  const sidebarModeRef = useRef<
    'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen' | null
  >(null);
  const sidebarModeTimerRef = useRef<number | null>(null);
  const inviteToastTimerRef = useRef<number | null>(null);
  const [showAuthenticatedShell, setShowAuthenticatedShell] = useState(false);
  const [isAuthWindowReady, setIsAuthWindowReady] = useState(!window.desktopWindow);
  const authNativeWindowPinnedRef = useRef(false);
  const [workspaceShellRoute, setWorkspaceShellRoute] = useState<WorkspaceShellRoute>(() =>
    getWorkspaceShellRouteFromLocation()
  );
  const activeModuleKind = isModuleWindow ? workspaceShellRoute.kind : moduleKind;
  const activeModuleFocusContext = isModuleWindow
    ? workspaceShellRoute.focusContext?.trim() ?? ''
    : moduleFocusContext;
  const activeKeepAliveModuleKey = getKeepAliveModuleKey(
    activeModuleKind,
    activeModuleFocusContext
  );
  const [visitedModuleKeys, setVisitedModuleKeys] = useState<KeepAliveModuleKey[]>(() =>
    activeKeepAliveModuleKey ? [activeKeepAliveModuleKey] : []
  );

  useEffect(() => {
    if (window.location.pathname !== '/inbox') return;
    window.history.replaceState({}, '', `/intake${window.location.search}${window.location.hash}`);
  }, []);

  // Initialize workspace for authenticated users
  const effectiveUiMode: 'auth' | 'app' = user ? 'app' : uiMode;

  useEffect(() => {
    if (!isModuleWindow) return;

    const applyWorkspaceRoute = (route?: ModuleFocusPayload | null) => {
      if (!route?.kind) return;
      const nextRoute: WorkspaceShellRoute = {
        kind: route.kind,
        focusDate: route.focusDate ?? null,
        focusProjectId: route.focusProjectId ?? null,
        focusNoteId: route.focusNoteId ?? null,
        focusTaskId: route.focusTaskId ?? null,
        focusContext: route.focusContext ?? null,
        focusSection: route.focusSection ?? null,
      };
      const nextSearch = buildWorkspaceShellSearch(nextRoute);
      window.history.replaceState({}, '', `${window.location.pathname}?${nextSearch}`);
      setWorkspaceShellRoute(nextRoute);
    };

    const handleWorkspaceRouteChanged = (_event: unknown, route?: ModuleFocusPayload) => {
      applyWorkspaceRoute(route);
    };
    const handleLocalWorkspaceRouteRequested = (event: Event) => {
      applyWorkspaceRoute(
        (event as CustomEvent<ModuleFocusPayload>).detail as ModuleFocusPayload | undefined
      );
    };

    window.ipcRenderer?.on('workspace:route-changed', handleWorkspaceRouteChanged as any);
    window.ipcRenderer?.on('workspace:route-requested', handleWorkspaceRouteChanged as any);
    window.addEventListener(
      'ledger:workspace-route-requested',
      handleLocalWorkspaceRouteRequested
    );
    return () => {
      window.ipcRenderer?.off('workspace:route-changed', handleWorkspaceRouteChanged as any);
      window.ipcRenderer?.off('workspace:route-requested', handleWorkspaceRouteChanged as any);
      window.removeEventListener(
        'ledger:workspace-route-requested',
        handleLocalWorkspaceRouteRequested
      );
    };
  }, []);

  useEffect(() => {
    if (!activeKeepAliveModuleKey) return;
    setVisitedModuleKeys((current) =>
      current.includes(activeKeepAliveModuleKey) ? current : [...current, activeKeepAliveModuleKey]
    );
  }, [activeKeepAliveModuleKey]);

  useEffect(() => {
    if (!user || isLoading) return;

    let cancelled = false;
    const ping = () => {
      if (cancelled) return;
      void api.heartbeatAccountSession().catch(() => {
        // Best effort only.
      });
    };

    ping();

    const heartbeatTimer = window.setInterval(() => {
      if (document.hidden) return;
      ping();
    }, 10 * 60 * 1000);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        ping();
      }
    };

    window.addEventListener('focus', ping);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('focus', ping);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [api, isLoading, user?.id]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      if (!user || isLoading) return;
      openSearch();
    };

    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [isLoading, openSearch, user]);

  useEffect(() => {
    const handleSidebarExpandShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() !== 'e') return;

      event.preventDefault();
      if (!user || isLoading) return;

      // If the sidebar is hidden, show and expand it.
      if (!isVisible) {
        setIsVisible(true);
        setState('expanded');
        setIsExpanded(true);
        return;
      }

      const isHorizontal =
        sidebarPreferences.position === 'top' || sidebarPreferences.position === 'bottom';

      if (state === 'expanded') {
        if (isHorizontal) {
          collapseSidebar();
        } else {
          collapseToRail();
        }
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
      if (!user || isLoading) return;

      // Toggle the compact collapsed square state.
      if (state === 'minimized' && !isExpanded && isVisible) {
        restoreSidebarView();
        return;
      }

      // If hidden, show it first, then collapse to the compact square state.
      if (!isVisible) setIsVisible(true);

      collapseSidebar();
    };

    window.addEventListener('keydown', handleSidebarExpandShortcut);
    window.addEventListener('keydown', handleSidebarCollapseShortcut);
    return () => {
      window.removeEventListener('keydown', handleSidebarExpandShortcut);
      window.removeEventListener('keydown', handleSidebarCollapseShortcut);
    };
  }, [isExpanded, isLoading, setIsExpanded, setState, state, user]);

  useEffect(() => {
    const handleModuleNavigation = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey) return;
      if (!event.altKey) return;
      if (!user || isLoading) return;

      const key = event.code;

      // Module navigation: Cmd/Ctrl+Option/Alt+1 to 5
      if (key === 'Digit1') {
        event.preventDefault();
        void window.desktopWindow?.openModule('dashboard');
        return;
      }

      if (key === 'Digit2') {
        event.preventDefault();
        void window.desktopWindow?.openModule('calendar');
        return;
      }

      if (key === 'Digit3') {
        event.preventDefault();
        void window.desktopWindow?.openModule('notes');
        return;
      }

      if (key === 'Digit4') {
        event.preventDefault();
        void window.desktopWindow?.openModule('projects');
        return;
      }

      if (key === 'Digit5') {
        event.preventDefault();
        void window.desktopWindow?.openModule('settings');
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
  }, [setIsVisible, user]);

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

      const forwardToWorkspaceWindow = window.desktopWindow?.openSearchInWorkspaceWindow;
      if (forwardToWorkspaceWindow) {
        void forwardToWorkspaceWindow()
          .then((wasForwarded) => {
            if (wasForwarded) return;
            if (state !== 'expanded') {
              setState('expanded');
              window.setTimeout(() => openSearch(), 220);
              return;
            }
            openSearch();
          })
          .catch(() => {
            if (state !== 'expanded') {
              setState('expanded');
              window.setTimeout(() => openSearch(), 220);
              return;
            }
            openSearch();
          });
        return;
      }

      if (state !== 'expanded') {
        setState('expanded');
        window.setTimeout(() => openSearch(), 220);
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
  }, [isLoading, isVisible, user]);

  useEffect(() => {
    const handleOpenInvite = (_event: unknown, payload: { token?: string } | string) => {
      const token = String(typeof payload === 'string' ? payload : payload?.token ?? '').trim();
      if (!token) return;

      handledInviteTokenRef.current = null;
      setIsInviteOnboarding(true);
      setPendingInviteToken(token);
      window.history.replaceState({}, '', `/?token=${encodeURIComponent(token)}`);
    };

    window.ipcRenderer?.on('ledger:open-invite', handleOpenInvite);
    return () => {
      window.ipcRenderer?.off('ledger:open-invite', handleOpenInvite);
    };
  }, []);

  useEffect(() => {
    if (!inviteFlowNotice) return;
    if (!user) {
      setInviteFlowNotice(null);
      return;
    }

    if (inviteToastTimerRef.current !== null) {
      window.clearTimeout(inviteToastTimerRef.current);
    }

    const shouldExpandForToast = !isVisible || state !== 'expanded';
    if (shouldExpandForToast) {
      setIsVisible(true);
      setIsExpanded(true);
      setState('expanded');
    }

    inviteToastTimerRef.current = window.setTimeout(
      () => {
        toast.show(inviteFlowNotice, {
          variant: 'success',
          duration: 4500,
        });
        inviteToastTimerRef.current = null;
      },
      shouldExpandForToast ? 260 : 0
    );

    setInviteFlowNotice(null);
  }, [inviteFlowNotice, isVisible, setIsExpanded, setIsVisible, setState, state, toast, user]);

  useEffect(() => {
    return () => {
      if (inviteToastTimerRef.current !== null) {
        window.clearTimeout(inviteToastTimerRef.current);
        inviteToastTimerRef.current = null;
      }
    };
  }, []);

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

  useEffect(() => {
    if (isModuleWindow || isLoading || !user || postAuthStage !== 'ready') return;
    if (ensuredWorkspaceStartPageRef.current) return;
    ensuredWorkspaceStartPageRef.current = true;

    let cancelled = false;
    const ensureWorkspaceStartPage = async () => {
      const state = await window.desktopWindow?.getWorkspaceNavigationState?.().catch(() => null);
      if (cancelled || state?.currentModule) return;
      void window.desktopWindow?.openModule('new-tab', {
        kind: 'new-tab',
        focusContext: `new-tab:${crypto.randomUUID()}`,
      });
    };

    void ensureWorkspaceStartPage();
    return () => {
      cancelled = true;
    };
  }, [isLoading, isModuleWindow, postAuthStage, user]);

  if (isModuleWindow) {
    if (isLoading) {
      return <AuthStatusScreen title="Opening module" subtitle="Bringing it into view…" />;
    }

    if (!user) {
      return (
        <AuthStatusScreen
          title="Sign in required"
          subtitle="Please sign in from the Ledger sidebar window first."
        />
      );
    }

    const renderKeepAliveModule = (key: KeepAliveModuleKey) => {
      switch (key) {
        case 'calendar':
          return <CalendarWindow />;
        case 'circle':
          return <CircleWindow focusContext={activeModuleFocusContext} />;
        case 'notes':
          return <NotesWindow focusContext={activeModuleFocusContext || undefined} />;
        case 'projects':
          return <ProjectsWindow />;
        case 'teams':
          return <TeamsWindow focusContext={activeModuleFocusContext || undefined} />;
        case 'team-settings':
          return <TeamSettingsWindow focusContext={activeModuleFocusContext || undefined} />;
        case 'dashboard':
          return <DashboardContent />;
        case 'notifications':
          return <NotificationCenterWindow />;
        case 'inbox':
          return <IntakeWindow />;
        case 'settings':
          return <SettingsWindow />;
      }
    };

    if (activeKeepAliveModuleKey) {
      const renderedModuleKeys = visitedModuleKeys.includes(activeKeepAliveModuleKey)
        ? visitedModuleKeys
        : [...visitedModuleKeys, activeKeepAliveModuleKey];

      return (
        <div className="relative h-screen w-screen overflow-hidden">
          {renderedModuleKeys.map((key) => (
            <div
              key={key}
              className="h-full w-full"
              style={{ display: key === activeKeepAliveModuleKey ? 'block' : 'none' }}
              aria-hidden={key !== activeKeepAliveModuleKey}
            >
              {renderKeepAliveModule(key)}
            </div>
          ))}
        </div>
      );
    }

    if (isNewTabRoute(workspaceShellRoute)) {
      return <NewTabWindow onClose={() => void window.desktopWindow?.closeModule('new-tab')} />;
    }

    if (
      activeModuleKind === 'quick-follow-up' ||
      activeModuleKind === 'quick-task' ||
      activeModuleKind === 'quick-note' ||
      activeModuleKind === 'quick-event' ||
      activeModuleKind === 'quick-reminder'
    ) {
      return (
        <QuickCaptureWindow
          kind={activeModuleKind}
          context={activeModuleFocusContext || undefined}
        />
      );
    }

    return (
      <div className="flex h-screen items-center justify-center bg-[var(--ledger-background)]">
        <p className="text-sm text-[var(--ledger-text-muted)]">Unknown module</p>
      </div>
    );
  }

  useEffect(() => {
    if (!user) {
      authNativeWindowPinnedRef.current = false;
      setIsAuthWindowReady(false);
    }

    if (user && uiMode !== 'app') {
      setUiMode('app');
      setIsAuthExiting(false);
      setIsAuthWindowReady(false);
      return;
    }

    if (!user && !isLoading && uiMode !== 'auth') {
      setUiMode('auth');
      setIsAuthExiting(false);
      setPostAuthStage('idle');
    }
  }, [user, isLoading, uiMode]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;
    if (user) return;
    if (authNativeWindowPinnedRef.current) return;

    authNativeWindowPinnedRef.current = true;
    let cancelled = false;

    const prepareAuthWindow = async () => {
      await window.desktopWindow?.setMode('auth').catch(() => {
        // No-op outside Electron (browser dev mode)
      });
      await window.desktopWindow?.setVisible(true).catch(() => {
        // No-op outside Electron (browser dev mode)
      });

      window.requestAnimationFrame(() => {
        if (!cancelled) setIsAuthWindowReady(true);
      });
    };

    void prepareAuthWindow();

    return () => {
      cancelled = true;
    };
  }, [isLoading, isModuleWindow, user]);

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
          status?: string;
          invitation?: {
            workspace_id?: string | null;
            workspace_name?: string | null;
          };
        };

        if (cancelled) return;
        setInviteWorkspaceId(payload.invitation?.workspace_id ?? null);
        setInviteWorkspaceName(payload.invitation?.workspace_name ?? 'Workspace');

        if (payload.status === 'accepted') {
          if (!user) {
            setInviteFlowStatus('idle');
            window.history.replaceState({}, '', '/');
            setPendingInviteToken(null);
            return;
          }

          setInviteFlowStatus('accepted');
          setInviteFlowNotice('This invite has already been accepted. Switching workspaces.');
          return;
        }

        if (payload.status === 'expired') {
          setInviteFlowStatus('error');
          setInviteFlowError('Invite unavailable');
          return;
        }

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
  }, [pendingInviteToken, api, user]);

  useEffect(() => {
    if (!pendingInviteToken || !inviteWorkspaceId) return;
    if (inviteFlowStatus !== 'accepted' && inviteFlowStatus !== 'already-member') return;
    if (!user) return;

    let cancelled = false;
    const activateWorkspace = async () => {
      try {
        await refreshWorkspaces();
        if (cancelled) return;
        await setActiveWorkspace(inviteWorkspaceId);
      } catch {
        // Leave the accepted state visible; the workspace can still be selected manually.
      } finally {
        if (cancelled) return;
        window.history.replaceState({}, '', '/');
        setPendingInviteToken(null);
      }
    };

    void activateWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    inviteFlowStatus,
    inviteWorkspaceId,
    pendingInviteToken,
    refreshWorkspaces,
    setActiveWorkspace,
    user,
  ]);

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

    if (
      inviteFlowStatus === 'checking' ||
      inviteFlowStatus === 'error' ||
      inviteFlowStatus === 'accepted' ||
      inviteFlowStatus === 'already-member'
    )
      return;

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
          workspace_id?: string | null;
        };
        await refreshWorkspaces();
        if (payload.workspace_id) {
          await setActiveWorkspace(payload.workspace_id);
        }

        if (cancelled) return;
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
  }, [
    pendingInviteToken,
    isLoading,
    user,
    api,
    refreshWorkspaces,
    inviteFlowStatus,
    setActiveWorkspace,
  ]);

  useEffect(() => {
    if (user) return;

    setInviteFlowNotice(null);
    setInviteFlowError(null);
    if (inviteFlowStatus === 'accepted' || inviteFlowStatus === 'already-member') {
      setInviteFlowStatus('idle');
      window.history.replaceState({}, '', '/');
      setPendingInviteToken(null);
    }
  }, [inviteFlowStatus, user]);

  useEffect(() => {
    if (postAuthStage !== 'onboarding') {
      onboardingResetUserRef.current = null;
      return;
    }

    const currentUserId = user?.id ?? null;
    if (onboardingResetUserRef.current === currentUserId) return;
    onboardingResetUserRef.current = currentUserId;

    setOnboardingStep(isInviteOnboarding ? 'position' : 'welcome');
    setOnboardingWorkspaceType(null);
    setOnboardingWorkspaceId(null);
    setOnboardingInviteEmails([]);
    setOnboardingInviteRole('member');
    setOnboardingWorkspaceName('My Workspace');
    setOnboardingMode('create');
    setOnboardingInviteValue('');
    setOnboardingSidebarPosition('floating');
    setOnboardingError(null);
    setIsSavingOnboarding(false);
  }, [isInviteOnboarding, postAuthStage, user?.id]);

  useEffect(() => {
    const userId = user?.id ?? null;

    if (!userId) {
      postAuthBootstrapUserRef.current = null;
      if (authTransitionTimerRef.current !== null) {
        window.clearTimeout(authTransitionTimerRef.current);
        authTransitionTimerRef.current = null;
      }
      setShowAuthenticatedShell(false);
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

    if (!user || isLoading || postAuthStage !== 'ready') {
      if (authTransitionTimerRef.current !== null) {
        window.clearTimeout(authTransitionTimerRef.current);
        authTransitionTimerRef.current = null;
      }
      setShowAuthenticatedShell(false);
      setIsAuthExiting(false);
      return;
    }

    if (showAuthenticatedShell) return;

    setIsAuthExiting(true);
    if (authTransitionTimerRef.current !== null) {
      window.clearTimeout(authTransitionTimerRef.current);
    }

    authTransitionTimerRef.current = window.setTimeout(() => {
      setShowAuthenticatedShell(true);
      setIsAuthExiting(false);
      authTransitionTimerRef.current = null;
    }, 150);

    return () => {
      if (authTransitionTimerRef.current !== null) {
        window.clearTimeout(authTransitionTimerRef.current);
        authTransitionTimerRef.current = null;
      }
    };
  }, [isLoading, isModuleWindow, postAuthStage, showAuthenticatedShell, user]);

  useEffect(() => {
    if (isModuleWindow) return;
    if (isLoading) return;
    const { opacity: _opacity, ...restPreferences } = sidebarPreferences;
    void window.desktopWindow
      ?.applySidebarPreferences({
        ...restPreferences,
        shellFullscreen: workspaceShellLayout.shellFullscreen,
      })
      .catch(() => {
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
    workspaceShellLayout.shellFullscreen,
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
      !user ||
      effectiveUiMode === 'auth' ||
      postAuthStage === 'idle' ||
      postAuthStage === 'loading' ||
      postAuthStage === 'onboarding';

    const mode: 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen' = isCenteredFlow
      ? 'auth'
      : state === 'expanded'
      ? 'expanded'
      : isExpanded
      ? 'minimized'
      : 'compact';

    if (sidebarModeTimerRef.current !== null) {
      window.clearTimeout(sidebarModeTimerRef.current);
      sidebarModeTimerRef.current = null;
    }

    const applyMode = () => {
      if (sidebarModeRef.current === mode && mode !== 'auth') return;
      sidebarModeRef.current = mode;
      window.desktopWindow?.setMode(mode).catch(() => {
        // No-op outside Electron (browser dev mode)
      });
    };

    const isHorizontalSidebar =
      sidebarPreferences.position === 'top' || sidebarPreferences.position === 'bottom';
    const shouldDelayNativeShrink =
      !isHorizontalSidebar &&
      sidebarModeRef.current === 'expanded' &&
      mode !== 'expanded' &&
      mode !== 'auth';

    if (shouldDelayNativeShrink) {
      sidebarModeTimerRef.current = window.setTimeout(() => {
        applyMode();
        sidebarModeTimerRef.current = null;
      }, 180);
      return () => {
        if (sidebarModeTimerRef.current !== null) {
          window.clearTimeout(sidebarModeTimerRef.current);
          sidebarModeTimerRef.current = null;
        }
      };
    }

    applyMode();
  }, [
    effectiveUiMode,
    isExpanded,
    isLoading,
    postAuthStage,
    sidebarPreferences.position,
    state,
    user,
  ]);

  // Only show the global boot loading state for authenticated users.
  // Unauthenticated flows (login) handle their own prelogin splash to avoid a flash of the preparing loader.
  const shouldShowBootLoading = isLoading && Boolean(user);
  const startupTitle = activeWorkspace?.name ? `Opening ${activeWorkspace.name}` : 'Opening Ledger';
  const startupSubtitle = 'Preparing your workspace…';

  if (shouldShowBootLoading) {
    return <AuthStatusScreen title={startupTitle} subtitle={startupSubtitle} />;
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

  const isDesktopRenderer = Boolean(window.desktopWindow);
  const shouldShowInviteSuccess =
    !isDesktopRenderer &&
    (inviteFlowStatus === 'accepted' || inviteFlowStatus === 'already-member');

  if (shouldShowInviteSuccess) {
    return (
      <InviteSuccessScreen
        workspaceName={inviteWorkspaceName ?? 'workspace'}
        onOpenLedger={() => {
          window.location.assign(buildOpenLedgerUrl(inviteWorkspaceName));
        }}
      />
    );
  }

  // Show login if not authenticated
  if (!user) {
    if (!isAuthWindowReady) {
      return <AuthStatusScreen title="Opening Ledger" subtitle="Preparing sign in." />;
    }

    return (
      <div className="relative h-screen w-screen overflow-hidden bg-transparent">
        <div
          className={`relative z-10 w-full transform transition-all duration-250 ease-out ${
            isAuthExiting
              ? 'opacity-0 scale-95 translate-y-2'
              : 'opacity-100 scale-100 translate-y-0'
          }`}
          style={noDragRegionStyle}
        >
          <LoginForm
            notice={
              pendingInviteToken && inviteFlowStatus === 'awaiting-auth'
                ? `Sign in to accept your ${inviteWorkspaceName ?? 'workspace'} invitation.`
                : null
            }
          />
        </div>
      </div>
    );
  }

  if (postAuthStage === 'idle' || postAuthStage === 'loading') {
    return <AuthStatusScreen title={startupTitle} subtitle={startupSubtitle} />;
  }

  if (postAuthStage === 'onboarding') {
    const completeWorkspaceSetup = async () => {
      if (!user || isSavingOnboarding) return;

      setIsSavingOnboarding(true);
      setOnboardingError(null);

      try {
        if (onboardingMode === 'create') {
          if (!onboardingWorkspaceType) {
            setOnboardingError('Choose a workspace type to continue.');
            return;
          }

          const workspaceName = onboardingWorkspaceName.trim();
          if (!workspaceName) {
            setOnboardingError('Workspace name is required.');
            return;
          }
        } else {
          const token = getInviteTokenFromInput(onboardingInviteValue);
          if (!token) {
            setOnboardingError('Invite code is required.');
            return;
          }

          const acceptedWorkspace = (await api.acceptWorkspaceInvitation(token)) as {
            workspace_id?: string | null;
          };
          setOnboardingWorkspaceId(acceptedWorkspace.workspace_id ?? null);
        }

        await refreshWorkspaces();
        setOnboardingStep(
          onboardingWorkspaceType === 'team' && onboardingMode === 'create'
            ? 'team-invite'
            : 'position'
        );
      } catch (error) {
        setOnboardingError(
          error instanceof Error
            ? error.message
            : onboardingMode === 'create'
            ? 'Could not create workspace.'
            : 'Could not join workspace.'
        );
      } finally {
        setIsSavingOnboarding(false);
      }
    };

    const sendOnboardingInvites = async (
      emails: string[],
      role: 'admin' | 'member'
    ): Promise<string[]> => {
      // Keep invite choices in onboarding state. The workspace is created once,
      // at the final Open Ledger action, before invitations are sent.
      setOnboardingInviteEmails(emails);
      setOnboardingInviteRole(role);
      return [];
    };

    const skipOnboardingInvites = () => {
      setOnboardingError(null);
      setOnboardingStep('position');
    };

    const openLedgerFromOnboarding = async (position: SidebarPosition) => {
      if (isSavingOnboarding) return;

      setIsSavingOnboarding(true);
      setOnboardingError(null);

      try {
        let workspaceId = onboardingWorkspaceId;

        if (onboardingMode === 'create') {
          if (!onboardingWorkspaceType) {
            setOnboardingError('Choose a workspace type to continue.');
            return;
          }

          const workspaceName = onboardingWorkspaceName.trim();
          if (!workspaceName) {
            setOnboardingError('Workspace name is required.');
            return;
          }

          if (workspaceId) {
            await api.updateWorkspace(workspaceId, {
              name: workspaceName,
              is_personal: onboardingWorkspaceType === 'personal',
            });
          } else if (
            activeWorkspaceId &&
            activeWorkspace?.is_personal &&
            activeWorkspace.owner_id === user.id &&
            onboardingWorkspaceType === 'personal'
          ) {
            await api.updateWorkspace(activeWorkspaceId, { name: workspaceName });
            workspaceId = activeWorkspaceId;
          } else {
            const createdWorkspace = (await api.createWorkspace({
              name: workspaceName,
              is_personal: onboardingWorkspaceType === 'personal',
              color: '#FF5F40',
            })) as { workspace_id?: string | null };
            workspaceId = createdWorkspace.workspace_id ?? null;
          }

          setOnboardingWorkspaceId(workspaceId);
        }

        if (
          onboardingWorkspaceType === 'team' &&
          workspaceId &&
          onboardingInviteEmails.length > 0
        ) {
          const results = await Promise.all(
            onboardingInviteEmails.map(async (email) => {
              try {
                await api.createWorkspaceInvitation(workspaceId as string, {
                  email,
                  role: onboardingInviteRole,
                });
                return { email, failed: false };
              } catch {
                return { email, failed: true };
              }
            })
          );
          const failedEmails = results
            .filter((result) => result.failed)
            .map((result) => result.email);

          if (failedEmails.length > 0) {
            toast.show('Some invitations could not be sent', {
              detail: `${failedEmails.join(', ')} can be invited later from Members & access.`,
              variant: 'error',
            });
          }
        }

        setPosition(position);
        saveSidebarPreferences({ ...sidebarPreferences, position });
        await window.desktopWindow?.applySidebarPreferences({ position }).catch(() => undefined);
        await api.completeOnboarding();
        await refreshWorkspaces();
        setPostAuthStage('ready');
      } catch (error) {
        setOnboardingError(error instanceof Error ? error.message : 'Could not open Ledger.');
      } finally {
        setIsSavingOnboarding(false);
      }
    };

    return (
      <OnboardingFlow
        step={onboardingStep}
        mode={onboardingMode}
        workspaceName={onboardingWorkspaceName}
        inviteValue={onboardingInviteValue}
        selectedPosition={onboardingSidebarPosition}
        selectedWorkspaceType={onboardingWorkspaceType}
        isSaving={isSavingOnboarding}
        error={onboardingError}
        onStepChange={(nextStep) => {
          setOnboardingError(null);
          setOnboardingStep(nextStep);
        }}
        onModeChange={(nextMode) => {
          setOnboardingError(null);
          setOnboardingMode(nextMode);
        }}
        onWorkspaceTypeChange={(nextType) => {
          setOnboardingError(null);
          setOnboardingWorkspaceType(nextType);
        }}
        onSkipSetup={() => {
          setOnboardingError(null);
          setOnboardingWorkspaceType('personal');
          setOnboardingMode('create');
          setOnboardingStep('workspace');
        }}
        onInviteSubmit={sendOnboardingInvites}
        onInviteSkip={skipOnboardingInvites}
        onWorkspaceNameChange={(value) => {
          setOnboardingError(null);
          setOnboardingWorkspaceName(value);
        }}
        onInviteValueChange={(value) => {
          setOnboardingError(null);
          setOnboardingInviteValue(value);
        }}
        onPositionChange={setOnboardingSidebarPosition}
        onWorkspaceSubmit={completeWorkspaceSetup}
        onOpenLedger={openLedgerFromOnboarding}
      />
    );
  }

  // Authenticated view - sidebar shell
  if (postAuthStage !== 'ready') {
    return (
      <AuthStatusScreen title={startupTitle} subtitle={startupSubtitle} isExiting={isAuthExiting} />
    );
  }

  if (!showAuthenticatedShell) {
    return (
      <AuthStatusScreen title={startupTitle} subtitle={startupSubtitle} isExiting={isAuthExiting} />
    );
  }

  return (
    <>
      {inviteFlowStatus === 'error' && inviteFlowError && (
        <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-[color:rgba(239,68,68,0.2)] bg-[color:rgba(239,68,68,0.08)] px-4 py-3 text-sm text-[color:#FCA5A5]">
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
  const { user } = useAuthContext();
  const figmaPluginAuthSession = windowParams.get('figmaPluginAuth');
  const figmaPluginAuthCode = windowParams.get('code');
  const mcpAuthSession = windowParams.get('mcpAuth');
  const mcpAuthCode = windowParams.get('code');
  const mcpScopeUpgradeSession = windowParams.get('mcpScopeUpgrade');
  const mcpScopeUpgradeCode = windowParams.get('code');
  const shouldShowNotificationMonitor = Boolean(user) && !isModuleWindow;
  const [isNotificationTrayOpen, setIsNotificationTrayOpen] = useState(false);

  useEffect(() => {
    const handleToggleNotificationTray = () => setIsNotificationTrayOpen((current) => !current);
    window.addEventListener(NOTIFICATION_TRAY_TOGGLE_EVENT, handleToggleNotificationTray);
    return () =>
      window.removeEventListener(NOTIFICATION_TRAY_TOGGLE_EVENT, handleToggleNotificationTray);
  }, []);

  return (
    <SearchProvider>
      <ToastProvider>
        <NotificationCenterProvider>
          {shouldShowNotificationMonitor ? <NotificationMonitor /> : null}
          <AuthSessionToastReset />
          {mcpScopeUpgradeSession && mcpScopeUpgradeCode && user ? <McpScopeUpgradeAuthorizationPage sessionId={mcpScopeUpgradeSession} code={mcpScopeUpgradeCode} /> : mcpAuthSession && mcpAuthCode && user ? <McpAuthorizationPage sessionId={mcpAuthSession} code={mcpAuthCode} /> : figmaPluginAuthSession && figmaPluginAuthCode && user ? <FigmaPluginAuthorizationPage sessionId={figmaPluginAuthSession} code={figmaPluginAuthCode} /> : <AppShell />}
          {user && isModuleWindow ? (
            <NotificationTray
              isOpen={isNotificationTrayOpen}
              onClose={() => setIsNotificationTrayOpen(false)}
            />
          ) : null}
          {isModuleWindow ? <PageFindBar /> : null}
          <SearchModal />
        </NotificationCenterProvider>
      </ToastProvider>
    </SearchProvider>
  );
}

export default App;
