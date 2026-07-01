import {
  ArrowRight,
  Bell,
  CalendarDays,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  Circle,
  Folder,
  FolderKanban,
  Inbox,
  LayoutList,
  Loader2,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { ToastProvider } from './components/Common/ToastProvider';
import { NotificationMonitor } from './components/Common/NotificationMonitor';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from './context/AuthContext';
import { useWorkspaceContext } from './context/WorkspaceContext';
import { useWorkspaceInit } from './hooks/useWorkspaceInit';
import { useWorkspaceRealtimeRefresh } from './hooks/useWorkspaceRealtimeRefresh';
import { useApi } from './hooks/useApi';
import { useSidebar } from './context/SidebarContext';
import { MainLayout } from './components/Common/MainLayout';
import {
  ModuleHeaderActionButton,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from './components/Common/ModuleWindowHeader';
import { CloseGuardModal } from './components/Common/CloseGuardModal';
import { ModalCloseButton } from './components/Common/ModalCloseButton';
import { ModalOverlay } from './components/Common/ModalOverlay';
import LoginForm from './components/Common/LoginForm';
import CalendarWindow from './components/Calendar/CalendarWindow';
import NotesWindow from './components/Notes/NotesWindow';
import ProjectsWindow from './components/Projects/ProjectsWindow';
import TeamsWindow from './components/Teams/TeamsWindow';
import InboxWindow from './components/Inbox/InboxWindow';
import { NotificationCenterWindow } from './components/Notifications/NotificationCenterWindow';
import SettingsWindow from './components/Settings/SettingsWindow';
import { SearchModal } from './components/Search/SearchModal';
import { SearchProvider } from './context/SearchContext';
import { useSearch } from './context/SearchContext';
import { QuickCaptureWindow } from './components/Common/QuickCaptureWindow';
import {
  saveSidebarPreferences,
  type SidebarPosition,
} from './config/sidebarPreferences';
import { useToast } from './components/Common/ToastProvider';

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'ready';
type OnboardingStep = 'welcome' | 'workspace' | 'position';
type OnboardingWorkspaceMode = 'create' | 'join';
type ModuleKind =
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
  | null;

const windowParams = new URLSearchParams(window.location.search);
const isModuleWindow = windowParams.get('window') === 'module';
const moduleKind = (windowParams.get('module') as ModuleKind) ?? null;
const moduleFocusContext = windowParams.get('focusContext')?.trim() ?? '';
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
  queueLabel: 'text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ledger-text-muted)]',
  queuePrimary:
    'rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 py-4',
  queuePrimaryTitle: 'text-sm font-medium text-[var(--ledger-text-primary)]',
  queuePrimaryStatus: 'text-xs font-medium text-[var(--ledger-text-secondary)]',
  queuePrimaryBody: 'text-xs leading-5 text-[var(--ledger-text-muted)]',
  queueSecondaryLine: 'text-xs leading-5 text-[var(--ledger-text-muted)]',
  queueCta:
    'inline-flex items-center justify-center rounded-2xl bg-[var(--ledger-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]',
  queueLink: 'text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]',
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
  chip:
    'whitespace-nowrap rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  chipSelected:
    'whitespace-nowrap rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-primary)]',
  actionLink:
    'inline-flex items-center whitespace-nowrap text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]',
  actionLinkMuted:
    'inline-flex items-center whitespace-nowrap text-xs font-medium text-[var(--ledger-text-muted)] transition',
  hoverRow:
    'transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
};
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
  <div className="flex items-start gap-3 rounded-2xl border px-4 py-3 animate-pulse"
    style={{ backgroundColor: dashboardSkeletonSurface, borderColor: dashboardSkeletonBorder }}>
    <div
      className="mt-0.5 h-5 w-5 shrink-0 rounded-full"
      style={{ backgroundColor: dashboardSkeletonFill }}
    />
    <div className="flex-1 space-y-1.5">
      <div
        className="h-4 rounded w-3/4"
        style={{ backgroundColor: dashboardSkeletonFill }}
      />
      <div
        className="h-3 rounded w-1/2"
        style={{ backgroundColor: dashboardSkeletonFill }}
      />
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

const formatExpiryCounter = (task: {
  due_date?: string | null;
  due_time?: string | null;
}) => {
  if (!task.due_date) return null;

  const dueAt = task.due_time
    ? new Date(`${task.due_date}T${task.due_time.length === 5 ? `${task.due_time}:00` : task.due_time}`)
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

    const parsed = JSON.parse(raw) as
      | { day?: string; items?: CompletedFocusTask[] | null }
      | null;

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
          <h2 className="mt-4 text-[22px] font-medium leading-tight text-[var(--ledger-text-primary)]">{title}</h2>
          <p className="mt-1.5 max-w-[18rem] text-sm leading-6 text-[var(--ledger-text-muted)]">{subtitle}</p>
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
  isSaving,
  error,
  onStepChange,
  onModeChange,
  onWorkspaceNameChange,
  onInviteValueChange,
  onPositionChange,
  onWorkspaceSubmit,
  onOpenLedger,
}: {
  step: OnboardingStep;
  mode: OnboardingWorkspaceMode;
  workspaceName: string;
  inviteValue: string;
  selectedPosition: SidebarPosition;
  isSaving: boolean;
  error: string | null;
  onStepChange: (step: OnboardingStep) => void;
  onModeChange: (mode: OnboardingWorkspaceMode) => void;
  onWorkspaceNameChange: (value: string) => void;
  onInviteValueChange: (value: string) => void;
  onPositionChange: (position: SidebarPosition) => void;
  onWorkspaceSubmit: () => Promise<void>;
  onOpenLedger: (position: SidebarPosition) => Promise<void>;
}) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;

    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener?.('change', updatePreference);
    return () => mediaQuery.removeEventListener?.('change', updatePreference);
  }, []);

  const positionOptions: Array<{ value: SidebarPosition; label: string }> = [
    { value: 'right', label: 'Right' },
    { value: 'left', label: 'Left' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'top', label: 'Top' },
    { value: 'floating', label: 'Floating' },
  ];

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
        style={noDragRegionStyle}
      >
        <div
          className={`w-full transition-all duration-150 ease-out ${
            step === 'welcome' ? 'max-w-4xl' : 'max-w-lg'
          }`}
        >
          {step === 'welcome' ? (
            <div className="grid items-center gap-10 md:grid-cols-[1.18fr_0.82fr]">
              <div className="overflow-hidden rounded-[26px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_24px_70px_rgba(17,24,39,0.2)]">
                {prefersReducedMotion ? (
                  <div className="flex aspect-video items-center justify-center bg-[var(--ledger-background)]">
                    <img src="./logo-color.svg" alt="Ledger" className="h-16 w-16" />
                  </div>
                ) : (
                  <video
                    className="block aspect-video h-full w-full object-cover"
                    src="./onboarding-vid.mp4"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                  />
                )}
              </div>

              <div className="text-center md:text-left">
                <img src="./logo-color.svg" alt="Ledger" className="mx-auto mb-6 h-11 w-11 md:mx-0" />
                <h1 className="text-[34px] font-semibold leading-tight text-[var(--ledger-text-primary)] sm:text-[40px]">
                  Welcome to Ledger
                </h1>
                <p className="mt-3 text-xl text-[var(--ledger-text-secondary)]">Your day, beside your work.</p>
                <p className="mt-4 max-w-sm text-sm leading-6 text-[var(--ledger-text-muted)] md:max-w-none">
                  Capture notes, tasks, events, and follow-ups without leaving your flow.
                </p>
                <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:items-start">
                  <button
                    type="button"
                    onClick={() => onStepChange('workspace')}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-6 text-sm font-semibold text-white shadow-[var(--ledger-shadow-accent)] transition hover:bg-[var(--ledger-accent-hover)]"
                  >
                    Get started
                  </button>
                  <button
                    type="button"
                    onClick={() => onStepChange('workspace')}
                    className="inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 'workspace' ? (
            <div className="mx-auto rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-7 shadow-[0_24px_70px_rgba(17,24,39,0.18)] backdrop-blur-xl">
              <div className="mb-7">
                <img src="./logo-color.svg" alt="Ledger" className="mb-5 h-10 w-10" />
                <h1 className="text-[30px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                  {mode === 'create' ? 'Create your workspace' : 'Join a workspace'}
                </h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-[var(--ledger-text-muted)]">
                  {mode === 'create'
                    ? 'A workspace keeps your notes, projects, calendar, and daily focus together.'
                    : 'Paste an invite code or link to join an existing Ledger workspace.'}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--ledger-text-secondary)]">
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
                  className="h-12 w-full rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-input-background)] px-4 text-[15px] text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-accent)]/10"
                />
              </label>

              <button
                type="button"
                onClick={() => onModeChange(mode === 'create' ? 'join' : 'create')}
                className="mt-3 text-sm font-medium text-[var(--ledger-accent)] transition hover:text-[var(--ledger-accent-hover)]"
              >
                {mode === 'create' ? 'Have an invite? Join a workspace' : 'Back to create a workspace'}
              </button>

              {error ? (
                <div className="mt-5 rounded-2xl border border-[color:rgba(239,68,68,0.2)] bg-[color:rgba(239,68,68,0.08)] px-4 py-3 text-sm text-[color:#FCA5A5]">
                  {error}
                </div>
              ) : null}

              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  void onWorkspaceSubmit();
                }}
                className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ledger-accent)] px-5 text-sm font-semibold text-white shadow-[var(--ledger-shadow-accent)] transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
              >
                {isSaving ? <Loader2 size={17} className="animate-spin" /> : null}
                {isSaving ? (mode === 'create' ? 'Creating...' : 'Joining...') : mode === 'create' ? 'Continue' : 'Join workspace'}
              </button>
            </div>
          ) : null}

          {step === 'position' ? (
            <div className="mx-auto rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-7 shadow-[0_24px_70px_rgba(17,24,39,0.18)] backdrop-blur-xl">
              <div className="mb-7">
                <img src="./logo-color.svg" alt="Ledger" className="mb-5 h-10 w-10" />
                <h1 className="text-[30px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                  Where should Ledger live?
                </h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-[var(--ledger-text-muted)]">
                  Choose a starting position. You can change this anytime.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {positionOptions.map((option) => {
                  const isSelected = selectedPosition === option.value;
                  const isFloating = option.value === 'floating';
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onPositionChange(option.value)}
                      className={`group flex h-20 items-center gap-3 rounded-2xl border px-4 text-left transition ${
                        isFloating ? 'col-span-2' : ''
                      } ${
                        isSelected
                          ? 'border-[color:rgba(255,95,64,0.35)] bg-[color:rgba(255,95,64,0.08)] text-[var(--ledger-text-primary)] shadow-[0_8px_18px_rgba(255,95,64,0.08)]'
                          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)]'
                      }`}
                    >
                      <span className="relative h-9 w-11 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)]">
                        <span
                          className={`absolute rounded-sm bg-[var(--ledger-accent)] ${
                            option.value === 'right'
                              ? 'right-1 top-1 h-7 w-2'
                              : option.value === 'left'
                              ? 'left-1 top-1 h-7 w-2'
                              : option.value === 'top'
                              ? 'left-1 top-1 h-2 w-9'
                              : option.value === 'bottom'
                              ? 'bottom-1 left-1 h-2 w-9'
                              : 'left-1.5 top-1.5 h-6 w-8 rounded-md opacity-95'
                          }`}
                        />
                        {option.value === 'floating' ? (
                          <>
                            <span className="absolute left-2 top-2 h-1 w-1 rounded-full bg-[var(--ledger-surface-card)]/90" />
                            <span className="absolute right-2 top-2 h-1 w-1 rounded-full bg-[var(--ledger-surface-card)]/90" />
                          </>
                        ) : null}
                      </span>
                      <span className="text-sm font-semibold">{option.label}</span>
                    </button>
                  );
                })}
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-[color:rgba(239,68,68,0.2)] bg-[color:rgba(239,68,68,0.08)] px-4 py-3 text-sm text-[color:#FCA5A5]">
                  {error}
                </div>
              ) : null}

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    void onOpenLedger(selectedPosition);
                  }}
                  className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--ledger-accent)] px-5 text-sm font-semibold text-white shadow-[var(--ledger-shadow-accent)] transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
                >
                  {isSaving ? <Loader2 size={17} className="animate-spin" /> : null}
                  {isSaving ? 'Opening...' : 'Open Ledger'}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    onPositionChange('right');
                    void onOpenLedger('right');
                  }}
                  className="inline-flex h-12 items-center justify-center rounded-2xl px-4 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
                >
                  Decide later
                </button>
              </div>
            </div>
          ) : null}
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
function DashboardContent() {
  const { user } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();
  const { setState } = useSidebar();

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
      project_id?: string | null;
      project_name?: string | null;
      workspace_id?: string | null;
      workspace_name?: string | null;
      workspace_color?: string | null;
      calendar_name?: string | null;
      assigned_to?: string | null;
      task_horizon?: 'today' | 'long_term' | null;
      is_today_focus?: boolean;
      show_in_today?: boolean;
      completed_at?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>
  >([]);
  const [workspaceTasks, setWorkspaceTasks] = useState<
    Array<{
      id: string;
      title: string;
      status?: string | null;
      due_date?: string | null;
      due_time?: string | null;
      project_id?: string | null;
      milestone_id?: string | null;
      assigned_to?: string | null;
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
      end_date?: string | null;
    }>
  >([]);
  const [upcoming, setUpcoming] = useState<
    Array<{
      id: string;
      title: string;
      start_at: string;
      end_at: string;
      color?: string;
      workspace_name?: string | null;
      workspace_color?: string | null;
    }>
  >([]);
  const [notes, setNotes] = useState<
    Array<{ id: string; title: string; content: string; updated_at: string }>
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
    }>
  >([]);
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [focusDraftTitle, setFocusDraftTitle] = useState('');
  const [isSavingFocusTask, setIsSavingFocusTask] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [focusActionId, setFocusActionId] = useState<string | null>(null);
  const [completedFocusTasks, setCompletedFocusTasks] = useState<CompletedFocusTask[]>(() =>
    loadCompletedFocusTasks()
  );
  const [isFocusPickerOpen, setIsFocusPickerOpen] = useState(false);
  const [isNewFocusModalOpen, setIsNewFocusModalOpen] = useState(false);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [calendarScope, setCalendarScope] = useState<'current_workspace' | 'all_accessible_workspaces'>(
    'current_workspace'
  );
  const autoExpireTodayTaskIdsRef = useRef<Set<string>>(new Set());
  const workspaceMemberById = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers]
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
  const [overviewTab, setOverviewTab] = useState<'all' | 'assigned' | 'today' | 'projects' | 'notes'>('all');
  const [overviewLayout, setOverviewLayout] = useState<'list' | 'compact'>('list');
  const [isOverviewFilterOpen, setIsOverviewFilterOpen] = useState(false);
  const [isOverviewDisplayOpen, setIsOverviewDisplayOpen] = useState(false);
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
  const dashboardDayRef = useRef(todayKey());
  const handleDashboardWorkspaceRefresh = useCallback(() => {
    setDashboardRefreshToken((current) => current + 1);
  }, []);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: ['notes', 'projects', 'tasks', 'events', 'reminders'],
    enabled: Boolean(user && activeWorkspaceId),
    onChange: handleDashboardWorkspaceRefresh,
  });

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
          preferences?:
            | {
                calendarScope?: 'current_workspace' | 'all_accessible_workspaces';
                showTrayIcon?: boolean;
                runInBackground?: boolean;
              }
            | null;
        };
        if (cancelled) return;
        setCalendarScope(
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
  }, [api, user]);

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
    window.addEventListener('ledger:notifications-summary', handleNotificationsSummary as EventListener);

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
        setNotes([]);
        setFollowUpTasks([]);
        setWorkspaceTasks([]);
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
            api.getUpcomingEvents({ scope: calendarScope }),
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
        const activeReminders =
          todayData.status === 'fulfilled' &&
          Array.isArray((todayData.value as { reminders?: unknown[] } | null)?.reminders)
            ? (todayData.value as { reminders: Array<(typeof todayTasks)[number]> }).reminders
            : [];

        setTodayTasks([
          ...activeToday.map((item) => ({ ...item, kind: 'task' as const })),
          ...activeReminders.map((item) => ({
            ...item,
            kind: 'reminder' as const,
            is_today_focus: false,
            show_in_today: true,
          })),
        ]);

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
                  status?: string | null;
                  workspace_name?: string | null;
                  workspace_color?: string | null;
                }>
              )
                .filter(isUpcomingEventActive)
                .slice(0, 4)
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
                due_date?: string | null;
                due_time?: string | null;
                project_id?: string | null;
                milestone_id?: string | null;
                assigned_to?: string | null;
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
          rawTasks.filter((task) => String(task.status ?? '').toLowerCase() !== 'completed')
        );
        const calendarFollowUps = rawTasks
          .filter((task) => String(task.description ?? '').startsWith('calendar_followup:'))
          .map((task) => {
            const marker = String(task.description ?? '');
            const eventId = marker.startsWith('calendar_followup:')
              ? marker.slice('calendar_followup:'.length).trim()
              : '';
            const noteText = String(task.notes ?? '');
            const noteTitle = noteText.startsWith('Follow-up from calendar: ')
              ? noteText
                  .slice('Follow-up from calendar: '.length)
                  .split(/\r?\n/, 1)[0]
                  .trim()
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
        const failedSections = [
          dailyData.status === 'rejected' ? 'daily check-in' : null,
          todayData.status === 'rejected' ? 'today feed' : null,
          projectData.status === 'rejected' ? 'projects' : null,
          upcomingData.status === 'rejected' ? 'upcoming events' : null,
          noteData.status === 'rejected' ? 'notes' : null,
          taskData.status === 'rejected' ? 'follow-ups' : null,
        ].filter(Boolean);

        if (failedSections.length > 0 && isInitialLoad) {
          setDashboardError(`Some overview sections could not load: ${failedSections.join(', ')}.`);
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
  }, [activeWorkspaceId, api, calendarScope, dashboardRefreshToken, user]);

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
  const reminderFocusTasks = todayTasks.filter(
    (task) => task.kind === 'reminder' && !task.is_today_focus
  );
  const focusTasksForDisplay = focusTasks.length > 0 ? focusTasks : reminderFocusTasks.slice(0, 1);
  const recentNotes = notes;
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
      ...active.map((item) => ({ ...item, kind: 'task' as const })),
      ...reminders.map((item) => ({
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

  const createNewFocusTask = async () => {
    const title = focusDraftTitle.trim();
    if (!title || isSavingFocusTask || focusTasks.length >= 3) return;

    const tempId = `focus-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dueDate = todayKey();
    const optimisticTask = {
      id: tempId,
      title,
      status: 'todo',
      due_date: dueDate,
      show_in_today: true,
      is_today_focus: true,
      task_horizon: 'today' as const,
      created_at: new Date().toISOString(),
      ...getWorkspaceTaskMetadata(),
    };
    setTodayTasks((prev) => [optimisticTask, ...prev]);
    setIsSavingFocusTask(true);
    try {
      const created = await api.createTask({
        title,
        status: 'todo',
        show_in_today: true,
        is_today_focus: true,
        due_date: dueDate,
        task_horizon: 'today',
      });
      if (created && typeof created === 'object') {
        const createdTask = created as { id?: string; workspace_id?: string | null; workspace_name?: string | null; workspace_color?: string | null };
        const createdId = createdTask.id ?? tempId;
        setTodayTasks((prev) => [
          {
            ...optimisticTask,
            ...createdTask,
            id: createdId,
            ...getWorkspaceTaskMetadata(),
          },
          ...prev.filter((item) => item.id !== tempId && item.id !== createdId),
        ]);
      }
      setFocusDraftTitle('');
      setIsNewFocusModalOpen(false);
      await refreshTodayTasks();
    } catch (error) {
      setTodayTasks((prev) => prev.filter((item) => item.id !== tempId));
      setDashboardError(error instanceof Error ? error.message : 'Could not create task.');
    } finally {
      setIsSavingFocusTask(false);
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
            (item) =>
              item.id !== restoredTask.id && (clientId ? item.client_id !== clientId : true)
          ),
        ]);
        return;
      }

      setTodayTasks((prev) =>
        prev.filter((item) => item.id !== detail.task?.id && (clientId ? item.client_id !== clientId : true))
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

  type OverviewActionRowKind = 'task' | 'reminder' | 'project' | 'note' | 'event' | 'milestone' | 'capture';

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
        await api.updateReminder(row.sourceId, { is_done: true });
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
    if (row.kind !== 'task') return;

    const target = findOverviewTaskTarget(row.sourceId);
    if (!target || target.kind !== 'task') return;

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
      if (target.workspace_id) {
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

  type OverviewRow = {
    id: string;
    sourceId: string;
    kind: 'task' | 'reminder' | 'project' | 'note' | 'event' | 'milestone' | 'capture';
    title: string;
    meta: string;
    chips: string[];
    dateLabel?: string;
    group: string;
    icon: ReactNode;
    accent?: string;
    progress?: number;
    assignee?: {
      initials: string;
      name: string;
    };
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

  const projectStatusLabel = (statusValue: string) => {
    const status = String(statusValue ?? '').toLowerCase();
    if (status.includes('complete')) return 'Completed';
    if (status.includes('pause')) return 'Paused';
    if (status.includes('progress')) return 'In progress';
    return 'Not started';
  };

  const getMemberInitials = (name: string) => {
    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  };

  const buildTaskRow = (
    task: (typeof todayTasks)[number],
    group: string,
    chips: string[] = []
  ): OverviewRow => {
    const dueLabel = formatShortDate(task.due_date);
    const timeLabel = task.due_time || formatTime(task.remind_at);
    const isReminder = task.kind === 'reminder';
    const assignedMember = task.assigned_to ? workspaceMemberById.get(task.assigned_to) ?? null : null;
    const assigneeName = assignedMember?.full_name?.trim() || assignedMember?.email?.trim() || '';
    return {
      id: `${group}:${task.id}`,
      sourceId: task.id,
      kind: isReminder ? 'reminder' : 'task',
      title: task.title,
      meta: [task.project_name || task.workspace_name || activeWorkspace?.name || 'Workspace', dueLabel ? `Due ${dueLabel}` : timeLabel]
        .filter(Boolean)
        .join(' · '),
      chips:
        chips.length > 0
          ? chips
          : [
              isReminder
                ? 'Reminder'
                : task.is_today_focus
                  ? 'Focus'
                  : task.task_horizon === 'long_term'
                    ? 'Long-term'
                    : 'Short-term',
            ],
      dateLabel: timeLabel || dueLabel || undefined,
      group,
      icon: isReminder ? <Bell size={13} /> : <Circle size={13} />,
      accent: isReminder ? 'var(--ledger-accent)' : undefined,
      assignee: assigneeName
        ? {
            initials: getMemberInitials(assigneeName),
            name: assigneeName,
          }
        : undefined,
      open: () => {
        if (isReminder) openModule('calendar');
        else void addTodayTaskToFocus(task.id);
      },
    };
  };

  const projectRows = attentionProjects.map<OverviewRow>((project) => {
    const dueLabel = formatShortDate(project.end_date);
    const progress = Math.max(0, Math.min(100, Number(project.completeness ?? 0)));
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
      dateLabel: dueLabel ? `Due ${dueLabel}` : undefined,
      group: 'Active projects',
      icon: <FolderKanban size={13} />,
      accent: 'var(--ledger-accent)',
      progress,
      open: () =>
        openModule('projects', {
          kind: 'projects',
          focusProjectId: project.id,
        }),
    };
  });

  const longTermTaskRows = workspaceTasks
    .filter((task) => task.task_horizon === 'long_term')
    .slice(0, 8)
    .map<OverviewRow>((task) => buildTaskRow(task as (typeof todayTasks)[number], 'Long-term tasks', ['Long-term']));

  const noteRows = recentNotes.slice(0, 6).map<OverviewRow>((note) => ({
    id: `Recent notes:${note.id}`,
    sourceId: note.id,
    kind: 'note',
    title: note.title || 'Untitled note',
    meta: ['Regular note', activeWorkspace?.name || 'Workspace', `${formatShortDate(note.updated_at) ?? 'Recently'}`]
      .filter(Boolean)
      .join(' · '),
    chips: htmlToPlainText(note.content).length > 0 ? ['Linked'] : ['Draft'],
    dateLabel: formatShortDate(note.updated_at) ?? undefined,
    group: 'Recent notes',
    icon: <StickyNote size={13} />,
    open: () => openModule('notes', { kind: 'notes', focusNoteId: note.id }),
  }));

  const eventRows = upcoming.slice(0, 6).map<OverviewRow>((event) => {
    const start = new Date(event.start_at);
    const isToday = start.toDateString() === new Date().toDateString();
    const dayLabel = isToday ? 'Today' : formatShortDate(event.start_at);
    const timeLabel = formatTime(event.start_at);
    return {
      id: `${isToday ? 'Today' : 'Upcoming'}:${event.id}`,
      sourceId: event.id,
      kind: 'event',
      title: event.title,
      meta: ['Event', timeLabel, calendarScope === 'all_accessible_workspaces' ? event.workspace_name : null]
        .filter(Boolean)
        .join(' · '),
      chips: [isToday ? 'Today' : 'Upcoming', isToday ? 'Meeting' : 'Event'],
      dateLabel: dayLabel ?? undefined,
      group: isToday ? 'Today' : 'Upcoming',
      icon: <CalendarDays size={13} />,
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
      meta: [task.eventTitle || 'Meeting follow-up', 'Action', formatShortDate(task.updated_at) ?? 'Recent']
        .filter(Boolean)
        .join(' · '),
      chips: ['Follow-up'],
      dateLabel: formatShortDate(task.updated_at) ?? undefined,
      group: 'Needs attention',
      icon: <CircleAlert size={13} />,
      open: () => openFollowUpEvent(task.id),
    }));

  const overviewRows: OverviewRow[] = [
    ...focusTasksForDisplay.map((task) => buildTaskRow(task, 'Needs attention', ['Focus'])),
    ...followUpRows,
    ...activeTodayTasks.slice(0, 6).map((task) => buildTaskRow(task, 'Today')),
    ...longTermTaskRows,
    ...todayTasks
      .filter((task) => task.assigned_to || task.project_name)
      .slice(0, 4)
      .map((task) => buildTaskRow(task, 'Assigned to me', ['Assigned'])),
    ...projectRows,
    ...noteRows,
    ...eventRows.filter((row) => row.group === 'Upcoming'),
  ];

  const visibleOverviewRows = overviewRows.filter((row) => {
    if (overviewTab === 'projects') return row.kind === 'project';
    if (overviewTab === 'notes') return row.kind === 'note';
    if (overviewTab === 'today') return row.group === 'Today';
    if (overviewTab === 'assigned') return row.group === 'Assigned to me';
    return true;
  });

  const overviewGroups = [
    'Needs attention',
    'Today',
    'Long-term tasks',
    'Assigned to me',
    'Active projects',
    'Recent notes',
    'Upcoming',
  ]
    .map((group) => ({
      id: group,
      label: group,
      rows: visibleOverviewRows.filter((row) => row.group === group),
    }))
    .filter((group) => group.rows.length > 0);

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
        icon: <Circle size={15} />,
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
      ? 'Action'
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
            ['Type', selectedOverviewTypeLabel],
            ['Status', selectedOverviewRow.kind === 'note' ? 'Recent note' : selectedOverviewRow.group],
            ['Workspace', activeWorkspace?.name ?? 'Workspace'],
            ['Date', selectedOverviewRow.dateLabel ?? 'Not set'],
          ],
        },
        {
          title: selectedOverviewRow.kind === 'project' ? 'Project context' : 'Linked context',
          rows:
            selectedOverviewRow.kind === 'project'
              ? [
                  ['Progress', typeof selectedOverviewRow.progress === 'number' ? `${selectedOverviewRow.progress}%` : 'Not set'],
                  ['Active actions', selectedOverviewRow.chips.includes('Near done') ? '2' : '0'],
                  ['Milestones', '0'],
                  ['Recent notes', '0'],
                ]
              : selectedOverviewRow.kind === 'task' || selectedOverviewRow.kind === 'reminder'
                ? [
                    ['Project', selectedOverviewRow.meta.split(' · ')[0] || 'None'],
                    ['Priority', selectedOverviewRow.chips.includes('Focus') ? 'Focus' : 'None'],
                    ['Assignee', 'Lex'],
                  ]
                : [
                    ['Project', 'None'],
                    ['Actions', '0'],
                    ['Milestones', '0'],
                  ],
        },
      ]
    : [];

  const openSelectedOverviewRow = () => {
    selectedOverviewRow?.open();
  };

  const selectedOverviewQuickActions = selectedOverviewRow
    ? [
        {
          label: selectedOverviewRow.kind === 'project' ? 'Open project' : selectedOverviewRow.kind === 'note' ? 'Open note' : 'Open',
          icon: <ArrowRight size={13} />,
          action: openSelectedOverviewRow,
          disabled: false,
        },
        ...(selectedOverviewRow.kind === 'task' || selectedOverviewRow.kind === 'reminder'
          ? [
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
              {
                label: 'Move to today',
                icon: <CalendarDays size={13} />,
                action: () =>
                  void moveOverviewRowToToday({
                    kind: selectedOverviewRow.kind,
                    sourceId: selectedOverviewRow.sourceId,
                  }),
                disabled: selectedOverviewRow.kind === 'reminder',
              },
              {
                label: 'Change due date',
                icon: <CalendarDays size={13} />,
                action: () => undefined,
                disabled: true,
              },
            ]
          : selectedOverviewRow.kind === 'project'
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
                    action: () => undefined,
                    disabled: true,
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOverviewFilterOpen || isOverviewDisplayOpen || isFocusPickerOpen || isNewFocusModalOpen) {
        if (event.key === 'Escape') {
          setIsOverviewFilterOpen(false);
          setIsOverviewDisplayOpen(false);
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
    isNewFocusModalOpen,
    isOverviewDisplayOpen,
    isOverviewFilterOpen,
    selectedOverviewRow,
    selectedOverviewRowId,
    visibleOverviewRows,
  ]);

  const attemptCloseDashboard = () => {
    const hasUnsaved = focusDraftTitle.trim().length > 0;
    if (isSavingFocusTask || hasUnsaved) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('dashboard');
  };
  const isDashboardModalOpen = isFocusPickerOpen || isNewFocusModalOpen || showCloseGuardModal;

  return (
    <div className={dashboardTheme.shell} style={{ scrollbarGutter: isDashboardModalOpen ? 'auto' : 'stable' }}>
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
        title={activeWorkspace?.name ?? 'My Work'}
        subtitle={
          activeWorkspace
            ? activeWorkspace.is_personal
              ? 'Personal workspace'
              : activeWorkspace.role
            : 'Workspace overview'
        }
        icon={<img src="./logo-color.svg" alt="" className="h-5 w-5" />}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={12} />}
              count={inboxCount}
              onClick={() => window.desktopWindow?.openModule('inbox')}
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
          <>
            {[
              {
                label: 'Task',
                action: () => window.desktopWindow?.toggleModule('quick-task' as any),
              },
              {
                label: 'Note',
                action: () => window.desktopWindow?.toggleModule('quick-note' as any),
              },
              {
                label: 'Event',
                action: () => window.desktopWindow?.toggleModule('quick-event' as any),
              },
              {
                label: 'Project',
                action: () =>
                  window.desktopWindow?.toggleModule('projects', {
                    kind: 'projects',
                    focusProjectId: '__new__',
                  }),
              },
            ].map(({ label, action }) => (
              <ModuleHeaderActionButton
                key={label}
                onClick={() => void action()}
                title={`Create ${label.toLowerCase()}`}
              >
                <Plus size={12} />
                {label}
              </ModuleHeaderActionButton>
            ))}
          </>
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
      />

      <div
        className={`flex-1 min-h-0 overflow-auto ${dashboardTheme.content} px-6 py-8`}
        style={{ scrollbarGutter: isDashboardModalOpen ? 'auto' : 'stable' }}
      >
        <div className="flex h-full min-h-[720px] w-full flex-col rounded-[18px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_18px_44px_rgba(66,42,24,0.06)]">
          <header className="flex flex-col gap-3 border-b border-[color:var(--ledger-border-subtle)] px-5 py-3.5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[12px] font-medium text-[var(--ledger-text-muted)]">
                {activeWorkspace?.name ?? 'Workspace'} › Overview
              </p>
              <h2 className="text-[24px] font-semibold text-[var(--ledger-text-primary)]">
                Workspace overview
              </h2>
              <p className="text-[13px] text-[var(--ledger-text-muted)]">
                Everything happening across {activeWorkspace?.name ?? 'this workspace'}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-0.5">
                {[
                  ['all', 'All'],
                  ['assigned', 'Assigned'],
                  ['today', 'Today'],
                  ['projects', 'Projects'],
                  ['notes', 'Notes'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOverviewTab(id as typeof overviewTab)}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                      overviewTab === id
                        ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-sm'
                        : 'text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsOverviewFilterOpen((current) => !current);
                    setIsOverviewDisplayOpen(false);
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <SlidersHorizontal size={13} />
                  Filter
                </button>
                {isOverviewFilterOpen && (
                  <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2 shadow-[var(--ledger-shadow)]">
                    {['Type', 'Status', 'Project', 'Due date', 'Assignee', 'Priority', 'Workspace', 'Completed'].map(
                      (item) => (
                        <button
                          key={item}
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                        >
                          {item}
                          <ChevronRight size={13} className="text-[var(--ledger-text-muted)]" />
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsOverviewDisplayOpen((current) => !current);
                    setIsOverviewFilterOpen(false);
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <LayoutList size={13} />
                  Display
                </button>
                {isOverviewDisplayOpen && (
                  <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2 shadow-[var(--ledger-shadow)]">
                    <p className="px-3 py-1.5 text-[11px] font-medium text-[var(--ledger-text-muted)]">Layout</p>
                    {['List', 'Compact list'].map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setOverviewLayout(item === 'List' ? 'list' : 'compact')}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        {item}
                        {overviewLayout === (item === 'List' ? 'list' : 'compact') && <CheckCircle2 size={13} />}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                    <p className="px-3 py-1.5 text-[11px] font-medium text-[var(--ledger-text-muted)]">Group by</p>
                    {['None', 'Status', 'Type', 'Project', 'Due date', 'Assignee'].map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        {item}
                        <ChevronRight size={13} className="text-[var(--ledger-text-muted)]" />
                      </button>
                    ))}
                    <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                    <p className="px-3 py-1.5 text-[11px] font-medium text-[var(--ledger-text-muted)]">Properties</p>
                    <div className="grid grid-cols-2 gap-1 px-1 pb-1">
                      {['Priority', 'Project', 'Due date', 'Assignee', 'Members', 'Progress', 'Linked notes', 'Updated'].map(
                        (item) => (
                          <span
                            key={item}
                            className="rounded-lg px-2 py-1 text-[12px] text-[var(--ledger-text-muted)]"
                          >
                            {item}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsNewFocusModalOpen(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--ledger-accent)] px-3 text-[12px] font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]"
              >
                <Plus size={13} />
                New
              </button>
            </div>
          </header>

          {dashboardError && (
            <div className="mx-5 mt-4 rounded-2xl border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] px-4 py-3 text-sm text-[var(--ledger-danger)]">
              {dashboardError}
            </div>
          )}

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
            <main className="flex min-h-0 min-w-0 flex-col overflow-auto px-3 py-3">
              {isLoadingDashboard ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <DashboardSkeletonTaskItem key={i} />
                  ))}
                </div>
              ) : visibleOverviewRows.length === 0 ? (
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
              ) : (
                <div className="space-y-1.5">
                  {overviewGroups.map((group) => {
                    const isCollapsed = collapsedOverviewGroups.has(group.id);
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
                          <button
                            type="button"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (group.id === 'Active projects') {
                                openModule('projects', { kind: 'projects', focusProjectId: '__new__' });
                              } else {
                                setIsNewFocusModalOpen(true);
                              }
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] select-none"
                            title={`Create item in ${group.label}`}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                        {!isCollapsed && (
                        <div className="space-y-1 pb-1 pt-1">
                            {group.rows.map((row) => {
                              const isSelected = selectedOverviewRow?.id === row.id;
                              return (
                                <button
                                  key={row.id}
                                  type="button"
                                  onClick={() => setSelectedOverviewRowId(row.id)}
                                  onDoubleClick={() => row.open()}
                                  onContextMenu={(event) =>
                                    openContextMenu(event, {
                                      type: 'overview-row',
                                      rowId: row.id,
                                      rowKind: row.kind,
                                      sourceId: row.sourceId,
                                    })
                                  }
                                  className={`group grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 text-left transition ${
                                    overviewLayout === 'compact' ? 'min-h-9 py-1' : 'min-h-10 py-1.5'
                                  } ${
                                    isSelected
                                      ? 'rounded-lg bg-[var(--ledger-surface-muted)]'
                                      : 'hover:rounded-lg hover:bg-[var(--ledger-surface-muted)]'
                                  }`}
                                >
                                  <span
                                    className="flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[13px] text-[var(--ledger-text-secondary)]"
                                  >
                                    {row.icon}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
                                      {row.title}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
                                      {row.chips.slice(0, 2).map((chip) => (
                                        <span
                                          key={chip}
                                          className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-0.5 text-[10px] leading-none text-[var(--ledger-text-muted)]"
                                        >
                                          {chip}
                                        </span>
                                      ))}
                                    </span>
                                    <span className="hidden max-w-80 truncate text-[11px] leading-4 text-[var(--ledger-text-muted)] md:inline">
                                      {row.meta}
                                    </span>
                                    {typeof row.progress === 'number' && (
                                      <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)] lg:block">
                                        <span
                                          className="block h-full rounded-full bg-[var(--ledger-accent)]"
                                          style={{ width: `${row.progress}%` }}
                                        />
                                      </span>
                                    )}
                                    {row.assignee && (
                                      <span
                                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[9px] font-semibold tracking-normal text-[var(--ledger-text-secondary)]"
                                        title={row.assignee.name}
                                        aria-label={row.assignee.name}
                                      >
                                        {row.assignee.initials}
                                      </span>
                                    )}
                                    {row.dateLabel && (
                                      <span className="hidden text-[11px] text-[var(--ledger-text-muted)] md:inline">
                                        {row.dateLabel}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
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
                                </button>
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

            <aside className="min-h-0 border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]/35 p-5 lg:border-l lg:border-t-0">
              <div className="flex h-full min-h-0 flex-col space-y-5 overflow-y-auto pr-1">
                {!selectedOverviewRow ? (
                  <>
                    <div>
                      <p className="text-[12px] font-medium text-[var(--ledger-text-muted)]">{todayLabel}</p>
                      <h3 className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]">
                        {activeWorkspace?.name ?? 'Workspace'}
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {[
                        ['Today', `${Math.max(0, completedFocusTasks.length)}/${Math.max(1, todayTasks.length)} complete`],
                        ['Long-term', `${workspaceTasks.filter((task) => task.task_horizon === 'long_term').length} tasks`],
                        ['Assigned to me', `${todayTasks.filter((task) => task.assigned_to || task.project_name).length} tasks`],
                        ['Active projects', `${attentionProjects.length} active`],
                        ['Upcoming', `${upcoming.length} events`],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] py-2"
                        >
                          <span className="text-[12px] text-[var(--ledger-text-muted)]">{label}</span>
                          <span className="text-[13px] font-medium text-[var(--ledger-text-primary)]">{value}</span>
                        </div>
                      ))}
                    </div>
                    {recentNotes[0] && (
                      <div className="border-t border-[color:var(--ledger-border-subtle)] pt-4">
                        <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Recent note</p>
                        <p className="mt-1 truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
                          {recentNotes[0].title}
                        </p>
                        <p className="mt-1 text-[12px] text-[var(--ledger-text-muted)]">2 actions created</p>
                      </div>
                    )}
                    <div className="pt-4">
                      <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Try next</p>
                      <p className="mt-1 text-[13px] font-medium text-[var(--ledger-text-primary)]">Connect calendar</p>
                      <p className="mt-1 text-[12px] leading-5 text-[var(--ledger-text-muted)]">
                        Turn meetings into notes and actions.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="border-b border-[color:var(--ledger-border-subtle)] pb-4">
                      <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                        {selectedOverviewTypeLabel}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold leading-6 text-[var(--ledger-text-primary)]">
                        {selectedOverviewRow.title}
                      </h3>
                      <p className="mt-1 text-[12px] leading-5 text-[var(--ledger-text-muted)]">
                        {selectedOverviewRow.meta}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {selectedOverviewRow.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-0.5 text-[11px] text-[var(--ledger-text-secondary)]"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>

                    {overviewDetailSections.map((section) => (
                      <section key={section.title} className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                        <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">{section.title}</p>
                        <div className="space-y-1">
                          {section.rows.map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-4 rounded-lg px-1 py-1.5"
                            >
                              <span className="text-[12px] text-[var(--ledger-text-muted)]">{label}</span>
                              <span className="max-w-44 truncate text-right text-[13px] font-medium capitalize text-[var(--ledger-text-primary)]">
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}

                    <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                      <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Quick actions</p>
                      <div className="space-y-1">
                        {selectedOverviewQuickActions.map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            onClick={() => action.action()}
                            disabled={action.disabled}
                            className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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
        isOpen={isFocusPickerOpen}
        onClose={() => setIsFocusPickerOpen(false)}
        classNameContainer="w-full max-w-xl rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
            Add from Today
          </p>
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
                    <p className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">{task.title}</p>
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
        isOpen={isNewFocusModalOpen}
        onClose={() => {
          setIsNewFocusModalOpen(false);
          setFocusDraftTitle('');
        }}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">New focus</p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Create a new priority and keep it in Today.
            </p>
          </div>
          <ModalCloseButton
            onClick={() => {
              setIsNewFocusModalOpen(false);
              setFocusDraftTitle('');
            }}
            ariaLabel="Close new focus modal"
          />
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
            className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />
          <p className="text-sm text-[var(--ledger-text-secondary)]">
            This creates a Today task and marks it as a focus priority.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setIsNewFocusModalOpen(false);
              setFocusDraftTitle('');
            }}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void createNewFocusTask()}
            disabled={!focusDraftTitle.trim() || isSavingFocusTask || focusTasks.length >= 3}
            className="rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
          >
            Add focus
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
            {dashboardContextMenu.type === 'overview-row' && (() => {
              const row = overviewRows.find((item) => item.id === dashboardContextMenu.rowId);
              if (!row) return null;
              const isFollowUpTask = followUpTasks.some((task) => task.id === row.sourceId);
              const deleteRow = () => {
                if (row.kind === 'project') void deleteDashboardProject(row.sourceId);
                else if (row.kind === 'note') void deleteDashboardNote(row.sourceId);
                else if (row.kind === 'event') void deleteTimelineEvent(row.sourceId);
                else if (isFollowUpTask) void deleteFollowUp(row.sourceId);
                else void deleteOverviewRow({ kind: row.kind, sourceId: row.sourceId });
              };
              const markDone = () => {
                if (row.kind === 'task' || row.kind === 'reminder') {
                  void completeOverviewRow({ kind: row.kind, sourceId: row.sourceId });
                } else if (isFollowUpTask) {
                  void markFollowUpDone(row.sourceId);
                } else {
                  setDashboardContextMenu(null);
                }
              };
              const moveToToday = () => {
                if (row.kind === 'task' || row.kind === 'reminder') {
                  void moveOverviewRowToToday({ kind: row.kind, sourceId: row.sourceId });
                } else {
                  setDashboardContextMenu(null);
                }
              };
              return (
                <>
                  <button
                    onClick={() => {
                      row.open();
                      setDashboardContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <ArrowRight size={14} />
                    Open
                  </button>
                  <button
                    onClick={() => {
                      row.open();
                      setDashboardContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <Folder size={14} />
                    Open in new panel
                  </button>
                  {(row.kind === 'task' || row.kind === 'reminder') && (
                    <>
                      <button
                        onClick={markDone}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <CheckCircle2 size={14} />
                        Mark complete
                      </button>
                      <button
                        onClick={moveToToday}
                        disabled={row.kind === 'reminder'}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <Circle size={14} />
                        Move to Today
                      </button>
                    </>
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
                      disabled
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-muted)] opacity-60"
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
                    {row.kind === 'note' || row.kind === 'project' || row.kind === 'event' ? 'Archive' : 'Delete'}
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
  const [inviteFlowStatus, setInviteFlowStatus] = useState<
    'idle' | 'checking' | 'awaiting-auth' | 'processing' | 'accepted' | 'already-member' | 'error'
  >('idle');
  const [inviteFlowError, setInviteFlowError] = useState<string | null>(null);
  const [inviteFlowNotice, setInviteFlowNotice] = useState<string | null>(null);
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState<string | null>(null);
  const [inviteWorkspaceName, setInviteWorkspaceName] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('welcome');
  const [onboardingWorkspaceName, setOnboardingWorkspaceName] = useState('My Workspace');
  const [onboardingMode, setOnboardingMode] = useState<OnboardingWorkspaceMode>('create');
  const [onboardingInviteValue, setOnboardingInviteValue] = useState('');
  const [onboardingSidebarPosition, setOnboardingSidebarPosition] =
    useState<SidebarPosition>('right');
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const onboardingResetUserRef = useRef<string | null>(null);
  const handledInviteTokenRef = useRef<string | null>(null);
  const postAuthBootstrapUserRef = useRef<string | null>(null);
  const ensuredVisibleOnBootRef = useRef(false);
  const authTransitionTimerRef = useRef<number | null>(null);
  const sidebarModeRef = useRef<'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen' | null>(
    null
  );
  const sidebarModeTimerRef = useRef<number | null>(null);
  const inviteToastTimerRef = useRef<number | null>(null);
  const [showAuthenticatedShell, setShowAuthenticatedShell] = useState(false);
  const [isAuthWindowReady, setIsAuthWindowReady] = useState(!window.desktopWindow);
  const authNativeWindowPinnedRef = useRef(false);

  // Initialize workspace for authenticated users
  useWorkspaceInit();
  const effectiveUiMode: 'auth' | 'app' = user ? 'app' : uiMode;

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
      if (!user || isLoading) return;

      // If the sidebar is hidden, show and expand it.
      if (!isVisible) {
        setIsVisible(true);
        setState('expanded');
        setIsExpanded(true);
        return;
      }

      const isHorizontal = sidebarPreferences.position === 'top' || sidebarPreferences.position === 'bottom';

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
        void window.desktopWindow?.openModule('calendar');
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
  }, [isLoading, isVisible, user]);

  useEffect(() => {
    const handleOpenInvite = (_event: unknown, payload: { token?: string } | string) => {
      const token = String(typeof payload === 'string' ? payload : payload?.token ?? '').trim();
      if (!token) return;

      handledInviteTokenRef.current = null;
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

  if (isModuleWindow) {
    if (isLoading) {
      return (
        <AuthStatusScreen title="Opening module" subtitle="Bringing it into view…" />
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

    if (moduleKind === 'teams') {
      return <TeamsWindow />;
    }

    if (moduleKind === 'dashboard') {
      return <DashboardContent />;
    }

    if (moduleKind === 'notifications') {
      return <NotificationCenterWindow />;
    }

    if (moduleKind === 'inbox') {
      return <InboxWindow />;
    }

    if (moduleKind === 'settings') {
      return <SettingsWindow />;
    }

    if (
      moduleKind === 'quick-follow-up' ||
      moduleKind === 'quick-task' ||
      moduleKind === 'quick-note' ||
      moduleKind === 'quick-event'
    ) {
      return <QuickCaptureWindow kind={moduleKind} context={moduleFocusContext || undefined} />;
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
  }, [pendingInviteToken, isLoading, user, api, refreshWorkspaces, inviteFlowStatus, setActiveWorkspace]);

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

    setOnboardingStep('welcome');
    setOnboardingWorkspaceName('My Workspace');
    setOnboardingMode('create');
    setOnboardingInviteValue('');
    setOnboardingSidebarPosition('right');
    setOnboardingError(null);
    setIsSavingOnboarding(false);
  }, [postAuthStage, user?.id]);

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
    return (
      <AuthStatusScreen
        title={startupTitle}
        subtitle={startupSubtitle}
      />
    );
  }

  if (postAuthStage === 'onboarding') {
    const completeWorkspaceSetup = async () => {
      if (!user || isSavingOnboarding) return;

      setIsSavingOnboarding(true);
      setOnboardingError(null);

      try {
        if (onboardingMode === 'create') {
          const workspaceName = onboardingWorkspaceName.trim();
          if (!workspaceName) {
            setOnboardingError('Workspace name is required.');
            return;
          }

          if (activeWorkspaceId && activeWorkspace?.is_personal && activeWorkspace.owner_id === user.id) {
            await api.updateWorkspace(activeWorkspaceId, { name: workspaceName });
          } else {
            await api.createWorkspace({
              name: workspaceName,
              is_personal: true,
              color: '#FF5F40',
            });
          }
        } else {
          const token = getInviteTokenFromInput(onboardingInviteValue);
          if (!token) {
            setOnboardingError('Invite code is required.');
            return;
          }

          await api.acceptWorkspaceInvitation(token);
        }

        await refreshWorkspaces();
        setOnboardingStep('position');
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

    const openLedgerFromOnboarding = async (position: SidebarPosition) => {
      if (isSavingOnboarding) return;

      setIsSavingOnboarding(true);
      setOnboardingError(null);

      try {
        setPosition(position);
        saveSidebarPreferences({ ...sidebarPreferences, position });
        await window.desktopWindow?.applySidebarPreferences({ position }).catch(() => undefined);
        await api.completeOnboarding();
        await refreshWorkspaces();
        setPostAuthStage('ready');
      } catch (error) {
        setOnboardingError(
          error instanceof Error ? error.message : 'Could not open Ledger.'
        );
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
      <AuthStatusScreen
        title={startupTitle}
        subtitle={startupSubtitle}
        isExiting={isAuthExiting}
      />
    );
  }

  if (!showAuthenticatedShell) {
    return (
      <AuthStatusScreen
        title={startupTitle}
        subtitle={startupSubtitle}
        isExiting={isAuthExiting}
      />
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
  const shouldShowNotificationMonitor = Boolean(user) && !isModuleWindow;

  return (
    <SearchProvider>
      <ToastProvider>
        {shouldShowNotificationMonitor ? <NotificationMonitor /> : null}
        <AuthSessionToastReset />
        <AppShell />
        <SearchModal />
      </ToastProvider>
    </SearchProvider>
  );
}

export default App;
