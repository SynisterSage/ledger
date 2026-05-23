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
  Plus,
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
import { ModalOverlay } from './components/Common/ModalOverlay';
import LoginForm from './components/Common/LoginForm';
import CalendarWindow from './components/Calendar/CalendarWindow';
import NotesWindow from './components/Notes/NotesWindow';
import ProjectsWindow from './components/Projects/ProjectsWindow';
import InboxWindow from './components/Inbox/InboxWindow';
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
import {
  saveSidebarPreferences,
  type SidebarPosition,
} from './config/sidebarPreferences';

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'ready';
type OnboardingStep = 'welcome' | 'workspace' | 'position';
type OnboardingWorkspaceMode = 'create' | 'join';
type ModuleKind =
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'dashboard'
  | 'settings'
  | 'inbox'
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

const isUpcomingEventActive = (event: {
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}) => {
  if (String(event.status ?? '').toLowerCase() === 'done') return false;
  const endAt = new Date(event.end_at ?? event.start_at ?? 0).getTime();
  return Number.isFinite(endAt) && endAt > Date.now();
};

const getExpiryMetadata = (hoursAhead = 24) => {
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
      className={`relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900 transition-all duration-150 ease-out ${
        isExiting ? 'opacity-0 scale-[0.985] translate-y-1' : 'opacity-100 scale-100 translate-y-0'
      }`}
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-3xl border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
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

function InviteSuccessScreen({
  workspaceName,
  onOpenLedger,
}: {
  workspaceName: string;
  onOpenLedger: () => void;
}) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-transparent p-3 text-gray-900"
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-3xl border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
      <div className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8">
        <div className="w-full max-w-sm rounded-3xl border border-gray-200 bg-white px-6 py-7 text-center shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0eb]">
            <CheckCircle2 size={24} className="text-[#FF5F40]" />
          </div>
          <h2 className="mt-5 text-[28px] font-semibold leading-tight text-gray-950">
            Joined {workspaceName}
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            You’re now a member of this workspace.
          </p>
          <button
            type="button"
            onClick={onOpenLedger}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] px-4 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(255,95,64,0.08)] transition-colors hover:bg-[#ea5336]"
          >
            Open Ledger
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
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
      className="relative min-h-screen overflow-hidden bg-transparent p-3 text-[#111827]"
      style={dragRegionStyle}
    >
      <div className="absolute inset-3 rounded-3xl border border-white/70 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" />
      <button
        type="button"
        onClick={() => {
          void window.desktopWindow?.quitApp();
        }}
        aria-label="Close"
        className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/70 text-gray-500 transition hover:bg-white hover:text-gray-900"
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
              <div className="overflow-hidden rounded-[26px] bg-white/80 shadow-[0_24px_70px_rgba(17,24,39,0.12)]">
                {prefersReducedMotion ? (
                  <div className="flex aspect-video items-center justify-center bg-[#fffaf5]">
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
                <h1 className="text-[34px] font-semibold leading-tight text-gray-950 sm:text-[40px]">
                  Welcome to Ledger
                </h1>
                <p className="mt-3 text-xl text-gray-600">Your day, beside your work.</p>
                <p className="mt-4 max-w-sm text-sm leading-6 text-gray-500 md:max-w-none">
                  Capture notes, tasks, events, and follow-ups without leaving your flow.
                </p>
                <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:items-start">
                  <button
                    type="button"
                    onClick={() => onStepChange('workspace')}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-[#FF5F40] px-6 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,64,0.18)] transition hover:bg-[#ea5336]"
                  >
                    Get started
                  </button>
                  <button
                    type="button"
                    onClick={() => onStepChange('workspace')}
                    className="inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-gray-500 transition hover:text-gray-900"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 'workspace' ? (
            <div className="mx-auto rounded-3xl bg-white/72 p-7 shadow-[0_24px_70px_rgba(17,24,39,0.10)] backdrop-blur-xl">
              <div className="mb-7">
                <img src="./logo-color.svg" alt="Ledger" className="mb-5 h-10 w-10" />
                <h1 className="text-[30px] font-semibold leading-tight text-gray-950">
                  {mode === 'create' ? 'Create your workspace' : 'Join a workspace'}
                </h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
                  {mode === 'create'
                    ? 'A workspace keeps your notes, projects, calendar, and daily focus together.'
                    : 'Paste an invite code or link to join an existing Ledger workspace.'}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
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
                  className="h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-[15px] text-gray-950 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                />
              </label>

              <button
                type="button"
                onClick={() => onModeChange(mode === 'create' ? 'join' : 'create')}
                className="mt-3 text-sm font-medium text-[#FF5F40] transition hover:text-[#ea5336]"
              >
                {mode === 'create' ? 'Have an invite? Join a workspace' : 'Back to create a workspace'}
              </button>

              {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  void onWorkspaceSubmit();
                }}
                className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,64,0.16)] transition hover:bg-[#ea5336] disabled:opacity-60"
              >
                {isSaving ? <Loader2 size={17} className="animate-spin" /> : null}
                {isSaving ? (mode === 'create' ? 'Creating...' : 'Joining...') : mode === 'create' ? 'Continue' : 'Join workspace'}
              </button>
            </div>
          ) : null}

          {step === 'position' ? (
            <div className="mx-auto rounded-3xl bg-white/72 p-7 shadow-[0_24px_70px_rgba(17,24,39,0.10)] backdrop-blur-xl">
              <div className="mb-7">
                <img src="./logo-color.svg" alt="Ledger" className="mb-5 h-10 w-10" />
                <h1 className="text-[30px] font-semibold leading-tight text-gray-950">
                  Where should Ledger live?
                </h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
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
                          ? 'border-[#FF5F40]/45 bg-[#fff7f2] text-gray-950 shadow-[0_8px_18px_rgba(255,95,64,0.08)]'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <span className="relative h-9 w-11 rounded-lg border border-gray-200 bg-white">
                        <span
                          className={`absolute rounded-sm bg-[#FF5F40] ${
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
                            <span className="absolute left-2 top-2 h-1 w-1 rounded-full bg-white/90" />
                            <span className="absolute right-2 top-2 h-1 w-1 rounded-full bg-white/90" />
                          </>
                        ) : null}
                      </span>
                      <span className="text-sm font-semibold">{option.label}</span>
                    </button>
                  );
                })}
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                  className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,64,0.16)] transition hover:bg-[#ea5336] disabled:opacity-60"
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
                  className="inline-flex h-12 items-center justify-center rounded-2xl px-4 text-sm font-medium text-gray-500 transition hover:text-gray-900 disabled:opacity-60"
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
      client_id?: string | null;
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
  const [inboxCount, setInboxCount] = useState(0);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(initialFocusTaskId ?? null);
  const [focusDraftTitle, setFocusDraftTitle] = useState('');
  const [isSavingFocusTask, setIsSavingFocusTask] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [focusActionId, setFocusActionId] = useState<string | null>(null);
  const [completedFocusTasks, setCompletedFocusTasks] = useState<CompletedFocusTask[]>(() =>
    loadCompletedFocusTasks()
  );
  const [completedFocusExpanded, setCompletedFocusExpanded] = useState<boolean>(false);
  const [isFocusPickerOpen, setIsFocusPickerOpen] = useState(false);
  const [isNewFocusModalOpen, setIsNewFocusModalOpen] = useState(false);
  const [expandedTimelineIds, setExpandedTimelineIds] = useState<Set<string>>(new Set());
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [calendarScope, setCalendarScope] = useState<'current_workspace' | 'all_accessible_workspaces'>(
    'current_workspace'
  );
  const autoExpireTodayTaskIdsRef = useRef<Set<string>>(new Set());
  const getWorkspaceTaskMetadata = () => ({
    workspace_id: activeWorkspaceId ?? null,
    workspace_name: activeWorkspace?.name?.trim() || null,
    workspace_color: activeWorkspace?.color ?? null,
  });
  const [dashboardContextMenu, setDashboardContextMenu] = useState<
    | { x: number; y: number; type: 'followup'; taskId: string }
    | { x: number; y: number; type: 'timeline'; eventId: string }
    | { x: number; y: number; type: 'project'; projectId: string }
    | { x: number; y: number; type: 'note'; noteId: string }
    | { x: number; y: number; type: 'checkin' }
    | null
  >(null);
  const hasLoadedDashboardRef = useRef(false);
  const dashboardDayRef = useRef(todayKey());

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
          preferences?: { calendarScope?: 'current_workspace' | 'all_accessible_workspaces' } | null;
        };
        if (cancelled) return;
        setCalendarScope(
          payload?.preferences?.calendarScope === 'all_accessible_workspaces'
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

  useEffect(() => {
    const syncCompletedFocusDay = () => {
      const currentDay = todayKey();
      if (dashboardDayRef.current === currentDay) return;

      dashboardDayRef.current = currentDay;
      setCompletedFocusTasks([]);
      setCompletedFocusExpanded(false);
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
  }, [activeWorkspaceId, api, calendarScope, user]);

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

  const summaryItems = [
    { label: 'focus', value: focusTasks.length, accent: true },
    { label: 'tasks', value: activeTodayTasks.length },
    { label: 'upcoming', value: upcoming.length },
    { label: recentNotes.length === 1 ? 'note' : 'notes', value: recentNotes.length },
  ];
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

  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      autoExpireTodayTaskIdsRef.current.clear();
      return;
    }

    const expiredTasks = todayTasks.filter((task) => shouldAutoExpireTodayTask(task));
    if (expiredTasks.length === 0) return;

    expiredTasks.forEach((task) => {
      if (autoExpireTodayTaskIdsRef.current.has(task.id)) return;
      autoExpireTodayTaskIdsRef.current.add(task.id);
      setTodayTasks((prev) => prev.filter((item) => item.id !== task.id));

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
          setTodayTasks((prev) => [task, ...prev.filter((item) => item.id !== task.id)]);
          autoExpireTodayTaskIdsRef.current.delete(task.id);
        } finally {
          if (succeeded) {
            autoExpireTodayTaskIdsRef.current.delete(task.id);
          }
        }
      })();
    });
  }, [activeWorkspaceId, api, todayTasks, user]);

  const createNewFocusTask = async () => {
    const title = focusDraftTitle.trim();
    if (!title || isSavingFocusTask || focusTasks.length >= 3) return;

    const tempId = `focus-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dueAt = getExpiryMetadata(24);
    const optimisticTask = {
      id: tempId,
      title,
      status: 'todo',
      ...dueAt,
      show_in_today: true,
      is_today_focus: true,
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
        ...dueAt,
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
      if (!detail.task.is_today_focus) return;
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
        is_today_focus: true,
        show_in_today: true,
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
          is_today_focus: true,
          show_in_today: true,
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

    const previousTodayTasks = todayTasks;
    const previousCompletedFocusTasks = completedFocusTasks;
    const completedAt = new Date().toISOString();
    const completedItem: CompletedFocusTask = {
      id: task.id,
      title: task.title,
      workspace_name: task.workspace_name ?? null,
      project_name: task.project_name ?? null,
      due_date: task.due_date ?? null,
      due_time: task.due_time ?? null,
      completed_at: completedAt,
    };

    setTodayTasks((prev) => prev.filter((item) => item.id !== taskId));
    setCompletedFocusTasks((prev) => {
      const next = [completedItem, ...prev.filter((item) => item.id !== taskId)];
      setCompletedFocusExpanded(false);
      return next;
    });
    setFocusActionId(taskId);
    try {
      await api.updateTaskInWorkspace(taskId, task.workspace_id ?? activeWorkspaceId ?? '', {
        status: 'completed',
      });
      await refreshTodayTasks();
    } catch (error) {
      console.error('Failed to complete focus task:', error);
      setTodayTasks(previousTodayTasks);
      setCompletedFocusTasks(previousCompletedFocusTasks);
      setCompletedFocusExpanded(false);
    } finally {
      setFocusActionId(null);
    }
  };

  const openModule = (
    kind: 'calendar' | 'notes' | 'projects',
    focus?: string | ModuleFocusPayload
  ) => {
    void window.desktopWindow?.toggleModule(kind, focus);
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
      className="flex h-screen flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-none"
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
        actions={
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
              <button
                key={label}
                type="button"
                onClick={() => void action()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#64748B] transition hover:text-[#FF5F40]"
              >
                <Plus size={14} />
                {label}
              </button>
            ))}
          </>
        }
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
      />

      <div
        className="flex-1 min-h-0 overflow-auto bg-white px-6 py-8"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div className="mx-auto max-w-6xl space-y-10">
          <header className="max-w-3xl space-y-8">
            <div className="space-y-1.5">
              <h2 className="text-[34px] font-normal leading-tight tracking-tight text-[#111827]">
                Good to see you, {firstName}
              </h2>
              <p className="text-lg font-light text-[#64748B]">
                What needs your attention today?
              </p>
            </div>

            <div className="flex flex-col gap-6 border-b border-gray-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#64748B]">
                  {todayLabel}
                </p>
                {!isLoadingDashboard && (
                  <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#64748B]">
                    {summaryItems.map((item) => (
                      <span key={item.label} className="flex items-center gap-1.5">
                        <span
                          className={item.accent ? 'font-semibold text-[#FF5F40]' : 'font-medium'}
                        >
                          {item.value}
                        </span>
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          {dashboardError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {dashboardError}
            </div>
          )}

          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
            <main className="space-y-14">
              <section ref={todayTasksRef} className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <p className="text-xs font-medium text-[#64748B]">
                    Focus
                  </p>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setIsFocusPickerOpen(true)}
                      disabled={focusTasks.length >= 3 || activeTodayTasks.length === 0}
                      className="text-[11px] font-medium text-[#FF5F40] transition hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + Add from Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsNewFocusModalOpen(true)}
                      disabled={focusTasks.length >= 3}
                      className="text-[11px] font-medium text-[#FF5F40] transition hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + New focus
                    </button>
                  </div>
                </div>

                {isLoadingDashboard ? (
                  <div className="space-y-3 border-y border-gray-200 py-10">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonTaskItem key={i} />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="border-y border-gray-200 py-10">
                      {focusTasks.length === 0 ? (
                        <p className="text-sm font-light italic text-[#64748B]">No focus set yet.</p>
                      ) : (
                        <div className="space-y-4">
                          {focusTasks.map((task, index) => {
                            const expiryLabel = formatExpiryCounter(task);
                            return (
                              <div key={task.id} className="group flex items-start gap-3">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 text-[11px] font-medium text-[#64748B]">
                                  {index + 1}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[13px] font-medium leading-5 text-[#111827]">
                                    {task.title}
                                  </p>
                                  <p className="mt-0.5 text-[11px] leading-4 text-[#64748B]">
                                    {task.project_name || task.workspace_name || 'Workspace task'}
                                    {expiryLabel ? ` · ${expiryLabel}` : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => void toggleFocusDone(task.id)}
                                    disabled={focusActionId === task.id}
                                    className="text-[#64748B] transition hover:text-[#111827] disabled:opacity-50"
                                    title="Mark complete"
                                  >
                                    <CheckCircle2 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void removeTaskFromFocus(task.id)}
                                    disabled={focusActionId === task.id}
                                    className="text-[#64748B] transition hover:text-[#111827] disabled:opacity-50"
                                    title="Remove from focus"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {completedFocusTasks.length > 0 && (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setCompletedFocusExpanded((current) => !current)}
                          className="flex w-full items-center justify-between rounded-2xl px-0 py-1 text-left"
                        >
                          <span className="text-xs font-medium text-[#64748B]">
                            Completed · {completedFocusTasks.length}
                          </span>
                          <ChevronDown
                            size={14}
                            className={`text-[#94A3B8] transition-transform ${
                              completedFocusExpanded ? 'rotate-180' : 'rotate-0'
                            }`}
                          />
                        </button>

                        {completedFocusExpanded && (
                          <div className="space-y-2">
                            {completedFocusTasks.map((task) => {
                              const expiryLabel = formatExpiryCounter(task);
                              return (
                                <div
                                  key={task.id}
                                  className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2"
                                >
                                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] text-[#64748B]">
                                    ✓
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-medium leading-5 text-[#64748B] line-through decoration-gray-300">
                                      {task.title}
                                    </p>
                                    <p className="mt-0.5 text-[11px] leading-4 text-[#94A3B8]">
                                      {task.project_name || task.workspace_name || 'Workspace task'}
                                      {expiryLabel ? ` · ${expiryLabel}` : ''}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>

              <div className="grid gap-12 lg:grid-cols-2">
                <section
                  className="space-y-6"
                  onContextMenu={(event) => openContextMenu(event, { type: 'checkin' })}
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-medium text-[#64748B]">
                      Review
                    </p>
                    <button
                      onClick={() => {
                        void window.desktopWindow?.openCheckin();
                        setState('expanded');
                      }}
                      className="shrink-0 whitespace-nowrap rounded-full border border-[#ffd9d0] bg-white px-3 py-1.5 text-xs font-medium text-[#FF5F40] transition hover:border-[#FFB7A6] hover:bg-[#FFF7F4]"
                    >
                      Open check-in
                    </button>
                  </div>
                <div className="space-y-8">
                  {[
                    { label: 'Finished', value: daily.finished || 'Nothing yet' },
                    { label: 'Blocked', value: daily.blocked || 'No blockers' },
                    {
                      label: 'First task tomorrow',
                      value: daily.firstTaskTomorrow || 'Not set yet',
                    },
                  ].map((item) => (
                    <div key={item.label} className="space-y-2">
                      <p className="text-[11px] font-semibold text-[#64748B]">{item.label}</p>
                      <p className="text-sm font-light leading-6 text-[#64748B]">{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-[#64748B]">
                      Recent Notes
                    </p>
                  </div>
                  <button
                    onClick={() => openModule('notes')}
                    className="shrink-0 whitespace-nowrap rounded-full border border-[#ffd9d0] bg-white px-3 py-1.5 text-xs font-medium text-[#FF5F40] transition hover:border-[#FFB7A6] hover:bg-[#FFF7F4]"
                  >
                    Open notes
                  </button>
                </div>

                <div className="space-y-1">
                  {isLoadingDashboard ? (
                    Array.from({ length: 2 }).map((_, i) => <SkeletonNoteCard key={i} />)
                  ) : recentNotes.length === 0 ? (
                    <p className="text-sm font-light italic text-[#64748B]">No notes yet.</p>
                  ) : (
                    recentNotes.map((note) => (
                      <button
                        key={note.id}
                        onContextMenu={(event) =>
                          openContextMenu(event, { type: 'note', noteId: note.id })
                        }
                        onClick={() => openModule('notes', { kind: 'notes', focusNoteId: note.id })}
                        className="group flex w-full flex-col gap-1.5 border-b border-gray-200 pb-5 pt-3 text-left first:pt-0"
                      >
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="truncate text-sm font-medium text-[#111827] group-hover:text-[#FF5F40]">
                            {note.title}
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[#94A3B8]">
                            {new Date(note.updated_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                        <p className="line-clamp-1 text-xs font-light text-[#94A3B8]">
                          {htmlToPlainText(note.content) || 'No content yet'}
                        </p>
                        {expandedNoteIds.has(note.id) && (
                          <p className="text-sm text-[#4B5563] whitespace-pre-wrap wrap-break-word">
                            {htmlToPlainText(note.content) || 'No content yet'}
                          </p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </section>
              </div>
            </main>

            <aside className="border-t border-gray-200 pt-8 lg:sticky lg:top-0 lg:self-start lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
              <section ref={followUpsRef} className="space-y-7">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#64748B]">
                        Action queue
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#64748B]">
                        <span className="whitespace-nowrap leading-5">
                          {inboxCount > 0
                            ? `${inboxCount} inbox capture${inboxCount === 1 ? '' : 's'}`
                            : 'Inbox clear'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="whitespace-nowrap leading-5">
                          {followUpTasks.length} follow-up{followUpTasks.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.desktopWindow?.toggleModule('inbox')}
                      className="shrink-0 whitespace-nowrap rounded-full border border-[#ffd9d0] bg-white px-3 py-1.5 text-xs font-medium text-[#FF5F40] transition hover:border-[#FFB7A6] hover:bg-[#FFF7F4]"
                    >
                      Open inbox
                    </button>
                  </div>

                  <div className="space-y-3 pt-2">
                    {inboxCount > 0 && (
                      <button
                        type="button"
                        onClick={() => window.desktopWindow?.toggleModule('inbox')}
                        className="flex w-full items-start justify-between gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3 text-left transition hover:border-gray-200 hover:bg-gray-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#4B5563]">
                            Inbox
                          </p>
                          <p className="mt-1 truncate text-xs text-[#94A3B8]">
                            Slack saves and other captures land here first.
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-medium text-[#94A3B8]">
                          {inboxCount}
                        </span>
                      </button>
                    )}

                    {followUpTasks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-3">
                        <p className="text-sm font-light text-[#94A3B8]">No follow-ups yet.</p>
                      </div>
                    ) : (
                      followUpTasks.map((task) => {
                        const isFocused = focusedTaskId === task.id;
                        const statusLabel = task.status === 'done' ? 'Done' : 'Todo';
                        return (
                          <div
                            key={task.id}
                            onContextMenu={(event) =>
                              openContextMenu(event, { type: 'followup', taskId: task.id })
                            }
                            className={`flex items-start gap-3 rounded-lg px-0 py-3 transition ${
                              isFocused ? 'bg-gray-50' : 'hover:bg-white/70'
                            }`}
                          >
                            <button
                              type="button"
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
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="truncate text-sm font-medium text-[#4B5563]">
                                {task.title}
                              </p>
                              <p className="mt-1 truncate text-xs text-[#94A3B8]">
                                {task.eventTitle ? `Event: ${task.eventTitle}` : statusLabel}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => void markFollowUpDone(task.id)}
                              className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-[#94A3B8] hover:bg-gray-50 hover:text-[#4B5563]"
                            >
                              {task.status === 'done' ? 'Undo' : 'Done'}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="h-px w-12 bg-gray-200" />

                  <div className="space-y-6 pt-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-[#64748B]">
                        Upcoming
                      </p>
                      <button
                        type="button"
                        onClick={() => openModule('calendar')}
                        className="shrink-0 whitespace-nowrap rounded-full border border-[#ffd9d0] bg-white px-3 py-1.5 text-xs font-medium text-[#FF5F40] transition hover:border-[#FFB7A6] hover:bg-[#FFF7F4]"
                      >
                        Calendar
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {isLoadingDashboard ? (
                        Array.from({ length: 3 }).map((_, i) => <SkeletonNoteCard key={i} />)
                      ) : upcoming.length === 0 ? (
                        <p className="text-sm font-light text-[#64748B]">
                          No upcoming events today.
                        </p>
                      ) : (
                        upcoming.map((item) => {
                          const start = new Date(item.start_at);
                          const isExpanded = expandedTimelineIds.has(item.id);
                          const showWorkspace = calendarScope === 'all_accessible_workspaces';
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
                              className="w-full rounded-lg px-2 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <p
                                  className={`${
                                    isExpanded ? '' : 'truncate'
                                  } text-sm font-medium text-[#111827]`}
                                >
                                  {item.title}
                                </p>
                                <p className="shrink-0 text-xs text-[#64748B]">{dayLabel}</p>
                              </div>
                              <p className="mt-1 text-xs text-[#64748B]">{timeLabel}</p>
                              {showWorkspace && item.workspace_name && (
                                <p className="mt-0.5 text-[11px] text-[#94A3B8]">
                                  Workspace · {item.workspace_name}
                                </p>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="h-px w-12 bg-gray-200" />

                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-[#64748B]">
                        Projects
                      </p>
                      <button
                        type="button"
                        onClick={() => openModule('projects')}
                        className="shrink-0 whitespace-nowrap rounded-full border border-[#ffd9d0] bg-white px-3 py-1.5 text-xs font-medium text-[#FF5F40] transition hover:border-[#FFB7A6] hover:bg-[#FFF7F4]"
                      >
                        Projects
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {isLoadingDashboard ? (
                        Array.from({ length: 3 }).map((_, i) => <SkeletonProjectCard key={i} />)
                      ) : attentionProjects.length === 0 ? (
                        <p className="text-sm font-light text-[#64748B]">
                          No projects need attention.
                        </p>
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
                              onClick={() =>
                                openModule('projects', {
                                  kind: 'projects',
                                  focusProjectId: project.id,
                                })
                              }
                              className="w-full rounded-lg px-2 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
                            >
                              <p className="truncate text-sm font-medium text-[#111827]">
                                {project.name}
                              </p>
                              <p className="mt-1 flex items-center gap-2 text-xs text-[#64748B]">
                                <Circle size={8} className="fill-current text-[#FF5F40]" />
                                <span>{label}</span>
                                <span>·</span>
                                <span>{Math.max(0, Math.min(100, project.completeness))}%</span>
                              </p>
                              <p className="mt-1 text-xs text-[#64748B]">{dueLabel}</p>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
      <ModalOverlay
        isOpen={isFocusPickerOpen}
        onClose={() => setIsFocusPickerOpen(false)}
        classNameContainer="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-xs font-medium text-gray-500">
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
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-left transition hover:bg-white disabled:opacity-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-gray-950">{task.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">
                      {task.project_name || task.workspace_name || 'Workspace task'}
                      {formatExpiryCounter(task) ? ` · ${formatExpiryCounter(task)}` : ''}
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
      </ModalOverlay>
      <ModalOverlay
        isOpen={isNewFocusModalOpen}
        onClose={() => {
          setIsNewFocusModalOpen(false);
          setFocusDraftTitle('');
        }}
        classNameContainer="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-xs font-medium text-gray-500">
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
      </ModalOverlay>
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
  const [showAuthenticatedShell, setShowAuthenticatedShell] = useState(false);
  const authNativeWindowPinnedRef = useRef(false);

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

    if (moduleKind === 'inbox') {
      return <InboxWindow />;
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
    if (!user) {
      authNativeWindowPinnedRef.current = false;
    }

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
    if (isModuleWindow) return;
    if (isLoading) return;
    if (user) return;
    if (authNativeWindowPinnedRef.current) return;

    authNativeWindowPinnedRef.current = true;
    void window.desktopWindow?.setMode('auth').catch(() => {
      // No-op outside Electron (browser dev mode)
    });
    void window.desktopWindow?.setVisible(true).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
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
        await refreshWorkspaces();

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
  }, [pendingInviteToken, isLoading, user, api, refreshWorkspaces, inviteFlowStatus]);

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
      if (sidebarModeRef.current === mode) return;
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
      }, 60);
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

  if (shouldShowBootLoading) {
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
        title="Preparing workspace"
        subtitle="Loading your sidebar, notes, projects, and calendar."
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
        title="Preparing workspace"
        subtitle="Loading your sidebar, notes, projects, and calendar."
        isExiting={isAuthExiting}
      />
    );
  }

  if (!showAuthenticatedShell) {
    return (
      <AuthStatusScreen
        title="Preparing workspace"
        subtitle="Loading your sidebar, notes, projects, and calendar."
        isExiting={isAuthExiting}
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
