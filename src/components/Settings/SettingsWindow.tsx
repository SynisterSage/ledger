import {
  Bell,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  CircleAlert,
  Copy,
  CalendarDays,
  CirclePause,
  CirclePlay,
  Loader2,
  PanelLeft,
  Plug2,
  Settings,
  SlidersHorizontal,
  Shield,
  UserRound,
  Keyboard,
  ListTree,
  Globe2,
  Monitor,
  Wind,
  Plus,
  Hash,
  Info,
  Inbox,
  MoreHorizontal,
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
import { ModuleHeaderStripAction, ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import authService from '../../services/auth';
import { useWorkspaceRouteHistory } from '../../hooks/useWorkspaceRouteHistory';
import { FigmaIntegrationPage, type FigmaIntegrationStatus } from './FigmaIntegrationPage';
import { SlackIntegrationPage } from './SlackIntegrationPage';
import { GithubIntegrationCard } from './GithubIntegrationCard';

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

type WorkspaceTeam = {
  id: string;
  name: string;
  identifier: string;
  description?: string | null;
  color?: string | null;
  members: Array<{ id: string; name: string; email?: string | null; role?: string | null }>;
  assignedCount: number;
  milestoneCount: number;
  archivedAt?: string | null;
};

type SlackIntegrationStatus = {
  connected: boolean;
  team_id?: string | null;
  team_name?: string | null;
  bot_user_id?: string | null;
  scopes?: string[];
  connected_by?: { name?: string | null; email?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  needs_reauthorization?: boolean;
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

type McpConnection = {
  id: string;
  client_name: string;
  status: 'active' | 'revoked' | 'expired';
  expires_at: string;
  created_at?: string | null;
  last_used_at?: string | null;
  scopes: string[];
  workspaces: Array<{ id: string; name: string }>;
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
  | 'members'
  | 'calendar'
  | 'notifications'
  | 'integrations'
  | 'sidebar'
  | 'shortcuts'
  | 'accessibility';
type SettingsNavGroupId = 'account' | 'workspace' | 'preferences';

type SettingsNavSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: typeof UserRound;
};

const settingsNavGroups: Array<{
  id: SettingsNavGroupId;
  label: string;
  icon: typeof UserRound;
  sections: SettingsNavSection[];
}> = [
  {
    id: 'account',
    label: 'Account',
    icon: UserRound,
    sections: [
      { id: 'account', label: 'Account', description: 'Identity and security', icon: UserRound },
      {
        id: 'sessions',
        label: 'Sessions',
        description: 'Signed-in devices and access',
        icon: Shield,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: BriefcaseBusiness,
    sections: [
      {
        id: 'workspace',
        label: 'Workspace',
        description: 'Identity, defaults, and lifecycle',
        icon: BriefcaseBusiness,
      },
      {
        id: 'members',
        label: 'Members & access',
        description: 'Workspace members, roles, and invites',
        icon: ListTree,
      },
    ],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: Settings,
    sections: [
      {
        id: 'calendar',
        label: 'Calendar',
        description: 'Event and reminder defaults',
        icon: CalendarDays,
      },
      {
        id: 'notifications',
        label: 'Notifications',
        description: 'Alerts and delivery',
        icon: Bell,
      },
      {
        id: 'integrations',
        label: 'Integrations',
        description: 'Connect external signals',
        icon: Plug2,
      },
      {
        id: 'sidebar',
        label: 'Sidebar',
        description: 'Docking, visibility, and placement',
        icon: PanelLeft,
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        description: 'Quick reference for actions',
        icon: Keyboard,
      },
      {
        id: 'accessibility',
        label: 'Accessibility',
        description: 'Comfort and readability options',
        icon: SlidersHorizontal,
      },
    ],
  },
];

const isSettingsSection = (value: string | null | undefined): value is SettingsSectionId => {
  const section = String(value ?? '')
    .trim()
    .toLowerCase();
  return (
    section === 'account' ||
    section === 'sessions' ||
    section === 'workspace' ||
    section === 'members' ||
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

const MCP_WRITE_PERMISSION_ROWS = [
  { scope: 'intake:write', label: 'Intake' },
  { scope: 'tasks:write', label: 'Tasks' },
  { scope: 'notes:write', label: 'Notes' },
  { scope: 'daily:write', label: 'Today' },
  { scope: 'projects:write', label: 'Projects' },
] as const;

const MCP_READ_SCOPE_LABELS: Record<string, string> = {
  'workspace:read': 'Workspace',
  'projects:read': 'projects',
  'tasks:read': 'tasks',
  'notes:read': 'notes',
  'calendar:read': 'calendar',
  'daily:read': 'today',
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
      {
        keys: '⌘/Ctrl + ⇧ + H',
        description: 'toggle side panels in Notes, Calendar, and Projects',
      },
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
      { keys: '⌘/Ctrl + ⌥/Alt + 1', description: 'overview' },
      { keys: '⌘/Ctrl + ⌥/Alt + 2', description: 'calendar' },
      { keys: '⌘/Ctrl + ⌥/Alt + 3', description: 'notes' },
      { keys: '⌘/Ctrl + ⌥/Alt + 4', description: 'projects' },
      { keys: '⌘/Ctrl + ⌥/Alt + 5', description: 'settings' },
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
    shortcuts: [
      { keys: 'Click logo', description: 'collapse / expand' },
      { keys: 'Hold logo', description: 'shut down app' },
    ],
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
  const max = 1;
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

const preferenceSelectClassName = `${compactSelectClassName} w-full sm:w-64`;

const preferenceRowClassName =
  'grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-center';

const inlineSwitchClassName =
  'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition focus:outline-none focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60';

const settingsTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]',
  root: 'flex-1 overflow-hidden bg-[var(--ledger-background)]',
  aside:
    'overflow-auto border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 pb-3 pt-8',
  main: 'overflow-auto bg-[var(--ledger-background)] px-8 py-8 lg:px-10',
  sectionTitle: 'text-[13px] font-semibold text-[var(--ledger-text-primary)]',
  sectionSubtitle: 'text-sm text-[var(--ledger-text-secondary)]',
  sectionStatus: 'text-xs leading-5 text-[var(--ledger-text-muted)]',
  pageTitle: 'text-2xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
  pageSubtitle: 'mt-1 text-[13px] leading-5 text-[var(--ledger-text-secondary)]',
  pageStatus: 'text-xs text-[var(--ledger-text-muted)]',
  sectionShell: 'mt-7',
  sectionRows:
    'mt-3 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] divide-y divide-[color:var(--ledger-border-subtle)] [&>div]:px-4 [&>div]:py-3',
  rowLabel: 'text-[13px] font-medium text-[var(--ledger-text-primary)]',
  rowValue: 'text-[13px] text-[var(--ledger-text-primary)]',
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
  label: 'text-[13px] font-medium text-[var(--ledger-text-primary)]',
  help: 'mt-1 block text-xs leading-5 text-[var(--ledger-text-muted)]',
  fieldValue: 'text-sm text-[var(--ledger-text-secondary)]',
  footerButton:
    'h-9 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  headerButton:
    'h-9 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-semibold text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  navButton:
    'group flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ledger-border-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ledger-surface)]',
  navButtonActive:
    'border-transparent bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] shadow-none',
  navButtonIdle:
    'border-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  input:
    'h-10 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
  inputSecondary:
    'h-10 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
  pill: 'inline-flex rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)]',
  dangerPill:
    'inline-flex rounded-full border border-[color:rgba(217,45,32,0.18)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)]',
  disabledButton:
    'h-8 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-xs font-medium text-[var(--ledger-text-muted)] transition',
} as const;

const themeOptionOrder: Array<{
  value: UserPreferences['theme'];
  label: string;
  description: string;
}> = [
  { value: 'system', label: 'System', description: 'Match your OS appearance.' },
  { value: 'light', label: 'Light', description: 'Always use the warm light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the graphite dark theme.' },
];

const SettingsPage = ({ children }: { children: ReactNode }) => (
  <section className="mx-auto w-full max-w-2xl">{children}</section>
);

const SettingsInfo = ({ text: tooltipText }: { text: string }) => (
  <span className="group relative inline-flex align-middle">
    <button
      type="button"
      aria-label="More information"
      title={tooltipText}
      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--ledger-text-muted)] outline-none hover:text-[var(--ledger-text-secondary)] focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/30"
    >
      <Info size={13} />
    </button>
    <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-xs font-normal leading-5 text-[var(--ledger-text-secondary)] shadow-[0_10px_24px_rgba(15,23,42,0.14)] group-hover:block group-focus-within:block">
      {tooltipText}
    </span>
  </span>
);

const SlackMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <rect x="10" y="2" width="4" height="9" rx="2" fill="#36C5F0" />
    <rect x="13" y="10" width="9" height="4" rx="2" fill="#2EB67D" />
    <rect x="10" y="13" width="4" height="9" rx="2" fill="#ECB22E" />
    <rect x="2" y="10" width="9" height="4" rx="2" fill="#E01E5A" />
  </svg>
);

const FigmaMark = () => (
  <svg
    width="400"
    height="600"
    viewBox="0 0 400 600"
    className="h-4 w-4"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M0 500C0 444.772 44.772 400 100 400H200V500C200 555.228 155.228 600 100 600C44.772 600 0 555.228 0 500Z" fill="#24CB71"/>
    <path d="M200 0V200H300C355.228 200 400 155.228 400 100C400 44.772 355.228 0 300 0H200Z" fill="#FF7237"/>
    <path d="M299.167 400C354.395 400 399.167 355.228 399.167 300C399.167 244.772 354.395 200 299.167 200C243.939 200 199.167 244.772 199.167 300C199.167 355.228 243.939 400 299.167 400Z" fill="#00B6FF"/>
    <path d="M0 100C0 155.228 44.772 200 100 200H200V0H100C44.772 0 0 44.772 0 100Z" fill="#FF3737"/>
    <path d="M0 300C0 355.228 44.772 400 100 400H200V200H100C44.772 200 0 244.772 0 300Z" fill="#874FFF"/>
  </svg>
);

const SettingsPageHeader = ({
  id,
  title,
  description,
  status,
}: {
  id: string;
  title: string;
  description: ReactNode;
  status?: ReactNode;
}) => (
  <header aria-labelledby={id} className="mb-6">
    <h2 id={id} className={settingsTheme.pageTitle}>
      {title}
    </h2>
    <p className={settingsTheme.pageSubtitle}>{description}</p>
    {status ? (
      <p className={settingsTheme.pageStatus + ' mt-2'} role="status">
        {status}
      </p>
    ) : null}
  </header>
);

const SettingsSection = ({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) => (
  <section className={settingsTheme.sectionShell} aria-labelledby={id}>
    <h3 id={id} className={settingsTheme.sectionTitle}>
      {title}
    </h3>
    {description ? <p className={settingsTheme.sectionStatus + ' mt-1'}>{description}</p> : null}
    {children}
  </section>
);

const SettingsGroup = ({ children }: { children: ReactNode }) => (
  <div className={settingsTheme.sectionRows}>{children}</div>
);

const SettingsDangerGroup = ({ children }: { children: ReactNode }) => (
  <div className="mt-7 rounded-xl border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.025)] p-4">
    {children}
  </div>
);

const SettingsRow = ({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) => {
  return (
    <div className={preferenceRowClassName}>
      <div className="min-w-0">
        <h3 className={settingsTheme.label}>{label}</h3>
        {help ? <p className={settingsTheme.help}>{help}</p> : null}
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
          checked
            ? 'border border-white/10'
            : 'border border-[color:var(--ledger-border-strong)]'
        } ${
          checked ? 'translate-x-6' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};

const makeTeamIdentifier = (value: string) => {
  const words = value
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .slice(0, 4)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
};

const getMemberInitials = (member: WorkspaceMember) => {
  const value = member.full_name?.trim() || member.email?.trim() || '?';
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
};

export const SettingsWindow = () => {
  const { user, signOut } = useAuthContext();
  const {
    sidebarPreferences,
    position,
    opacity,
    blur,
    defaultState,
    alwaysOnTop,
    autoHide,
    setPosition,
    setOpacity,
    setBlur,
    setDefaultState,
    setAlwaysOnTop,
    setAutoHide,
    workspaceShellLayout,
  } = useSidebar();
  const api = useApi();
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspace,
    refreshWorkspaces,
    error: workspaceError,
  } = useWorkspaceContext();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    getInitialSettingsSection()
  );
  const pendingSettingsAnchorRef = useRef<string | null>(null);

  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(defaultNotificationPrefs);
  const [isSavingNotificationPrefs, setIsSavingNotificationPrefs] = useState(false);

  const [fullName, setFullName] = useState('');
  const [isEditingFullName, setIsEditingFullName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordEditor, setShowPasswordEditor] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAccountDeleteModalOpen, setIsAccountDeleteModalOpen] = useState(false);
  const [accountDeleteConfirmed, setAccountDeleteConfirmed] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
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
  const [workspaceEditType, setWorkspaceEditType] = useState<'team' | 'personal'>('team');
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
  const [workspaceTeams, setWorkspaceTeams] = useState<WorkspaceTeam[]>([]);
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
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteModal, setInviteModal] = useState<InviteModalState>(null);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [createTeamName, setCreateTeamName] = useState('');
  const [createTeamIdentifier, setCreateTeamIdentifier] = useState('');
  const [createTeamIdentifierTouched, setCreateTeamIdentifierTouched] = useState(false);
  const [createTeamDescription, setCreateTeamDescription] = useState('');
  const [createTeamColor, setCreateTeamColor] = useState('#FF5F40');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);
  const [slackStatus, setSlackStatus] = useState<SlackIntegrationStatus | null>(null);
  const [isLoadingSlackStatus, setIsLoadingSlackStatus] = useState(false);
  const [isConnectingSlack, setIsConnectingSlack] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackRefreshToken, setSlackRefreshToken] = useState(0);
  const [figmaStatus, setFigmaStatus] = useState<FigmaIntegrationStatus>({ status: 'disconnected' });
  const [figmaDetailOpen, setFigmaDetailOpen] = useState(false);
  const [slackDetailOpen, setSlackDetailOpen] = useState(false);
  const [extensionTokenStatus, setExtensionTokenStatus] = useState<ExtensionTokenStatus | null>(
    null
  );
  const [isLoadingExtensionTokenStatus, setIsLoadingExtensionTokenStatus] = useState(false);
  const [isExtensionTokenBusy, setIsExtensionTokenBusy] = useState(false);
  const [extensionTokenError, setExtensionTokenError] = useState<string | null>(null);
  const [generatedExtensionToken, setGeneratedExtensionToken] = useState<string | null>(null);
  const [isExtensionTokenModalOpen, setIsExtensionTokenModalOpen] = useState(false);
  const [extensionTokenConfirmAction, setExtensionTokenConfirmAction] = useState<
    'regenerate' | 'revoke' | null
  >(null);
  const [extensionTokenCopyStatus, setExtensionTokenCopyStatus] = useState<string | null>(null);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [isLoadingMcpConnections, setIsLoadingMcpConnections] = useState(false);
  const [mcpConnectionError, setMcpConnectionError] = useState<string | null>(null);
  const [mcpConnectionActionId, setMcpConnectionActionId] = useState<string | null>(null);
  const [mcpScopeActionId, setMcpScopeActionId] = useState<string | null>(null);
  const [isMcpConnectionsExpanded, setIsMcpConnectionsExpanded] = useState(false);
  const [expandedMcpConnectionId, setExpandedMcpConnectionId] = useState<string | null>(null);
  const [openMcpConnectionMenuId, setOpenMcpConnectionMenuId] = useState<string | null>(null);
  const [openMcpPermissionsId, setOpenMcpPermissionsId] = useState<string | null>(null);
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
    const handleFocusContext = (
      _event: unknown,
      payload: { focusContext?: string | null }
    ) => {
      const focusContext = payload?.focusContext ?? '';
      if (focusContext.startsWith('settings-anchor:')) {
        pendingSettingsAnchorRef.current = focusContext.slice('settings-anchor:'.length);
      }
    };

    window.ipcRenderer?.on('module:focus-context', handleFocusContext);
    return () => {
      window.ipcRenderer?.off('module:focus-context', handleFocusContext);
    };
  }, []);

  useEffect(() => {
    const anchorId = pendingSettingsAnchorRef.current;
    if (!anchorId) return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      pendingSettingsAnchorRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'members' && activeWorkspace?.is_personal) {
      setActiveSection('workspace');
    }
  }, [activeSection, activeWorkspace?.is_personal]);

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

    const scheme = resolveDesktopThemeScheme(preferences.theme, getSystemDesktopThemeScheme());
    applyDesktopCssVars(document.documentElement, scheme);
    window.ipcRenderer?.send('ledger:theme-updated', {
      theme: preferences.theme,
    });
  }, [preferences.theme]);

  useEffect(() => {
    let cancelled = false;

    const loadNotificationPreferences = async () => {
      try {
        const payload =
          (await api.getNotificationPreferences()) as Partial<NotificationPreferences>;

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

  // Sync structural sidebar preferences separately from opacity so the range slider does not
  // trigger window-mode reapplication on every pointer move.
  useEffect(() => {
    if (!sidebarPreferencesSyncInitializedRef.current) {
      sidebarPreferencesSyncInitializedRef.current = true;
      return;
    }

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

  useWorkspaceRouteHistory(
    { kind: 'settings', focusSection: activeSection },
    Boolean(activeSection)
  );

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
    setBlur(defaultSidebarPreferences.blur);
    setDefaultState(defaultSidebarPreferences.defaultState);
    setAlwaysOnTop(defaultSidebarPreferences.alwaysOnTop);
    setAutoHide(defaultSidebarPreferences.autoHide);
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

    const existingPassword = currentPassword.trim();
    const password = newPassword.trim();
    if (!existingPassword) {
      setPasswordError('Enter your current password to continue.');
      return;
    }

    if (!user?.email) {
      setPasswordError('We could not verify the email for this account.');
      return;
    }

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
      const { error: verificationError } = await authService.verifyCurrentPassword(
        user.email,
        existingPassword
      );
      if (verificationError) throw verificationError;

      const { error } = await authService.updatePassword(password);
      if (error) throw error;
      setPasswordStatus('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordEditor(false);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const openAccountDeleteModal = () => {
    setAccountDeleteConfirmed(false);
    setAccountDeleteError(null);
    setIsAccountDeleteModalOpen(true);
  };

  const closeAccountDeleteModal = () => {
    if (isDeletingAccount) return;
    setIsAccountDeleteModalOpen(false);
    setAccountDeleteConfirmed(false);
    setAccountDeleteError(null);
  };

  const handleDeleteAccount = async () => {
    if (!accountDeleteConfirmed) return;

    setIsDeletingAccount(true);
    setAccountDeleteError(null);
    try {
      await api.deleteAccount();
      await signOut().catch(() => undefined);
      window.location.reload();
    } catch (err) {
      setAccountDeleteError(
        err instanceof Error ? err.message : 'Could not delete your account.'
      );
      setIsDeletingAccount(false);
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
    void api.getFigmaIntegrationStatus(activeWorkspaceId).then((payload) => {
      if (!cancelled) setFigmaStatus(payload as FigmaIntegrationStatus);
    }).catch(() => {
      if (!cancelled) setFigmaStatus({ status: 'error', error: 'Could not load Figma connection status.' });
    });
    return () => { cancelled = true; };
  }, [activeSection, activeWorkspaceId, api]);

  useEffect(() => {
    if (activeSection !== 'integrations' || !activeWorkspaceId) {
      setMcpConnections([]);
      setIsMcpConnectionsExpanded(false);
      setExpandedMcpConnectionId(null);
      return;
    }
    let cancelled = false;
    setMcpConnections([]);
    setIsMcpConnectionsExpanded(false);
    setExpandedMcpConnectionId(null);
    setIsLoadingMcpConnections(true);
    void api.getMcpConnections().then((payload) => {
      if (!cancelled) setMcpConnections((payload as McpConnection[]) ?? []);
    }).catch((error) => {
      if (!cancelled) setMcpConnectionError(error instanceof Error ? error.message : 'Could not load MCP connections.');
    }).finally(() => {
      if (!cancelled) setIsLoadingMcpConnections(false);
    });
    return () => { cancelled = true; };
  }, [activeSection, activeWorkspaceId, api]);

  const handleRevokeMcpConnection = async (connectionId: string) => {
    setMcpConnectionActionId(connectionId);
    setMcpConnectionError(null);
    try {
      await api.revokeMcpConnection(connectionId);
      setMcpConnections((current) => current.map((connection) => connection.id === connectionId ? { ...connection, status: 'revoked' } : connection));
    } catch (error) {
      setMcpConnectionError(error instanceof Error ? error.message : 'Could not revoke MCP connection.');
    } finally {
      setMcpConnectionActionId(null);
    }
  };

  const handleRenameMcpConnection = async (connection: McpConnection) => {
    const name = window.prompt('Name this MCP connection', connection.client_name)?.trim();
    if (!name || name === connection.client_name) return;
    setMcpConnectionActionId(connection.id);
    setMcpConnectionError(null);
    try {
      const updated = await api.renameMcpConnection(connection.id, name) as { client_name?: string };
      setMcpConnections((current) => current.map((item) => item.id === connection.id ? { ...item, client_name: updated.client_name ?? name } : item));
    } catch (error) {
      setMcpConnectionError(error instanceof Error ? error.message : 'Could not rename MCP connection.');
    } finally {
      setMcpConnectionActionId(null);
    }
  };

  const handleRequestMcpScope = async (connection: McpConnection, scope: string) => {
    setMcpScopeActionId(`${connection.id}:${scope}`);
    setMcpConnectionError(null);
    try {
      const response = await api.requestMcpScopeUpgrade(connection.id, [scope]) as { authorization_url?: string };
      if (response.authorization_url) await openExternalUrl(response.authorization_url);
    } catch (error) {
      setMcpConnectionError(error instanceof Error ? error.message : 'Could not request additional MCP access.');
    } finally {
      setMcpScopeActionId(null);
    }
  };

  const handleRemoveMcpScope = async (connection: McpConnection, scope: string) => {
    setMcpScopeActionId(`${connection.id}:${scope}`);
    setMcpConnectionError(null);
    try {
      await api.removeMcpScope(connection.id, scope);
      setMcpConnections((current) => current.map((item) => item.id === connection.id ? { ...item, scopes: item.scopes.filter((itemScope) => itemScope !== scope) } : item));
    } catch (error) {
      setMcpConnectionError(error instanceof Error ? error.message : 'Could not remove MCP access.');
    } finally {
      setMcpScopeActionId(null);
    }
  };

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

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkspaceUserRole('member');
      return;
    }
    if (activeWorkspace?.role) setWorkspaceUserRole(activeWorkspace.role);
  }, [activeWorkspace?.role, activeWorkspaceId]);

  const canManageWorkspace = workspaceUserRole === 'owner' || workspaceUserRole === 'admin';
  const canUseWorkspaceIntegrations = workspaceUserRole !== 'viewer';

  useEffect(() => {
    if (!openMcpConnectionMenuId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-mcp-menu]')) {
        setOpenMcpConnectionMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMcpConnectionMenuId(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMcpConnectionMenuId]);

  useEffect(() => {
    if (!openMcpPermissionsId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-mcp-permissions]')) {
        setOpenMcpPermissionsId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMcpPermissionsId(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMcpPermissionsId]);

  useEffect(() => {
    const nextWorkspaceId = activeWorkspace?.id ?? null;
    const previousWorkspaceId = activeWorkspaceIdRef.current;
    activeWorkspaceIdRef.current = nextWorkspaceId;

    if (!nextWorkspaceId) {
      setWorkspaceEditName('');
      setWorkspaceEditDescription('');
      setWorkspaceEditType('team');
      setWorkspaceDeleteConfirm('');
      setIsWorkspaceManageModalOpen(false);
      setIsWorkspaceDeleteModalOpen(false);
      return;
    }

    if (previousWorkspaceId && previousWorkspaceId !== nextWorkspaceId) {
      setWorkspaceEditName(activeWorkspace?.name ?? '');
      setWorkspaceEditDescription(activeWorkspace?.description ?? '');
      setWorkspaceEditType(activeWorkspace?.is_personal ? 'personal' : 'team');
      setWorkspaceDeleteConfirm('');
      setIsWorkspaceManageModalOpen(false);
      setIsWorkspaceDeleteModalOpen(false);
      return;
    }

    if (!isWorkspaceManageModalOpen && !isWorkspaceDeleteModalOpen) {
      setWorkspaceEditName(activeWorkspace?.name ?? '');
      setWorkspaceEditDescription(activeWorkspace?.description ?? '');
      setWorkspaceEditType(activeWorkspace?.is_personal ? 'personal' : 'team');
      setWorkspaceDeleteConfirm('');
    }
  }, [
    activeWorkspace?.id,
    activeWorkspace?.name,
    activeWorkspace?.description,
    activeWorkspace?.is_personal,
    isWorkspaceDeleteModalOpen,
    isWorkspaceManageModalOpen,
  ]);

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
        is_personal: workspaceEditType === 'personal',
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

    const nextWorkspace =
      workspaces.find((workspace) => workspace.id !== activeWorkspaceId) ?? null;

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
    setWorkspaceEditType(activeWorkspace.is_personal ? 'personal' : 'team');
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
    if (
      (activeSection !== 'workspace' && activeSection !== 'members') ||
      !activeWorkspaceId
    )
      return;

    let cancelled = false;

    const loadWorkspaceAdminData = async () => {
      setIsLoadingWorkspaceAdmin(true);
      setWorkspaceAdminError(null);

      try {
        const [membersPayload, invitesPayload, teamsPayload] = await Promise.all([
          api.getWorkspaceMembers(activeWorkspaceId),
          api.getWorkspaceInvitations(activeWorkspaceId),
          api.getTeams({ includeArchived: true }),
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
        const nextTeams = Array.isArray((teamsPayload as { teams?: unknown[] })?.teams)
          ? (teamsPayload as { teams: WorkspaceTeam[] }).teams ?? []
          : [];

        setWorkspaceMembers(nextMembers);
        setWorkspaceInvitations(nextInvites);
        setWorkspaceTeams(nextTeams);

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
        setWorkspaceTeams([]);
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

  const openWorkspaceTeamSettings = (teamId: string) => {
    void window.desktopWindow?.openModule('teams', {
      kind: 'teams',
      focusContext: `team-settings:${teamId}`,
    } as any);
  };

  const openTeamWorkPage = (teamId: string) => {
    void window.desktopWindow?.openModule('teams', {
      kind: 'teams',
      focusContext: `team:${teamId}`,
    } as any);
  };

  const openCreateTeamModal = () => {
    setCreateTeamName('');
    setCreateTeamIdentifier('');
    setCreateTeamIdentifierTouched(false);
    setCreateTeamDescription('');
    setCreateTeamColor('#FF5F40');
    setCreateTeamError(null);
    setIsCreateTeamOpen(true);
  };

  const handleCreateTeam = async () => {
    if (!activeWorkspaceId) return;
    const name = createTeamName.trim();
    if (!name) {
      setCreateTeamError('Team name is required.');
      return;
    }

    setIsCreatingTeam(true);
    setCreateTeamError(null);
    try {
      await api.createTeam({
        name,
        identifier: createTeamIdentifier.trim() || makeTeamIdentifier(name),
        description: createTeamDescription.trim() || null,
        color: createTeamColor,
      });
      const teamsPayload = await api.getTeams({ includeArchived: true });
      const nextTeams = Array.isArray((teamsPayload as { teams?: unknown[] })?.teams)
        ? (teamsPayload as { teams: WorkspaceTeam[] }).teams ?? []
        : [];
      setWorkspaceTeams(nextTeams);
      setIsCreateTeamOpen(false);
      setWorkspaceStatus('Team created.');
    } catch (err) {
      setCreateTeamError(err instanceof Error ? err.message : 'Could not create team');
    } finally {
      setIsCreatingTeam(false);
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
    Boolean(inviteModal && selectedInvite) ||
    isCreateTeamOpen;

  const activeMcpConnections = mcpConnections.filter(
    (connection) =>
      connection.status === 'active' &&
      connection.workspaces.some((workspace) => workspace.id === activeWorkspaceId)
  );

  return (
    <div
      className={settingsTheme.shell}
      style={{
        scrollbarGutter: 'auto',
        ...workspaceShellLayout.workspaceShellStyle,
      }}
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
        compact
        showBodyHeader={false}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={14} />}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={14} />}
              notificationTrayToggle
              onClick={() => window.dispatchEvent(new CustomEvent('ledger:toggle-notification-tray'))}
              title="Open notifications"
              ariaLabel="Open notifications"
            />
          </>
        }
      />

      <div className={settingsTheme.root}>
        <div className="h-full grid grid-cols-[260px_1fr]">
          <aside className={settingsTheme.aside} aria-label="Settings sections">
            <nav className="space-y-3" aria-label="Settings navigation">
              {settingsNavGroups.map((group) => (
                <section key={group.id} className="space-y-1.5">
                  <div className="px-1 text-xs font-medium text-[var(--ledger-text-muted)]">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.sections
                      .filter((section) => section.id !== 'members' || !activeWorkspace?.is_personal)
                      .map((section) => {
                      const SectionIcon = section.icon;
                      const isActive = activeSection === section.id;
                      return (
                        <button
                          key={section.id}
                          onClick={() => setActiveSection(section.id)}
                          title={section.description}
                          className={`${settingsTheme.navButton} ${
                            isActive ? settingsTheme.navButtonActive : settingsTheme.navButtonIdle
                          }`}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center ${
                              isActive
                                ? 'text-[var(--ledger-text-secondary)]'
                                : 'text-[var(--ledger-text-muted)]'
                            }`}
                            aria-hidden="true"
                          >
                            <SectionIcon size={12} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{section.label}</p>
                          </span>
                        </button>
                      );
                      })}
                  </div>
                </section>
              ))}
            </nav>
          </aside>

          <main
            className={`${settingsTheme.main} ${
              isSettingsModalOpen ? 'overflow-hidden' : 'overflow-auto'
            }`}
            aria-live="polite"
          >
            <div className="mx-auto max-w-4xl space-y-5">
              <SettingsPage>
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
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-profile"
                    >
                      <h3 id="settings-profile" className={settingsTheme.sectionTitle}>
                        Profile
                      </h3>

                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <p className={settingsTheme.label}>Display name</p>
                            <p className={settingsTheme.help}>Your name as it appears in Ledger.</p>
                            {isEditingFullName ? (
                              <input
                                id="settings-full-name"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                className={settingsTheme.input + ' mt-3 max-w-sm'}
                                autoFocus
                              />
                            ) : (
                              <p className="mt-2 truncate text-[13px] text-[var(--ledger-text-secondary)]">
                                {fullName.trim() || 'No name set'}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsEditingFullName((value) => !value)}
                            className={settingsTheme.controlButtonNeutral + ' shrink-0'}
                          >
                            {isEditingFullName ? 'Done' : 'Edit'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <p className={settingsTheme.label}>Email</p>
                            <p className={settingsTheme.help}>Used for signing in.</p>
                          </div>
                          <p className="max-w-[55%] truncate text-right text-[13px] text-[var(--ledger-text-secondary)]">
                            {user?.email ?? 'No email available'}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-security"
                    >
                      <h3 id="settings-security" className={settingsTheme.sectionTitle}>
                        Security
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className={settingsTheme.label}>Password</p>
                          <p className={settingsTheme.help}>Change your account password.</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
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
                                setCurrentPassword('');
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
                      </div>

                      {showPasswordEditor ? (
                        <div className="border-t border-[color:var(--ledger-border-subtle)] px-4 py-3">
                          <div className="w-full space-y-3">
                          <div className="grid gap-1.5">
                            <label htmlFor="settings-current-password" className={settingsTheme.rowLabel}>
                              Current password
                            </label>
                            <input
                              id="settings-current-password"
                              type="password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              className={settingsTheme.inputSecondary + ' w-full'}
                              autoComplete="current-password"
                            />
                          </div>
                          <div className="grid gap-3">
                            <div className="grid gap-1.5">
                              <label htmlFor="settings-password" className={settingsTheme.rowLabel}>
                                New password
                              </label>
                              <input
                                id="settings-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className={settingsTheme.inputSecondary + ' w-full'}
                              />
                            </div>
                            <div className="grid gap-1.5">
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
                                className={settingsTheme.inputSecondary + ' w-full'}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => void handleUpdatePassword()}
                              disabled={isUpdatingPassword}
                              className={settingsTheme.primaryButton + ' h-8 rounded-lg px-3 text-xs'}
                            >
                              {isUpdatingPassword ? 'Updating...' : 'Update password'}
                            </button>
                            {isUpdatingPassword && (
                              <Loader2
                                size={14}
                                className="animate-spin text-[var(--ledger-text-muted)]"
                              />
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
                        </div>
                      ) : null}
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-account-actions"
                    >
                      <h3 id="settings-account-actions" className={settingsTheme.sectionTitle}>
                        Account actions
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className={settingsTheme.label}>Sign out</p>
                            <p className={settingsTheme.help}>
                              End the current Ledger session on this device.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void signOut();
                            }}
                            className={settingsTheme.dangerButton + ' shrink-0'}
                          >
                            Sign out
                          </button>
                        </div>
                      </div>
                    </section>

                    <SettingsDangerGroup>
                      <section aria-labelledby="settings-account-danger-zone">
                        <div className="flex items-center justify-between gap-4">
                          <div className="space-y-1">
                            <h3
                              id="settings-account-danger-zone"
                              className={settingsTheme.sectionTitle}
                            >
                              Danger zone
                            </h3>
                            <p className={settingsTheme.sectionStatus}>
                              Permanently delete your account and all personal data. Shared
                              workspaces remain available to their other members.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={openAccountDeleteModal}
                            disabled={isDeletingAccount}
                            className={settingsTheme.dangerButton + ' shrink-0'}
                          >
                            Delete account
                          </button>
                        </div>
                      </section>
                    </SettingsDangerGroup>
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
                    {accountSessionsError || isLoadingAccountSessions ? (
                      <p className={settingsTheme.pageStatus} role="status">
                        {accountSessionsError || 'Loading sessions...'}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-8 space-y-10">
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-current-session"
                    >
                      <h3 id="settings-current-session" className={settingsTheme.sectionTitle}>
                        Current device
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)] text-[var(--ledger-accent)]">
                            <Monitor size={15} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={settingsTheme.label}>{currentSessionDeviceLabel}</p>
                            <p className={settingsTheme.help}>
                              This device · {currentSessionPlatformLabel} ·{' '}
                              {formatLedgerSessionRelativeTime(currentAccountSession?.last_seen_at)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void signOut();
                            }}
                            className={settingsTheme.dangerButton + ' shrink-0'}
                          >
                            Sign out
                          </button>
                        </div>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-other-sessions"
                    >
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
                          {otherAccountSessions.length} device
                          {otherAccountSessions.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        {isLoadingAccountSessions ? (
                          <div className="px-4 py-3 text-sm text-[var(--ledger-text-muted)]">
                            Loading sessions...
                          </div>
                        ) : otherAccountSessions.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-[var(--ledger-text-muted)]">
                            No other devices are currently listed.
                          </div>
                        ) : (
                          otherAccountSessions.map((session) => (
                            <div
                              key={session.id}
                              className="grid gap-4 px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)_auto]"
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

                  </div>
                </section>
              )}

              {(activeSection === 'workspace' || activeSection === 'members') && (
                <section className="w-full max-w-215" aria-labelledby="settings-workspace">
                  <div className="space-y-2">
                    <h2 id="settings-workspace" className={settingsTheme.pageTitle}>
                      {activeSection === 'members' ? 'Members & access' : 'Workspace'}
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      {activeSection === 'members'
                        ? 'Manage who can access this workspace and what they can do.'
                        : activeWorkspace?.is_personal
                          ? 'Manage workspace identity and defaults.'
                          : 'Manage workspace identity, defaults, and lifecycle.'}
                    </p>
                    <p className={settingsTheme.pageStatus} role="status">
                      {workspaceStatus || workspaceError || 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-10">
                    {activeSection === 'workspace' && (
                    <>
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-current-workspace"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3
                            id="settings-current-workspace"
                            className={settingsTheme.sectionTitle}
                          >
                            Workspace details
                          </h3>
                          <p className={settingsTheme.sectionStatus}>
                            The workspace currently active in Ledger.
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {canManageWorkspace ? (
                            <button
                              type="button"
                              onClick={openWorkspaceManageModal}
                              className={settingsTheme.controlButtonNeutral + ' h-8 rounded-lg px-2.5 text-xs'}
                            >
                              Manage
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setShowCreateWorkspaceForm((value) => !value)}
                            className={settingsTheme.controlButtonNeutral + ' h-8 rounded-lg px-2.5 text-xs'}
                            aria-label={showCreateWorkspaceForm ? 'Close workspace creation' : 'Create workspace'}
                          >
                            {showCreateWorkspaceForm ? 'Close' : 'Create workspace'}
                          </button>
                        </div>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className={settingsTheme.rowLabel}>Name</div>
                          <div className="flex items-center gap-2">
                            <span className={settingsTheme.rowValue + ' text-right'}>
                              {activeWorkspace?.name ?? 'No workspace selected'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className={settingsTheme.rowLabel}>Type</div>
                          <div className={settingsTheme.rowValue + ' text-right'}>{activeWorkspaceKindLabel}</div>
                        </div>
                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className={settingsTheme.rowLabel}>Description</div>
                          <div className="max-w-[65%] line-clamp-2 text-right text-[13px] leading-5 text-[var(--ledger-text-secondary)]">
                            {activeWorkspace?.description?.trim() || 'No description set.'}
                          </div>
                        </div>
                      </div>
                    </section>
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-appearance"
                    >
                      <h3 id="settings-appearance" className={settingsTheme.sectionTitle}>
                        Appearance
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className={settingsTheme.label}>Workspace theme</p>
                            <p className={settingsTheme.help}>Choose how Ledger looks in this workspace.</p>
                          </div>
                          <div className="flex shrink-0 overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]">
                            {themeOptionOrder.map((option) => {
                              const isSelected = preferences.theme === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() =>
                                    setPreferences((current) => ({ ...current, theme: option.value }))
                                  }
                                  className={`px-3 py-1.5 text-xs font-medium transition ${
                                    isSelected
                                      ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                      : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                                  }`}
                                  aria-pressed={isSelected}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </section>
                    </>
                    )}

                    {activeSection === 'members' && !activeWorkspace?.is_personal && (
                      <>
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-members"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-members" className={settingsTheme.sectionTitle}>
                            Members
                          </h3>
                          <p className={settingsTheme.sectionStatus}>
                            Manage access for the selected workspace.
                          </p>
                        </div>
                        <span className={settingsTheme.pill}>
                          {workspaceUserRole === 'owner' ? 'Owner' : `Role: ${workspaceUserRole}`}
                        </span>
                      </div>

                      <div className={settingsTheme.sectionRows}>
                        {isLoadingWorkspaceAdmin ? (
                          <div aria-label="Loading members" role="status" aria-live="polite">
                            {[0, 1, 2].map((row) => (
                              <div
                                key={row}
                                className="grid gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                              >
                                <span className="flex min-w-0 items-center gap-3">
                                  <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[var(--ledger-surface-hover)]" />
                                  <span className="min-w-0 flex-1 space-y-1.5">
                                    <span className="block h-3 w-32 max-w-[70%] animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
                                    <span className="block h-2.5 w-48 max-w-[90%] animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
                                  </span>
                                </span>
                                <span className="h-8 w-full animate-pulse rounded-lg bg-[var(--ledger-surface-hover)] md:w-20" />
                                <span className="h-8 w-full animate-pulse rounded-lg bg-[var(--ledger-surface-hover)] md:w-[68px]" />
                              </div>
                            ))}
                          </div>
                        ) : workspaceMembers.length === 0 ? (
                          <div className="py-4 text-xs text-[var(--ledger-text-muted)]">
                            No members yet.
                          </div>
                        ) : (
                          workspaceMembers.map((member) => {
                            const displayName = member.full_name || member.email || member.user_id;
                            const canEditRole =
                              canManageWorkspace && !member.is_owner && member.user_id !== user?.id;
                            return (
                              <div
                                key={member.user_id}
                                className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-surface-muted)] text-[11px] font-semibold text-[var(--ledger-text-secondary)]">
                                    {getMemberInitials(member)}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
                                      {displayName}
                                      {member.is_owner ? ' · Owner' : member.user_id === user?.id ? ' · You' : ''}
                                    </p>
                                    <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                                      {member.email || 'No email'}
                                    </p>
                                  </div>
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
                                  className={
                                    settingsTheme.inputSecondary +
                                    ' h-8 w-full appearance-none rounded-lg px-2 pr-8 text-xs md:w-auto'
                                  }
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

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-invites"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-invites" className={settingsTheme.sectionTitle}>
                            Invitations
                          </h3>
                          <p className={settingsTheme.sectionStatus}>
                            Invite people to this workspace.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowInviteForm((value) => !value)}
                          disabled={!canManageWorkspace}
                          className={settingsTheme.controlButton}
                        >
                          {showInviteForm ? 'Close' : 'Invite member'}
                        </button>
                      </div>

                      {showInviteForm ? (
                      <div className={settingsTheme.sectionRows + ' mt-3'}>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_148px_auto]">
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
                          className={settingsTheme.footerButton + ' h-10 rounded-xl px-3 text-sm'}
                        >
                          {isSendingInvite ? 'Creating...' : 'Create invite'}
                        </button>
                      </div>
                      <p className={settingsTheme.rowMuted + ' mt-2 px-4 leading-5'}>
                        Optional email. Invite links can be copied and shared manually.
                      </p>
                      </div>
                      ) : null}

                      {(inviteLink || inviteToken) && (
                        <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                          <p
                            className={settingsTheme.rowMuted.replace(
                              'text-xs',
                              'text-xs font-medium'
                            )}
                          >
                            Invite link
                          </p>
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
                              className={
                                settingsTheme.controlButtonNeutral +
                                ' inline-flex items-center justify-center gap-2'
                              }
                            >
                              <Copy size={14} />
                              Copy link
                            </button>
                          </div>
                          {inviteCopyStatus && (
                            <p className="mt-2 text-xs text-[var(--ledger-text-secondary)]">
                              {inviteCopyStatus}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                        <p
                          className={settingsTheme.rowMuted.replace(
                            'text-xs',
                            'text-xs font-medium'
                          )}
                        >
                          Recent invites
                        </p>
                        <div className={settingsTheme.sectionRows}>
                          {isLoadingWorkspaceAdmin ? (
                            <div aria-label="Loading invitations" role="status">
                              {[0, 1].map((row) => (
                                <div
                                  key={row}
                                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 last:border-b-0"
                                >
                                  <div className="min-w-0 space-y-1.5">
                                    <div className="h-3 w-40 max-w-[80%] animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
                                    <div className="h-2.5 w-24 animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
                                  </div>
                                  <div className="h-2.5 w-12 animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
                                  <div className="h-8 w-[68px] animate-pulse rounded-lg bg-[var(--ledger-surface-hover)]" />
                                </div>
                              ))}
                            </div>
                          ) : workspaceInvitations.length === 0 ? (
                            <div className="py-4 text-xs text-[var(--ledger-text-muted)]">
                              No pending invites.
                            </div>
                          ) : (
                            workspaceInvitations.map((invite) => (
                              <div
                                key={invite.id}
                                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3"
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
                                  className={
                                    settingsTheme.controlButtonNeutral + ' rounded-lg px-2'
                                  }
                                >
                                  Manage
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </section>

                    {false && (
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-teams"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-teams" className={settingsTheme.sectionTitle}>
                            Teams
                          </h3>
                          <p className={settingsTheme.sectionStatus}>
                            Create and manage teams in this workspace.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={openCreateTeamModal}
                          disabled={!canManageWorkspace}
                          className={settingsTheme.controlButton}
                        >
                          <Plus size={12} />
                          New team
                        </button>
                      </div>

                      <div className="mt-5 overflow-hidden rounded-[20px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]">
                        <div className="grid grid-cols-[minmax(0,1fr)_120px_96px_120px] gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-xs font-medium text-[var(--ledger-text-muted)]">
                          <div>Name</div>
                          <div>Members</div>
                          <div>Assigned</div>
                          <div className="text-right">Identifier</div>
                        </div>
                        {workspaceTeams.length === 0 ? (
                          <div className="flex min-h-40 items-center justify-center px-4 py-8 text-center">
                            <div className="max-w-sm">
                              <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                                No teams yet.
                              </p>
                              <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                                Create teams to group people and assign work inside this workspace.
                              </p>
                              <div className="mt-4 flex justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={openCreateTeamModal}
                                  disabled={!canManageWorkspace}
                                  className={settingsTheme.primaryButton}
                                >
                                  Create team
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          workspaceTeams.map((team) => {
                            const memberCount = Array.isArray(team.members)
                              ? team.members.length
                              : 0;
                            const isArchived = Boolean(team.archivedAt);
                            return (
                              <div
                                key={team.id}
                                className="grid grid-cols-[minmax(0,1fr)_120px_96px_120px_auto] items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"
                              >
                                <button
                                  type="button"
                                  onClick={() => openTeamWorkPage(team.id)}
                                  className="flex min-w-0 items-center gap-3 text-left"
                                >
                                  <span
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                                    style={{ backgroundColor: team.color || '#FF5F40' }}
                                  >
                                    <Hash size={14} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                      {team.name}
                                    </span>
                                    <span className="block truncate text-xs text-[var(--ledger-text-muted)]">
                                      {isArchived ? 'Archived' : 'Active'}
                                      {team.description ? ` · ${team.description}` : ''}
                                    </span>
                                  </span>
                                </button>
                                <div className="text-sm text-[var(--ledger-text-secondary)]">
                                  {memberCount} members
                                </div>
                                <div className="text-sm text-[var(--ledger-text-secondary)]">
                                  {team.assignedCount} assigned
                                </div>
                                <div className="text-right font-mono text-xs font-semibold text-[var(--ledger-text-muted)]">
                                  {team.identifier}
                                </div>
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openTeamWorkPage(team.id)}
                                    className={settingsTheme.controlButton}
                                  >
                                    Open
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openWorkspaceTeamSettings(team.id)}
                                    className={settingsTheme.controlButton}
                                  >
                                    Settings
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        if (isArchived) {
                                          await api.restoreTeam(team.id);
                                        } else {
                                          await api.archiveTeam(team.id);
                                        }
                                        const teamsPayload = await api.getTeams({
                                          includeArchived: true,
                                        });
                                        const nextTeams = Array.isArray(
                                          (teamsPayload as { teams?: unknown[] })?.teams
                                        )
                                          ? (teamsPayload as { teams: WorkspaceTeam[] }).teams ?? []
                                          : [];
                                        setWorkspaceTeams(nextTeams);
                                      } catch (err) {
                                        setWorkspaceAdminError(
                                          err instanceof Error
                                            ? err.message
                                            : 'Could not update team'
                                        );
                                      }
                                    }}
                                    className={settingsTheme.controlButton}
                                    disabled={!canManageWorkspace}
                                  >
                                    {isArchived ? 'Restore' : 'Archive'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!canManageWorkspace) return;
                                      if (!window.confirm(`Delete ${team.name}?`)) return;
                                      try {
                                        await api.deleteTeam(team.id);
                                        const teamsPayload = await api.getTeams({
                                          includeArchived: true,
                                        });
                                        const nextTeams = Array.isArray(
                                          (teamsPayload as { teams?: unknown[] })?.teams
                                        )
                                          ? (teamsPayload as { teams: WorkspaceTeam[] }).teams ?? []
                                          : [];
                                        setWorkspaceTeams(nextTeams);
                                      } catch (err) {
                                        setWorkspaceAdminError(
                                          err instanceof Error
                                            ? err.message
                                            : 'Could not delete team'
                                        );
                                      }
                                    }}
                                    className={settingsTheme.dangerButton}
                                    disabled={!canManageWorkspace}
                                    title="Delete team"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </section>
                    )}
                      </>
                    )}

                    {activeSection === 'workspace' && (
                    <>
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="settings-defaults"
                    >
                      <h3 id="settings-defaults" className={settingsTheme.sectionTitle}>
                        Defaults
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center justify-between gap-4">
                          <label
                            htmlFor="settings-week-start"
                            className={settingsTheme.label}
                          >
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
                            className={settingsTheme.inputSecondary + ' w-48 appearance-none pr-9'}
                            style={selectChevronStyle}
                          >
                            <option value="monday">Monday</option>
                            <option value="sunday">Sunday</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <label
                            htmlFor="settings-time-format"
                            className={settingsTheme.label}
                          >
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
                            className={settingsTheme.inputSecondary + ' w-48 appearance-none pr-9'}
                            style={selectChevronStyle}
                          >
                            <option value="12h">12-hour (2:00 PM)</option>
                            <option value="24h">24-hour (14:00)</option>
                          </select>
                        </div>
                      </div>
                    </section>

                      {showCreateWorkspaceForm ? (
                        <div className="mt-3 space-y-3">
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
                                <p className="text-xs text-[color:var(--ledger-accent)]">
                                  {workspaceCreateStatus}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => void handleCreateWorkspace()}
                              disabled={isCreatingWorkspace || !workspaceCreateName.trim()}
                              className={
                                settingsTheme.primaryButton + ' h-8 rounded-lg px-3 text-xs'
                              }
                            >
                              {isCreatingWorkspace ? 'Creating...' : 'Create workspace'}
                            </button>
                          </div>
                        </div>
                      ) : null}

                    <SettingsDangerGroup>
                      <section aria-labelledby="settings-danger-zone">
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
                    </SettingsDangerGroup>
                    </>
                    )}
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

                  <div className="mt-8 flex flex-col gap-8">
                    <section
                      className={settingsTheme.sectionShell + ' order-2'}
                      aria-labelledby="calendar-defaults"
                    >
                      <h3 id="calendar-defaults" className={settingsTheme.sectionTitle}>
                        Event defaults
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
                          label="Default event duration"
                          help="Length of new events."
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
                        </SettingsRow>
                        <SettingsRow
                          label="Calendar for new events"
                          help="Calendar used for new events."
                        >
                          <select
                            id="settings-event-calendar"
                            value={preferences.defaultEventCalendar}
                            onChange={(e) =>
                              setPreferences((prev) => ({
                                ...prev,
                                defaultEventCalendar: e.target.value as
                                  | 'personal'
                                  | 'work'
                                  | 'projects',
                              }))
                            }
                            className={preferenceSelectClassName}
                            style={selectChevronStyle}
                          >
                            <option value="personal">Personal</option>
                            <option value="work">Work</option>
                            <option value="projects">Projects</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Default event status"
                          help="Starting status for new events."
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell + ' order-3'}
                      aria-labelledby="reminder-defaults"
                    >
                      <h3 id="reminder-defaults" className={settingsTheme.sectionTitle}>
                        Reminder defaults
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
                          label="Default reminder alert"
                          help="How early reminders appear."
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
                        </SettingsRow>
                        <SettingsRow
                          label="Time for date-only reminders"
                          help="Used when a reminder has no time."
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
                        </SettingsRow>
                        <SettingsRow
                          label="Snooze options"
                          help="Quick delay options for reminders."
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell + ' order-4'}
                      aria-labelledby="overdue-behavior"
                    >
                      <h3 id="overdue-behavior" className={settingsTheme.sectionTitle}>
                        Overdue behavior <SettingsInfo text="Controls what Ledger does when reminders or scheduled work pass their due time." />
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
                          label="Missed reminders"
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
                        </SettingsRow>
                        <SettingsRow
                          label="Completed items"
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell + ' order-5'}
                      aria-labelledby="follow-up-behavior"
                    >
                      <h3 id="follow-up-behavior" className={settingsTheme.sectionTitle}>
                        Follow-up behavior
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell + ' order-1'}
                      aria-labelledby="calendar-display"
                    >
                      <h3 id="calendar-display" className={settingsTheme.sectionTitle}>
                        Calendar display
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
                          label="Default calendar view"
                          help="View Ledger opens first."
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
                        </SettingsRow>
                        <SettingsRow
                          label="First day of week"
                          help="Controls the calendar week layout."
                        >
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
                        </SettingsRow>
                        <SettingsRow label="Time format" help="Choose 12- or 24-hour times.">
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
                        </SettingsRow>
                        <SettingsRow
                          label="Show weekends"
                          help="Include Saturday and Sunday."
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
                        </SettingsRow>
                        <SettingsRow
                          label="Show reminders"
                          help="Show reminders in the calendar."
                        >
                          <InlineSwitch
                            checked={preferences.showRemindersOnCalendar}
                            onToggle={() =>
                              setPreferences((prev) => ({
                                ...prev,
                                showRemindersOnCalendar: !prev.showRemindersOnCalendar,
                              }))
                            }
                            label="Show reminders"
                          />
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    {!activeWorkspace?.is_personal && (
                    <section
                      className={settingsTheme.sectionShell + ' order-6'}
                      aria-labelledby="workspace-calendars"
                    >
                      <h3 id="workspace-calendars" className={settingsTheme.sectionTitle}>
                        Workspace calendars <SettingsInfo text="Workspace calendars keep personal, school, internship, and freelance commitments separated while Today can still surface relevant work." />
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>
                    )}
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

                  <div className="mt-8 flex flex-col gap-8">
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="notification-control"
                    >
                      <h3 id="notification-control" className={settingsTheme.sectionTitle}>
                        Control <SettingsInfo text="Pause new alerts without changing your delivery preferences." />
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                          <span className="min-w-0">
                            <span className={settingsTheme.label}>Pause notifications</span>
                            <span className={settingsTheme.help}>
                              Temporarily mute new reminders and alerts from Ledger.
                            </span>
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={notificationPreferences.paused}
                            aria-label={
                              notificationPreferences.paused
                                ? 'Resume notifications'
                                : 'Pause notifications'
                            }
                            title={
                              notificationPreferences.paused
                                ? 'Resume notifications'
                                : 'Pause notifications'
                            }
                            onClick={() =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                paused: !prev.paused,
                              }))
                            }
                            className={`inline-flex h-7 w-12 shrink-0 items-center justify-center rounded-full border transition focus:outline-none focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60 ${
                              notificationPreferences.paused
                                ? 'border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)] text-white'
                                : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-secondary)]'
                            }`}
                          >
                            {notificationPreferences.paused ? (
                              <CirclePlay size={16} strokeWidth={2} />
                            ) : (
                              <CirclePause size={16} strokeWidth={2} />
                            )}
                          </button>
                        </div>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="notification-delivery"
                    >
                      <h3 id="notification-delivery" className={settingsTheme.sectionTitle}>
                        Delivery
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="notification-sources"
                    >
                      <h3 id="notification-sources" className={settingsTheme.sectionTitle}>
                        Notify me about
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow label="Reminders" help="Time-based reminders you create.">
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
                        </SettingsRow>
                        <SettingsRow label="Events" help="Upcoming calendar events.">
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
                        </SettingsRow>
                        <SettingsRow label="Tasks" help="Tasks due today or overdue.">
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                        <SettingsRow
                          label="Intake captures"
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
                            label="Intake captures"
                          />
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="notification-timing"
                    >
                      <h3 id="notification-timing" className={settingsTheme.sectionTitle}>
                        Timing
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
                          label="Event reminder"
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
                        </SettingsRow>
                        <SettingsRow
                          label="Task reminder"
                          help="How task notifications should be timed."
                        >
                          <select
                            value={notificationPreferences.defaultTaskTiming}
                            onChange={(e) =>
                              setNotificationPreferences((prev) => ({
                                ...prev,
                                defaultTaskTiming: e.target
                                  .value as NotificationPreferences['defaultTaskTiming'],
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
                        </SettingsRow>
                        <SettingsRow
                          label="Project deadline reminder"
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
                        </SettingsRow>
                        <SettingsRow
                          label="Snooze choices"
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
                        </SettingsRow>
                      </div>
                    </section>

                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="notification-behavior"
                    >
                      <h3 id="notification-behavior" className={settingsTheme.sectionTitle}>
                        Behavior
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <SettingsRow
                          label="Keep overdue items visible"
                          help="Keep overdue items surfaced in Today and Overview."
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
                        </SettingsRow>
                        <SettingsRow
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
                        </SettingsRow>
                      </div>
                    </section>
                  </div>
                </section>
              )}

              {activeSection === 'integrations' && figmaDetailOpen ? (
                <FigmaIntegrationPage
                  workspaceId={activeWorkspaceId}
                  canManage={canManageWorkspace}
                  onBack={() => setFigmaDetailOpen(false)}
                  onStatusChange={setFigmaStatus}
                />
              ) : activeSection === 'integrations' && slackDetailOpen ? (
                <SlackIntegrationPage
                  workspaceId={activeWorkspaceId}
                  canManage={canManageWorkspace}
                  onBack={() => setSlackDetailOpen(false)}
                  onStatusChange={(next) => setSlackStatus(next as SlackIntegrationStatus)}
                />
              ) : activeSection === 'integrations' && (
                <section className="w-full max-w-215" aria-labelledby="settings-integrations">
                  <div className="space-y-2">
                    <h2 id="settings-integrations" className={settingsTheme.pageTitle}>
                      Integrations
                    </h2>
                    <p className={settingsTheme.pageSubtitle}>
                      Connect tools that send captures and updates into Ledger.
                    </p>
                  </div>

                  <div className="mt-8 flex flex-col gap-8">
                    <section
                      className={settingsTheme.sectionShell}
                      aria-labelledby="integration-list"
                    >
                      <h3 id="integration-list" className={settingsTheme.sectionTitle}>
                        Connected
                      </h3>
                      <div className={settingsTheme.sectionRows}>
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]" aria-hidden="true"><FigmaMark /></span>
                          <div className="min-w-0 flex-1"><p className={settingsTheme.label}>Figma <span className="ml-1 text-[11px] font-normal text-[var(--ledger-text-muted)]">{figmaStatus.status === 'connected' ? 'Connected' : figmaStatus.status === 'connecting' ? 'Connecting' : figmaStatus.status === 'expired' || figmaStatus.status === 'revoked' || figmaStatus.status === 'error' ? 'Needs attention' : 'Not connected'}</span></p><p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Attach designs to Ledger work and preview them without leaving your workspace.</p></div>
                          <button type="button" onClick={() => setFigmaDetailOpen(true)} className={settingsTheme.controlButtonNeutral + ' rounded-lg'}>{figmaStatus.status === 'connected' ? 'Manage' : 'Connect'}</button>
                        </div>
                        <div
                          className={`flex items-center gap-3 px-4 py-2.5 ${slackStatus?.connected ? 'cursor-pointer hover:bg-[var(--ledger-surface-hover)]' : ''}`}
                          onClick={() => { if (slackStatus?.connected) setSlackDetailOpen(true); }}
                          role={slackStatus?.connected ? 'button' : undefined}
                          tabIndex={slackStatus?.connected ? 0 : undefined}
                          onKeyDown={(event) => { if (slackStatus?.connected && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSlackDetailOpen(true); } }}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]">
                            <SlackMark />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={settingsTheme.label}>Slack <span className="ml-1 text-[11px] font-normal text-[var(--ledger-text-muted)]">
                                {isLoadingSlackStatus
                                  ? 'Checking status'
                                  : slackStatus?.connected
                                  ? `Connected to ${slackStatus.team_name || 'Slack'}${
                                      slackStatus.updated_at
                                        ? ` · Updated ${formatIntegrationDate(
                                            slackStatus.updated_at
                                          )}`
                                        : ''
                                    }`
                                  : 'Not connected'}
                            </span></p>
                            <p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Save Slack messages to Intake.</p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); if (slackStatus?.connected) setSlackDetailOpen(true); else void handleConnectSlack(); }}
                              disabled={
                                isConnectingSlack || !activeWorkspaceId || !canManageWorkspace
                              }
                              className={`h-8 rounded-lg px-3 text-xs font-medium transition disabled:opacity-50 ${
                                slackStatus?.connected
                                  ? `${settingsTheme.controlButtonNeutral} rounded-lg`
                                : `${settingsTheme.controlButtonNeutral} rounded-lg`
                              }`}
                            >
                              {isConnectingSlack
                                ? 'Opening...'
                                : slackStatus?.connected
                                ? 'Manage'
                                : 'Connect'}
                            </button>
                          </div>
                        </div>
                        <GithubIntegrationCard workspaceId={activeWorkspaceId} canManage={canManageWorkspace} />

                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                            <Globe2 size={16} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={settingsTheme.label}>Browser Extension <span className="ml-1 text-[11px] font-normal text-[var(--ledger-text-muted)]">
                                {isLoadingExtensionTokenStatus
                                  ? 'Checking status'
                                  : extensionTokenStatus?.exists
                                  ? [
                                      'Token active',
                                      extensionTokenStatus.last_used_at
                                        ? `Last used ${
                                            formatIntegrationDate(
                                              extensionTokenStatus.last_used_at
                                            ) ?? 'recently'
                                          }`
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')
                                  : 'No token created'}
                            </span></p>
                            <p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Capture links, selected text, and quick notes from Chrome.</p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
                                className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                              >
                                {isExtensionTokenBusy ? 'Generating...' : 'Generate token'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div
                          className={`flex items-start gap-3 px-4 py-2.5 ${activeMcpConnections.length ? `cursor-pointer transition ${isMcpConnectionsExpanded ? '' : 'hover:bg-[var(--ledger-surface-muted)]'}` : ''}`}
                          onClick={() => {
                            if (!activeMcpConnections.length) return;
                            setIsMcpConnectionsExpanded((expanded) => !expanded);
                            setOpenMcpConnectionMenuId(null);
                            setOpenMcpPermissionsId(null);
                          }}
                          aria-expanded={activeMcpConnections.length ? isMcpConnectionsExpanded : undefined}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]" aria-hidden="true">
                            <img src="/mcp-icons/mpc.svg" alt="" className="h-5 w-5 dark:invert" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={settingsTheme.label}>MCP connections</p>
                            <p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">Connect AI tools to an explicitly approved Ledger workspace.</p>
                            {isLoadingMcpConnections ? <p className={settingsTheme.sectionStatus + ' mt-1'}>Checking connections…</p> : activeMcpConnections.length === 0 ? <p className={settingsTheme.sectionStatus + ' mt-1'}>No active connections</p> : isMcpConnectionsExpanded ? (
                              <div
                                className="mt-2 overflow-visible rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {activeMcpConnections.map((connection) => {
                                  const isExpanded = expandedMcpConnectionId === connection.id;
                                  const isMenuOpen = openMcpConnectionMenuId === connection.id;
                                  const hasWriteAccess = connection.scopes.some((scope) => scope.endsWith(':write'));
                                  const readAreas = connection.scopes.filter((scope) => scope.endsWith(':read')).map((scope) => MCP_READ_SCOPE_LABELS[scope] ?? scope.split(':')[0]);
                                  const writeAreas = MCP_WRITE_PERMISSION_ROWS.filter(({ scope }) => connection.scopes.includes(scope)).map(({ label }, index) => index === 0 ? label : label.toLowerCase());
                                  const provider = connection.client_name.toLowerCase().includes('claude') || connection.client_name.toLowerCase().includes('anthropic') ? 'Anthropic' : connection.client_name.toLowerCase().includes('chatgpt') || connection.client_name.toLowerCase().includes('openai') ? 'OpenAI' : null;
                                  return <div key={connection.id} className="relative border-b border-[color:var(--ledger-border-subtle)] last:border-b-0">
                                    <div className="flex min-h-14 cursor-pointer items-center gap-2.5 px-3 py-2.5 transition hover:bg-[var(--ledger-surface-hover)]" onClick={() => { setExpandedMcpConnectionId(isExpanded ? null : connection.id); setOpenMcpConnectionMenuId(null); setOpenMcpPermissionsId(null); }}>
                                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]" aria-hidden="true">
                                        {provider === 'Anthropic' ? <img src="/mcp-icons/Claude.svg" alt="" className="h-4 w-4" /> : provider === 'OpenAI' ? <img src="/mcp-icons/Openai.svg" alt="" className="h-4 w-4 dark:invert" /> : <img src="/mcp-icons/mpc.svg" alt="" className="h-5 w-5 dark:invert" />}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <p className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">{connection.client_name}</p>
                                          {provider && <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">{provider}</span>}
                                        </div>
                                        <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">{connection.workspaces[0]?.name ?? 'Workspace'}</p>
                                      </div>
                                      <span className="hidden shrink-0 text-[11px] text-[var(--ledger-text-muted)] sm:inline">{hasWriteAccess ? 'Read + write' : 'Read only'}</span>
                                      <span className="shrink-0 text-[var(--ledger-text-muted)]" aria-hidden="true">{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                                      <div className="relative shrink-0" data-mcp-menu onClick={(event) => event.stopPropagation()}>
                                        <button type="button" onClick={() => setOpenMcpConnectionMenuId(isMenuOpen ? null : connection.id)} aria-label={`More actions for ${connection.client_name}`} aria-expanded={isMenuOpen} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><MoreHorizontal size={16} /></button>
                                        {isMenuOpen && <div className="absolute bottom-8 right-0 z-20 w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[0_12px_30px_rgba(15,23,42,0.14)]">
                                          <button type="button" onClick={() => { setOpenMcpConnectionMenuId(null); void handleRenameMcpConnection(connection); }} disabled={mcpConnectionActionId === connection.id || !canUseWorkspaceIntegrations} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50">Rename connection</button>
                                          <button type="button" onClick={() => { setOpenMcpConnectionMenuId(null); window.alert('Workspace switching is requested by the connected AI tool and requires browser approval.'); }} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Switch workspace</button>
                                          <button type="button" onClick={() => { setOpenMcpConnectionMenuId(null); void handleRevokeMcpConnection(connection.id); }} disabled={mcpConnectionActionId === connection.id || !canUseWorkspaceIntegrations} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-50">Revoke connection</button>
                                        </div>}
                                      </div>
                                    </div>
                                    {isExpanded && <div className="space-y-2.5 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3 text-xs text-[var(--ledger-text-secondary)]">
                                      <p>View: {readAreas.length ? readAreas.join(', ') : 'none'}</p>
                                      <p>Change: {writeAreas.length ? writeAreas.join(', ') : 'none'}</p>
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--ledger-text-muted)]">
                                        <span>Workspace: <span className="text-[var(--ledger-text-secondary)]">{connection.workspaces[0]?.name ?? 'Workspace'}</span></span>
                                        <span>Connected {formatIntegrationDate(connection.created_at) ?? 'Unknown'} · {connection.last_used_at ? `Last used ${formatIntegrationDate(connection.last_used_at) ?? 'recently'}` : 'Not used yet'}</span>
                                      </div>
                                      <div className="relative" data-mcp-permissions onClick={(event) => event.stopPropagation()}>
                                        <button type="button" onClick={() => setOpenMcpPermissionsId(openMcpPermissionsId === connection.id ? null : connection.id)} disabled={!canUseWorkspaceIntegrations} className={settingsTheme.controlButtonNeutral + ' h-7 rounded-lg px-2.5 text-[11px]'}>Manage permissions</button>
                                        {openMcpPermissionsId === connection.id && <div className="absolute bottom-9 left-0 z-20 w-56 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[0_12px_30px_rgba(15,23,42,0.14)]">
                                          {MCP_WRITE_PERMISSION_ROWS.map(({ scope, label }) => {
                                            const enabled = connection.scopes.includes(scope);
                                            const actionId = `${connection.id}:${scope}`;
                                            return <button key={scope} type="button" role="checkbox" aria-checked={enabled} onClick={() => { if (enabled) { if (window.confirm(`Remove ${label} access from this connection?`)) void handleRemoveMcpScope(connection, scope); } else void handleRequestMcpScope(connection, scope); }} disabled={Boolean(mcpScopeActionId) || !canUseWorkspaceIntegrations} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[10px] ${enabled ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)] text-white' : 'border-[color:var(--ledger-border-strong)]'}`}>{enabled && '✓'}</span><span>{label}</span>{mcpScopeActionId === actionId && <span className="ml-auto text-[10px] text-[var(--ledger-text-muted)]">Opening…</span>}</button>;
                                          })}
                                        </div>}
                                      </div>
                                    </div>}
                                  </div>;
                                })}
                              </div>
                            ) : null}
                          </div>
                          {activeMcpConnections.length > 0 && (
                            <button
                              type="button"
                              aria-label={isMcpConnectionsExpanded ? 'Collapse MCP connections' : 'Expand MCP connections'}
                              aria-expanded={isMcpConnectionsExpanded}
                              className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                            >
                              {isMcpConnectionsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          )}
                        </div>
                      </div>

                      {(slackError || extensionTokenError || extensionTokenCopyStatus || mcpConnectionError) && (
                        <p
                          className={`mt-4 flex items-center gap-1.5 text-xs ${
                            slackError || extensionTokenError
                              ? 'text-[var(--ledger-danger)]'
                              : 'text-[var(--ledger-text-secondary)]'
                          }`}
                        >
                          {(slackError || extensionTokenError) && <CircleAlert size={12} />}
                          {slackError || extensionTokenError || extensionTokenCopyStatus || mcpConnectionError}
                        </p>
                      )}
                    </section>

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

                  <div className="mt-8 space-y-8">
                  <section aria-labelledby="sidebar-placement">
                    <h3 id="sidebar-placement" className={settingsTheme.sectionTitle}>
                      Placement
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      <div>
                        <div className="px-4 py-3">
                          <p className={settingsTheme.label}>Sidebar position</p>
                          <p className={settingsTheme.help}>
                            Choose where the sidebar is attached, or use it as a floating window.
                          </p>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 border-t border-[color:var(--ledger-border-subtle)] p-3">
                          {sidebarPositionOptions.map((option) => {
                            const Icon = option.icon;
                            const isActive = position === option.value;
                            const isFloating = option.value === 'floating';

                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setPosition(option.value)}
                                className={`${isFloating ? 'col-span-4' : ''} flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition ${
                                  isActive
                                    ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                    : 'border-transparent text-[var(--ledger-text-secondary)] hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                }`}
                              >
                                <Icon className="h-4 w-4 shrink-0" />
                                <span>{option.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <SettingsRow
                        label="Open on launch"
                        help="Choose how the sidebar appears when Ledger starts."
                      >
                        <select
                          value={defaultState}
                          onChange={(event) =>
                            setDefaultState(event.target.value as SidebarDefaultState)
                          }
                          className={preferenceSelectClassName}
                          style={selectChevronStyle}
                        >
                          {sidebarDefaultStateOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </SettingsRow>
                    </div>
                  </section>

                  <section aria-labelledby="sidebar-appearance">
                    <h3 id="sidebar-appearance" className={settingsTheme.sectionTitle}>
                      Appearance
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      <SettingsRow
                        label="Opacity"
                        help="Set how much of the sidebar background shows through."
                      >
                        <div className="w-full sm:w-72">
                          <div className="flex items-center justify-between gap-3">
                            <span className={settingsTheme.label}>
                              {Math.round(opacity * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.7"
                            max="1"
                            step="0.01"
                            value={opacity}
                            onChange={(event) => setOpacity(Number(event.target.value))}
                            className="ledger-range mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent"
                            style={getSidebarOpacitySliderStyle(opacity)}
                          />
                        </div>
                      </SettingsRow>
                      <SettingsRow
                        label="Background blur"
                        help="Blur content behind the sidebar."
                      >
                        <InlineSwitch
                          checked={blur}
                          onToggle={() => setBlur(!blur)}
                          label="Blur sidebar background"
                        />
                      </SettingsRow>
                    </div>
                  </section>

                  <section aria-labelledby="sidebar-behavior">
                    <h3 id="sidebar-behavior" className={settingsTheme.sectionTitle}>
                      Behavior
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      {position === 'floating' && (
                      <SettingsRow label="Always on top" help="Keep the floating sidebar above other windows.">
                        <InlineSwitch
                          checked={alwaysOnTop}
                          onToggle={() => setAlwaysOnTop(!alwaysOnTop)}
                          label="Always on top"
                        />
                      </SettingsRow>
                      )}
                      <SettingsRow
                        label="Auto-hide"
                        help="Hide the sidebar when your pointer leaves it."
                      >
                        <InlineSwitch
                          checked={autoHide}
                          onToggle={() => setAutoHide(!autoHide)}
                          label="Auto hide"
                        />
                      </SettingsRow>
                    </div>
                  </section>
                  <section aria-labelledby="sidebar-reset">
                    <h3 id="sidebar-reset" className={settingsTheme.sectionTitle}>
                      Reset
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className={settingsTheme.label}>Reset sidebar settings</p>
                          <p className={settingsTheme.help}>
                            Restore Ledger&apos;s default sidebar position and behavior.
                          </p>
                        </div>
                        <button
                          onClick={handleResetSidebarSettings}
                          type="button"
                          className={settingsTheme.footerButton + ' h-8 rounded-lg px-3 text-xs'}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </section>
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

                  <section className={settingsTheme.sectionShell} aria-labelledby="accessibility-core">
                    <h3 id="accessibility-core" className={settingsTheme.sectionTitle}>
                      Accessibility
                    </h3>
                    <div className={settingsTheme.sectionRows}>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>Reduce motion</span>
                          <span className={settingsTheme.help}>
                            Minimize non-essential animations.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={preferences.reduceMotion}
                          onToggle={() =>
                            setPreferences((prev) => ({
                              ...prev,
                              reduceMotion: !prev.reduceMotion,
                            }))
                          }
                          label="Reduce motion"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>High contrast</span>
                          <span className={settingsTheme.help}>
                            Increase contrast for text, borders, and controls.
                          </span>
                        </span>
                        <InlineSwitch
                          checked={preferences.highContrast}
                          onToggle={() =>
                            setPreferences((prev) => ({
                              ...prev,
                              highContrast: !prev.highContrast,
                            }))
                          }
                          label="High contrast"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>Compact density</span>
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

                  <SettingsSection id="accessibility-startup" title="Startup">
                    <SettingsGroup>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className={settingsTheme.label}>Open overview by default</span>
                          <span className={settingsTheme.help}>
                            Open Overview when Ledger starts.
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
                          label="Open overview by default"
                        />
                      </div>
                    </SettingsGroup>
                  </SettingsSection>
                </section>
              )}

              {activeSection === 'shortcuts' && (
                <section className="w-full max-w-215" aria-labelledby="settings-shortcuts">
                  <SettingsPageHeader
                    id="settings-shortcuts"
                    title="Keyboard Shortcuts"
                    description="Quick reference for actions."
                  />

                  <div className="mt-8 space-y-6">
                    {shortcutSections.map((section) => (
                      <section key={section.id} className={settingsTheme.sectionShell}>
                        <h3
                          id={`shortcut-${section.id}`}
                          className={settingsTheme.sectionTitle}
                        >
                          {section.title}
                        </h3>
                        <div className={settingsTheme.sectionRows}>
                          {section.shortcuts.map((shortcut) => (
                            <div
                              key={`${section.id}-${shortcut.keys}`}
                              className="grid gap-3 py-3 md:grid-cols-[160px_minmax(0,1fr)] md:items-center"
                            >
                              <p className={settingsTheme.rowMuted + ' font-medium'}>
                                {shortcut.keys}
                              </p>
                              <p className="text-right text-sm text-[var(--ledger-text-secondary)]">
                                {shortcut.description}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              )}

              </SettingsPage>
              <ModalOverlay
                isOpen={isAccountDeleteModalOpen}
                onClose={closeAccountDeleteModal}
                backdropBorderRadius="inherit"
                disablePortal
                manageWindowChrome={false}
                classNameContainer={`w-full max-w-lg ${settingsTheme.modalShell}`}
              >
                <div className="flex items-start justify-between gap-4 px-5 pt-5">
                  <div>
                    <p className={settingsTheme.rowMuted + ' font-medium'}>Permanent action</p>
                    <h3 className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]">
                      Delete your Ledger account?
                    </h3>
                  </div>
                  <ModalCloseButton
                    onClick={closeAccountDeleteModal}
                    ariaLabel="Close delete account modal"
                  />
                </div>

                <div className="space-y-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                  <p>
                    This permanently deletes your account, personal workspaces, notes, tasks,
                    reminders, sessions, integrations, and other data tied only to you.
                  </p>
                  <p>
                    Shared workspaces are not deleted because another person belongs to them. If
                    you own a shared workspace, ownership is transferred to an existing admin or
                    member before your account is removed.
                  </p>
                  <label className="flex items-start gap-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-3 text-[var(--ledger-text-primary)]">
                    <input
                      type="checkbox"
                      checked={accountDeleteConfirmed}
                      onChange={(event) => setAccountDeleteConfirmed(event.target.checked)}
                      disabled={isDeletingAccount}
                      className="mt-1 h-4 w-4 accent-[var(--ledger-danger)]"
                    />
                    <span>
                      I understand this cannot be undone and confirm that I want to delete my
                      account and all data tied to it.
                    </span>
                  </label>
                </div>

                {accountDeleteError ? (
                  <p className="px-5 pb-3 text-xs text-[var(--ledger-danger)]" role="alert">
                    {accountDeleteError}
                  </p>
                ) : null}

                <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
                  <button
                    type="button"
                    onClick={closeAccountDeleteModal}
                    disabled={isDeletingAccount}
                    className={settingsTheme.controlButtonNeutral + ' rounded-lg'}
                  >
                    Keep account
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount()}
                    disabled={!accountDeleteConfirmed || isDeletingAccount}
                    className={settingsTheme.dangerButton + ' rounded-lg'}
                  >
                    {isDeletingAccount ? 'Deleting account...' : 'Delete permanently'}
                  </button>
                </div>
              </ModalOverlay>
              <ModalOverlay
                isOpen={isCreateTeamOpen}
                onClose={() => setIsCreateTeamOpen(false)}
                backdropBorderRadius="inherit"
                disablePortal
                manageWindowChrome={false}
                classNameContainer="w-full max-w-md rounded-2xl border p-5"
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateTeam();
                  }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">
                      New team
                    </h3>
                    <p className="mt-1 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                      Create a compact team for shared ownership.
                    </p>
                  </div>
                  <label className="block space-y-1.5">
                    <span className={settingsTheme.label}>Team name</span>
                    <input
                      value={createTeamName}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setCreateTeamName(nextName);
                        if (!createTeamIdentifierTouched) {
                          setCreateTeamIdentifier(makeTeamIdentifier(nextName));
                        }
                      }}
                      className={settingsTheme.input}
                      placeholder="Main Room"
                      autoFocus
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={settingsTheme.label}>Identifier</span>
                    <input
                      value={createTeamIdentifier}
                      onChange={(event) => {
                        setCreateTeamIdentifierTouched(true);
                        setCreateTeamIdentifier(event.target.value.toUpperCase());
                      }}
                      className={settingsTheme.input}
                      placeholder="MAIN"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={settingsTheme.label}>Description</span>
                    <textarea
                      value={createTeamDescription}
                      onChange={(event) => setCreateTeamDescription(event.target.value)}
                      className={settingsTheme.input + ' min-h-20 resize-none py-2'}
                      placeholder="Optional"
                    />
                  </label>
                  <div className="space-y-2">
                    <span className={settingsTheme.label}>Color</span>
                    <div className="flex flex-wrap gap-2">
                      {['#FF5F40', '#D97706', '#0F766E', '#2563EB', '#7C3AED', '#475569'].map(
                        (color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setCreateTeamColor(color)}
                            className={`h-7 w-7 rounded-full border-2 ${
                              createTeamColor === color
                                ? 'border-[var(--ledger-text-primary)]'
                                : 'border-transparent'
                            }`}
                            style={{ backgroundColor: color }}
                            aria-label={`Use ${color}`}
                          />
                        )
                      )}
                    </div>
                  </div>
                  {createTeamError && (
                    <p className="text-xs text-[var(--ledger-danger)]">{createTeamError}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreateTeamOpen(false)}
                      className={settingsTheme.controlButton}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isCreatingTeam || !createTeamName.trim()}
                      className={settingsTheme.primaryButton}
                    >
                      {isCreatingTeam ? 'Creating...' : 'Create team'}
                    </button>
                  </div>
                </form>
              </ModalOverlay>

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
                    <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">
                      Connect browser extension
                    </h3>
                    <p className="mt-1 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                      Use this token in the Ledger browser extension.
                    </p>
                  </div>
                  <ModalCloseButton
                    onClick={closeExtensionTokenModal}
                    ariaLabel="Close extension token modal"
                  />
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
                    <p className="mt-2 text-xs text-[var(--ledger-text-secondary)]">
                      {extensionTokenCopyStatus}
                    </p>
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
                    className={
                      settingsTheme.controlButtonNeutral +
                      ' inline-flex items-center gap-2 rounded-lg'
                    }
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
                    <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">
                      Regenerate extension token?
                    </h3>
                    <p className="mt-1 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                      Your existing browser extension token will stop working. You’ll need to paste
                      the new token into the extension.
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
                    <h3 className="text-lg font-semibold text-[var(--ledger-text-primary)]">
                      Revoke extension token?
                    </h3>
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
                    <h3
                      id="workspace-manage-title"
                      className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]"
                    >
                      {activeWorkspace?.name}
                    </h3>
                    <p className={settingsTheme.rowMuted + ' mt-0.5'}>{activeWorkspaceKindLabel}</p>
                  </div>
                  <ModalCloseButton
                    onClick={closeWorkspaceManageModal}
                    ariaLabel="Close workspace settings modal"
                  />
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
                      <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                        Description
                      </p>
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
                  <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                    <div className="space-y-1 pt-1">
                      <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                        Workspace type
                      </p>
                      <p className={settingsTheme.rowMuted}>
                        Choose whether this workspace is for personal or shared work.
                      </p>
                    </div>
                    <select
                      id="workspace-edit-type"
                      value={workspaceEditType}
                      onChange={(event) =>
                        setWorkspaceEditType(event.target.value as 'team' | 'personal')
                      }
                      disabled={!canManageWorkspace || isSavingWorkspace}
                      className={settingsTheme.input + ' appearance-none pr-9'}
                      style={selectChevronStyle}
                      aria-label="Workspace type"
                    >
                      <option value="team">Team workspace</option>
                      <option value="personal">Personal workspace</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 border-t border-[color:var(--ledger-border-subtle)] px-5 pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                        Danger zone
                      </p>
                      <p className={settingsTheme.rowMuted + ' mt-1'}>
                        Delete this workspace and all data inside it.
                      </p>
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
                  <p
                    className="px-5 pt-3 text-xs text-[var(--ledger-text-secondary)]"
                    role="status"
                  >
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
                    <h3
                      id="workspace-delete-title"
                      className="mt-1 text-lg font-semibold text-[var(--ledger-text-primary)]"
                    >
                      Delete workspace
                    </h3>
                    <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
                      Type{' '}
                      <span className="font-medium text-[var(--ledger-text-primary)]">
                        {activeWorkspace?.name}
                      </span>{' '}
                      to confirm deletion.
                    </p>
                  </div>
                  <ModalCloseButton
                    onClick={closeWorkspaceDeleteModal}
                    ariaLabel="Close delete workspace modal"
                  />
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
                  <p className="mt-2 text-xs text-[var(--ledger-text-muted)]">
                    This removes the workspace and all data inside it.
                  </p>
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
                    <ModalCloseButton
                      onClick={() => setInviteModal(null)}
                      ariaLabel="Close invite modal"
                    />
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
                            className={
                              settingsTheme.controlButtonNeutral +
                              ' inline-flex flex-1 items-center justify-center gap-2 rounded-full'
                            }
                          >
                            <Copy size={14} />
                            Copy link
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRevokeInvitation(selectedInvite.id)}
                            disabled={invitationActionId === selectedInvite.id}
                            className={
                              settingsTheme.dangerButton +
                              ' inline-flex flex-1 items-center justify-center rounded-full'
                            }
                          >
                            {invitationActionId === selectedInvite.id ? 'Revoking...' : 'Revoke'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--ledger-text-secondary)]">
                        This invite is no longer pending.
                      </p>
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
