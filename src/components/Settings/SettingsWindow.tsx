import {
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  CircleAlert,
  Copy,
  Loader2,
  Settings,
  Wind,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useAuthContext } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import {
  defaultSidebarPreferences,
  saveSidebarPreferences,
  type SidebarDefaultState,
  type SidebarPosition,
} from '../../config/sidebarPreferences';
import {
  formatLedgerSessionPlatformLabel,
  formatLedgerSessionRelativeTime,
  getLedgerSessionDeviceName,
  getLedgerSessionPlatform,
} from '../../utils/deviceSession';
import {
  applyDesktopCssVars,
  getSystemDesktopThemeScheme,
  resolveDesktopThemeScheme,
} from '../../theme/desktopTokens';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { buildInviteUrl } from '../../config/invite';
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import authService from '../../services/auth';

type UserPreferences = {
  weekStartsOn: 'sunday' | 'monday';
  timeFormat: '12h' | '24h';
  defaultEventMinutes: 30 | 45 | 60;
  defaultEventCalendar: 'personal' | 'work' | 'projects';
  defaultEventStatus: 'planned' | 'tentative' | 'confirmed';
  defaultEventVisibility: 'private' | 'workspace';
  reminderLeadMinutes: 5 | 10 | 15 | 30;
  defaultReminderTime: '08:00' | '09:00' | '12:00' | '17:00';
  reminderSnoozePreset: '10m-1h-tomorrow' | '5m-15m-1h' | '15m-1h-tomorrow';
  reminderDestination: 'today-calendar' | 'today' | 'calendar';
  missedReminderBehavior: 'needs_attention' | 'today' | 'hide';
  completedReminderBehavior: 'collapse' | 'keep_visible' | 'hide_immediately';
  pastEventBehavior: 'history' | 'fade' | 'upcoming_only';
  followUpBehavior: 'none' | 'offer' | 'review_prompt';
  followUpDefaultTime: 'tomorrow_9' | 'today_5' | 'next_morning' | 'custom';
  eventNotesBehavior: 'enabled' | 'disabled';
  linkedProjectFollowUps: 'project_and_today' | 'project_only' | 'today_only';
  defaultCalendarView: 'day' | 'week' | 'month';
  showWeekends: boolean;
  showRemindersOnCalendar: boolean;
  showCompletedItems: 'muted' | 'hidden' | 'visible';
  calendarScope: 'current_workspace' | 'all_accessible_workspaces';
  defaultWorkspaceCalendar: 'personal' | 'workspace' | 'projects';
  calendarColor: 'ledger-orange' | 'blue' | 'green' | 'gray';
  openDashboardByDefault: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  compactDensity: boolean;
  showTrayIcon: boolean;
  runInBackground: boolean;
  theme: 'light' | 'dark' | 'system';
};

type NotificationPreferences = {
  desktopEnabled: boolean;
  inAppEnabled: boolean;
  paused: boolean;
  remindersEnabled: boolean;
  eventsEnabled: boolean;
  tasksEnabled: boolean;
  projectDeadlinesEnabled: boolean;
  inboxCapturesEnabled: boolean;
  overdueEnabled: boolean;
  defaultEventLeadMinutes: 0 | 5 | 10 | 30 | 60;
  defaultTaskTiming: 'morning_of' | 'at_due_time' | 'day_before' | 'none';
  defaultProjectDeadlineLeadDays: 0 | 1 | 3 | 7;
  defaultSnoozeMinutes: 10 | 30 | 60 | 1440;
  keepOverdueVisible: boolean;
  notifyWhileFullscreen: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

type WorkspaceMember = {
  user_id: string;
  role: WorkspaceRole;
  joined_at: string | null;
  email: string | null;
  full_name: string | null;
  is_owner: boolean;
};

type WorkspaceInvitation = {
  id: string;
  email?: string | null;
  invited_email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'expired';
  expires_at: string;
  token?: string | null;
  invited_by?: string;
  created_by?: string;
  created_at: string;
};

type SlackIntegrationStatus = {
  connected: boolean;
  team_id?: string | null;
  team_name?: string | null;
  bot_user_id?: string | null;
  scopes?: string[];
  updated_at?: string | null;
};

type ExtensionTokenStatus = {
  exists: boolean;
  created_at?: string | null;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

type ExtensionTokenResponse = {
  token?: string;
  status?: ExtensionTokenStatus;
};

type AccountSessionPlatform = 'desktop' | 'ios' | 'android' | 'web' | 'extension';

type AccountSessionRow = {
  id: string;
  device_id: string;
  device_name: string | null;
  platform: AccountSessionPlatform;
  app_name: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  revoked_at: string | null;
  is_current: boolean;
};

type AccountSessionsResponse = {
  currentSessionId: string | null;
  sessions: AccountSessionRow[];
};

type InviteModalState = {
  id: string;
} | null;

type SettingsSectionId =
  | 'account'
  | 'sessions'
  | 'workspace'
  | 'calendar'
  | 'notifications'
  | 'integrations'
  | 'sidebar'
  | 'shortcuts'
  | 'accessibility';
const sectionOrder: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'account', label: 'Account', description: 'Identity and security' },
  { id: 'sessions', label: 'Sessions', description: 'Signed-in devices and access' },
  { id: 'workspace', label: 'Workspace', description: 'Display and behavior defaults' },
  { id: 'calendar', label: 'Calendar', description: 'Event and reminder defaults' },
  { id: 'notifications', label: 'Notifications', description: 'Alerts and delivery' },
  { id: 'integrations', label: 'Integrations', description: 'Connect external signals' },
  { id: 'sidebar', label: 'Sidebar', description: 'Docking, visibility, and placement' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', description: 'Quick reference for actions' },
  { id: 'accessibility', label: 'Accessibility', description: 'Comfort and readability options' },
];

const isSettingsSection = (value: string | null | undefined): value is SettingsSectionId => {
  const section = String(value ?? '').trim().toLowerCase();
  return (
    section === 'account' ||
    section === 'sessions' ||
    section === 'workspace' ||
    section === 'calendar' ||
    section === 'notifications' ||
    section === 'integrations' ||
    section === 'sidebar' ||
    section === 'shortcuts' ||
    section === 'accessibility'
  );
};

const getInitialSettingsSection = (): SettingsSectionId => {
  const section = new URLSearchParams(window.location.search).get('section');
  return isSettingsSection(section) ? section : 'account';
};

const formatIntegrationDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
};

const shortcutSections: Array<{
  id: string;
  title: string;
  shortcuts: Array<{ keys: string; description: string }>;
}> = [
  {
    id: 'sidebar',
    title: 'Sidebar',
    shortcuts: [
      { keys: '⌘ + ⇧ + B', description: 'hide / show sidebar' },
      { keys: '⌘/Ctrl + ⇧ + H', description: 'toggle side panels in Notes, Calendar, and Projects' },
      { keys: '⌘/Ctrl + ⇧ + L', description: 'hide / show all Ledger windows' },
      { keys: '⌘ + B', description: 'collapse / expand' },
    ],
  },
  {
    id: 'search',
    title: 'Search',
    shortcuts: [
      { keys: '⌘ + K', description: 'search everything' },
      { keys: 'Esc', description: 'close search' },
      { keys: '↑ ↓ Arrow keys', description: 'navigate results' },
      { keys: 'Enter', description: 'jump to result' },
    ],
  },
  {
    id: 'navigation',
    title: 'Navigation',
    shortcuts: [
      { keys: '⌘ + 1', description: 'dashboard' },
      { keys: '⌘ + 2', description: 'calendar' },
      { keys: '⌘ + 3', description: 'notes' },
      { keys: '⌘ + 4', description: 'projects' },
    ],
  },
  {
    id: 'general',
    title: 'General',
    shortcuts: [
      { keys: '⌘ + ,', description: 'open settings' },
      { keys: '⌘ + ?', description: 'show this help' },
    ],
  },
  {
    id: 'mouse-actions',
    title: 'Mouse Actions',
    shortcuts: [{ keys: 'Click logo', description: 'collapse / expand' }],
  },
];

const STORAGE_KEY = 'ledger:settings:v1';

const defaultPrefs: UserPreferences = {
  weekStartsOn: 'monday',
  timeFormat: '12h',
  defaultEventMinutes: 30,
  defaultEventCalendar: 'personal',
  defaultEventStatus: 'planned',
  defaultEventVisibility: 'private',
  reminderLeadMinutes: 15,
  defaultReminderTime: '09:00',
  reminderSnoozePreset: '10m-1h-tomorrow',
  reminderDestination: 'today-calendar',
  missedReminderBehavior: 'needs_attention',
  completedReminderBehavior: 'collapse',
  pastEventBehavior: 'history',
  followUpBehavior: 'offer',
  followUpDefaultTime: 'tomorrow_9',
  eventNotesBehavior: 'enabled',
  linkedProjectFollowUps: 'project_and_today',
  defaultCalendarView: 'week',
  showWeekends: true,
  showRemindersOnCalendar: true,
  showCompletedItems: 'muted',
  calendarScope: 'current_workspace',
  defaultWorkspaceCalendar: 'personal',
  calendarColor: 'ledger-orange',
  openDashboardByDefault: true,
  reduceMotion: false,
  highContrast: false,
  compactDensity: false,
  showTrayIcon: true,
  runInBackground: true,
  theme: 'system',
};

const defaultNotificationPrefs: NotificationPreferences = {
  desktopEnabled: false,
  inAppEnabled: true,
  paused: false,
  remindersEnabled: true,
  eventsEnabled: true,
  tasksEnabled: false,
  projectDeadlinesEnabled: true,
  inboxCapturesEnabled: false,
  overdueEnabled: true,
  defaultEventLeadMinutes: 10,
  defaultTaskTiming: 'morning_of',
  defaultProjectDeadlineLeadDays: 1,
  defaultSnoozeMinutes: 10,
  keepOverdueVisible: true,
  notifyWhileFullscreen: false,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
};

const loadCachedPreferences = (): UserPreferences => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      ...defaultPrefs,
      ...parsed,
    };
  } catch {
    return defaultPrefs;
  }
};

const saveCachedPreferences = (prefs: UserPreferences) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
};

const selectChevronStyle: CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.8rem center',
  backgroundSize: '14px 14px',
};

const getSidebarOpacitySliderStyle = (value: number): CSSProperties => {
  const min = 0.7;
  const max = 0.95;
  const fillPercent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return {
    ['--ledger-range-progress' as string]: `${fillPercent}%`,
    ['--ledger-range-fill' as string]: 'var(--ledger-accent)',
  };
};

const compactFieldClassName =
  'h-9 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60 disabled:opacity-60';

const compactSelectClassName =
  'h-9 appearance-none rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 pr-8 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60 disabled:opacity-60';

const preferenceSelectClassName = `${compactSelectClassName} w-full`;

const preferenceRowClassName =
  'grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-center';

const inlineSwitchClassName =
  'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition focus:outline-none focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60';

const settingsTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]',
  root: 'flex-1 overflow-hidden bg-[var(--ledger-background)]',
  aside:
    'overflow-auto border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] p-4',
  sideHeader: 'mb-4 border-b border-[color:var(--ledger-border-subtle)] pb-4',
  sideLabel: 'text-xs font-medium text-[var(--ledger-text-muted)]',
  sideTitle: 'mt-1 text-sm font-semibold text-[var(--ledger-text-primary)]',
  sideMeta: 'text-xs text-[var(--ledger-text-secondary)] truncate',
  main: 'overflow-auto bg-[var(--ledger-background)] p-6',
  sectionTitle: 'text-sm font-semibold text-[var(--ledger-text-primary)]',
  sectionSubtitle: 'text-sm text-[var(--ledger-text-secondary)]',
  sectionStatus: 'text-xs text-[var(--ledger-text-muted)]',
  pageTitle: 'text-[28px] font-semibold tracking-tight text-[var(--ledger-text-primary)]',
  pageSubtitle: 'text-sm text-[var(--ledger-text-secondary)]',
  pageStatus: 'text-xs text-[var(--ledger-text-muted)]',
  sectionShell: 'border-t border-[color:var(--ledger-border-subtle)] pt-6',
  sectionRows: 'mt-5 divide-y divide-[color:var(--ledger-border-subtle)] border-t border-[color:var(--ledger-border-subtle)]',
  rowLabel: 'text-sm font-medium text-[var(--ledger-text-secondary)]',
  rowValue: 'text-sm text-[var(--ledger-text-primary)]',
  rowMuted: 'text-xs text-[var(--ledger-text-muted)]',
  divider: 'border-[color:var(--ledger-border-subtle)]',
  surfaceCard: 'bg-[var(--ledger-surface-card)]',
  surfaceMuted: 'bg-[var(--ledger-surface-muted)]',
  surfaceHover: 'hover:bg-[var(--ledger-surface-hover)]',
  rowHover: 'transition hover:bg-[var(--ledger-surface-hover)]',
  subtleDivider: 'border-[color:var(--ledger-border-subtle)]',
  modalShell:
    'rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_24px_70px_rgba(15,23,42,0.12)]',
  modalHeader: 'border-t border-[color:var(--ledger-border-subtle)]',
  modalBody: 'border-t border-[color:var(--ledger-border-subtle)]',
  modalFooter: 'border-t border-[color:var(--ledger-border-subtle)]',
  controlButton:
    'h-8 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  controlButtonNeutral:
    'h-8 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60',
  primaryButton:
    'h-9 rounded-full bg-[var(--ledger-accent)] px-4 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60',
  dangerButton:
    'h-8 rounded-full border border-[color:rgba(217,45,32,0.18)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-50',
  sectionCard:
    'mt-2 divide-y divide-[color:var(--ledger-border-subtle)] border-y border-[color:var(--ledger-border-subtle)]',
  radioRow:
    'flex cursor-pointer items-center gap-3 rounded-2xl border border-transparent px-4 py-3',
  radioInput:
    'mt-0.5 h-4 w-4 border-[color:var(--ledger-border-subtle)] text-[var(--ledger-accent)] outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0',
  label: 'text-sm font-medium text-[var(--ledger-text-primary)]',
  help: 'mt-1 block text-xs leading-5 text-[var(--ledger-text-muted)]',
  fieldValue: 'text-sm text-[var(--ledger-text-secondary)]',
  footerButton:
    'h-9 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  headerButton:
    'h-9 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-semibold text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  navButton:
    'w-full rounded-2xl border px-3 py-2.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ledger-surface)]',
  navButtonActive:
    'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]',
  navButtonIdle:
    'border-transparent text-[var(--ledger-text-secondary)] hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  input:
    'h-10 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
  inputSecondary:
    'h-10 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
  pill:
    'inline-flex rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)]',
  dangerPill:
    'inline-flex rounded-full border border-[color:rgba(217,45,32,0.18)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]',
  disabledButton:
    'h-8 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-xs font-medium text-[var(--ledger-text-muted)] transition',
} as const;

const themeOptionOrder: Array<{ value: UserPreferences['theme']; label: string; description: string }> = [
  { value: 'system', label: 'System', description: 'Match your OS appearance.' },
  { value: 'light', label: 'Light', description: 'Always use the warm light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the graphite dark theme.' },
];

const PreferenceRow = ({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: ReactNode;
}) => {
  return (
    <div className={preferenceRowClassName}>
      <div className="min-w-0">
        <h3 className={settingsTheme.label}>{label}</h3>
        <p className={settingsTheme.help}>{help}</p>
      </div>
      <div className="sm:flex sm:w-full sm:justify-end">{children}</div>
    </div>
  );
};

const InlineSwitch = ({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`${inlineSwitchClassName} ${
        checked
          ? 'border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)]'
          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-[var(--ledger-surface-card)] shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};

export const SettingsWindow = () => {
  const { user, signOut } = useAuthContext();
  const {
    sidebarPreferences,
    position,
    opacity,
    defaultState,
    alwaysOnTop,
    autoHide,
    setFloatingDockEnabled,
    setPosition,
    setOpacity,
    setDefaultState,
    setAlwaysOnTop,
    setAutoHide,
  } = useSidebar();
  const api = useApi();
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspace,
    refreshWorkspaces,
    isLoading: isLoadingWorkspaces,
    error: workspaceError,
  } = useWorkspaceContext();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(getInitialSettingsSection());

  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(
    defaultNotificationPrefs
  );
  const [isSavingNotificationPrefs, setIsSavingNotificationPrefs] = useState(false);

  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordEditor, setShowPasswordEditor] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [workspaceCreateName, setWorkspaceCreateName] = useState('');
  const [workspaceCreateDescription, setWorkspaceCreateDescription] = useState('');
  const [workspaceCreateType, setWorkspaceCreateType] = useState<'team' | 'personal'>('team');
  const [showCreateWorkspaceForm, setShowCreateWorkspaceForm] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [workspaceCreateStatus, setWorkspaceCreateStatus] = useState<string | null>(null);
  const [isWorkspaceManageModalOpen, setIsWorkspaceManageModalOpen] = useState(false);
  const [workspaceEditName, setWorkspaceEditName] = useState('');
  const [workspaceEditDescription, setWorkspaceEditDescription] = useState('');
  const [workspaceEditStatus, setWorkspaceEditStatus] = useState<string | null>(null);
  const [workspaceEditError, setWorkspaceEditError] = useState<string | null>(null);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [workspaceDeleteConfirm, setWorkspaceDeleteConfirm] = useState('');
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<string | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [isWorkspaceDeleteModalOpen, setIsWorkspaceDeleteModalOpen] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState<WorkspaceInvitation[]>([]);
  const [workspaceUserRole, setWorkspaceUserRole] = useState<WorkspaceRole>('member');
  const [isLoadingWorkspaceAdmin, setIsLoadingWorkspaceAdmin] = useState(false);
  const [workspaceAdminError, setWorkspaceAdminError] = useState<string | null>(null);
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteCopyStatus, setInviteCopyStatus] = useState<string | null>(null);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteModal, setInviteModal] = useState<InviteModalState>(null);
  const [slackStatus, setSlackStatus] = useState<SlackIntegrationStatus | null>(null);
  const [isLoadingSlackStatus, setIsLoadingSlackStatus] = useState(false);
  const [isConnectingSlack, setIsConnectingSlack] = useState(false);
  const [isDisconnectingSlack, setIsDisconnectingSlack] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackRefreshToken, setSlackRefreshToken] = useState(0);
  const [extensionTokenStatus, setExtensionTokenStatus] =
    useState<ExtensionTokenStatus | null>(null);
  const [isLoadingExtensionTokenStatus, setIsLoadingExtensionTokenStatus] = useState(false);
  const [isExtensionTokenBusy, setIsExtensionTokenBusy] = useState(false);
  const [extensionTokenError, setExtensionTokenError] = useState<string | null>(null);
  const [generatedExtensionToken, setGeneratedExtensionToken] = useState<string | null>(null);
  const [isExtensionTokenModalOpen, setIsExtensionTokenModalOpen] = useState(false);
  const [extensionTokenConfirmAction, setExtensionTokenConfirmAction] = useState<
    'regenerate' | 'revoke' | null
  >(null);
  const [extensionTokenCopyStatus, setExtensionTokenCopyStatus] = useState<string | null>(null);
  const [accountSessions, setAccountSessions] = useState<AccountSessionRow[]>([]);
  const [isLoadingAccountSessions, setIsLoadingAccountSessions] = useState(false);
  const [accountSessionsError, setAccountSessionsError] = useState<string | null>(null);
  const inviteEmailRef = useRef<HTMLInputElement | null>(null);
  const sessionHeartbeatTimerRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const saveStatusTimerRef = useRef<number | null>(null);
  const autosaveTokenRef = useRef(0);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const lastSavedSettingsRef = useRef<string>('');
  const lastSavedFullNameRef = useRef<string>('');
  const settingsHydratedRef = useRef(false);
  const notificationAutosaveTimerRef = useRef<number | null>(null);
  const notificationAutosaveTokenRef = useRef(0);
  const lastSavedNotificationSettingsRef = useRef<string>('');
  const notificationSettingsHydratedRef = useRef(false);
  const sidebarPreferencesSyncInitializedRef = useRef(false);
  const sidebarOpacitySyncInitializedRef = useRef(false);

  const sidebarPositionOptions: Array<{
    value: SidebarPosition;
    label: string;
    description: string;
    icon: typeof ChevronRight;
  }> = [
    {
      value: 'right',
      label: 'Right',
      description: 'Keep sidebar docked on the right edge.',
      icon: ChevronRight,
    },
    {
      value: 'left',
      label: 'Left',
      description: 'Move sidebar to the left edge.',
      icon: ChevronLeft,
    },
    { value: 'top', label: 'Top', description: 'Horizontal layout at the top.', icon: ChevronsUp },
    {
      value: 'bottom',
      label: 'Bottom',
      description: 'Horizontal layout at the bottom.',
      icon: ChevronsDown,
    },
    {
      value: 'floating',
      label: 'Floating',
      description: 'Detached panel, draggable anywhere.',
      icon: Wind,
    },
  ];

  const sidebarDefaultStateOptions: Array<{
    value: SidebarDefaultState;
    label: string;
    description: string;
  }> = [
    {
      value: 'expanded',
      label: 'Expanded',
      description: 'Always open the full sidebar on launch.',
    },
    { value: 'collapsed', label: 'Collapsed', description: 'Start in the compact sidebar state.' },
    {
      value: 'remember',
      label: 'Remember last state',
      description: 'Restore the last open or collapsed state.',
    },
  ];

  useEffect(() => {
    const cachedPrefs = loadCachedPreferences();
    setPreferences(cachedPrefs);

    let cancelled = false;

    const buildSettingsSnapshot = (nextFullName: string, nextPreferences: UserPreferences) =>
      JSON.stringify({
        full_name: nextFullName,
        preferences: nextPreferences,
      });

    const loadSettings = async () => {
      try {
        const payload = (await api.getUserSettings()) as {
          full_name?: string | null;
          preferences?: Partial<UserPreferences> | null;
        };

        if (cancelled) return;

        const nextFullName = String(payload?.full_name ?? '').trim();
        const nextPreferences = {
          ...defaultPrefs,
          ...(payload?.preferences ?? {}),
        };

        setPreferences(nextPreferences);
        setFullName(
          nextFullName ||
            (user?.user_metadata?.full_name as string | undefined)?.trim() ||
            user?.email?.split('@')[0] ||
            ''
        );
        saveCachedPreferences(nextPreferences);
        const hydratedFullName =
          nextFullName ||
          (user?.user_metadata?.full_name as string | undefined)?.trim() ||
          user?.email?.split('@')[0] ||
          '';
        lastSavedSettingsRef.current = buildSettingsSnapshot(hydratedFullName, nextPreferences);
        lastSavedFullNameRef.current = hydratedFullName;
        settingsHydratedRef.current = true;

        const cachedLooksReal = JSON.stringify(cachedPrefs) !== JSON.stringify(defaultPrefs);
        const serverLooksUnset =
          !payload?.preferences || Object.keys(payload.preferences).length === 0;
        if (cachedLooksReal && serverLooksUnset) {
          await api.updateUserSettings({
            full_name: nextFullName || null,
            preferences: cachedPrefs,
          });
        }
      } catch {
        if (cancelled) return;
        setPreferences(cachedPrefs);
        const seedName =
          String(user?.user_metadata?.full_name ?? '').trim() || user?.email?.split('@')[0] || '';
        setFullName(seedName);
        lastSavedSettingsRef.current = buildSettingsSnapshot(seedName, cachedPrefs);
        lastSavedFullNameRef.current = seedName;
        settingsHydratedRef.current = true;
      } finally {
        // Initial load only hydrates state; persistence now happens automatically.
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [api, user?.email, user?.user_metadata?.full_name]);

  useEffect(() => {
    if (!settingsHydratedRef.current) return;

    const scheme = resolveDesktopThemeScheme(
      preferences.theme,
      getSystemDesktopThemeScheme()
    );
    applyDesktopCssVars(document.documentElement, scheme);
    window.ipcRenderer?.send('ledger:theme-updated', {
      theme: preferences.theme,
    });
  }, [preferences.theme]);

  useEffect(() => {
    let cancelled = false;

    const loadNotificationPreferences = async () => {
      try {
        const payload = (await api.getNotificationPreferences()) as Partial<NotificationPreferences>;

        if (cancelled) return;

        const nextPreferences = {
          ...defaultNotificationPrefs,
          ...(payload ?? {}),
        };

        setNotificationPreferences(nextPreferences);
        lastSavedNotificationSettingsRef.current = JSON.stringify(nextPreferences);
        notificationSettingsHydratedRef.current = true;
      } catch {
        if (cancelled) return;
        setNotificationPreferences(defaultNotificationPrefs);
        lastSavedNotificationSettingsRef.current = JSON.stringify(defaultNotificationPrefs);
        notificationSettingsHydratedRef.current = true;
      }
    };

    void loadNotificationPreferences();

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    void window.desktopWindow?.setAlwaysOnTop(alwaysOnTop).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [alwaysOnTop]);

  // Sync structural sidebar preferences separately from opacity so the range slider does not
  // trigger window-mode reapplication on every pointer move.
  useEffect(() => {
    if (!sidebarPreferencesSyncInitializedRef.current) {
      sidebarPreferencesSyncInitializedRef.current = true;
      return;
    }

    const { opacity: _opacity, ...restPreferences } = sidebarPreferences;
    void window.desktopWindow?.applySidebarPreferences(restPreferences).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [
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
    if (!sidebarOpacitySyncInitializedRef.current) {
      sidebarOpacitySyncInitializedRef.current = true;
      return;
    }

    saveSidebarPreferences({
      ...sidebarPreferences,
      opacity: sidebarPreferences.opacity,
    });
    void window.desktopWindow
      ?.applySidebarPreferences({ opacity: sidebarPreferences.opacity })
      .catch(() => {
        // No-op outside Electron (browser dev mode)
      });
  }, [sidebarPreferences.opacity]);

  useEffect(() => {
    const handleFocusSection = (_event: unknown, payload: { section?: string | null }) => {
      if (isSettingsSection(payload?.section)) {
        setActiveSection(payload.section);
        if (payload.section === 'integrations') {
          setSlackRefreshToken((value) => value + 1);
        }
      }
    };

    window.ipcRenderer?.on('settings:focus-section', handleFocusSection);
    return () => {
      window.ipcRenderer?.off('settings:focus-section', handleFocusSection);
    };
  }, []);

  const firstName = useMemo(() => {
    const candidate = fullName.trim();
    if (!candidate) return 'there';
    return candidate.split(' ')[0];
  }, [fullName]);

  const currentAccountSession = useMemo(
    () => accountSessions.find((session) => session.is_current) ?? null,
    [accountSessions]
  );
  const otherAccountSessions = useMemo(
    () => accountSessions.filter((session) => !session.is_current),
    [accountSessions]
  );
  const currentSessionDeviceLabel =
    currentAccountSession?.device_name?.trim() || getLedgerSessionDeviceName();
  const currentSessionPlatformLabel = formatLedgerSessionPlatformLabel(
    currentAccountSession?.platform ?? getLedgerSessionPlatform()
  );

  const handleResetSidebarSettings = () => {
    setPosition(defaultSidebarPreferences.position);
    setOpacity(defaultSidebarPreferences.opacity);
    setDefaultState(defaultSidebarPreferences.defaultState);
    setAlwaysOnTop(defaultSidebarPreferences.alwaysOnTop);
    setAutoHide(defaultSidebarPreferences.autoHide);
    setFloatingDockEnabled(defaultSidebarPreferences.floatingDockEnabled);
    setSaveStatus('Sidebar settings reset to defaults.');
  };

  const setTimedSaveStatus = (message: string, shouldClear = false) => {
    if (saveStatusTimerRef.current !== null) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }

    setSaveStatus(message);

    if (shouldClear) {
      saveStatusTimerRef.current = window.setTimeout(() => {
        saveStatusTimerRef.current = null;
        setSaveStatus(null);
      }, 3000);
    }
  };

  useEffect(() => {
    if (!settingsHydratedRef.current) return;

    const nextFullName = fullName.trim() || null;
    const nextPreferences = { ...preferences };

    const nextSnapshot = JSON.stringify({
      full_name: nextFullName,
      preferences: nextPreferences,
    });

    if (nextSnapshot === lastSavedSettingsRef.current) {
      return;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    const saveToken = ++autosaveTokenRef.current;
    setIsSavingPrefs(true);
    setSaveStatus('Saving automatically...');

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void (async () => {
        try {
          await api.updateUserSettings({
            full_name: nextFullName,
            preferences: nextPreferences,
          });

          if (String(nextFullName ?? '') !== lastSavedFullNameRef.current) {
            try {
              await authService.updateProfile(nextFullName);
            } catch (authError) {
              console.warn('Profile metadata sync failed', authError);
            }
          }

          saveCachedPreferences(nextPreferences);
          window.ipcRenderer?.send('tray:update-state', {
            showTrayIcon: nextPreferences.showTrayIcon,
            runInBackground: nextPreferences.runInBackground,
          });

          if (saveToken !== autosaveTokenRef.current) return;
          lastSavedSettingsRef.current = nextSnapshot;
          lastSavedFullNameRef.current = nextFullName ?? '';
          setTimedSaveStatus('Saved automatically.', true);
        } catch {
          if (saveToken !== autosaveTokenRef.current) return;
          setSaveStatus('Could not save automatically.');
        } finally {
          if (saveToken !== autosaveTokenRef.current) return;
          setIsSavingPrefs(false);
        }
      })();
    }, 450);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (saveStatusTimerRef.current !== null) {
        window.clearTimeout(saveStatusTimerRef.current);
        saveStatusTimerRef.current = null;
      }
    };
  }, [api, fullName, preferences]);

  useEffect(() => {
    if (!notificationSettingsHydratedRef.current) return;

    const nextSnapshot = JSON.stringify(notificationPreferences);
    if (nextSnapshot === lastSavedNotificationSettingsRef.current) {
      return;
    }

    if (notificationAutosaveTimerRef.current !== null) {
      window.clearTimeout(notificationAutosaveTimerRef.current);
    }

    const saveToken = ++notificationAutosaveTokenRef.current;
    setIsSavingNotificationPrefs(true);
    setSaveStatus('Saving automatically...');

    notificationAutosaveTimerRef.current = window.setTimeout(() => {
      notificationAutosaveTimerRef.current = null;
      void (async () => {
        try {
          await api.updateNotificationPreferences(notificationPreferences);
          window.ipcRenderer?.send('notifications:refresh');
          window.ipcRenderer?.send('tray:update-state', {
            notificationsPaused: notificationPreferences.paused,
          });

          if (saveToken !== notificationAutosaveTokenRef.current) return;
          lastSavedNotificationSettingsRef.current = nextSnapshot;
          setTimedSaveStatus('Saved automatically.', true);
        } catch {
          if (saveToken !== notificationAutosaveTokenRef.current) return;
          setSaveStatus('Could not save automatically.');
        } finally {
          if (saveToken !== notificationAutosaveTokenRef.current) return;
          setIsSavingNotificationPrefs(false);
        }
      })();
    }, 450);

    return () => {
      if (notificationAutosaveTimerRef.current !== null) {
        window.clearTimeout(notificationAutosaveTimerRef.current);
        notificationAutosaveTimerRef.current = null;
      }
    };
  }, [api, notificationPreferences]);

  const handleUpdatePassword = async () => {
    setPasswordError(null);
    setPasswordStatus(null);

    const password = newPassword.trim();
    if (password.length < 8) {
      setPasswordError('Use at least 8 characters.');
      return;
    }

    if (password !== confirmPassword.trim()) {
      setPasswordError('Password confirmation does not match.');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error } = await authService.updatePassword(password);
      if (error) throw error;
      setPasswordStatus('Password updated.');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordEditor(false);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspaceId) return;

    setWorkspaceStatus(null);
    setIsSwitchingWorkspace(true);
    try {
      await setActiveWorkspace(workspaceId);
      // Clear any stale admin data
      setWorkspaceMembers([]);
      setWorkspaceInvitations([]);
      setWorkspaceAdminError(null);
      await refreshWorkspaces();
      window.dispatchEvent(new CustomEvent('ledger:workspaces-changed'));
      setWorkspaceStatus('Active workspace updated.');
    } catch (err) {
      setWorkspaceStatus(err instanceof Error ? err.message : 'Could not switch workspace.');
      // If switching fails, try to recover by refreshing the list
      await refreshWorkspaces().catch(() => {
        // Silently fail - UI will show empty workspaces
      });
    } finally {
      setIsSwitchingWorkspace(false);
    }
  };

  const handleCreateWorkspace = async () => {
    const name = workspaceCreateName.trim();
    if (!name) {
      setWorkspaceAdminError('Workspace name is required');
      return;
    }

    setWorkspaceAdminError(null);
    setWorkspaceStatus(null);
    setWorkspaceCreateStatus(null);
    setIsCreatingWorkspace(true);

    try {
      const createdWorkspace = (await api.createWorkspace({
        name,
        description: workspaceCreateDescription.trim() || null,
        is_personal: workspaceCreateType === 'personal',
      })) as { id?: string };

      const newWorkspaceId = createdWorkspace?.id;

      setWorkspaceCreateName('');
      setWorkspaceCreateDescription('');
      setWorkspaceCreateType('team');

      if (newWorkspaceId) {
        window.localStorage.setItem('ledger:active-workspace-id', newWorkspaceId);
        window.localStorage.setItem('ledger:active-workspace-name', name);
      }

      if (newWorkspaceId) {
        try {
          await setActiveWorkspace(newWorkspaceId);
        } catch {
          // Silently fail - user can manually switch
        }
      }

      await refreshWorkspaces();
      
      window.dispatchEvent(new CustomEvent('ledger:workspaces-changed'));
      setWorkspaceCreateStatus('Workspace created and activated. Next step: invite teammates.');
      window.setTimeout(() => {
        inviteEmailRef.current?.focus();
      }, 0);
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not create workspace');
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  useEffect(() => {
    if (activeSection !== 'integrations' || !activeWorkspaceId) return;

    let cancelled = false;
    setIsLoadingSlackStatus(true);
    setSlackError(null);

    void (async () => {
      try {
        const statusPayload = (await api.getSlackIntegrationStatus(
          activeWorkspaceId
        )) as SlackIntegrationStatus;
        if (!cancelled) {
          setSlackStatus(statusPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setSlackStatus({ connected: false });
          setSlackError(
            err instanceof Error ? err.message : 'Could not load Slack connection status.'
          );
        }
      } finally {
        if (!cancelled) setIsLoadingSlackStatus(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, activeWorkspaceId, api, slackRefreshToken]);

  useEffect(() => {
    if (activeSection !== 'integrations' || !activeWorkspaceId) return;

    let cancelled = false;
    setIsLoadingExtensionTokenStatus(true);
    setExtensionTokenError(null);

    void (async () => {
      try {
        const statusPayload = (await api.getExtensionTokenStatus(
          activeWorkspaceId
        )) as ExtensionTokenStatus;
        if (!cancelled) {
          setExtensionTokenStatus(statusPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setExtensionTokenStatus({ exists: false });
          setExtensionTokenError(
            err instanceof Error ? err.message : 'Could not load browser extension token status.'
          );
        }
      } finally {
        if (!cancelled) setIsLoadingExtensionTokenStatus(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, activeWorkspaceId, api]);

  useEffect(() => {
    if (activeSection !== 'sessions') return;

    let cancelled = false;
    setIsLoadingAccountSessions(true);
    setAccountSessionsError(null);

    const refreshSessions = async () => {
      try {
        await api.heartbeatAccountSession();
        const payload = (await api.getAccountSessions()) as AccountSessionsResponse;
        if (cancelled) return;
        setAccountSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      } catch (err) {
        if (cancelled) return;
        setAccountSessionsError(err instanceof Error ? err.message : 'Could not load sessions.');
      } finally {
        if (!cancelled) {
          setIsLoadingAccountSessions(false);
        }
      }
    };

    void refreshSessions();

    if (sessionHeartbeatTimerRef.current !== null) {
      window.clearInterval(sessionHeartbeatTimerRef.current);
      sessionHeartbeatTimerRef.current = null;
    }

    sessionHeartbeatTimerRef.current = window.setInterval(() => {
      if (document.hidden) return;
      void api.heartbeatAccountSession().catch(() => {
        // Best effort only.
      });
    }, 10 * 60 * 1000);

    const handleWindowFocus = () => {
      void api.heartbeatAccountSession().catch(() => {
        // Best effort only.
      });
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
      if (sessionHeartbeatTimerRef.current !== null) {
        window.clearInterval(sessionHeartbeatTimerRef.current);
        sessionHeartbeatTimerRef.current = null;
      }
    };
  }, [activeSection, api]);

  const handleConnectSlack = async () => {
    if (!activeWorkspaceId) {
      setSlackError('Select a workspace before connecting Slack.');
      return;
    }

    setIsConnectingSlack(true);
    setSlackError(null);
    try {
      const payload = (await api.getSlackInstallUrl(activeWorkspaceId)) as { url?: string };
      const url = String(payload?.url ?? '').trim();
      if (!url) throw new Error('Slack install URL was not returned.');

      await openExternalUrl(url);
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : 'Could not start Slack connection.');
    } finally {
      setIsConnectingSlack(false);
    }
  };

  const handleDisconnectSlack = async () => {
    if (!activeWorkspaceId) {
      setSlackError('Select a workspace before disconnecting Slack.');
      return;
    }

    const confirmed = window.confirm(
      'Disconnect Slack from this workspace? Existing captures will remain in Ledger.'
    );
    if (!confirmed) return;

    setIsDisconnectingSlack(true);
    setSlackError(null);
    try {
      await api.disconnectSlackIntegration(activeWorkspaceId);
      setSlackStatus({ connected: false });
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : 'Could not disconnect Slack.');
    } finally {
      setIsDisconnectingSlack(false);
    }
  };

  const handleGenerateExtensionToken = async () => {
    if (!activeWorkspaceId) {
      setExtensionTokenError('Select a workspace before generating a browser extension token.');
      return;
    }

    setIsExtensionTokenBusy(true);
    setExtensionTokenError(null);
    setExtensionTokenCopyStatus(null);
    try {
      const payload = (await api.createExtensionToken(activeWorkspaceId)) as ExtensionTokenResponse;
      const token = String(payload?.token ?? '').trim();
      if (!token) throw new Error('Extension token was not returned.');
      setGeneratedExtensionToken(token);
      setExtensionTokenStatus(payload.status ?? { exists: true });
      setIsExtensionTokenModalOpen(true);
    } catch (err) {
      setExtensionTokenError(
        err instanceof Error ? err.message : 'Could not generate browser extension token.'
      );
    } finally {
      setIsExtensionTokenBusy(false);
    }
  };

  const handleRegenerateExtensionToken = async () => {
    if (!activeWorkspaceId) {
      setExtensionTokenError('Select a workspace before regenerating the browser extension token.');
      return;
    }

    setIsExtensionTokenBusy(true);
    setExtensionTokenError(null);
    setExtensionTokenCopyStatus(null);
    try {
      const payload = (await api.regenerateExtensionToken(
        activeWorkspaceId
      )) as ExtensionTokenResponse;
      const token = String(payload?.token ?? '').trim();
      if (!token) throw new Error('Extension token was not returned.');
      setGeneratedExtensionToken(token);
      setExtensionTokenStatus(payload.status ?? { exists: true });
      setExtensionTokenConfirmAction(null);
      setIsExtensionTokenModalOpen(true);
    } catch (err) {
      setExtensionTokenError(
        err instanceof Error ? err.message : 'Could not regenerate browser extension token.'
      );
    } finally {
      setIsExtensionTokenBusy(false);
    }
  };

  const handleRevokeExtensionToken = async () => {
    if (!activeWorkspaceId) {
      setExtensionTokenError('Select a workspace before revoking the browser extension token.');
      return;
    }

    setIsExtensionTokenBusy(true);
    setExtensionTokenError(null);
    try {
      const statusPayload = (await api.revokeExtensionToken(
        activeWorkspaceId
      )) as ExtensionTokenStatus;
      setExtensionTokenStatus(statusPayload ?? { exists: false });
      setGeneratedExtensionToken(null);
      setExtensionTokenConfirmAction(null);
      setIsExtensionTokenModalOpen(false);
    } catch (err) {
      setExtensionTokenError(
        err instanceof Error ? err.message : 'Could not revoke browser extension token.'
      );
    } finally {
      setIsExtensionTokenBusy(false);
    }
  };

  const handleCopyExtensionToken = async () => {
    if (!generatedExtensionToken) return;
    try {
      await navigator.clipboard.writeText(generatedExtensionToken);
      setExtensionTokenCopyStatus('Copied.');
    } catch {
      setExtensionTokenCopyStatus('Copy failed. Select the token manually.');
    }
  };

  const closeExtensionTokenModal = () => {
    setIsExtensionTokenModalOpen(false);
    setGeneratedExtensionToken(null);
    setExtensionTokenCopyStatus(null);
  };

  const openExternalUrl = async (url: string) => {
    if (window.desktopWindow?.openExternal) {
      await window.desktopWindow.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const canManageWorkspace = workspaceUserRole === 'owner' || workspaceUserRole === 'admin';
  const canUseWorkspaceIntegrations = workspaceUserRole !== 'viewer';

  useEffect(() => {
    const nextWorkspaceId = activeWorkspace?.id ?? null;
    const previousWorkspaceId = activeWorkspaceIdRef.current;
    activeWorkspaceIdRef.current = nextWorkspaceId;

    if (!nextWorkspaceId) {
      setWorkspaceEditName('');
      setWorkspaceEditDescription('');
      setWorkspaceDeleteConfirm('');
      setIsWorkspaceManageModalOpen(false);
      setIsWorkspaceDeleteModalOpen(false);
      return;
    }

    if (previousWorkspaceId && previousWorkspaceId !== nextWorkspaceId) {
      setWorkspaceEditName(activeWorkspace?.name ?? '');
      setWorkspaceEditDescription(activeWorkspace?.description ?? '');
      setWorkspaceDeleteConfirm('');
      setIsWorkspaceManageModalOpen(false);
      setIsWorkspaceDeleteModalOpen(false);
      return;
    }

    if (!isWorkspaceManageModalOpen && !isWorkspaceDeleteModalOpen) {
      setWorkspaceEditName(activeWorkspace?.name ?? '');
      setWorkspaceEditDescription(activeWorkspace?.description ?? '');
      setWorkspaceDeleteConfirm('');
    }
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.description, isWorkspaceDeleteModalOpen, isWorkspaceManageModalOpen]);

  const handleUpdateWorkspace = async () => {
    if (!activeWorkspaceId) return false;

    const name = workspaceEditName.trim();
    if (!name) {
      setWorkspaceEditError('Workspace name is required');
      return false;
    }

    setWorkspaceEditError(null);
    setWorkspaceEditStatus(null);
    setIsSavingWorkspace(true);

    try {
      await api.updateWorkspace(activeWorkspaceId, {
        name,
        description: workspaceEditDescription.trim() || null,
      });
      await refreshWorkspaces();
      window.dispatchEvent(new CustomEvent('ledger:workspaces-changed'));
      setWorkspaceEditStatus('Workspace details saved.');
      return true;
    } catch (err) {
      setWorkspaceEditError(err instanceof Error ? err.message : 'Could not save workspace');
      return false;
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!activeWorkspaceId || !activeWorkspace) return false;

    if (workspaceDeleteConfirm.trim() !== activeWorkspace.name.trim()) {
      setWorkspaceDeleteError('Type the workspace name to confirm deletion.');
      return false;
    }

    setWorkspaceDeleteError(null);
    setIsDeletingWorkspace(true);

    const nextWorkspace = workspaces.find((workspace) => workspace.id !== activeWorkspaceId) ?? null;

    try {
      await api.deleteWorkspace(activeWorkspaceId);
      setWorkspaceDeleteConfirm('');

      if (nextWorkspace) {
        window.localStorage.setItem('ledger:active-workspace-id', nextWorkspace.id);
        window.localStorage.setItem('ledger:active-workspace-name', nextWorkspace.name);

        try {
          await setActiveWorkspace(nextWorkspace.id);
          setWorkspaceMembers([]);
          setWorkspaceInvitations([]);
          setWorkspaceAdminError(null);
        } catch (switchErr) {
          console.warn('Could not auto-select workspace after deletion', switchErr);
        }
      } else {
        window.localStorage.removeItem('ledger:active-workspace-id');
        window.localStorage.removeItem('ledger:active-workspace-name');
      }

      await refreshWorkspaces();
      
      window.dispatchEvent(new CustomEvent('ledger:workspaces-changed'));
      return true;
    } catch (err) {
      setWorkspaceDeleteError(err instanceof Error ? err.message : 'Could not delete workspace');
      return false;
    } finally {
      setIsDeletingWorkspace(false);
    }
  };

  const activeWorkspaceKindLabel = activeWorkspace?.is_personal
    ? 'Personal workspace'
    : 'Team workspace';

  const openWorkspaceManageModal = () => {
    if (!activeWorkspace) return;

    setWorkspaceEditName(activeWorkspace.name);
    setWorkspaceEditDescription(activeWorkspace.description ?? '');
    setWorkspaceEditStatus(null);
    setWorkspaceEditError(null);
    setIsWorkspaceManageModalOpen(true);
  };

  const closeWorkspaceManageModal = () => {
    setIsWorkspaceManageModalOpen(false);
  };

  const openWorkspaceDeleteModal = () => {
    setWorkspaceDeleteConfirm('');
    setWorkspaceDeleteError(null);
    setIsWorkspaceDeleteModalOpen(true);
  };

  const closeWorkspaceDeleteModal = () => {
    setIsWorkspaceDeleteModalOpen(false);
    setWorkspaceDeleteConfirm('');
    setWorkspaceDeleteError(null);
  };

  const submitWorkspaceDeleteConfirmation = async () => {
    const succeeded = await handleDeleteWorkspace();
    if (succeeded) {
      closeWorkspaceDeleteModal();
      closeWorkspaceManageModal();
    }
  };

  const handleSaveWorkspaceChanges = async () => {
    const succeeded = await handleUpdateWorkspace();
    if (succeeded) {
      closeWorkspaceManageModal();
    }
  };

  useEffect(() => {
    if (!isWorkspaceManageModalOpen && !isWorkspaceDeleteModalOpen) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isWorkspaceDeleteModalOpen) {
        closeWorkspaceDeleteModal();
        return;
      }
      closeWorkspaceManageModal();
    };

    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isWorkspaceDeleteModalOpen, isWorkspaceManageModalOpen]);

  useEffect(() => {
    if (activeSection !== 'workspace' || !activeWorkspaceId) return;

    let cancelled = false;

    const loadWorkspaceAdminData = async () => {
      setIsLoadingWorkspaceAdmin(true);
      setWorkspaceAdminError(null);

      try {
        const [membersPayload, invitesPayload] = await Promise.all([
          api.getWorkspaceMembers(activeWorkspaceId),
          api.getWorkspaceInvitations(activeWorkspaceId),
        ]);

        if (cancelled) return;

        const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
          ? (membersPayload as { members: WorkspaceMember[] }).members
          : [];

        const nextInvites = Array.isArray(
          (invitesPayload as { invitations?: unknown[] })?.invitations
        )
          ? (invitesPayload as { invitations: WorkspaceInvitation[] }).invitations
          : [];

        setWorkspaceMembers(nextMembers);
        setWorkspaceInvitations(nextInvites);

        const roleCandidate = String(
          (membersPayload as { current_user_role?: string })?.current_user_role ?? 'member'
        ).toLowerCase();
        if (
          roleCandidate === 'owner' ||
          roleCandidate === 'admin' ||
          roleCandidate === 'member' ||
          roleCandidate === 'viewer'
        ) {
          setWorkspaceUserRole(roleCandidate);
        }
      } catch (err) {
        if (cancelled) return;
        // Gracefully handle errors loading workspace data (e.g., workspace deleted, no permission)
        const errorMsg = err instanceof Error ? err.message : 'Could not load workspace members';
        if (!errorMsg.includes('403') && !errorMsg.includes('404')) {
          setWorkspaceAdminError(errorMsg);
        }
        setWorkspaceMembers([]);
        setWorkspaceInvitations([]);
      } finally {
        if (!cancelled) {
          setIsLoadingWorkspaceAdmin(false);
        }
      }
    };

    void loadWorkspaceAdminData();

    return () => {
      cancelled = true;
    };
  }, [activeSection, activeWorkspaceId, api]);

  const handleUpdateMemberRole = async (userId: string, role: 'admin' | 'member' | 'viewer') => {
    if (!activeWorkspaceId) return;
    setWorkspaceAdminError(null);
    setMemberActionId(userId);

    try {
      await api.updateWorkspaceMemberRole(activeWorkspaceId, userId, role);
      const membersPayload = await api.getWorkspaceMembers(activeWorkspaceId);
      const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
        ? (membersPayload as { members: WorkspaceMember[] }).members
        : [];
      setWorkspaceMembers(nextMembers);
      window.dispatchEvent(new CustomEvent('ledger:membership-changed'));
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not update member role');
    } finally {
      setMemberActionId(null);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeWorkspaceId) return;
    setWorkspaceAdminError(null);
    setMemberActionId(userId);

    try {
      await api.removeWorkspaceMember(activeWorkspaceId, userId);
      const membersPayload = await api.getWorkspaceMembers(activeWorkspaceId);
      const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
        ? (membersPayload as { members: WorkspaceMember[] }).members
        : [];
      const invitesPayload = await api.getWorkspaceInvitations(activeWorkspaceId);
      const nextInvites = Array.isArray(
        (invitesPayload as { invitations?: unknown[] })?.invitations
      )
        ? (invitesPayload as { invitations: WorkspaceInvitation[] }).invitations
        : [];
      setWorkspaceMembers(nextMembers);
      setWorkspaceInvitations(nextInvites);
      window.dispatchEvent(new CustomEvent('ledger:membership-changed'));
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not remove member');
    } finally {
      setMemberActionId(null);
    }
  };

  const handleCreateInvitation = async () => {
    if (!activeWorkspaceId) return;
    const email = inviteEmail.trim();

    setWorkspaceAdminError(null);
    setWorkspaceStatus(null);
    setInviteCopyStatus(null);
    setIsSendingInvite(true);

    try {
      const payload = (await api.createWorkspaceInvitation(activeWorkspaceId, {
        email: email || null,
        role: inviteRole,
      })) as { invite_url?: string; invite_token?: string };

      setInviteEmail('');
      setInviteRole('member');
      setInviteLink(payload.invite_url ?? null);
      setInviteToken(payload.invite_token ?? null);

      const invitesPayload = await api.getWorkspaceInvitations(activeWorkspaceId);
      const nextInvites = Array.isArray(
        (invitesPayload as { invitations?: unknown[] })?.invitations
      )
        ? (invitesPayload as { invitations: WorkspaceInvitation[] }).invitations
        : [];
      setWorkspaceInvitations(nextInvites);
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not create invitation');
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleCopyInvitationLink = async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopyStatus('Copied.');
    } catch {
      setInviteCopyStatus('Copy failed. Select the link manually.');
    }
  };

  const selectedInvite = inviteModal
    ? workspaceInvitations.find((invite) => invite.id === inviteModal.id) ?? null
    : null;

  const getInviteUrl = (invite: WorkspaceInvitation) => {
    const token = invite.token?.trim();
    if (!token) return null;
    return buildInviteUrl(token);
  };

  const handleCopySelectedInviteLink = async () => {
    if (!selectedInvite) return;
    const inviteUrl = getInviteUrl(selectedInvite);
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setWorkspaceAdminError(null);
      setWorkspaceStatus('Invite link copied.');
    } catch {
      setWorkspaceAdminError('Copy failed. Select the link manually.');
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!activeWorkspaceId) return;
    setWorkspaceAdminError(null);
    setInvitationActionId(invitationId);

    try {
      await api.revokeWorkspaceInvitation(activeWorkspaceId, invitationId);
      const invitesPayload = await api.getWorkspaceInvitations(activeWorkspaceId);
      const nextInvites = Array.isArray(
        (invitesPayload as { invitations?: unknown[] })?.invitations
      )
        ? (invitesPayload as { invitations: WorkspaceInvitation[] }).invitations
        : [];
      setWorkspaceInvitations(nextInvites);
      if (inviteModal?.id === invitationId) {
        setInviteModal(null);
      }
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not revoke invitation');
    } finally {
      setInvitationActionId(null);
    }
  };

  const attemptCloseSettings = () => {
    if (isSavingPrefs || isSavingWorkspace) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('settings');
  };

  const isSettingsModalOpen =
    showCloseGuardModal ||
    isExtensionTokenModalOpen ||
    extensionTokenConfirmAction !== null ||
    (isWorkspaceManageModalOpen && Boolean(activeWorkspace)) ||
    (isWorkspaceDeleteModalOpen && Boolean(activeWorkspace)) ||
    Boolean(inviteModal && selectedInvite);

  return (
    <div
      className={settingsTheme.shell}
      style={{ scrollbarGutter: isSettingsModalOpen ? 'auto' : 'stable' }}
    >
      <CloseGuardModal
        isOpen={showCloseGuardModal}
        isSaving
        hasUnsavedChanges={false}
        onCancel={() => setShowCloseGuardModal(false)}
      />
      <ModuleWindowHeader
        title="Settings"
        subtitle="Defaults, accessible controls"
        icon={<Settings size={18} className="text-[var(--ledger-text-secondary)]" />}
        closeLabel="Close settings"
        minimizeLabel="Minimize settings"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('settings');
        }}
        fullscreenLabel="Fullscreen settings"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('settings');
        }}
        onClose={attemptCloseSettings}
        actions={
          <button
            onClick={() => {
              void signOut();
            }}
            className={settingsTheme.headerButton}
          >
            Sign out
          </button>
        }
      />

      <div className={settingsTheme.root}>
        <div className="h-full grid grid-cols-[260px_1fr]">
          <aside
            className={settingsTheme.aside}
            aria-label="Settings sections"
          >
            <div className={settingsTheme.sideHeader}>
              <p className={settingsTheme.sideLabel}>Account</p>
              <p className={settingsTheme.sideTitle}>Hi {firstName}</p>
              <p className={settingsTheme.sideMeta}>
                {user?.email ?? 'No email available'}
              </p>
            </div>

            <nav className="space-y-1.5" aria-label="Settings navigation">
              {sectionOrder.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`${settingsTheme.navButton} ${
                    activeSection === section.id
                      ? settingsTheme.navButtonActive
                      : settingsTheme.navButtonIdle
                  }`}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                >
                  <p className="text-sm font-semibold">{section.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">{section.description}</p>
                </button>
              ))}
            </nav>
          </aside>

          <main
            className={`${settingsTheme.main} ${isSettingsModalOpen ? 'overflow-hidden' : 'overflow-auto'}`}
            aria-live="polite"
          >
            <div className="mx-auto max-w-4xl space-y-5">
              {activeSection === 'account' && (
                <section className="w-full max-w-215" aria-labelledby="settings-account">
                  <div className="space-y-2">
                    <h2 id="settings-account" className={settingsTheme.pageTitle}>
                      Account
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Basic identity and security settings.
                    </p>
                    <p className={settingsTheme.pageStatus} role="status">
                      {saveStatus ?? 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-10">
                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-profile">
                      <h3 id="settings-profile" className={settingsTheme.sectionTitle}>
                        Profile
                      </h3>

                      <div className={settingsTheme.sectionRows}>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                          <div className="space-y-1">
                            <label htmlFor="settings-full-name" className={settingsTheme.rowLabel}>
                              Display name
                            </label>
                            <p className={settingsTheme.rowMuted}>Your name as it appears in Ledger.</p>
                          </div>
                          <div className="max-w-130">
                            <input
                              id="settings-full-name"
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              className={settingsTheme.input}
                            />
                          </div>
                        </div>

                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                          <div className="space-y-1">
                            <label htmlFor="settings-email" className={settingsTheme.rowLabel}>
                              Email
                            </label>
                            <p className={settingsTheme.rowMuted}>Used for signing in.</p>
                          </div>
                          <div className="max-w-130 text-sm text-[var(--ledger-text-secondary)]">
                            {user?.email ?? 'No email available'}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-security">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-security" className={settingsTheme.sectionTitle}>
                            Security
                          </h3>
                          <p className={settingsTheme.rowMuted}>
                            Change your account password.
                          </p>
                        </div>
                        {!showPasswordEditor ? (
                          <button
                            type="button"
                            onClick={() => setShowPasswordEditor(true)}
                            className={settingsTheme.headerButton}
                          >
                            Change password
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setShowPasswordEditor(false);
                              setNewPassword('');
                              setConfirmPassword('');
                              setPasswordError(null);
                              setPasswordStatus(null);
                            }}
                            className={settingsTheme.headerButton}
                          >
                            Cancel
                          </button>
                        )}
                      </div>

                      {showPasswordEditor ? (
                        <div className="mt-5 max-w-155 space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="grid gap-2">
                              <label
                                htmlFor="settings-password"
                                className={settingsTheme.rowLabel}
                              >
                                New password
                              </label>
                              <input
                                id="settings-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className={settingsTheme.inputSecondary}
                              />
                            </div>
                            <div className="grid gap-2">
                              <label
                                htmlFor="settings-password-confirm"
                                className={settingsTheme.rowLabel}
                              >
                                Confirm password
                              </label>
                              <input
                                id="settings-password-confirm"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className={settingsTheme.inputSecondary}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => void handleUpdatePassword()}
                              disabled={isUpdatingPassword}
                              className={settingsTheme.primaryButton}
                            >
                              {isUpdatingPassword ? 'Updating...' : 'Update password'}
                            </button>
                            {isUpdatingPassword && (
                              <Loader2 size={14} className="animate-spin text-[var(--ledger-text-muted)]" />
                            )}
                          </div>
                          {passwordError && (
                            <p className="flex items-center gap-1.5 text-xs text-[var(--ledger-danger)]">
                              <CircleAlert size={12} />
                              {passwordError}
                            </p>
                          )}
                          {passwordStatus && (
                            <p className="text-xs text-[var(--ledger-success)]">{passwordStatus}</p>
                          )}
                        </div>
                      ) : null}
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-session">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-session" className={settingsTheme.sectionTitle}>
                            Session
                          </h3>
                          <p className={settingsTheme.rowMuted}>
                            Sign out of Ledger on this device.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void signOut();
                          }}
                          className={settingsTheme.dangerButton}
                        >
                          Sign out
                        </button>
                      </div>
                    </section>
                  </div>
                </section>
              )}

              {activeSection === 'sessions' && (
                <section className="w-full max-w-215" aria-labelledby="settings-sessions">
                  <div className="space-y-2">
                    <h2 id="settings-sessions" className={settingsTheme.pageTitle}>
                      Sessions
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Manage devices signed in to your Ledger account.
                    </p>
                    <p className={settingsTheme.pageStatus} role="status">
                      {accountSessionsError ||
                        (isLoadingAccountSessions
                          ? 'Loading sessions...'
                          : 'We only show your devices here. Revocation support comes next.')}
                    </p>
                  </div>

                  <div className="mt-8 space-y-10">
                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-current-session">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-current-session" className={settingsTheme.sectionTitle}>
                            Current device
                          </h3>
                          <p className={settingsTheme.rowMuted}>
                            The device currently signed in to Ledger.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void signOut();
                          }}
                          className={settingsTheme.dangerButton}
                        >
                          Sign out this device
                        </button>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className={settingsTheme.rowLabel}>Device</div>
                          <div className={settingsTheme.rowValue}>
                            {currentSessionDeviceLabel}
                          </div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className={settingsTheme.rowLabel}>App</div>
                          <div className={settingsTheme.rowValue}>{currentSessionPlatformLabel}</div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className={settingsTheme.rowLabel}>Status</div>
                          <div className={settingsTheme.rowValue}>
                            {formatLedgerSessionRelativeTime(currentAccountSession?.last_seen_at)}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-other-sessions">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-other-sessions" className={settingsTheme.sectionTitle}>
                            Other devices
                          </h3>
                          <p className={settingsTheme.rowMuted}>
                            Signed-in devices besides this one.
                          </p>
                        </div>
                        <span className={settingsTheme.pill}>
                          {otherAccountSessions.length} device{otherAccountSessions.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        {isLoadingAccountSessions ? (
                          <div className="py-5 text-sm text-[var(--ledger-text-muted)]">Loading sessions...</div>
                        ) : otherAccountSessions.length === 0 ? (
                          <div className="py-5 text-sm text-[var(--ledger-text-muted)]">
                            No other devices are currently listed.
                          </div>
                        ) : (
                          otherAccountSessions.map((session) => (
                            <div
                              key={session.id}
                              className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)_auto]"
                            >
                              <div className={settingsTheme.rowLabel}>
                                {session.device_name?.trim() ||
                                  formatLedgerSessionPlatformLabel(session.platform)}
                              </div>
                              <div className="space-y-0.5">
                                <div className={settingsTheme.rowValue}>
                                  {formatLedgerSessionPlatformLabel(session.platform)}
                                </div>
                                <div className={settingsTheme.rowMuted}>
                                  {formatLedgerSessionRelativeTime(session.last_seen_at)}
                                </div>
                              </div>
                              <div className="md:justify-self-end">
                                <button
                                  type="button"
                                  disabled
                                  className={settingsTheme.disabledButton}
                                >
                                  Coming soon
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    <div className="rounded-2xl border border-dashed border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-4 py-3 text-xs text-[var(--ledger-text-muted)]">
                      Sign-out for other devices is scaffolded here. It will be wired only when the auth
                      provider can revoke sessions safely.
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'workspace' && (
                <section className="w-full max-w-215" aria-labelledby="settings-workspace">
                  <div className="space-y-2">
                    <h2 id="settings-workspace" className={settingsTheme.pageTitle}>
                      Workspace
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Manage workspace identity, members, and defaults.
                    </p>
                    <p className={settingsTheme.pageStatus} role="status">
                      {workspaceStatus || workspaceError || 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-10">
                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-current-workspace">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-current-workspace" className={settingsTheme.sectionTitle}>
                            Current workspace
                          </h3>
                          <p className={settingsTheme.sectionStatus}>The workspace currently active in Ledger.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void refreshWorkspaces()}
                            disabled={isLoadingWorkspaces || isSwitchingWorkspace}
                            className={settingsTheme.controlButtonNeutral}
                          >
                            Refresh
                          </button>
                          {canManageWorkspace ? (
                            <button
                              onClick={openWorkspaceManageModal}
                              className={settingsTheme.controlButton}
                            >
                              Manage
                            </button>
                          ) : (
                            <span className={settingsTheme.pill}>
                              Owner only
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                          <div className={settingsTheme.rowLabel}>Theme</div>
                          <div className="space-y-2">
                            <div className="inline-flex w-full overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]">
                              {themeOptionOrder.map((option, index) => {
                                const isSelected = preferences.theme === option.value;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      setPreferences((current) => ({
                                        ...current,
                                        theme: option.value,
                                      }))
                                    }
                                    className={`flex-1 px-4 py-3 text-sm font-medium transition ${
                                      index > 0 ? 'border-l border-[color:var(--ledger-border-subtle)]' : ''
                                    } ${
                                      isSelected
                                        ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                    }`}
                                    aria-pressed={isSelected}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-xs leading-5 text-[var(--ledger-text-muted)]">
                              {themeOptionOrder.find((option) => option.value === preferences.theme)?.description}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className={settingsTheme.rowLabel}>Name</div>
                          <div className={settingsTheme.rowValue}>
                            {activeWorkspace?.name ?? 'No workspace selected'}
                          </div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className={settingsTheme.rowLabel}>Type</div>
                          <div className={settingsTheme.rowValue}>{activeWorkspaceKindLabel}</div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className={settingsTheme.rowLabel}>Description</div>
                          <div className="max-w-140 text-sm leading-6 text-[var(--ledger-text-secondary)]">
                            {activeWorkspace?.description?.trim() || 'No description set.'}
                          </div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                          <div className={settingsTheme.rowLabel}>Switch workspace</div>
                          <div className="max-w-130">
                            <select
                              id="settings-active-workspace"
                              value={activeWorkspaceId ?? ''}
                              onChange={(e) => void handleSwitchWorkspace(e.target.value)}
                              disabled={isLoadingWorkspaces || isSwitchingWorkspace || workspaces.length === 0}
                              className={settingsTheme.inputSecondary + ' appearance-none pr-9'}
                              style={selectChevronStyle}
                            >
                              {workspaces.length === 0 && (
                                <option value="">No workspaces available</option>
                              )}
                              {workspaces.map((workspace) => (
                                <option key={workspace.id} value={workspace.id}>
                                  {workspace.name} ({workspace.role})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-members">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-members" className={settingsTheme.sectionTitle}>
                            Members
                          </h3>
                          <p className={settingsTheme.sectionStatus}>Manage access for the selected workspace.</p>
                        </div>
                        <span className={settingsTheme.pill}>
                          {workspaceUserRole === 'owner' ? 'Owner' : `Role: ${workspaceUserRole}`}
                        </span>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        {isLoadingWorkspaceAdmin ? (
                          <div className="py-4 text-xs text-[var(--ledger-text-muted)]">Loading members...</div>
                        ) : workspaceMembers.length === 0 ? (
                          <div className="py-4 text-xs text-[var(--ledger-text-muted)]">No members yet.</div>
                        ) : (
                          workspaceMembers.map((member) => {
                            const displayName = member.full_name || member.email || member.user_id;
                            const canEditRole =
                              canManageWorkspace && !member.is_owner && member.user_id !== user?.id;
                            return (
                              <div
                                key={member.user_id}
                                className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">{displayName}</p>
                                  <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                                    {member.email || 'No email'}{member.is_owner ? ' · Owner' : ''}
                                  </p>
                                </div>
                                <select
                                  value={member.is_owner ? 'owner' : member.role}
                                  onChange={(e) =>
                                    void handleUpdateMemberRole(
                                      member.user_id,
                                      e.target.value as 'admin' | 'member' | 'viewer'
                                    )
                                  }
                                  disabled={!canEditRole || memberActionId === member.user_id}
                                  className={settingsTheme.inputSecondary + ' h-8 w-full appearance-none rounded-lg px-2 pr-8 text-xs md:w-auto'}
                                  style={selectChevronStyle}
                                  aria-label={`Update ${displayName} role`}
                                >
                                  {member.is_owner ? (
                                    <option value="owner">owner</option>
                                  ) : (
                                    <>
                                      <option value="admin">admin</option>
                                      <option value="member">member</option>
                                      <option value="viewer">viewer</option>
                                    </>
                                  )}
                                </select>
                                <button
                                  onClick={() => void handleRemoveMember(member.user_id)}
                                  disabled={
                                    !canManageWorkspace ||
                                    member.is_owner ||
                                    member.user_id === user?.id ||
                                    memberActionId === member.user_id
                                  }
                                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {workspaceAdminError && (
                        <p className="mt-3 text-xs text-[var(--ledger-danger)]" role="status">
                          {workspaceAdminError}
                        </p>
                      )}
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-invites">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-invites" className={settingsTheme.sectionTitle}>
                            Invites
                          </h3>
                          <p className={settingsTheme.sectionStatus}>Invite someone to this workspace.</p>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-2 md:grid-cols-[minmax(0,1fr)_148px_auto]">
                        <input
                          ref={inviteEmailRef}
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="name@example.com"
                          disabled={!canManageWorkspace || isSendingInvite}
                          className={settingsTheme.input}
                          aria-label="Invite email optional"
                        />
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                          disabled={!canManageWorkspace || isSendingInvite}
                          className={settingsTheme.inputSecondary + ' appearance-none pr-8'}
                          style={selectChevronStyle}
                          aria-label="Invite role"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          onClick={() => void handleCreateInvitation()}
                          disabled={!canManageWorkspace || isSendingInvite}
                          className={settingsTheme.footerButton + ' h-9 px-3 text-xs'}
                        >
                          {isSendingInvite ? 'Creating...' : 'Create invite'}
                        </button>
                      </div>
                      <p className={settingsTheme.rowMuted + ' mt-2 leading-5'}>
                        Optional email. Invite links can be copied and shared manually.
                      </p>

                      {(inviteLink || inviteToken) && (
                        <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                          <p className={settingsTheme.rowMuted.replace('text-xs', 'text-xs font-medium')}>Invite link</p>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                            {inviteLink && (
                              <p className="min-w-0 flex-1 break-all text-sm text-[var(--ledger-text-secondary)]">
                                {inviteLink}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleCopyInvitationLink()}
                              disabled={!inviteLink}
                              className={settingsTheme.controlButtonNeutral + ' inline-flex items-center justify-center gap-2'}
                            >
                              <Copy size={14} />
                              Copy link
                            </button>
                          </div>
                          {inviteCopyStatus && (
                            <p className="mt-2 text-xs text-[var(--ledger-text-secondary)]">{inviteCopyStatus}</p>
                          )}
                        </div>
                      )}

                      <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                        <p className={settingsTheme.rowMuted.replace('text-xs', 'text-xs font-medium')}>Recent invites</p>
                        <div className={settingsTheme.sectionRows}>
                          {workspaceInvitations.length === 0 ? (
                            <div className="py-4 text-xs text-[var(--ledger-text-muted)]">No pending invites.</div>
                          ) : (
                            workspaceInvitations.map((invite) => (
                              <div
                                key={invite.id}
                                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-4"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                    {invite.invited_email}
                                  </p>
                                  <p className="text-xs text-[var(--ledger-text-muted)]">
                                    {invite.role} · {invite.status}
                                  </p>
                                </div>
                                <p className="text-[11px] text-[var(--ledger-text-muted)]">
                                  {new Date(invite.expires_at).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                                <button
                                  onClick={() => setInviteModal({ id: invite.id })}
                                  disabled={!canManageWorkspace}
                                  className={settingsTheme.controlButtonNeutral + ' rounded-lg px-2'}
                                >
                                  Manage
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-defaults">
                      <h3 id="settings-defaults" className={settingsTheme.sectionTitle}>Defaults</h3>
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor="settings-week-start" className="mb-2 block text-xs font-medium text-[var(--ledger-text-muted)]">
                            Week starts on
                          </label>
                          <select
                            id="settings-week-start"
                            value={preferences.weekStartsOn}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                weekStartsOn: e.target.value as 'sunday' | 'monday',
                              }))
                            }
                            className={settingsTheme.inputSecondary + ' appearance-none pr-9'}
                            style={selectChevronStyle}
                          >
                            <option value="monday">Monday</option>
                            <option value="sunday">Sunday</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="settings-time-format" className="mb-2 block text-xs font-medium text-[var(--ledger-text-muted)]">
                            Time format
                          </label>
                          <select
                            id="settings-time-format"
                            value={preferences.timeFormat}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                timeFormat: e.target.value as '12h' | '24h',
                              }))
                            }
                            className={settingsTheme.inputSecondary + ' appearance-none pr-9'}
                            style={selectChevronStyle}
                          >
                            <option value="12h">12-hour (2:00 PM)</option>
                            <option value="24h">24-hour (14:00)</option>
                          </select>
                        </div>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-create-workspace">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-create-workspace" className={settingsTheme.sectionTitle}>
                            Create workspace
                          </h3>
                          <p className={settingsTheme.sectionStatus}>
                            Create another focused space for school, internship, freelance, or personal work.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowCreateWorkspaceForm((value) => !value)}
                          className={settingsTheme.controlButton}
                          aria-label={showCreateWorkspaceForm ? 'Close workspace creation' : 'Create workspace'}
                        >
                          {showCreateWorkspaceForm ? 'Collapse' : 'Create workspace'}
                        </button>
                      </div>

                      {showCreateWorkspaceForm ? (
                        <div className="mt-5 space-y-3">
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_176px]">
                            <input
                              value={workspaceCreateName}
                              onChange={(e) => setWorkspaceCreateName(e.target.value)}
                              placeholder="Workspace name"
                              className={compactFieldClassName}
                              aria-label="Workspace name"
                            />
                            <select
                              value={workspaceCreateType}
                              onChange={(e) =>
                                setWorkspaceCreateType(e.target.value as 'team' | 'personal')
                              }
                              className={compactSelectClassName}
                              style={selectChevronStyle}
                              aria-label="Workspace type"
                            >
                              <option value="team">Team workspace</option>
                              <option value="personal">Personal workspace</option>
                            </select>
                          </div>
                          <textarea
                            value={workspaceCreateDescription}
                            onChange={(e) => setWorkspaceCreateDescription(e.target.value)}
                            placeholder="Optional description"
                            className={settingsTheme.input + ' min-h-14 resize-none py-2'}
                            aria-label="Workspace description"
                          />
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-h-5">
                              {workspaceCreateStatus && (
                                <p className="text-xs text-[color:var(--ledger-accent)]">{workspaceCreateStatus}</p>
                              )}
                            </div>
                            <button
                              onClick={() => void handleCreateWorkspace()}
                              disabled={isCreatingWorkspace || !workspaceCreateName.trim()}
                              className={settingsTheme.primaryButton + ' h-8 rounded-lg px-3 text-xs'}
                            >
                              {isCreatingWorkspace ? 'Creating...' : 'Create workspace'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="settings-danger-zone">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-danger-zone" className={settingsTheme.sectionTitle}>
                            Danger zone
                          </h3>
                          <p className={settingsTheme.sectionStatus}>
                            Delete this workspace and all data inside it.
                          </p>
                        </div>
                        <button
                          onClick={openWorkspaceDeleteModal}
                          disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                          className={settingsTheme.dangerButton}
                        >
                          Delete workspace
                        </button>
                      </div>
                    </section>
                  </div>
                </section>
              )}
              {activeSection === 'calendar' && (
                <section className="w-full max-w-215" aria-labelledby="settings-calendar">
                  <div className="space-y-2">
                    <h2 id="settings-calendar" className={settingsTheme.pageTitle}>
                      Calendar and reminders
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Set how Ledger schedules events, reminders, follow-ups, and overdue items.
                    </p>
                    <p className={settingsTheme.pageStatus} role="status">
                      Changes save automatically.
                    </p>
                  </div>

                  <div className="mt-8 space-y-8">
                    <section className={settingsTheme.sectionShell} aria-labelledby="calendar-defaults">
                      <h3 id="calendar-defaults" className={settingsTheme.sectionTitle}>
                        Calendar defaults
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Default event duration"
                          help="Used when creating a new event."
                        >
                          <select
                            id="settings-event-duration"
                            value={String(preferences.defaultEventMinutes)}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultEventMinutes: Number(e.target.value) as 30 | 45 | 60,
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">60 minutes</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default event calendar"
                          help="Where new events are created by default."
                        >
                          <select
                            id="settings-event-calendar"
                            value={preferences.defaultEventCalendar}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultEventCalendar: e.target.value as 'personal' | 'work' | 'projects',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="personal">Personal</option>
                            <option value="work">Work</option>
                            <option value="projects">Projects</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default event status"
                          help="Initial state for new events."
                        >
                          <select
                            id="settings-event-status"
                            value={preferences.defaultEventStatus}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultEventStatus: e.target.value as
                                  | 'planned'
                                  | 'tentative'
                                  | 'confirmed',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="planned">Planned</option>
                            <option value="tentative">Tentative</option>
                            <option value="confirmed">Confirmed</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default event visibility"
                          help="Choose whether new events are private or workspace-visible."
                        >
                          <select
                            id="settings-event-visibility"
                            value={preferences.defaultEventVisibility}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultEventVisibility: e.target.value as 'private' | 'workspace',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="private">Private</option>
                            <option value="workspace">Workspace</option>
                          </select>
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="reminder-defaults">
                      <h3 id="reminder-defaults" className={settingsTheme.sectionTitle}>
                        Reminder defaults
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Default reminder timing"
                          help="When reminders should alert you before due time."
                        >
                          <select
                            id="settings-reminder-lead"
                            value={String(preferences.reminderLeadMinutes)}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                reminderLeadMinutes: Number(e.target.value) as 5 | 10 | 15 | 30,
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="5">5 minutes before</option>
                            <option value="10">10 minutes before</option>
                            <option value="15">15 minutes before</option>
                            <option value="30">30 minutes before</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default reminder time"
                          help="Used when a reminder has a date but no time."
                        >
                          <select
                            id="settings-default-reminder-time"
                            value={preferences.defaultReminderTime}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultReminderTime: e.target.value as
                                  | '08:00'
                                  | '09:00'
                                  | '12:00'
                                  | '17:00',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="08:00">8:00 AM</option>
                            <option value="09:00">9:00 AM</option>
                            <option value="12:00">12:00 PM</option>
                            <option value="17:00">5:00 PM</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Snooze options"
                          help="Quick choices shown in reminder notifications."
                        >
                          <select
                            id="settings-reminder-snooze"
                            value={preferences.reminderSnoozePreset}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                reminderSnoozePreset: e.target.value as
                                  | '10m-1h-tomorrow'
                                  | '5m-15m-1h'
                                  | '15m-1h-tomorrow',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="10m-1h-tomorrow">10 min, 1 hour, tomorrow</option>
                            <option value="5m-15m-1h">5 min, 15 min, 1 hour</option>
                            <option value="15m-1h-tomorrow">15 min, 1 hour, tomorrow</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Reminder destination"
                          help="Where reminders appear in Ledger."
                        >
                          <select
                            id="settings-reminder-destination"
                            value={preferences.reminderDestination}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                reminderDestination: e.target.value as
                                  | 'today-calendar'
                                  | 'today'
                                  | 'calendar',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="today-calendar">Today + Calendar</option>
                            <option value="today">Today</option>
                            <option value="calendar">Calendar</option>
                          </select>
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="overdue-behavior">
                      <h3 id="overdue-behavior" className={settingsTheme.sectionTitle}>
                        Overdue behavior
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="When reminders are missed"
                          help="What Ledger does when a reminder is overdue."
                        >
                          <select
                            id="settings-missed-reminder"
                            value={preferences.missedReminderBehavior}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                missedReminderBehavior: e.target.value as
                                  | 'needs_attention'
                                  | 'today'
                                  | 'hide',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="needs_attention">Move to Needs Attention</option>
                            <option value="today">Keep in Today</option>
                            <option value="hide">Hide until rescheduled</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Completed reminders"
                          help="How completed reminders are shown."
                        >
                          <select
                            id="settings-completed-reminders"
                            value={preferences.completedReminderBehavior}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                completedReminderBehavior: e.target.value as
                                  | 'collapse'
                                  | 'keep_visible'
                                  | 'hide_immediately',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="keep_visible">Keep visible today</option>
                            <option value="collapse">Collapse after completion</option>
                            <option value="hide_immediately">Hide immediately</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Past events"
                          help="How Ledger treats completed or past events."
                        >
                          <select
                            id="settings-past-events"
                            value={preferences.pastEventBehavior}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                pastEventBehavior: e.target.value as
                                  | 'history'
                                  | 'fade'
                                  | 'upcoming_only',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="history">Keep as history</option>
                            <option value="fade">Fade in calendar</option>
                            <option value="upcoming_only">Hide from upcoming only</option>
                          </select>
                        </PreferenceRow>
                      </div>
                      <p className={settingsTheme.rowMuted + ' mt-3 leading-5'}>
                        Past events stay in Calendar history. Missed reminders stay visible until
                        completed, rescheduled, or dismissed.
                      </p>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="follow-up-behavior">
                      <h3 id="follow-up-behavior" className={settingsTheme.sectionTitle}>
                        Follow-up behavior
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="After events end"
                          help="What Ledger offers after an event finishes."
                        >
                          <select
                            id="settings-follow-up-behavior"
                            value={preferences.followUpBehavior}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                followUpBehavior: e.target.value as
                                  | 'none'
                                  | 'offer'
                                  | 'review_prompt',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="none">Do nothing</option>
                            <option value="offer">Offer follow-up</option>
                            <option value="review_prompt">Create review prompt</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Follow-up default time"
                          help="Default time for suggested follow-ups."
                        >
                          <select
                            id="settings-follow-up-default-time"
                            value={preferences.followUpDefaultTime}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                followUpDefaultTime: e.target.value as
                                  | 'tomorrow_9'
                                  | 'today_5'
                                  | 'next_morning'
                                  | 'custom',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="tomorrow_9">Tomorrow at 9:00 AM</option>
                            <option value="today_5">Today at 5:00 PM</option>
                            <option value="next_morning">Next morning</option>
                            <option value="custom">Custom</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Event notes"
                          help="Allow notes to be attached directly to events."
                        >
                          <select
                            id="settings-event-notes"
                            value={preferences.eventNotesBehavior}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                eventNotesBehavior: e.target.value as 'enabled' | 'disabled',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="enabled">Enabled</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Linked project follow-ups"
                          help="Where follow-ups from events should appear."
                        >
                          <select
                            id="settings-linked-project-follow-ups"
                            value={preferences.linkedProjectFollowUps}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                linkedProjectFollowUps: e.target.value as
                                  | 'project_and_today'
                                  | 'project_only'
                                  | 'today_only',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="project_and_today">Project and Today</option>
                            <option value="project_only">Project only</option>
                            <option value="today_only">Today only</option>
                          </select>
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="calendar-display">
                      <h3 id="calendar-display" className={settingsTheme.sectionTitle}>
                        Calendar display
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Default calendar view"
                          help="Which calendar view opens first."
                        >
                          <select
                            id="settings-default-calendar-view"
                            value={preferences.defaultCalendarView}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultCalendarView: e.target.value as 'day' | 'week' | 'month',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="day">Day</option>
                            <option value="week">Week</option>
                            <option value="month">Month</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow label="Week starts on" help="Start the week on Sunday or Monday.">
                          <select
                            id="settings-week-starts-on"
                            value={preferences.weekStartsOn}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                weekStartsOn: e.target.value as 'sunday' | 'monday',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="monday">Monday</option>
                            <option value="sunday">Sunday</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow label="Time format" help="Choose 12-hour or 24-hour time.">
                          <select
                            id="settings-time-format"
                            value={preferences.timeFormat}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                timeFormat: e.target.value as '12h' | '24h',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="12h">12-hour (2:00 PM)</option>
                            <option value="24h">24-hour (14:00)</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Show weekends"
                          help="Include Saturday and Sunday in week view."
                        >
                          <InlineSwitch
                            checked={preferences.showWeekends}
                            onToggle={() =>
                              setPreferences((prev) => ({
                                ...prev,
                                showWeekends: !prev.showWeekends,
                              }))
                            }
                            label="Show weekends"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="Show reminders on calendar"
                          help="Surface reminders directly in the calendar grid."
                        >
                          <InlineSwitch
                            checked={preferences.showRemindersOnCalendar}
                            onToggle={() =>
                              setPreferences((prev) => ({
                                ...prev,
                                showRemindersOnCalendar: !prev.showRemindersOnCalendar,
                              }))
                            }
                            label="Show reminders on calendar"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="Show completed items"
                          help="How completed reminders and events appear."
                        >
                          <select
                            id="settings-show-completed-items"
                            value={preferences.showCompletedItems}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                showCompletedItems: e.target.value as
                                  | 'muted'
                                  | 'hidden'
                                  | 'visible',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="muted">Muted</option>
                            <option value="hidden">Hidden</option>
                            <option value="visible">Visible</option>
                          </select>
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="workspace-calendars">
                      <h3 id="workspace-calendars" className={settingsTheme.sectionTitle}>
                        Workspace calendars
                      </h3>
                      <p className={settingsTheme.sectionStatus + ' mt-1 leading-5'}>
                        Workspace calendars keep school, internship, freelance, and personal
                        commitments separated while Today can still surface what needs attention.
                      </p>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Calendar scope"
                          help="Choose whether Ledger shows the current workspace or all accessible workspaces."
                        >
                          <select
                            id="settings-calendar-scope"
                            value={preferences.calendarScope}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                calendarScope: e.target.value as
                                  | 'current_workspace'
                                  | 'all_accessible_workspaces',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="current_workspace">Current workspace</option>
                            <option value="all_accessible_workspaces">
                              All accessible workspaces
                            </option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default workspace calendar"
                          help="The workspace calendar Ledger should use by default."
                        >
                          <select
                            id="settings-default-workspace-calendar"
                            value={preferences.defaultWorkspaceCalendar}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultWorkspaceCalendar: e.target.value as
                                  | 'personal'
                                  | 'workspace'
                                  | 'projects',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="personal">Personal</option>
                            <option value="workspace">Workspace</option>
                            <option value="projects">Projects</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Calendar color"
                          help="Used as the default accent for calendar items."
                        >
                          <select
                            id="settings-calendar-color"
                            value={preferences.calendarColor}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                calendarColor: e.target.value as
                                  | 'ledger-orange'
                                  | 'blue'
                                  | 'green'
                                  | 'gray',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="ledger-orange">Ledger orange</option>
                            <option value="blue">Blue</option>
                            <option value="green">Green</option>
                            <option value="gray">Gray</option>
                          </select>
                        </PreferenceRow>
                      </div>
                    </section>
                  </div>
                </section>
              )}

              {activeSection === 'notifications' && (
                <section className="w-full max-w-215" aria-labelledby="settings-notifications">
                  <div className="space-y-2">
                    <h2 id="settings-notifications" className={settingsTheme.pageTitle}>
                      Notifications
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Choose what Ledger should bring to your attention.
                    </p>
                    <p className={settingsTheme.pageStatus} role="status">
                      {isSavingNotificationPrefs
                        ? 'Saving automatically...'
                        : saveStatus ?? 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-8">
                    <section className={settingsTheme.sectionShell} aria-labelledby="notification-control">
                      <h3 id="notification-control" className={settingsTheme.sectionTitle}>
                        Control
                      </h3>
                      <p className={settingsTheme.sectionStatus + ' mt-1 leading-5'}>
                        Pause new alerts without changing your delivery preferences.
                      </p>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-start justify-between gap-4 px-4 py-3">
                          <span className="min-w-0">
                            <span className={settingsTheme.label}>
                              Pause notifications
                            </span>
                            <span className={settingsTheme.help}>
                              Temporarily mute new reminders and alerts from Ledger.
                            </span>
                          </span>
                          <InlineSwitch
                            checked={notificationPreferences.paused}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                paused: !prev.paused,
                              }))
                            }
                            label="Pause notifications"
                          />
                        </div>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="notification-delivery">
                      <h3 id="notification-delivery" className={settingsTheme.sectionTitle}>
                        Delivery
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Desktop notifications"
                          help="Use native system notifications when Ledger is running."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.desktopEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                desktopEnabled: !prev.desktopEnabled,
                              }))
                            }
                            label="Desktop notifications"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="In-app notifications"
                          help="Show reminders and alerts inside Ledger."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.inAppEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                inAppEnabled: !prev.inAppEnabled,
                              }))
                            }
                            label="In-app notifications"
                          />
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="notification-sources">
                      <h3 id="notification-sources" className={settingsTheme.sectionTitle}>
                        Notify me about
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow label="Reminders" help="Time-based reminders you create.">
                          <InlineSwitch
                            checked={notificationPreferences.remindersEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                remindersEnabled: !prev.remindersEnabled,
                              }))
                            }
                            label="Reminders"
                          />
                        </PreferenceRow>
                        <PreferenceRow label="Events" help="Upcoming calendar events.">
                          <InlineSwitch
                            checked={notificationPreferences.eventsEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                eventsEnabled: !prev.eventsEnabled,
                              }))
                            }
                            label="Events"
                          />
                        </PreferenceRow>
                        <PreferenceRow label="Tasks" help="Tasks due today or overdue.">
                          <InlineSwitch
                            checked={notificationPreferences.tasksEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                tasksEnabled: !prev.tasksEnabled,
                              }))
                            }
                            label="Tasks"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="Project deadlines"
                          help="Projects approaching their due date."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.projectDeadlinesEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                projectDeadlinesEnabled: !prev.projectDeadlinesEnabled,
                              }))
                            }
                            label="Project deadlines"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="Inbox captures"
                          help="New captures from Slack, browser, or other integrations."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.inboxCapturesEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                inboxCapturesEnabled: !prev.inboxCapturesEnabled,
                              }))
                            }
                            label="Inbox captures"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="Overdue items"
                          help="Items past due that still need attention."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.overdueEnabled}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                overdueEnabled: !prev.overdueEnabled,
                              }))
                            }
                            label="Overdue items"
                          />
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="notification-timing">
                      <h3 id="notification-timing" className={settingsTheme.sectionTitle}>
                        Timing
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Default event reminder"
                          help="How far in advance event reminders should fire."
                        >
                          <select
                            value={String(notificationPreferences.defaultEventLeadMinutes)}
                            onChange={(e) =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                defaultEventLeadMinutes: Number(
                                  e.target.value
                                ) as NotificationPreferences['defaultEventLeadMinutes'],
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="0">At time of event</option>
                            <option value="5">5 minutes before</option>
                            <option value="10">10 minutes before</option>
                            <option value="30">30 minutes before</option>
                            <option value="60">1 hour before</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default task reminder"
                          help="How task notifications should be timed."
                        >
                          <select
                            value={notificationPreferences.defaultTaskTiming}
                            onChange={(e) =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                defaultTaskTiming: e.target.value as NotificationPreferences['defaultTaskTiming'],
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="morning_of">Morning of due date</option>
                            <option value="at_due_time">At due time</option>
                            <option value="day_before">1 day before</option>
                            <option value="none">None</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default project deadline reminder"
                          help="How early project deadlines should notify."
                        >
                          <select
                            value={String(notificationPreferences.defaultProjectDeadlineLeadDays)}
                            onChange={(e) =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                defaultProjectDeadlineLeadDays: Number(
                                  e.target.value
                                ) as NotificationPreferences['defaultProjectDeadlineLeadDays'],
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="0">At deadline</option>
                            <option value="1">1 day before</option>
                            <option value="3">3 days before</option>
                            <option value="7">1 week before</option>
                          </select>
                        </PreferenceRow>
                        <PreferenceRow
                          label="Default snooze"
                          help="Quick choices shown when you snooze a notification."
                        >
                          <select
                            value={String(notificationPreferences.defaultSnoozeMinutes)}
                            onChange={(e) =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                defaultSnoozeMinutes: Number(
                                  e.target.value
                                ) as NotificationPreferences['defaultSnoozeMinutes'],
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="10">10 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="1440">Tomorrow</option>
                          </select>
                        </PreferenceRow>
                      </div>
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="notification-behavior">
                      <h3 id="notification-behavior" className={settingsTheme.sectionTitle}>
                        Behavior
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <PreferenceRow
                          label="Keep overdue items visible"
                          help="Keep overdue items surfaced in Today and Dashboard."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.keepOverdueVisible}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                keepOverdueVisible: !prev.keepOverdueVisible,
                              }))
                            }
                            label="Keep overdue items visible"
                          />
                        </PreferenceRow>
                        <PreferenceRow
                          label="Show notifications while fullscreen"
                          help="Let desktop notifications through when Ledger or another app is fullscreen."
                        >
                          <InlineSwitch
                            checked={notificationPreferences.notifyWhileFullscreen}
                            onToggle={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                notifyWhileFullscreen: !prev.notifyWhileFullscreen,
                              }))
                            }
                            label="Show notifications while fullscreen"
                          />
                        </PreferenceRow>
                      </div>
                    </section>
                  </div>
                </section>
              )}

              {activeSection === 'integrations' && (
                <section className="w-full max-w-215" aria-labelledby="settings-integrations">
                  <div className="space-y-2">
                    <h2 id="settings-integrations" className={settingsTheme.pageTitle}>
                      Integrations
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Connect tools that send captures into Ledger.
                    </p>
                  </div>

                  <div className="mt-8 space-y-8">
                    <section className={settingsTheme.sectionShell} aria-labelledby="integration-list">
                      <h3 id="integration-list" className="sr-only">
                        Connected integrations
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
                          <div className="min-w-0">
                            <h3 className={settingsTheme.sectionTitle}>Slack</h3>
                            <p className={settingsTheme.sectionSubtitle + ' mt-1'}>
                              Save Slack messages to Inbox.
                            </p>
                            <p className={settingsTheme.sectionStatus + ' mt-1'}>
                              {isLoadingSlackStatus
                                ? 'Checking status'
                                : slackStatus?.connected
                                  ? `Connected to ${slackStatus.team_name || 'Slack'}${
                                      slackStatus.updated_at
                                        ? ` · Updated ${formatIntegrationDate(slackStatus.updated_at)}`
                                        : ''
                                    }`
                                  : 'Not connected'}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                            <button
                              type="button"
                              onClick={() => void handleConnectSlack()}
                              disabled={isConnectingSlack || !activeWorkspaceId || !canManageWorkspace}
                              className={`h-8 rounded-lg px-3 text-xs font-medium transition disabled:opacity-50 ${
                                slackStatus?.connected
                                  ? `${settingsTheme.controlButtonNeutral} rounded-lg`
                                  : 'bg-[var(--ledger-accent)] text-white hover:bg-[var(--ledger-accent-hover)]'
                              }`}
                            >
                              {isConnectingSlack
                                ? 'Opening...'
                                : slackStatus?.connected
                                  ? 'Reconnect'
                                  : 'Connect Slack'}
                            </button>
                            {slackStatus?.connected && (
                              <button
                                type="button"
                                onClick={() => void handleDisconnectSlack()}
                                disabled={
                                  isDisconnectingSlack || !activeWorkspaceId || !canManageWorkspace
                                }
                                className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                              >
                                {isDisconnectingSlack ? 'Disconnecting...' : 'Disconnect'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
                          <div className="min-w-0">
                            <h3 className={settingsTheme.sectionTitle}>Browser Extension</h3>
                            <p className={settingsTheme.sectionSubtitle + ' mt-1'}>
                              Capture links, selected text, and quick notes from Chrome.
                            </p>
                            <p className={settingsTheme.sectionStatus + ' mt-1'}>
                              {isLoadingExtensionTokenStatus
                                ? 'Checking status'
                                : extensionTokenStatus?.exists
                                  ? [
                                      'Token active',
                                      extensionTokenStatus.last_used_at
                                        ? `Last used ${
                                            formatIntegrationDate(extensionTokenStatus.last_used_at) ??
                                            'recently'
                                          }`
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')
                                  : 'No token created'}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                            {extensionTokenStatus?.exists ? (
                              <>
                                {generatedExtensionToken && (
                                  <button
                                    type="button"
                                    onClick={() => void handleCopyExtensionToken()}
                                    className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                                  >
                                    Copy token
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExtensionTokenConfirmAction('regenerate')}
                                  disabled={
                                    isExtensionTokenBusy ||
                                    !activeWorkspaceId ||
                                    !canUseWorkspaceIntegrations
                                  }
                                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                                >
                                  Regenerate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExtensionTokenConfirmAction('revoke')}
                                  disabled={
                                    isExtensionTokenBusy ||
                                    !activeWorkspaceId ||
                                    !canUseWorkspaceIntegrations
                                  }
                                  className={settingsTheme.dangerButton}
                                >
                                  Revoke
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleGenerateExtensionToken()}
                                disabled={
                                  isExtensionTokenBusy ||
                                  !activeWorkspaceId ||
                                  !canUseWorkspaceIntegrations
                                }
                                className="h-8 rounded-lg bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
                              >
                                {isExtensionTokenBusy ? 'Generating...' : 'Generate token'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {(slackError || extensionTokenError || extensionTokenCopyStatus) && (
                        <p
                          className={`mt-4 flex items-center gap-1.5 text-xs ${
                            slackError || extensionTokenError ? 'text-[var(--ledger-danger)]' : 'text-[var(--ledger-text-secondary)]'
                          }`}
                        >
                          {(slackError || extensionTokenError) && <CircleAlert size={12} />}
                          {slackError || extensionTokenError || extensionTokenCopyStatus}
                        </p>
                      )}
                    </section>

                    <section className={settingsTheme.sectionShell} aria-labelledby="integration-coming-soon">
                      <h3 id="integration-coming-soon" className={settingsTheme.sectionTitle}>
                        Coming soon
                      </h3>
                      <div className="mt-3 divide-y divide-[color:var(--ledger-border-subtle)] border-y border-[color:var(--ledger-border-subtle)]">
                        {['Email', 'Google Calendar', 'GitHub', 'Linear'].map((source) => (
                          <div key={source} className="py-3 text-sm text-[var(--ledger-text-secondary)]">
                            {source}
                          </div>
                        ))}
                      </div>
                    </section>

                    <p className={settingsTheme.sectionShell + ' pt-4 text-xs leading-5 text-[var(--ledger-text-muted)]'}>
                      Connected tools send captures to Inbox. You decide later whether they become
                      tasks, notes, reminders, or events.
                    </p>
                  </div>
                </section>
              )}

              {activeSection === 'sidebar' && (
                <section className="w-full max-w-215" aria-labelledby="settings-sidebar">
                  <h2 id="settings-sidebar" className={settingsTheme.pageTitle}>
                    Sidebar
                  </h2>
                  <p className={settingsTheme.pageSubtitle + ' mt-1'}>
                    Configure where Ledger lives and how it behaves.
                  </p>
                  <p className={settingsTheme.pageStatus + ' mt-2'}>
                    {saveStatus ?? 'Changes save automatically.'}
                  </p>

                  <section className="mt-6 pt-6" aria-labelledby="sidebar-position">
                    <h3 id="sidebar-position" className={settingsTheme.sectionTitle}>
                      Position
                    </h3>
                    <p className={settingsTheme.sectionStatus}>Choose where Ledger lives.</p>
                    <div className={settingsTheme.sectionCard}>
                      {sidebarPositionOptions
                        .filter((option) => option.value !== 'floating')
                        .map((option) => (
                          <label
                            key={option.value}
                            className={settingsTheme.radioRow}
                          >
                            <input
                              type="radio"
                              name="sidebar-position"
                              value={option.value}
                              checked={position === option.value}
                              onChange={() => setPosition(option.value)}
                              className={settingsTheme.radioInput}
                              style={{ accentColor: 'var(--ledger-accent)' }}
                            />
                            <span className="min-w-0">
                              <span className={settingsTheme.label}>
                                {option.label}
                              </span>
                              <span className={settingsTheme.help}>
                                {option.description}
                              </span>
                            </span>
                          </label>
                        ))}
                    </div>
                  </section>

                  <section className={settingsTheme.sectionShell} aria-labelledby="sidebar-behavior">
                    <h3 id="sidebar-behavior" className={settingsTheme.sectionTitle}>
                      Behavior
                    </h3>
                    <p className={settingsTheme.sectionStatus}>
                      Keep Ledger attached, detached, or following the app you dock to.
                    </p>
                    <div className={settingsTheme.sectionCard}>
                      <label
                        className={settingsTheme.radioRow}
                      >
                        <input
                          type="radio"
                          name="sidebar-position"
                          value="floating"
                          checked={position === 'floating'}
                          onChange={() => setPosition('floating')}
                          className={settingsTheme.radioInput}
                          style={{ accentColor: 'var(--ledger-accent)' }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={settingsTheme.label}>Floating</span>
                          <span className={settingsTheme.help}>
                            Detach Ledger as a movable panel.
                          </span>
                        </span>
                      </label>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Always on top
                          </span>
                          <span className={settingsTheme.help}>
                            Keep Ledger above other windows.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={alwaysOnTop}
                          onToggle={() => setAlwaysOnTop(!alwaysOnTop)}
                          label="Always on top"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>Auto hide</span>
                          <span className={settingsTheme.help}>
                            Collapse when your pointer leaves the panel.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={autoHide}
                          onToggle={() => setAutoHide(!autoHide)}
                          label="Auto hide"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Dock to app windows
                          </span>
                          <span className={settingsTheme.help}>
                            Follow the app you attach Ledger to.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={sidebarPreferences.floatingDockEnabled}
                          onToggle={() => setFloatingDockEnabled(!sidebarPreferences.floatingDockEnabled)}
                          label="Dock to app windows"
                        />
                      </div>
                    </div>
                  </section>

                  <section className={settingsTheme.sectionShell} aria-labelledby="sidebar-desktop-utility">
                    <h3 id="sidebar-desktop-utility" className={settingsTheme.sectionTitle}>
                      Desktop utility
                    </h3>
                    <p className={settingsTheme.sectionStatus}>
                      Keep Ledger available from the menu bar or system tray.
                    </p>
                    <div className={settingsTheme.sectionCard}>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Show tray icon
                          </span>
                          <span className={settingsTheme.help}>
                            Keep a Ledger icon visible in the menu bar or system tray.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={Boolean(preferences.showTrayIcon)}
                          onToggle={() =>
                            setPreferences((current) => ({
                              ...current,
                              showTrayIcon: !current.showTrayIcon,
                            }))
                          }
                          label="Show tray icon"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Run in background
                          </span>
                          <span className={settingsTheme.help}>
                            Keep Ledger running after closing the window so reminders can still notify you.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={Boolean(preferences.runInBackground)}
                          onToggle={() =>
                            setPreferences((current) => ({
                              ...current,
                              runInBackground: !current.runInBackground,
                            }))
                          }
                          label="Run in background"
                        />
                      </div>
                    </div>
                  </section>

                  <section className={settingsTheme.sectionShell} aria-labelledby="sidebar-default-state">
                    <h3 id="sidebar-default-state" className={settingsTheme.sectionTitle}>
                      Default state
                    </h3>
                    <p className={settingsTheme.sectionStatus}>Choose how Ledger opens.</p>
                    <div className={settingsTheme.sectionCard}>
                      {sidebarDefaultStateOptions.map((option) => (
                        <label
                          key={option.value}
                          className={settingsTheme.radioRow}
                        >
                            <input
                              type="radio"
                              name="sidebar-default-state"
                              value={option.value}
                              checked={defaultState === option.value}
                              onChange={() => setDefaultState(option.value)}
                              className={settingsTheme.radioInput}
                              style={{ accentColor: 'var(--ledger-accent)' }}
                            />
                          <span className="min-w-0">
                            <span className={settingsTheme.label}>
                              {option.label}
                            </span>
                            <span className={settingsTheme.help}>
                              {option.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className={settingsTheme.sectionShell} aria-labelledby="sidebar-appearance">
                    <h3 id="sidebar-appearance" className={settingsTheme.sectionTitle}>
                      Appearance
                    </h3>
                    <p className={settingsTheme.sectionStatus}>
                      Tune the sidebar look and feel.
                    </p>
                    <div className={settingsTheme.sectionCard}>
                      <PreferenceRow label="Opacity" help={`${Math.round(opacity * 100)}% to 95%.`}>
                        <div className="w-full sm:w-70">
                          <div className="flex items-center justify-between gap-4">
                            <span className={settingsTheme.label}>
                              {Math.round(opacity * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.7"
                            max="0.95"
                            step="0.01"
                            value={opacity}
                            onChange={(event) => setOpacity(Number(event.target.value))}
                            className="ledger-range mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent"
                            style={getSidebarOpacitySliderStyle(opacity)}
                          />
                        </div>
                      </PreferenceRow>
                    </div>
                  </section>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      onClick={handleResetSidebarSettings}
                      type="button"
                      className={settingsTheme.footerButton}
                    >
                      Reset to Defaults
                    </button>
                  </div>
                </section>
              )}

              {activeSection === 'accessibility' && (
                <section className="w-full max-w-215" aria-labelledby="settings-accessibility">
                  <h2 id="settings-accessibility" className={settingsTheme.pageTitle}>
                    Accessibility
                  </h2>
                  <p className={settingsTheme.pageSubtitle + ' mt-1'}>
                    Adjust motion, contrast, and density for a more comfortable workspace.
                  </p>
                  <p className={settingsTheme.pageStatus + ' mt-2'}>Changes save automatically.</p>

                  <section className="mt-6 pt-6" aria-labelledby="accessibility-core">
                    <h3 id="accessibility-core" className={settingsTheme.sectionTitle}>
                      Accessibility
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Reduce motion
                          </span>
                          <span className={settingsTheme.help}>
                            Minimize non-essential animations.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={preferences.reduceMotion}
                          onToggle={() =>
                            setPreferences((prev) => ({ ...prev, reduceMotion: !prev.reduceMotion }))
                          }
                          label="Reduce motion"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            High contrast
                          </span>
                          <span className={settingsTheme.help}>
                            Increase contrast for text, borders, and controls.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={preferences.highContrast}
                          onToggle={() =>
                            setPreferences((prev) => ({ ...prev, highContrast: !prev.highContrast }))
                          }
                          label="High contrast"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Compact density
                          </span>
                          <span className={settingsTheme.help}>
                            Use tighter spacing across Ledger.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={preferences.compactDensity}
                          onToggle={() =>
                            setPreferences((prev) => ({
                              ...prev,
                              compactDensity: !prev.compactDensity,
                            }))
                          }
                          label="Compact density"
                        />
                      </div>
                    </div>
                  </section>

                  <section className={settingsTheme.sectionShell} aria-labelledby="accessibility-startup">
                    <h3 id="accessibility-startup" className={settingsTheme.sectionTitle}>
                      Startup
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>
                            Open dashboard by default
                          </span>
                          <span className={settingsTheme.help}>
                            Open Dashboard when Ledger starts.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={preferences.openDashboardByDefault}
                          onToggle={() =>
                            setPreferences((prev) => ({
                              ...prev,
                              openDashboardByDefault: !prev.openDashboardByDefault,
                            }))
                          }
                          label="Open dashboard by default"
                        />
                      </div>
                    </div>
                  </section>
                </section>
              )}

              {activeSection === 'shortcuts' && (
                <section className="w-full max-w-215" aria-labelledby="settings-shortcuts">
                  <div className="space-y-2">
                    <h2 id="settings-shortcuts" className={settingsTheme.pageTitle}>
                      Keyboard Shortcuts
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>Quick reference for actions.</p>
                  </div>

                  <div className="mt-8 space-y-6">
                    {shortcutSections.map((section) => (
                      <section key={section.id} className={settingsTheme.sectionShell}>
                        <h3 className={settingsTheme.sectionTitle}>{section.title}</h3>
                        <div className="mt-3 divide-y divide-[color:var(--ledger-border-subtle)] border-y border-[color:var(--ledger-border-subtle)]">
                          {section.shortcuts.map((shortcut) => (
                            <div
                              key={`${section.id}-${shortcut.keys}`}
                              className="grid gap-3 py-3 md:grid-cols-[160px_minmax(0,1fr)] md:items-center"
                            >
                              <p className={settingsTheme.rowMuted + ' font-medium'}>{shortcut.keys}</p>
                              <p className="text-sm text-[var(--ledger-text-secondary)]">{shortcut.description}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              )}

            <ModalOverlay
              isOpen={isExtensionTokenModalOpen}
              onClose={closeExtensionTokenModal}
              backdropBorderRadius="inherit"
              disablePortal
              manageWindowChrome={false}
              classNameContainer={`w-full max-w-115 ${settingsTheme.modalShell}`}
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">Connect browser extension</h3>
                  <p className="mt-1 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                    Use this token in the Ledger browser extension.
                  </p>
                </div>
                <ModalCloseButton onClick={closeExtensionTokenModal} ariaLabel="Close extension token modal" />
              </div>

              <div className="mt-5 border-y border-[color:var(--ledger-border-subtle)] px-5 py-4">
                <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2">
                  <p className="break-all font-mono text-xs leading-5 text-[var(--ledger-text-primary)]">
                    {generatedExtensionToken}
                  </p>
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--ledger-text-muted)]">
                  This token is shown once. Keep it somewhere safe.
                </p>
                {extensionTokenCopyStatus && (
                  <p className="mt-2 text-xs text-[var(--ledger-text-secondary)]">{extensionTokenCopyStatus}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExtensionTokenConfirmAction('regenerate')}
                  disabled={isExtensionTokenBusy}
                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyExtensionToken()}
                  className={settingsTheme.controlButtonNeutral + ' inline-flex items-center gap-2 rounded-lg'}
                >
                  <Copy size={13} />
                  Copy token
                </button>
                <button
                  type="button"
                  onClick={closeExtensionTokenModal}
                  className="h-8 rounded-lg bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
                >
                  Done
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={extensionTokenConfirmAction === 'regenerate'}
              onClose={() => setExtensionTokenConfirmAction(null)}
              backdropBorderRadius="inherit"
              disablePortal
              manageWindowChrome={false}
              classNameContainer={`w-full max-w-115 ${settingsTheme.modalShell}`}
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">Regenerate extension token?</h3>
                  <p className="mt-1 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                    Your existing browser extension token will stop working. You’ll need to paste the
                    new token into the extension.
                  </p>
                </div>
                <ModalCloseButton
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  ariaLabel="Close regenerate token modal"
                />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleRegenerateExtensionToken()}
                  disabled={isExtensionTokenBusy}
                  className="h-8 rounded-lg bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
                >
                  {isExtensionTokenBusy ? 'Regenerating...' : 'Regenerate token'}
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={extensionTokenConfirmAction === 'revoke'}
              onClose={() => setExtensionTokenConfirmAction(null)}
              backdropBorderRadius="inherit"
              disablePortal
              manageWindowChrome={false}
              classNameContainer={`w-full max-w-115 ${settingsTheme.modalShell}`}
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">Revoke extension token?</h3>
                  <p className="mt-1 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                    The browser extension will no longer be able to save captures to Ledger.
                  </p>
                </div>
                <ModalCloseButton
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  ariaLabel="Close revoke token modal"
                />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevokeExtensionToken()}
                  disabled={isExtensionTokenBusy}
                  className={settingsTheme.dangerButton + ' rounded-lg'}
                >
                  {isExtensionTokenBusy ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={isWorkspaceManageModalOpen && !!activeWorkspace}
              onClose={closeWorkspaceManageModal}
              backdropBorderRadius="inherit"
              disablePortal
              manageWindowChrome={false}
              classNameContainer={`w-full max-w-[720px] ${settingsTheme.modalShell}`}
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className={settingsTheme.rowMuted + ' font-medium'}>Workspace settings</p>
                  <h3 id="workspace-manage-title" className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]">
                    {activeWorkspace?.name}
                  </h3>
                  <p className={settingsTheme.rowMuted + ' mt-0.5'}>{activeWorkspaceKindLabel}</p>
                </div>
                <ModalCloseButton onClick={closeWorkspaceManageModal} ariaLabel="Close workspace settings modal" />
              </div>

              <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] px-5 pt-4">
                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div className="space-y-1 pt-1">
                    <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Name</p>
                    <p className={settingsTheme.rowMuted}>Workspace display name.</p>
                  </div>
                  <input
                    id="workspace-edit-name"
                    value={workspaceEditName}
                    onChange={(e) => setWorkspaceEditName(e.target.value)}
                    disabled={!canManageWorkspace || isSavingWorkspace}
                    className={settingsTheme.input}
                    aria-label="Edit workspace name"
                  />
                </div>
              </div>

              <div className="mt-4 px-5">
                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div className="space-y-1 pt-1">
                    <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Description</p>
                    <p className={settingsTheme.rowMuted}>Optional workspace context.</p>
                  </div>
                  <textarea
                    id="workspace-edit-description"
                    value={workspaceEditDescription}
                    onChange={(e) => setWorkspaceEditDescription(e.target.value)}
                    disabled={!canManageWorkspace || isSavingWorkspace}
                    className={settingsTheme.input + ' min-h-24 resize-none py-2'}
                    aria-label="Edit workspace description"
                  />
                </div>
              </div>

              <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] px-5 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">Danger zone</p>
                    <p className={settingsTheme.rowMuted + ' mt-1'}>Delete this workspace and all data inside it.</p>
                  </div>
                  <button
                    type="button"
                    onClick={openWorkspaceDeleteModal}
                    disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                    className={settingsTheme.dangerButton}
                  >
                    Delete workspace
                  </button>
                </div>
              </div>

              {(workspaceEditError || workspaceEditStatus) && (
                <p className="px-5 pt-3 text-xs text-[var(--ledger-text-secondary)]" role="status">
                  {workspaceEditError || workspaceEditStatus}
                </p>
              )}

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
                <button
                  type="button"
                  onClick={closeWorkspaceManageModal}
                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveWorkspaceChanges()}
                  disabled={!canManageWorkspace || isSavingWorkspace}
                  className="h-8 rounded-lg bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
                >
                  {isSavingWorkspace ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </ModalOverlay>
            <ModalOverlay
              isOpen={isWorkspaceDeleteModalOpen && !!activeWorkspace}
              onClose={closeWorkspaceDeleteModal}
              backdropBorderRadius="inherit"
              disablePortal
              manageWindowChrome={false}
              classNameContainer={`w-full max-w-[640px] ${settingsTheme.modalShell}`}
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className={settingsTheme.rowMuted + ' font-medium'}>Danger zone</p>
                  <h3 id="workspace-delete-title" className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]">
                    Delete workspace
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
                    Type <span className="font-medium text-[var(--ledger-text-primary)]">{activeWorkspace?.name}</span> to confirm deletion.
                  </p>
                </div>
                <ModalCloseButton onClick={closeWorkspaceDeleteModal} ariaLabel="Close delete workspace modal" />
              </div>

              <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] px-5 pt-4">
                <label
                  htmlFor="workspace-delete-confirm"
                  className="mb-2 block text-xs font-medium text-[var(--ledger-text-muted)]"
                >
                  Workspace name
                </label>
                <input
                  id="workspace-delete-confirm"
                  value={workspaceDeleteConfirm}
                  onChange={(e) => setWorkspaceDeleteConfirm(e.target.value)}
                  disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                  placeholder={activeWorkspace?.name}
                  className={settingsTheme.inputSecondary + ' h-9 w-full'}
                  aria-label="Confirm workspace deletion"
                />
                <p className="mt-2 text-xs text-[var(--ledger-text-muted)]">This removes the workspace and all data inside it.</p>
              </div>

              {workspaceDeleteError && (
                <p className="px-5 pt-3 text-xs text-[var(--ledger-danger)]" role="alert">
                  {workspaceDeleteError}
                </p>
              )}

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
                <button
                  type="button"
                  onClick={closeWorkspaceDeleteModal}
                  className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitWorkspaceDeleteConfirmation()}
                  disabled={
                    workspaceUserRole !== 'owner' ||
                    isDeletingWorkspace ||
                    workspaceDeleteConfirm.trim() !== activeWorkspace?.name?.trim()
                  }
                  className={settingsTheme.dangerButton + ' rounded-lg'}
                >
                  {isDeletingWorkspace ? 'Deleting...' : 'Delete workspace'}
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={!!inviteModal && !!selectedInvite}
              onClose={() => setInviteModal(null)}
              backdropBorderRadius="inherit"
              disablePortal
              manageWindowChrome={false}
              classNameContainer={`w-full max-w-[560px] overflow-hidden ${settingsTheme.modalShell}`}
            >
              <div className="flex min-h-70 flex-col">
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className={settingsTheme.rowMuted + ' font-medium'}>Manage invite</p>
                  <h3 className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]">
                    {selectedInvite?.invited_email}
                  </h3>
                  <p className={settingsTheme.rowMuted + ' mt-0.5'}>
                    {selectedInvite?.role} · {selectedInvite?.status}
                  </p>
                </div>
                <ModalCloseButton onClick={() => setInviteModal(null)} ariaLabel="Close invite modal" />
              </div>

              <div className="mt-4 flex-1 border-t border-[color:var(--ledger-border-subtle)] px-5 pt-4 pb-5">
                <p className={settingsTheme.rowMuted + ' font-medium'}>Invite link</p>
                {selectedInvite?.status === 'pending' ? (
                  <>
                    <p className="mt-2 break-all text-sm text-[var(--ledger-text-secondary)]">
                      {getInviteUrl(selectedInvite) ?? 'No link available'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopySelectedInviteLink()}
                        disabled={!getInviteUrl(selectedInvite)}
                        className={settingsTheme.controlButtonNeutral + ' inline-flex flex-1 items-center justify-center gap-2 rounded-full'}
                      >
                        <Copy size={14} />
                        Copy link
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevokeInvitation(selectedInvite.id)}
                        disabled={invitationActionId === selectedInvite.id}
                        className={settingsTheme.dangerButton + ' inline-flex flex-1 items-center justify-center rounded-full'}
                      >
                        {invitationActionId === selectedInvite.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[var(--ledger-text-secondary)]">This invite is no longer pending.</p>
                )}
              </div>
              </div>
            </ModalOverlay>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default SettingsWindow;
