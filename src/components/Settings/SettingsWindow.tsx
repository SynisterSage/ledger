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

type InviteModalState = {
  id: string;
} | null;

type SettingsSectionId =
  | 'account'
  | 'workspace'
  | 'calendar'
  | 'notifications'
  | 'integrations'
  | 'sidebar'
  | 'shortcuts'
  | 'accessibility';
const sectionOrder: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'account', label: 'Account', description: 'Identity and security' },
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
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.8rem center',
  backgroundSize: '14px 14px',
};

const getSidebarOpacitySliderStyle = (value: number): CSSProperties => {
  const min = 0.7;
  const max = 0.95;
  const fillPercent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return {
    backgroundImage: `linear-gradient(to right, #FF5F40 0%, #FF5F40 ${fillPercent}%, rgba(229, 231, 235, 0.9) ${fillPercent}%, rgba(229, 231, 235, 0.9) 100%)`,
  };
};

const compactFieldClassName =
  'h-9 rounded-xl border border-gray-200 bg-gray-50/80 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60';

const compactSelectClassName =
  'h-9 appearance-none rounded-xl border border-gray-200 bg-gray-50/80 px-3 pr-8 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60';

const preferenceSelectClassName = `${compactSelectClassName} w-full bg-white`;

const preferenceRowClassName =
  'grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-center';

const inlineSwitchClassName =
  'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-gray-200 bg-gray-200 transition focus:outline-none focus:ring-4 focus:ring-gray-100';

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
        <h3 className="text-sm font-medium text-gray-900">{label}</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">{help}</p>
      </div>
      <div className="sm:justify-self-end sm:w-70">{children}</div>
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
        checked ? 'border-gray-900 bg-gray-900' : 'border-gray-200 bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
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
  const inviteEmailRef = useRef<HTMLInputElement | null>(null);
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

  return (
    <div
      className="h-screen overflow-hidden rounded-3xl border border-gray-200 bg-[#f5f7fb] text-gray-900 flex flex-col shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
      style={{ scrollbarGutter: 'stable' }}
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
        icon={<Settings size={18} className="text-gray-700" />}
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
            className="h-9 px-3 rounded-full border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold"
          >
            Sign out
          </button>
        }
      />

      <div className="flex-1 overflow-hidden bg-white">
        <div className="h-full grid grid-cols-[260px_1fr]">
          <aside
            className="border-r border-gray-200 bg-white p-4 overflow-auto"
            aria-label="Settings sections"
          >
            <div className="mb-4 border-b border-gray-200 pb-4">
              <p className="text-xs font-medium text-gray-500">Account</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">Hi {firstName}</p>
              <p className="text-xs text-gray-600 truncate">
                {user?.email ?? 'No email available'}
              </p>
            </div>

            <nav className="space-y-1.5" aria-label="Settings navigation">
              {sectionOrder.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                    activeSection === section.id
                      ? 'bg-gray-100 text-gray-950'
                      : 'text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                >
                  <p className="text-sm font-semibold">{section.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{section.description}</p>
                </button>
              ))}
            </nav>
          </aside>

          <main className="overflow-auto bg-white p-6" aria-live="polite">
            <div className="mx-auto max-w-4xl space-y-5">
              {activeSection === 'account' && (
                <section className="w-full max-w-215" aria-labelledby="settings-account">
                  <div className="space-y-2">
                    <h2
                      id="settings-account"
                      className="text-[28px] font-semibold tracking-tight text-gray-950"
                    >
                      Account
                    </h2>
                    <p className="text-sm text-gray-600">
                      Basic identity and security settings.
                    </p>
                    <p className="text-xs text-gray-500" role="status">
                      {saveStatus ?? 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-10">
                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-profile">
                      <h3 id="settings-profile" className="text-sm font-semibold text-gray-900">
                        Profile
                      </h3>

                      <div className="mt-5 divide-y divide-gray-100 border-t border-gray-200">
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                          <div className="space-y-1">
                            <label
                              htmlFor="settings-full-name"
                              className="text-sm font-medium text-gray-800"
                            >
                              Display name
                            </label>
                            <p className="text-xs text-gray-500">
                              Your name as it appears in Ledger.
                            </p>
                          </div>
                          <div className="max-w-130">
                            <input
                              id="settings-full-name"
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                            />
                          </div>
                        </div>

                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                          <div className="space-y-1">
                            <label
                              htmlFor="settings-email"
                              className="text-sm font-medium text-gray-800"
                            >
                              Email
                            </label>
                            <p className="text-xs text-gray-500">Used for signing in.</p>
                          </div>
                          <div className="max-w-130 text-sm text-gray-700">
                            {user?.email ?? 'No email available'}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-security">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-security" className="text-sm font-semibold text-gray-900">
                            Security
                          </h3>
                          <p className="text-xs text-gray-500">
                            Change your account password.
                          </p>
                        </div>
                        {!showPasswordEditor ? (
                          <button
                            type="button"
                            onClick={() => setShowPasswordEditor(true)}
                            className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
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
                            className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
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
                                className="text-xs font-medium text-gray-700"
                              >
                                New password
                              </label>
                              <input
                                id="settings-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                              />
                            </div>
                            <div className="grid gap-2">
                              <label
                                htmlFor="settings-password-confirm"
                                className="text-xs font-medium text-gray-700"
                              >
                                Confirm password
                              </label>
                              <input
                                id="settings-password-confirm"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => void handleUpdatePassword()}
                              disabled={isUpdatingPassword}
                              className="h-9 rounded-full bg-[#FF5F40] px-4 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                            >
                              {isUpdatingPassword ? 'Updating...' : 'Update password'}
                            </button>
                            {isUpdatingPassword && (
                              <Loader2 size={14} className="animate-spin text-gray-500" />
                            )}
                          </div>
                          {passwordError && (
                            <p className="flex items-center gap-1.5 text-xs text-red-700">
                              <CircleAlert size={12} />
                              {passwordError}
                            </p>
                          )}
                          {passwordStatus && (
                            <p className="text-xs text-green-700">{passwordStatus}</p>
                          )}
                        </div>
                      ) : null}
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-session">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-session" className="text-sm font-semibold text-gray-900">
                            Session
                          </h3>
                          <p className="text-xs text-gray-500">
                            Sign out of Ledger on this device.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void signOut();
                          }}
                          className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Sign out
                        </button>
                      </div>
                    </section>
                  </div>
                </section>
              )}

              {activeSection === 'workspace' && (
                <section className="w-full max-w-215" aria-labelledby="settings-workspace">
                  <div className="space-y-2">
                    <h2
                      id="settings-workspace"
                      className="text-[28px] font-semibold tracking-tight text-gray-950"
                    >
                      Workspace
                    </h2>
                    <p className="text-sm text-gray-600">
                      Manage workspace identity, members, and defaults.
                    </p>
                    <p className="text-xs text-gray-500" role="status">
                      {workspaceStatus || workspaceError || 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-10">
                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-current-workspace">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-current-workspace" className="text-sm font-semibold text-gray-900">
                            Current workspace
                          </h3>
                          <p className="text-xs text-gray-500">The workspace currently active in Ledger.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void refreshWorkspaces()}
                            disabled={isLoadingWorkspaces || isSwitchingWorkspace}
                            className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                          >
                            Refresh
                          </button>
                          {canManageWorkspace ? (
                            <button
                              onClick={openWorkspaceManageModal}
                              className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                            >
                              Manage
                            </button>
                          ) : (
                            <span className="rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500">
                              Owner only
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 divide-y divide-gray-100 border-t border-gray-200">
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className="text-sm font-medium text-gray-800">Name</div>
                          <div className="text-sm text-gray-900">
                            {activeWorkspace?.name ?? 'No workspace selected'}
                          </div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className="text-sm font-medium text-gray-800">Type</div>
                          <div className="text-sm text-gray-900">{activeWorkspaceKindLabel}</div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                          <div className="text-sm font-medium text-gray-800">Description</div>
                          <div className="max-w-140 text-sm leading-6 text-gray-700">
                            {activeWorkspace?.description?.trim() || 'No description set.'}
                          </div>
                        </div>
                        <div className="grid gap-4 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                          <div className="text-sm font-medium text-gray-800">Switch workspace</div>
                          <div className="max-w-130">
                            <select
                              id="settings-active-workspace"
                              value={activeWorkspaceId ?? ''}
                              onChange={(e) => void handleSwitchWorkspace(e.target.value)}
                              disabled={isLoadingWorkspaces || isSwitchingWorkspace || workspaces.length === 0}
                              className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 pr-9 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-members">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-members" className="text-sm font-semibold text-gray-900">
                            Members
                          </h3>
                          <p className="text-xs text-gray-500">Manage access for the selected workspace.</p>
                        </div>
                        <span className="inline-flex rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700">
                          {workspaceUserRole === 'owner' ? 'Owner' : `Role: ${workspaceUserRole}`}
                        </span>
                      </div>

                      <div className="mt-5 divide-y divide-gray-100 border-t border-gray-200">
                        {isLoadingWorkspaceAdmin ? (
                          <div className="py-4 text-xs text-gray-500">Loading members...</div>
                        ) : workspaceMembers.length === 0 ? (
                          <div className="py-4 text-xs text-gray-500">No members yet.</div>
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
                                  <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
                                  <p className="truncate text-xs text-gray-500">
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
                                  className="h-8 w-full appearance-none rounded-lg border border-gray-200 bg-white px-2 pr-8 text-xs text-gray-800 outline-none disabled:opacity-60 md:w-auto"
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
                                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {workspaceAdminError && (
                        <p className="mt-3 text-xs text-red-700" role="status">
                          {workspaceAdminError}
                        </p>
                      )}
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-invites">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-invites" className="text-sm font-semibold text-gray-900">
                            Invites
                          </h3>
                          <p className="text-xs text-gray-500">Invite someone to this workspace.</p>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-2 md:grid-cols-[minmax(0,1fr)_148px_auto]">
                        <input
                          ref={inviteEmailRef}
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="name@example.com"
                          disabled={!canManageWorkspace || isSendingInvite}
                          className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                          aria-label="Invite email optional"
                        />
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                          disabled={!canManageWorkspace || isSendingInvite}
                          className="h-9 appearance-none rounded-xl border border-gray-200 bg-white px-3 pr-8 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                          style={selectChevronStyle}
                          aria-label="Invite role"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          onClick={() => void handleCreateInvitation()}
                          disabled={!canManageWorkspace || isSendingInvite}
                          className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                        >
                          {isSendingInvite ? 'Creating...' : 'Create invite'}
                        </button>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-gray-500">
                        Optional email. Invite links can be copied and shared manually.
                      </p>

                      {(inviteLink || inviteToken) && (
                        <div className="mt-4 border-t border-gray-200 pt-4">
                          <p className="text-xs font-medium text-gray-500">Invite link</p>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                            {inviteLink && (
                              <p className="min-w-0 flex-1 break-all text-sm text-gray-700">
                                {inviteLink}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleCopyInvitationLink()}
                              disabled={!inviteLink}
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                            >
                              <Copy size={14} />
                              Copy link
                            </button>
                          </div>
                          {inviteCopyStatus && (
                            <p className="mt-2 text-xs text-gray-600">{inviteCopyStatus}</p>
                          )}
                        </div>
                      )}

                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <p className="text-xs font-medium text-gray-500">Recent invites</p>
                        <div className="mt-2 divide-y divide-gray-100 border-t border-gray-200">
                          {workspaceInvitations.length === 0 ? (
                            <div className="py-4 text-xs text-gray-500">No pending invites.</div>
                          ) : (
                            workspaceInvitations.map((invite) => (
                              <div
                                key={invite.id}
                                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-4"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-900">
                                    {invite.invited_email}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {invite.role} · {invite.status}
                                  </p>
                                </div>
                                <p className="text-[11px] text-gray-500">
                                  {new Date(invite.expires_at).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                                <button
                                  onClick={() => setInviteModal({ id: invite.id })}
                                  disabled={!canManageWorkspace}
                                  className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Manage
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-defaults">
                      <h3 id="settings-defaults" className="text-sm font-semibold text-gray-900">Defaults</h3>
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor="settings-week-start" className="mb-2 block text-xs font-medium text-gray-500">
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
                            className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                            style={selectChevronStyle}
                          >
                            <option value="monday">Monday</option>
                            <option value="sunday">Sunday</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="settings-time-format" className="mb-2 block text-xs font-medium text-gray-500">
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
                            className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                            style={selectChevronStyle}
                          >
                            <option value="12h">12-hour (2:00 PM)</option>
                            <option value="24h">24-hour (14:00)</option>
                          </select>
                        </div>
                      </div>
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-create-workspace">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-create-workspace" className="text-sm font-semibold text-gray-900">
                            Create workspace
                          </h3>
                          <p className="text-xs text-gray-500">
                            Create another focused space for school, internship, freelance, or personal work.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowCreateWorkspaceForm((value) => !value)}
                          className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
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
                            className="min-h-14 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                            aria-label="Workspace description"
                          />
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-h-5">
                              {workspaceCreateStatus && (
                                <p className="text-xs text-green-700">{workspaceCreateStatus}</p>
                              )}
                            </div>
                            <button
                              onClick={() => void handleCreateWorkspace()}
                              disabled={isCreatingWorkspace || !workspaceCreateName.trim()}
                              className="h-8 rounded-lg bg-[#FF5F40] px-3 text-xs font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                            >
                              {isCreatingWorkspace ? 'Creating...' : 'Create workspace'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="settings-danger-zone">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h3 id="settings-danger-zone" className="text-sm font-semibold text-gray-900">
                            Danger zone
                          </h3>
                          <p className="text-xs text-gray-500">
                            Delete this workspace and all data inside it.
                          </p>
                        </div>
                        <button
                          onClick={openWorkspaceDeleteModal}
                          disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                          className="h-8 rounded-full border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
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
                    <h2 id="settings-calendar" className="text-[28px] font-semibold tracking-tight text-gray-950">
                      Calendar and reminders
                    </h2>
                    <p className="text-sm text-gray-600">
                      Set how Ledger schedules events, reminders, follow-ups, and overdue items.
                    </p>
                    <p className="text-xs text-gray-500" role="status">
                      Changes save automatically.
                    </p>
                  </div>

                  <div className="mt-8 space-y-8">
                    <section className="border-t border-gray-200 pt-6" aria-labelledby="calendar-defaults">
                      <h3 id="calendar-defaults" className="text-sm font-semibold text-gray-900">
                        Calendar defaults
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="reminder-defaults">
                      <h3 id="reminder-defaults" className="text-sm font-semibold text-gray-900">
                        Reminder defaults
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="overdue-behavior">
                      <h3 id="overdue-behavior" className="text-sm font-semibold text-gray-900">
                        Overdue behavior
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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
                      <p className="mt-3 text-xs leading-5 text-gray-500">
                        Past events stay in Calendar history. Missed reminders stay visible until
                        completed, rescheduled, or dismissed.
                      </p>
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="follow-up-behavior">
                      <h3 id="follow-up-behavior" className="text-sm font-semibold text-gray-900">
                        Follow-up behavior
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="calendar-display">
                      <h3 id="calendar-display" className="text-sm font-semibold text-gray-900">
                        Calendar display
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="workspace-calendars">
                      <h3 id="workspace-calendars" className="text-sm font-semibold text-gray-900">
                        Workspace calendars
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        Workspace calendars keep school, internship, freelance, and personal
                        commitments separated while Today can still surface what needs attention.
                      </p>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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
                    <h2
                      id="settings-notifications"
                      className="text-[28px] font-semibold tracking-tight text-gray-950"
                    >
                      Notifications
                    </h2>
                    <p className="text-sm text-gray-600">
                      Choose what Ledger should bring to your attention.
                    </p>
                    <p className="text-xs text-gray-500" role="status">
                      {isSavingNotificationPrefs
                        ? 'Saving automatically...'
                        : saveStatus ?? 'Changes save automatically.'}
                    </p>
                  </div>

                  <div className="mt-8 space-y-8">
                    <section
                      className="border-t border-gray-200 pt-6"
                      aria-labelledby="notification-control"
                    >
                      <h3 id="notification-control" className="text-sm font-semibold text-gray-900">
                        Control
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        Pause new alerts without changing your delivery preferences.
                      </p>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                        <div className="flex items-start justify-between gap-4 px-4 py-3">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">
                              Pause notifications
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-gray-500">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="notification-delivery">
                      <h3 id="notification-delivery" className="text-sm font-semibold text-gray-900">
                        Delivery
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="notification-sources">
                      <h3 id="notification-sources" className="text-sm font-semibold text-gray-900">
                        Notify me about
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="notification-timing">
                      <h3 id="notification-timing" className="text-sm font-semibold text-gray-900">
                        Timing
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="notification-behavior">
                      <h3 id="notification-behavior" className="text-sm font-semibold text-gray-900">
                        Behavior
                      </h3>
                      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
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
                      <p className="mt-3 text-xs text-gray-500">Quiet hours coming later.</p>
                    </section>
                  </div>
                </section>
              )}

              {activeSection === 'integrations' && (
                <section className="w-full max-w-215" aria-labelledby="settings-integrations">
                  <div className="space-y-2">
                    <h2
                      id="settings-integrations"
                      className="text-[28px] font-semibold tracking-tight text-gray-950"
                    >
                      Integrations
                    </h2>
                    <p className="text-sm text-gray-600">
                      Connect tools that send captures into Ledger.
                    </p>
                  </div>

                  <div className="mt-8 space-y-8">
                    <section className="border-t border-gray-200 pt-6" aria-labelledby="integration-list">
                      <h3 id="integration-list" className="sr-only">
                        Connected integrations
                      </h3>
                      <div className="divide-y divide-gray-200 border-y border-gray-200">
                        <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium text-gray-900">Slack</h3>
                            <p className="mt-1 text-sm text-gray-600">
                              Save Slack messages to Inbox.
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
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
                                  ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                  : 'bg-[#FF5F40] text-white hover:bg-[#ea5336]'
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
                                className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                              >
                                {isDisconnectingSlack ? 'Disconnecting...' : 'Disconnect'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium text-gray-900">Browser Extension</h3>
                            <p className="mt-1 text-sm text-gray-600">
                              Capture links, selected text, and quick notes from Chrome.
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
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
                                    className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
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
                                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
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
                                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
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
                                className="h-8 rounded-lg bg-[#FF5F40] px-3 text-xs font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-50"
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
                            slackError || extensionTokenError ? 'text-red-700' : 'text-gray-600'
                          }`}
                        >
                          {(slackError || extensionTokenError) && <CircleAlert size={12} />}
                          {slackError || extensionTokenError || extensionTokenCopyStatus}
                        </p>
                      )}
                    </section>

                    <section className="border-t border-gray-200 pt-6" aria-labelledby="integration-coming-soon">
                      <h3 id="integration-coming-soon" className="text-sm font-medium text-gray-900">
                        Coming soon
                      </h3>
                      <div className="mt-3 divide-y divide-gray-100 border-y border-gray-100">
                        {['Email', 'Google Calendar', 'GitHub', 'Linear'].map((source) => (
                          <div key={source} className="py-3 text-sm text-gray-600">
                            {source}
                          </div>
                        ))}
                      </div>
                    </section>

                    <p className="border-t border-gray-200 pt-4 text-xs leading-5 text-gray-500">
                      Connected tools send captures to Inbox. You decide later whether they become
                      tasks, notes, reminders, or events.
                    </p>
                  </div>
                </section>
              )}

              {activeSection === 'sidebar' && (
                <section className="w-full max-w-215" aria-labelledby="settings-sidebar">
                  <h2
                    id="settings-sidebar"
                    className="text-[28px] font-semibold tracking-tight text-gray-950"
                  >
                    Sidebar
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Configure where Ledger lives and how it behaves.
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    {saveStatus ?? 'Changes save automatically.'}
                  </p>

                  <section className="mt-6 border-t border-gray-200 pt-6" aria-labelledby="sidebar-position">
                    <h3 id="sidebar-position" className="text-sm font-semibold text-gray-900">
                      Position
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500">Choose where Ledger lives.</p>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      {sidebarPositionOptions
                        .filter((option) => option.value !== 'floating')
                        .map((option) => (
                          <label
                            key={option.value}
                            className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-gray-50"
                          >
                            <input
                              type="radio"
                              name="sidebar-position"
                              value={option.value}
                              checked={position === option.value}
                              onChange={() => setPosition(option.value)}
                              className="mt-0.5 h-4 w-4 border-gray-300 text-[#FF5F40] outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-gray-900">
                                {option.label}
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-gray-500">
                                {option.description}
                              </span>
                            </span>
                          </label>
                        ))}
                    </div>
                  </section>

                  <section className="border-t border-gray-200 pt-6" aria-labelledby="sidebar-behavior">
                    <h3 id="sidebar-behavior" className="text-sm font-semibold text-gray-900">
                      Behavior
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Keep Ledger attached, detached, or following the app you dock to.
                    </p>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      <label
                        className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-gray-50"
                      >
                        <input
                          type="radio"
                          name="sidebar-position"
                          value="floating"
                          checked={position === 'floating'}
                          onChange={() => setPosition('floating')}
                          className="mt-0.5 h-4 w-4 border-gray-300 text-[#FF5F40] outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900">Floating</span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
                            Detach Ledger as a movable panel.
                          </span>
                        </span>
                      </label>
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">
                            Always on top
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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
                          <span className="block text-sm font-medium text-gray-900">Auto hide</span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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
                          <span className="block text-sm font-medium text-gray-900">
                            Dock to app windows
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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

                  <section className="border-t border-gray-200 pt-6" aria-labelledby="sidebar-desktop-utility">
                    <h3 id="sidebar-desktop-utility" className="text-sm font-semibold text-gray-900">
                      Desktop utility
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Keep Ledger available from the menu bar or system tray.
                    </p>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">
                            Show tray icon
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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
                          <span className="block text-sm font-medium text-gray-900">
                            Run in background
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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

                  <section className="border-t border-gray-200 pt-6" aria-labelledby="sidebar-default-state">
                    <h3 id="sidebar-default-state" className="text-sm font-semibold text-gray-900">
                      Default state
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500">Choose how Ledger opens.</p>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      {sidebarDefaultStateOptions.map((option) => (
                        <label
                          key={option.value}
                          className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-gray-50"
                        >
                          <input
                            type="radio"
                            name="sidebar-default-state"
                            value={option.value}
                            checked={defaultState === option.value}
                            onChange={() => setDefaultState(option.value)}
                            className="mt-0.5 h-4 w-4 border-gray-300 text-[#FF5F40] outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">
                              {option.label}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-gray-500">
                              {option.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="border-t border-gray-200 pt-6" aria-labelledby="sidebar-appearance">
                    <h3 id="sidebar-appearance" className="text-sm font-semibold text-gray-900">
                      Appearance
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Tune the sidebar look and feel.
                    </p>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      <PreferenceRow label="Theme" help="Match your system or choose a fixed theme.">
                        <select
                          value={preferences.theme}
                          onChange={(event) =>
                            setPreferences((current) => ({
                              ...current,
                              theme: event.target.value as UserPreferences['theme'],
                            }))
                          }
                          className={preferenceSelectClassName}
                          style={selectChevronStyle}
                        >
                          <option value="system">System</option>
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                        </select>
                      </PreferenceRow>
                      <PreferenceRow label="Opacity" help={`${Math.round(opacity * 100)}% to 95%.`}>
                        <div className="w-full sm:w-70">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm font-semibold text-gray-900">
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
                            className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent"
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
                      className="h-9 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-800 transition hover:bg-gray-50"
                    >
                      Reset to Defaults
                    </button>
                  </div>
                </section>
              )}

              {activeSection === 'accessibility' && (
                <section className="w-full max-w-215" aria-labelledby="settings-accessibility">
                  <h2
                    id="settings-accessibility"
                    className="text-[28px] font-semibold tracking-tight text-gray-950"
                  >
                    Accessibility
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Adjust motion, contrast, and density for a more comfortable workspace.
                  </p>
                  <p className="mt-2 text-xs text-gray-500">Changes save automatically.</p>

                  <section className="mt-6 border-t border-gray-200 pt-6" aria-labelledby="accessibility-core">
                    <h3 id="accessibility-core" className="text-sm font-semibold text-gray-900">
                      Accessibility
                    </h3>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">
                            Reduce motion
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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
                          <span className="block text-sm font-medium text-gray-900">
                            High contrast
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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
                          <span className="block text-sm font-medium text-gray-900">
                            Compact density
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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

                  <section className="border-t border-gray-200 pt-6" aria-labelledby="accessibility-startup">
                    <h3 id="accessibility-startup" className="text-sm font-semibold text-gray-900">
                      Startup
                    </h3>
                    <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
                      <div className="flex items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">
                            Open dashboard by default
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
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
                    <h2
                      id="settings-shortcuts"
                      className="text-[28px] font-semibold tracking-tight text-gray-950"
                    >
                      Keyboard Shortcuts
                    </h2>
                    <p className="text-sm text-gray-600">Quick reference for actions.</p>
                  </div>

                  <div className="mt-8 space-y-6">
                    {shortcutSections.map((section) => (
                      <section key={section.id} className="border-t border-gray-200 pt-6">
                        <h3 className="text-sm font-medium text-gray-900">{section.title}</h3>
                        <div className="mt-3 divide-y divide-gray-100 border-y border-gray-100">
                          {section.shortcuts.map((shortcut) => (
                            <div
                              key={`${section.id}-${shortcut.keys}`}
                              className="grid gap-3 py-3 md:grid-cols-[160px_minmax(0,1fr)] md:items-center"
                            >
                              <p className="text-xs font-medium text-gray-500">{shortcut.keys}</p>
                              <p className="text-sm text-gray-700">{shortcut.description}</p>
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
              classNameContainer="w-full max-w-115 rounded-2xl border border-gray-200 bg-white"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Connect browser extension</h3>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Use this token in the Ledger browser extension.
                  </p>
                </div>
                <ModalCloseButton onClick={closeExtensionTokenModal} ariaLabel="Close extension token modal" />
              </div>

              <div className="mt-5 border-y border-gray-100 px-5 py-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="break-all font-mono text-xs leading-5 text-gray-900">
                    {generatedExtensionToken}
                  </p>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  This token is shown once. Keep it somewhere safe.
                </p>
                {extensionTokenCopyStatus && (
                  <p className="mt-2 text-xs text-gray-600">{extensionTokenCopyStatus}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExtensionTokenConfirmAction('regenerate')}
                  disabled={isExtensionTokenBusy}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyExtensionToken()}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Copy size={13} />
                  Copy token
                </button>
                <button
                  type="button"
                  onClick={closeExtensionTokenModal}
                  className="h-8 rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition hover:bg-gray-800"
                >
                  Done
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={extensionTokenConfirmAction === 'regenerate'}
              onClose={() => setExtensionTokenConfirmAction(null)}
              classNameContainer="w-full max-w-115 rounded-2xl border border-gray-200 bg-white"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Regenerate extension token?</h3>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Your existing browser extension token will stop working. You’ll need to paste the
                    new token into the extension.
                  </p>
                </div>
                <ModalCloseButton
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  ariaLabel="Close regenerate token modal"
                />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleRegenerateExtensionToken()}
                  disabled={isExtensionTokenBusy}
                  className="h-8 rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
                >
                  {isExtensionTokenBusy ? 'Regenerating...' : 'Regenerate token'}
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={extensionTokenConfirmAction === 'revoke'}
              onClose={() => setExtensionTokenConfirmAction(null)}
              classNameContainer="w-full max-w-115 rounded-2xl border border-gray-200 bg-white"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Revoke extension token?</h3>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    The browser extension will no longer be able to save captures to Ledger.
                  </p>
                </div>
                <ModalCloseButton
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  ariaLabel="Close revoke token modal"
                />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExtensionTokenConfirmAction(null)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevokeExtensionToken()}
                  disabled={isExtensionTokenBusy}
                  className="h-8 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {isExtensionTokenBusy ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={isWorkspaceManageModalOpen && !!activeWorkspace}
              onClose={closeWorkspaceManageModal}
              classNameContainer="w-full max-w-[720px] rounded-2xl border border-gray-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className="text-xs font-medium text-gray-500">Workspace settings</p>
                  <h3 id="workspace-manage-title" className="mt-1 text-lg font-semibold text-gray-900">
                    {activeWorkspace?.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">{activeWorkspaceKindLabel}</p>
                </div>
                <ModalCloseButton onClick={closeWorkspaceManageModal} ariaLabel="Close workspace settings modal" />
              </div>

              <div className="mt-4 border-t border-gray-100 px-5 pt-4">
                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div className="space-y-1 pt-1">
                    <p className="text-sm font-medium text-gray-800">Name</p>
                    <p className="text-xs text-gray-500">Workspace display name.</p>
                  </div>
                  <input
                    id="workspace-edit-name"
                    value={workspaceEditName}
                    onChange={(e) => setWorkspaceEditName(e.target.value)}
                    disabled={!canManageWorkspace || isSavingWorkspace}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                    aria-label="Edit workspace name"
                  />
                </div>
              </div>

              <div className="mt-4 px-5">
                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div className="space-y-1 pt-1">
                    <p className="text-sm font-medium text-gray-800">Description</p>
                    <p className="text-xs text-gray-500">Optional workspace context.</p>
                  </div>
                  <textarea
                    id="workspace-edit-description"
                    value={workspaceEditDescription}
                    onChange={(e) => setWorkspaceEditDescription(e.target.value)}
                    disabled={!canManageWorkspace || isSavingWorkspace}
                    className="min-h-24 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                    aria-label="Edit workspace description"
                  />
                </div>
              </div>

              <div className="mt-4 border-t border-gray-100 px-5 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Danger zone</p>
                    <p className="mt-1 text-xs text-gray-500">Delete this workspace and all data inside it.</p>
                  </div>
                  <button
                    type="button"
                    onClick={openWorkspaceDeleteModal}
                    disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                    className="h-8 rounded-full border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete workspace
                  </button>
                </div>
              </div>

              {(workspaceEditError || workspaceEditStatus) && (
                <p className="px-5 pt-3 text-xs text-gray-700" role="status">
                  {workspaceEditError || workspaceEditStatus}
                </p>
              )}

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button
                  type="button"
                  onClick={closeWorkspaceManageModal}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveWorkspaceChanges()}
                  disabled={!canManageWorkspace || isSavingWorkspace}
                  className="h-8 rounded-lg bg-[#FF5F40] px-3 text-xs font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                >
                  {isSavingWorkspace ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </ModalOverlay>
            <ModalOverlay
              isOpen={isWorkspaceDeleteModalOpen && !!activeWorkspace}
              onClose={closeWorkspaceDeleteModal}
              classNameContainer="w-full max-w-[640px] rounded-2xl border border-gray-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className="text-xs font-medium text-gray-500">Danger zone</p>
                  <h3 id="workspace-delete-title" className="mt-1 text-lg font-semibold text-gray-900">
                    Delete workspace
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Type <span className="font-medium text-gray-900">{activeWorkspace?.name}</span> to confirm deletion.
                  </p>
                </div>
                <ModalCloseButton onClick={closeWorkspaceDeleteModal} ariaLabel="Close delete workspace modal" />
              </div>

              <div className="mt-4 border-t border-gray-100 px-5 pt-4">
                <label
                  htmlFor="workspace-delete-confirm"
                  className="mb-2 block text-xs font-medium text-gray-500"
                >
                  Workspace name
                </label>
                <input
                  id="workspace-delete-confirm"
                  value={workspaceDeleteConfirm}
                  onChange={(e) => setWorkspaceDeleteConfirm(e.target.value)}
                  disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                  placeholder={activeWorkspace?.name}
                  className="h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                  aria-label="Confirm workspace deletion"
                />
                <p className="mt-2 text-xs text-gray-500">This removes the workspace and all data inside it.</p>
              </div>

              {workspaceDeleteError && (
                <p className="px-5 pt-3 text-xs text-red-700" role="alert">
                  {workspaceDeleteError}
                </p>
              )}

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button
                  type="button"
                  onClick={closeWorkspaceDeleteModal}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
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
                  className="h-8 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {isDeletingWorkspace ? 'Deleting...' : 'Delete workspace'}
                </button>
              </div>
            </ModalOverlay>

            <ModalOverlay
              isOpen={!!inviteModal && !!selectedInvite}
              onClose={() => setInviteModal(null)}
              classNameContainer="w-full max-w-[560px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
            >
              <div className="flex min-h-70 flex-col">
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className="text-xs font-medium text-gray-500">Manage invite</p>
                  <h3 className="mt-1 text-lg font-semibold text-gray-900">
                    {selectedInvite?.invited_email}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selectedInvite?.role} · {selectedInvite?.status}
                  </p>
                </div>
                <ModalCloseButton onClick={() => setInviteModal(null)} ariaLabel="Close invite modal" />
              </div>

              <div className="mt-4 flex-1 border-t border-gray-100 px-5 pt-4 pb-5">
                <p className="text-xs font-medium text-gray-500">Invite link</p>
                {selectedInvite?.status === 'pending' ? (
                  <>
                    <p className="mt-2 break-all text-sm text-gray-700">
                      {getInviteUrl(selectedInvite) ?? 'No link available'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopySelectedInviteLink()}
                        disabled={!getInviteUrl(selectedInvite)}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Copy size={14} />
                        Copy link
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevokeInvitation(selectedInvite.id)}
                        disabled={invitationActionId === selectedInvite.id}
                        className="inline-flex h-8 flex-1 items-center justify-center rounded-full border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        {invitationActionId === selectedInvite.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">This invite is no longer pending.</p>
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
