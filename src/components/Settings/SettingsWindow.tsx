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
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useAuthContext } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import {
  defaultSidebarPreferences,
  type SidebarDefaultState,
  type SidebarPosition,
} from '../../config/sidebarPreferences';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import authService from '../../services/auth';

type UserPreferences = {
  weekStartsOn: 'sunday' | 'monday';
  timeFormat: '12h' | '24h';
  defaultEventMinutes: 30 | 45 | 60;
  reminderLeadMinutes: 5 | 10 | 15 | 30;
  openDashboardByDefault: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  compactDensity: boolean;
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

type SlackCapturePreview = {
  id: string;
  external_url?: string | null;
  channel_name?: string | null;
  author_name?: string | null;
  captured_text?: string | null;
  captured_at?: string | null;
  created_at: string;
};

type InviteModalState = {
  id: string;
} | null;

type SettingsSectionId =
  | 'account'
  | 'workspace'
  | 'calendar'
  | 'integrations'
  | 'sidebar'
  | 'shortcuts'
  | 'accessibility';
const sectionOrder: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'account', label: 'Account', description: 'Identity and security' },
  { id: 'workspace', label: 'Workspace', description: 'Display and behavior defaults' },
  { id: 'calendar', label: 'Calendar', description: 'Event and reminder defaults' },
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
  reminderLeadMinutes: 15,
  openDashboardByDefault: true,
  reduceMotion: false,
  highContrast: false,
  compactDensity: false,
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

const compactFieldClassName =
  'h-9 rounded-xl border border-gray-200 bg-gray-50/80 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60';

const compactSelectClassName =
  'h-9 appearance-none rounded-xl border border-gray-200 bg-gray-50/80 px-3 pr-8 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60';

const ToggleField = ({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-200"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="mt-1 block text-xs text-gray-600">{help}</span>
      </span>
    </label>
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

  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [workspaceCreateName, setWorkspaceCreateName] = useState('');
  const [workspaceCreateDescription, setWorkspaceCreateDescription] = useState('');
  const [workspaceCreateType, setWorkspaceCreateType] = useState<'team' | 'personal'>('team');
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
  const [slackCaptures, setSlackCaptures] = useState<SlackCapturePreview[]>([]);
  const [isLoadingSlackStatus, setIsLoadingSlackStatus] = useState(false);
  const [isConnectingSlack, setIsConnectingSlack] = useState(false);
  const [isDisconnectingSlack, setIsDisconnectingSlack] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackRefreshToken, setSlackRefreshToken] = useState(0);
  const inviteEmailRef = useRef<HTMLInputElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveTokenRef = useRef(0);
  const lastSavedSettingsRef = useRef<string>('');
  const lastSavedFullNameRef = useRef<string>('');
  const settingsHydratedRef = useRef(false);

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
    void window.desktopWindow?.setAlwaysOnTop(alwaysOnTop).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [alwaysOnTop]);

  // Sync sidebar preferences to sidebar window whenever they change
  useEffect(() => {
    void window.desktopWindow?.applySidebarPreferences(sidebarPreferences).catch(() => {
      // No-op outside Electron (browser dev mode)
    });
  }, [sidebarPreferences]);

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

          if (saveToken !== autosaveTokenRef.current) return;
          lastSavedSettingsRef.current = nextSnapshot;
          lastSavedFullNameRef.current = nextFullName ?? '';
          setSaveStatus('Saved automatically.');
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
    };
  }, [api, fullName, preferences]);

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
        const [statusPayload, capturesPayload] = await Promise.all([
          api.getSlackIntegrationStatus(activeWorkspaceId) as Promise<SlackIntegrationStatus>,
          api.getSlackCaptures(activeWorkspaceId) as Promise<SlackCapturePreview[]>,
        ]);
        if (!cancelled) {
          setSlackStatus(statusPayload);
          setSlackCaptures(Array.isArray(capturesPayload) ? capturesPayload : []);
        }
      } catch (err) {
        if (!cancelled) {
          setSlackStatus({ connected: false });
          setSlackCaptures([]);
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

  const openExternalUrl = async (url: string) => {
    if (window.desktopWindow?.openExternal) {
      await window.desktopWindow.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const canManageWorkspace = workspaceUserRole === 'owner' || workspaceUserRole === 'admin';

  useEffect(() => {
    if (!activeWorkspace) {
      setWorkspaceEditName('');
      setWorkspaceEditDescription('');
      setWorkspaceDeleteConfirm('');
      setIsWorkspaceManageModalOpen(false);
      setIsWorkspaceDeleteModalOpen(false);
      return;
    }

    setWorkspaceEditName(activeWorkspace.name);
    setWorkspaceEditDescription(activeWorkspace.description ?? '');
    setWorkspaceDeleteConfirm('');
    setIsWorkspaceManageModalOpen(false);
    setIsWorkspaceDeleteModalOpen(false);
  }, [activeWorkspace]);

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
    const baseUrl = import.meta.env.VITE_INVITE_BASE_URL?.trim() || window.location.origin;
    return `${baseUrl.replace(/\/$/, '')}/invite/${encodeURIComponent(token)}`;
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
      className="h-screen overflow-hidden rounded-[28px] border border-gray-200 bg-[#f5f7fb] text-gray-900 flex flex-col shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
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

      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-[260px_1fr]">
          <aside
            className="border-r border-gray-200 bg-white p-4 overflow-auto"
            aria-label="Settings sections"
          >
            <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Account</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">Hi {firstName}</p>
              <p className="text-xs text-gray-600 truncate">
                {user?.email ?? 'No email available'}
              </p>
            </div>

            <nav className="space-y-2" aria-label="Settings navigation">
              {sectionOrder.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    activeSection === section.id
                      ? 'border-gray-300 bg-gray-100'
                      : 'border-transparent bg-white hover:border-gray-200 hover:bg-gray-50'
                  }`}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                >
                  <p className="text-sm font-semibold text-gray-900">{section.label}</p>
                  <p className="mt-1 text-xs text-gray-600">{section.description}</p>
                </button>
              ))}
            </nav>
          </aside>

          <main className="overflow-auto p-6" aria-live="polite">
            <div className="mx-auto max-w-3xl space-y-5">
              {activeSection === 'account' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-account"
                >
                  <h2 id="settings-account" className="text-lg font-semibold text-gray-900">
                    Account
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Basic identity and security controls.
                  </p>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label
                        htmlFor="settings-full-name"
                        className="block text-sm font-medium text-gray-700 mb-2"
                      >
                        Display name
                      </label>
                      <input
                        id="settings-full-name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        aria-describedby="settings-full-name-help"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="settings-email"
                        className="block text-sm font-medium text-gray-700 mb-2"
                      >
                        Email
                      </label>
                      <input
                        id="settings-email"
                        value={user?.email ?? ''}
                        readOnly
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-100 px-3 text-sm text-gray-600"
                      />
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <p className="text-sm font-semibold text-gray-900">Change password</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label
                            htmlFor="settings-password"
                            className="block text-xs font-medium text-gray-700 mb-1.5"
                          >
                            New password
                          </label>
                          <input
                            id="settings-password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="settings-password-confirm"
                            className="block text-xs font-medium text-gray-700 mb-1.5"
                          >
                            Confirm password
                          </label>
                          <input
                            id="settings-password-confirm"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => void handleUpdatePassword()}
                          disabled={isUpdatingPassword}
                          className="h-9 rounded-xl bg-[#FF5F40] px-4 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                        >
                          {isUpdatingPassword ? 'Updating...' : 'Update password'}
                        </button>
                        {isUpdatingPassword && (
                          <Loader2 size={14} className="animate-spin text-gray-500" />
                        )}
                      </div>
                      {passwordError && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-700">
                          <CircleAlert size={12} />
                          {passwordError}
                        </p>
                      )}
                      {passwordStatus && (
                        <p className="mt-2 text-xs text-green-700">{passwordStatus}</p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'workspace' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-workspace"
                >
                  <h2 id="settings-workspace" className="text-lg font-semibold text-gray-900">
                    Workspace
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Defaults used across dashboard and modules.
                  </p>

                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                          Create workspace
                        </p>
                        <h3 className="mt-1 text-[15px] font-semibold leading-5 text-gray-900">
                          Create a focused space for work
                        </h3>
                        <p className="mt-0.5 text-xs leading-5 text-gray-500">
                          Start a personal or team workspace for Ledger data.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_176px]">
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

                    <div className="mt-3">
                      <textarea
                        value={workspaceCreateDescription}
                        onChange={(e) => setWorkspaceCreateDescription(e.target.value)}
                        placeholder="Optional description"
                        className="min-h-14 w-full resize-none rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100"
                        aria-label="Workspace description"
                      />
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-3">
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

                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                          Active workspace
                        </p>
                        <p className="mt-1 text-[15px] font-semibold leading-5 text-gray-900">
                          {activeWorkspace?.name ?? 'No workspace selected'}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-gray-500">
                          {activeWorkspaceKindLabel}
                        </p>
                        <p className="mt-2 max-w-xl text-xs leading-5 text-gray-600">
                          This workspace keeps dashboard, projects, calendar, notes, and settings
                          separated.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => void refreshWorkspaces()}
                          disabled={isLoadingWorkspaces || isSwitchingWorkspace}
                          className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                        >
                          Refresh
                        </button>
                        {canManageWorkspace ? (
                          <button
                            onClick={openWorkspaceManageModal}
                            className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                          >
                            Manage
                          </button>
                        ) : (
                          <span className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500">
                            Owner only
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <label
                        htmlFor="settings-active-workspace"
                        className="mb-2 block text-xs font-medium text-gray-500"
                      >
                        Switch workspace
                      </label>
                      <select
                        id="settings-active-workspace"
                        value={activeWorkspaceId ?? ''}
                        onChange={(e) => void handleSwitchWorkspace(e.target.value)}
                        disabled={
                          isLoadingWorkspaces || isSwitchingWorkspace || workspaces.length === 0
                        }
                        className="h-9 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50/80 px-3 pr-9 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
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

                    {(workspaceStatus || workspaceError) && (
                      <p className="mt-3 text-xs text-gray-700" role="status">
                        {workspaceStatus || workspaceError}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">Members</h3>
                        <p className="mt-1 text-xs text-gray-600">
                          Manage access for the selected workspace. Owners and admins can add or
                          remove people.
                        </p>
                      </div>
                      <span className="inline-flex self-start rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700">
                        {workspaceUserRole === 'owner' ? 'Owner' : `Role: ${workspaceUserRole}`}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {isLoadingWorkspaceAdmin ? (
                        <p className="text-xs text-gray-500">Loading members...</p>
                      ) : workspaceMembers.length === 0 ? (
                        <p className="text-xs text-gray-500">No members yet.</p>
                      ) : (
                        workspaceMembers.map((member) => {
                          const displayName = member.full_name || member.email || member.user_id;
                          const canEditRole =
                            canManageWorkspace && !member.is_owner && member.user_id !== user?.id;
                          return (
                            <div
                              key={member.user_id}
                              className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center"
                            >
                              <div className="min-w-0 lg:min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {displayName}
                                </p>
                                <p className="truncate text-xs text-gray-600">
                                  {member.email || 'No email'}
                                  {member.is_owner ? ' · Owner' : ''}
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
                                className="h-8 w-full appearance-none rounded-lg border border-gray-200 bg-white px-2 pr-8 text-xs text-gray-800 outline-none disabled:opacity-60 lg:w-auto"
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
                                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 lg:w-auto"
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">Invite members</h3>
                        <p className="mt-1 text-xs text-gray-600">
                          Invite someone to this workspace.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_148px_auto]">
                      <input
                        ref={inviteEmailRef}
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="name@example.com"
                        disabled={!canManageWorkspace || isSendingInvite}
                        className="h-9 rounded-xl border border-gray-200 bg-gray-50/80 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                        aria-label="Invite email optional"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                        disabled={!canManageWorkspace || isSendingInvite}
                        className="h-9 appearance-none rounded-xl border border-gray-200 bg-gray-50/80 px-3 pr-8 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
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
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                        <p className="text-xs font-medium text-gray-700">Invite link</p>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                          {inviteLink && (
                            <p className="min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
                              {inviteLink}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleCopyInvitationLink()}
                            disabled={!inviteLink}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
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

                    <div className="mt-3">
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                        Recent invites
                      </p>
                      <div className="mt-2 space-y-2">
                        {workspaceInvitations.length === 0 ? (
                          <p className="text-xs text-gray-500">No pending invites.</p>
                        ) : (
                          workspaceInvitations.map((invite) => (
                            <div
                              key={invite.id}
                              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {invite.invited_email}
                                </p>
                                <p className="text-xs text-gray-600">
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
                                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                              >
                                Manage
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {workspaceAdminError && (
                    <p className="mt-3 text-xs text-red-700" role="status">
                      {workspaceAdminError}
                    </p>
                  )}

                  <ModalOverlay
                    isOpen={!!inviteModal && !!selectedInvite}
                    onClose={() => setInviteModal(null)}
                    classNameContainer="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-950">
                          Manage invite
                        </h4>
                        <p className="mt-1 text-xs text-gray-500">
                          {selectedInvite?.invited_email}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInviteModal(null)}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                              Status
                            </p>
                            <p className="text-sm font-medium text-gray-900">
                              {selectedInvite?.status}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                              Role
                            </p>
                            <p className="text-sm font-medium text-gray-900">
                              {selectedInvite?.role}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-gray-500">
                          Expires{' '}
                          {selectedInvite && new Date(selectedInvite.expires_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>

                      {selectedInvite?.status === 'pending' ? (
                        <div className="rounded-xl border border-gray-200 bg-white p-3">
                          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                            Invite link
                          </p>
                          <p className="mt-2 break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                            {getInviteUrl(selectedInvite) ?? 'No link available'}
                          </p>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleCopySelectedInviteLink()}
                              disabled={!getInviteUrl(selectedInvite)}
                              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                            >
                              <Copy size={14} />
                              Copy link
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRevokeInvitation(selectedInvite.id)}
                              disabled={invitationActionId === selectedInvite.id}
                              className="inline-flex h-9 flex-1 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                            >
                              {invitationActionId === selectedInvite.id
                                ? 'Revoking...'
                                : 'Revoke'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                          This invite is no longer pending.
                        </div>
                      )}
                    </div>
                  </ModalOverlay>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="settings-week-start"
                        className="block text-sm font-medium text-gray-700 mb-2"
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
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                      >
                        <option value="monday">Monday</option>
                        <option value="sunday">Sunday</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="settings-time-format"
                        className="block text-sm font-medium text-gray-700 mb-2"
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
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                      >
                        <option value="12h">12-hour (2:00 PM)</option>
                        <option value="24h">24-hour (14:00)</option>
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'calendar' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-calendar"
                >
                  <h2 id="settings-calendar" className="text-lg font-semibold text-gray-900">
                    Calendar and reminders
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Set defaults for new events and reminder timing.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="settings-event-duration"
                        className="block text-sm font-medium text-gray-700 mb-2"
                      >
                        Default event duration
                      </label>
                      <select
                        id="settings-event-duration"
                        value={String(preferences.defaultEventMinutes)}
                        onChange={(e) =>
                          setPreferences((prev) => ({
                            ...prev,
                            defaultEventMinutes: Number(e.target.value) as 30 | 45 | 60,
                          }))
                        }
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                      >
                        <option value="30">30 minutes</option>
                        <option value="45">45 minutes</option>
                        <option value="60">60 minutes</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="settings-reminder-lead"
                        className="block text-sm font-medium text-gray-700 mb-2"
                      >
                        Default reminder
                      </label>
                      <select
                        id="settings-reminder-lead"
                        value={String(preferences.reminderLeadMinutes)}
                        onChange={(e) =>
                          setPreferences((prev) => ({
                            ...prev,
                            reminderLeadMinutes: Number(e.target.value) as 5 | 10 | 15 | 30,
                          }))
                        }
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                      >
                        <option value="5">5 minutes before</option>
                        <option value="10">10 minutes before</option>
                        <option value="15">15 minutes before</option>
                        <option value="30">30 minutes before</option>
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'integrations' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-integrations"
                >
                  <h2 id="settings-integrations" className="text-lg font-semibold text-gray-900">
                    Integrations
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Connect external signals that should become intentional Ledger captures.
                  </p>

                  <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF5F40] text-sm font-semibold text-white shadow-sm">
                            S
                          </span>
                          <div>
                            <h3 className="text-sm font-semibold text-gray-950">Slack</h3>
                            <p className="mt-0.5 text-xs leading-5 text-gray-600">
                              Save Slack messages to Ledger as tasks, notes, reminders, and project
                              context.
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                            Status
                          </p>
                          <p className="mt-1 text-sm font-medium text-gray-900">
                            {isLoadingSlackStatus
                              ? 'Checking connection...'
                              : slackStatus?.connected
                                ? `Connected to ${slackStatus.team_name || 'Slack'}`
                                : 'Not connected'}
                          </p>
                          {slackStatus?.connected && slackStatus.updated_at && (
                            <p className="mt-1 text-xs text-gray-500">
                              Updated{' '}
                              {new Date(slackStatus.updated_at).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-36">
                        <button
                          type="button"
                          onClick={() => void handleConnectSlack()}
                          disabled={isConnectingSlack || !activeWorkspaceId}
                          className="h-9 rounded-xl bg-[#FF5F40] px-4 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                        >
                          {isConnectingSlack
                            ? 'Opening...'
                            : slackStatus?.connected
                              ? 'Reconnect Slack'
                              : 'Connect Slack'}
                        </button>
                        {slackStatus?.connected && (
                          <button
                            type="button"
                            onClick={() => void handleDisconnectSlack()}
                            disabled={isDisconnectingSlack || !activeWorkspaceId}
                            className="h-9 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                          >
                            {isDisconnectingSlack ? 'Disconnecting...' : 'Disconnect'}
                          </button>
                        )}
                      </div>
                    </div>

                    {slackError && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-red-700">
                        <CircleAlert size={12} />
                        {slackError}
                      </p>
                    )}

                    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                          Latest Slack captures
                        </p>
                        <span className="text-[11px] text-gray-400">
                          {slackCaptures.length} shown
                        </span>
                      </div>
                      <div className="mt-2 space-y-2">
                        {slackCaptures.length === 0 ? (
                          <p className="text-xs leading-5 text-gray-500">
                            Captured Slack messages will appear here until the dedicated capture
                            inbox ships.
                          </p>
                        ) : (
                          slackCaptures.map((capture) => (
                            <div
                              key={capture.id}
                              className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {capture.captured_text || 'Slack message'}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-gray-500">
                                  From Slack
                                  {capture.channel_name ? ` · #${capture.channel_name}` : ''}
                                  {capture.author_name ? ` · ${capture.author_name}` : ''}
                                </p>
                              </div>
                              {capture.external_url && (
                                <button
                                  type="button"
                                  onClick={() => void openExternalUrl(capture.external_url || '')}
                                  className="shrink-0 text-[11px] font-medium text-[#FF5F40] hover:text-[#d84b31]"
                                >
                                  Open
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-gray-500">
                      Phase 1 only stores intentional Slack message captures. Ledger will not sync
                      channel history or read every message.
                    </p>
                  </div>
                </section>
              )}

              {activeSection === 'sidebar' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-sidebar"
                >
                  <h2 id="settings-sidebar" className="text-lg font-semibold text-gray-900">
                    Sidebar
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Configure position, behavior, and appearance for the sidebar.
                  </p>

                  <div className="mt-5 space-y-5">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.5px] text-gray-600">
                        Position
                      </h3>
                      <p className="mt-2 text-xs text-gray-600">
                        Choose where the sidebar appears in your workspace.
                      </p>
                      <div className="mt-4 grid gap-2">
                        {sidebarPositionOptions.map((option) => (
                          <label
                            key={option.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                              position === option.value
                                ? 'border-gray-300 bg-white'
                                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="sidebar-position"
                              value={option.value}
                              checked={position === option.value}
                              onChange={() => setPosition(option.value)}
                              className="mt-1 h-4 w-4 border-gray-300 text-[#FF5F40] focus:ring-2 focus:ring-[#ffd9d0]"
                            />
                            <span className="flex-1">
                              <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-900">
                                <option.icon
                                  size={16}
                                  className={
                                    position === option.value ? 'text-[#FF5F40]' : 'text-gray-400'
                                  }
                                />
                                {option.label}
                              </span>
                              <span className="mt-1 block text-xs text-gray-600">
                                {option.description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.5px] text-gray-600">
                          Default state
                        </p>
                        {sidebarDefaultStateOptions.map((option) => (
                          <label
                            key={option.value}
                            className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5"
                          >
                            <input
                              type="radio"
                              name="sidebar-default-state"
                              value={option.value}
                              checked={defaultState === option.value}
                              onChange={() => setDefaultState(option.value)}
                              className="mt-1 h-4 w-4 border-gray-300 text-[#FF5F40] focus:ring-2 focus:ring-[#ffd9d0]"
                            />
                            <span>
                              <span className="block text-sm font-medium text-gray-900">
                                {option.label}
                              </span>
                              <span className="mt-1 block text-xs text-gray-600">
                                {option.description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.5px] text-gray-600">
                        Behavior
                      </h3>
                      <div className="mt-3 space-y-3">
                        <ToggleField
                          id="settings-sidebar-always-on-top"
                          label="Always on top"
                          help="Keep sidebar above other windows in docked mode."
                          checked={alwaysOnTop}
                          onChange={(checked) => setAlwaysOnTop(checked)}
                        />
                        <ToggleField
                          id="settings-sidebar-auto-hide"
                          label="Auto hide"
                          help="Collapse sidebar when pointer leaves the panel."
                          checked={autoHide}
                          onChange={(checked) => setAutoHide(checked)}
                        />
                        {position === 'floating' && (
                          <ToggleField
                            id="settings-sidebar-dock-enabled"
                            label="Dock to app windows"
                            help="Attach sidebar to app windows while floating."
                            checked={sidebarPreferences.floatingDockEnabled}
                            onChange={(checked) => setFloatingDockEnabled(checked)}
                          />
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.5px] text-gray-600">
                        Appearance
                      </h3>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900">Opacity</p>
                        <span className="text-base font-semibold text-gray-900">
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
                        className="mt-3 w-full accent-[#FF5F40]"
                      />
                      <p className="mt-2 text-xs text-gray-600">(Range: 70% - 95%)</p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        onClick={handleResetSidebarSettings}
                        type="button"
                        className="h-9 rounded-xl border border-gray-200 bg-gray-100 px-4 text-sm font-medium text-gray-800 transition hover:bg-gray-200"
                      >
                        Reset to Defaults
                      </button>
                      <p className="text-xs text-gray-600">Changes save automatically.</p>
                    </div>
                    {saveStatus && (
                      <p className="mt-2 text-xs text-gray-700" role="status">
                        {saveStatus}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {activeSection === 'accessibility' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-accessibility"
                >
                  <h2 id="settings-accessibility" className="text-lg font-semibold text-gray-900">
                    Accessibility
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Comfort controls for readability and navigation.
                  </p>

                  <div className="mt-5 space-y-3">
                    <ToggleField
                      id="settings-reduce-motion"
                      label="Reduce motion"
                      help="Minimize non-essential animations where supported."
                      checked={preferences.reduceMotion}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, reduceMotion: checked }))
                      }
                    />
                    <ToggleField
                      id="settings-high-contrast"
                      label="High contrast"
                      help="Increase contrast for text and borders in future screens."
                      checked={preferences.highContrast}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, highContrast: checked }))
                      }
                    />
                    <ToggleField
                      id="settings-compact-density"
                      label="Compact density"
                      help="Fit more content on screen with tighter spacing."
                      checked={preferences.compactDensity}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, compactDensity: checked }))
                      }
                    />
                    <ToggleField
                      id="settings-dashboard-default"
                      label="Open dashboard by default"
                      help="Use dashboard mode as your preferred entry layout."
                      checked={preferences.openDashboardByDefault}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, openDashboardByDefault: checked }))
                      }
                    />
                  </div>
                </section>
              )}

              {activeSection === 'shortcuts' && (
                <section
                  className="rounded-2xl border border-gray-200 bg-white p-5"
                  aria-labelledby="settings-shortcuts"
                >
                  <div>
                    <h2 id="settings-shortcuts" className="text-lg font-semibold text-gray-900">
                      Keyboard Shortcuts
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">Quick reference for actions.</p>
                  </div>

                  <div className="mt-5 rounded-xl border border-gray-200 bg-[#fafafa] p-5">
                    <div className="space-y-7">
                      {shortcutSections.map((section) => (
                        <section key={section.id} aria-labelledby={`shortcut-group-${section.id}`}>
                          <h3
                            id={`shortcut-group-${section.id}`}
                            className="text-xs font-semibold uppercase tracking-[0.5px] text-gray-600"
                          >
                            {section.title}
                          </h3>
                          <div className="mt-3 space-y-3">
                            {section.shortcuts.map((shortcut) => (
                              <div
                                key={`${section.id}-${shortcut.keys}-${shortcut.description}`}
                                className="grid min-h-8 grid-cols-[180px_1fr] items-center gap-3"
                              >
                                <span className="font-mono text-sm font-semibold text-gray-900">
                                  {shortcut.keys}
                                </span>
                                <span className="text-sm text-gray-700">
                                  {shortcut.description}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {activeSection !== 'sidebar' &&
                activeSection !== 'shortcuts' &&
                activeSection !== 'integrations' && (
                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">
                      Changes save automatically
                    </h2>
                    <p className="mt-1 text-xs text-gray-600">
                      Your account and workspace defaults update as you edit them.
                    </p>
                  </div>
                  {saveStatus && (
                    <p className="mt-3 text-xs text-gray-700" role="status">
                      {saveStatus}
                    </p>
                  )}
                </section>
              )}
            </div>

            <ModalOverlay
              isOpen={isWorkspaceManageModalOpen && !!activeWorkspace}
              onClose={closeWorkspaceManageModal}
              classNameContainer="w-full max-w-155 rounded-2xl border border-gray-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                    Workspace settings
                  </p>
                  <h3
                    id="workspace-manage-title"
                    className="mt-1 text-lg font-semibold text-gray-900"
                  >
                    {activeWorkspace?.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">{activeWorkspaceKindLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={closeWorkspaceManageModal}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 border-t border-gray-100 px-5 pt-4">
                <label
                  htmlFor="workspace-edit-name"
                  className="mb-2 block text-xs font-medium text-gray-500"
                >
                  Name
                </label>
                <input
                  id="workspace-edit-name"
                  value={workspaceEditName}
                  onChange={(e) => setWorkspaceEditName(e.target.value)}
                  disabled={!canManageWorkspace || isSavingWorkspace}
                  className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50/80 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                  aria-label="Edit workspace name"
                />
              </div>

              <div className="mt-3 px-5">
                <label
                  htmlFor="workspace-edit-description"
                  className="mb-2 block text-xs font-medium text-gray-500"
                >
                  Description
                </label>
                <textarea
                  id="workspace-edit-description"
                  value={workspaceEditDescription}
                  onChange={(e) => setWorkspaceEditDescription(e.target.value)}
                  disabled={!canManageWorkspace || isSavingWorkspace}
                  className="min-h-20 w-full resize-none rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                  aria-label="Edit workspace description"
                />
              </div>

              <div className="mt-4 border-t border-gray-100 px-5 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                      Danger zone
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      Delete this workspace and all data inside it.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openWorkspaceDeleteModal}
                    disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                    className="h-8 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
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
              classNameContainer="w-full max-w-130 rounded-2xl border border-gray-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
            >
              <div className="px-5 pt-5">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
                  Danger zone
                </p>
                <h3
                  id="workspace-delete-title"
                  className="mt-1 text-lg font-semibold text-gray-900"
                >
                  Delete workspace
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  Type{' '}
                  <span className="font-medium text-gray-900">{activeWorkspace?.name}</span> to
                  confirm deletion.
                </p>
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
                  className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50/80 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                  aria-label="Confirm workspace deletion"
                />
                <p className="mt-2 text-xs text-gray-500">
                  This removes the workspace and all data inside it.
                </p>
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
          </main>
        </div>
      </div>
    </div>
  );
};

export default SettingsWindow;
