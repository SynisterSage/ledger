import {
  ChevronLeft,
  CircleAlert,
  Loader2,
  Settings,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useSidebar } from '../../context/SidebarContext'
import { type SidebarPosition } from '../../config/sidebarPreferences'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { useApi } from '../../hooks/useApi'
import authService from '../../services/auth'

type UserPreferences = {
  weekStartsOn: 'sunday' | 'monday'
  timeFormat: '12h' | '24h'
  defaultEventMinutes: 30 | 45 | 60
  reminderLeadMinutes: 5 | 10 | 15 | 30
  openDashboardByDefault: boolean
  reduceMotion: boolean
  highContrast: boolean
  compactDensity: boolean
}

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

type WorkspaceMember = {
  user_id: string
  role: WorkspaceRole
  joined_at: string | null
  email: string | null
  full_name: string | null
  is_owner: boolean
}

type WorkspaceInvitation = {
  id: string
  invited_email: string
  role: 'admin' | 'member' | 'viewer'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string
  invited_by: string
  created_at: string
}

type SettingsSectionId = 'account' | 'workspace' | 'calendar' | 'sidebar' | 'accessibility'
const sectionOrder: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'account', label: 'Account', description: 'Identity and security' },
  { id: 'workspace', label: 'Workspace', description: 'Display and behavior defaults' },
  { id: 'calendar', label: 'Calendar', description: 'Event and reminder defaults' },
  { id: 'sidebar', label: 'Sidebar', description: 'Docking, visibility, and placement' },
  { id: 'accessibility', label: 'Accessibility', description: 'Comfort and readability options' },
]

const STORAGE_KEY = 'ledger:settings:v1'

const defaultPrefs: UserPreferences = {
  weekStartsOn: 'monday',
  timeFormat: '12h',
  defaultEventMinutes: 30,
  reminderLeadMinutes: 15,
  openDashboardByDefault: true,
  reduceMotion: false,
  highContrast: false,
  compactDensity: false,
}

const loadCachedPreferences = (): UserPreferences => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPrefs
    const parsed = JSON.parse(raw) as Partial<UserPreferences>
    return {
      ...defaultPrefs,
      ...parsed,
    }
  } catch {
    return defaultPrefs
  }
}

const saveCachedPreferences = (prefs: UserPreferences) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

const selectChevronStyle: CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.8rem center',
  backgroundSize: '14px 14px',
}

const ToggleField = ({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string
  label: string
  help: string
  checked: boolean
  onChange: (checked: boolean) => void
}) => {
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#FF5F40] focus:ring-2 focus:ring-[#ffd9d0]"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="mt-1 block text-xs text-gray-600">{help}</span>
      </span>
    </label>
  )
}

export const SettingsWindow = () => {
  const { user, signOut } = useAuthContext()
  const { position, isVisible, setPosition, setIsVisible, floatingPosition, setFloatingPosition } = useSidebar()
  const api = useApi()
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspace,
    refreshWorkspaces,
    isLoading: isLoadingWorkspaces,
    error: workspaceError,
  } = useWorkspaceContext()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('account')

  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [isSavingPrefs, setIsSavingPrefs] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [initialFullName, setInitialFullName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null)
  const [workspaceCreateName, setWorkspaceCreateName] = useState('')
  const [workspaceCreateDescription, setWorkspaceCreateDescription] = useState('')
  const [workspaceCreateType, setWorkspaceCreateType] = useState<'team' | 'personal'>('team')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [workspaceCreateStatus, setWorkspaceCreateStatus] = useState<string | null>(null)
  const [isWorkspaceManageOpen, setIsWorkspaceManageOpen] = useState(false)
  const [workspaceEditName, setWorkspaceEditName] = useState('')
  const [workspaceEditDescription, setWorkspaceEditDescription] = useState('')
  const [workspaceEditStatus, setWorkspaceEditStatus] = useState<string | null>(null)
  const [workspaceEditError, setWorkspaceEditError] = useState<string | null>(null)
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false)
  const [workspaceDeleteConfirm, setWorkspaceDeleteConfirm] = useState('')
  const [workspaceDeleteStatus, setWorkspaceDeleteStatus] = useState<string | null>(null)
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<string | null>(null)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
  const [workspaceInvitations, setWorkspaceInvitations] = useState<WorkspaceInvitation[]>([])
  const [workspaceUserRole, setWorkspaceUserRole] = useState<WorkspaceRole>('member')
  const [isLoadingWorkspaceAdmin, setIsLoadingWorkspaceAdmin] = useState(false)
  const [workspaceAdminError, setWorkspaceAdminError] = useState<string | null>(null)
  const [memberActionId, setMemberActionId] = useState<string | null>(null)
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [isSendingInvite, setIsSendingInvite] = useState(false)
  const inviteEmailRef = useRef<HTMLInputElement | null>(null)

  const sidebarPositionOptions: Array<{ value: SidebarPosition; label: string; description: string }> = [
    { value: 'right', label: 'Right', description: 'Keep the sidebar docked on the right edge.' },
    { value: 'left', label: 'Left', description: 'Move the sidebar to the left edge.' },
    { value: 'top', label: 'Top', description: 'Stack the sidebar above the main content.' },
    { value: 'bottom', label: 'Bottom', description: 'Anchor the sidebar below the main content.' },
    { value: 'floating', label: 'Floating', description: 'Keep the sidebar in a detached floating panel.' },
  ]

  useEffect(() => {
    const cachedPrefs = loadCachedPreferences()
    setPreferences(cachedPrefs)

    let cancelled = false

    const loadSettings = async () => {
      try {
        const payload = await api.getUserSettings() as {
          full_name?: string | null
          preferences?: Partial<UserPreferences> | null
        }

        if (cancelled) return

        const nextFullName = String(payload?.full_name ?? '').trim()
        const nextPreferences = {
          ...defaultPrefs,
          ...(payload?.preferences ?? {}),
        }

        setPreferences(nextPreferences)
        setFullName(nextFullName || (user?.user_metadata?.full_name as string | undefined)?.trim() || user?.email?.split('@')[0] || '')
        setInitialFullName(nextFullName || (user?.user_metadata?.full_name as string | undefined)?.trim() || user?.email?.split('@')[0] || '')
        saveCachedPreferences(nextPreferences)

        const cachedLooksReal = JSON.stringify(cachedPrefs) !== JSON.stringify(defaultPrefs)
        const serverLooksUnset = !payload?.preferences || Object.keys(payload.preferences).length === 0
        if (cachedLooksReal && serverLooksUnset) {
          await api.updateUserSettings({
            full_name: nextFullName || null,
            preferences: cachedPrefs,
          })
        }
      } catch {
        if (cancelled) return
        setPreferences(cachedPrefs)
        const seedName = String(user?.user_metadata?.full_name ?? '').trim() || user?.email?.split('@')[0] || ''
        setFullName(seedName)
        setInitialFullName(seedName)
      } finally {
        if (!cancelled) {
          setIsLoadingSettings(false)
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [api, user?.email, user?.user_metadata?.full_name])

  const firstName = useMemo(() => {
    const candidate = fullName.trim()
    if (!candidate) return 'there'
    return candidate.split(' ')[0]
  }, [fullName])

  const handleSavePrefs = async () => {
    setIsSavingPrefs(true)
    setSaveStatus(null)

    try {
      const nextFullName = fullName.trim() || null
      const nextPreferences = {
        ...preferences,
      }

      await api.updateUserSettings({
        full_name: nextFullName,
        preferences: nextPreferences,
      })

      if (String(nextFullName ?? '') !== initialFullName) {
        try {
          await authService.updateProfile(nextFullName)
        } catch (authError) {
          console.warn('Profile metadata sync failed', authError)
        }
      }

      saveCachedPreferences(nextPreferences)
      setInitialFullName(nextFullName ?? '')
      setSaveStatus('Settings saved.')
    } catch {
      setSaveStatus('Could not save settings.')
    } finally {
      setIsSavingPrefs(false)
    }
  }

  const handleUpdatePassword = async () => {
    setPasswordError(null)
    setPasswordStatus(null)

    const password = newPassword.trim()
    if (password.length < 8) {
      setPasswordError('Use at least 8 characters.')
      return
    }

    if (password !== confirmPassword.trim()) {
      setPasswordError('Password confirmation does not match.')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const { error } = await authService.updatePassword(password)
      if (error) throw error
      setPasswordStatus('Password updated.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not update password.')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspaceId) return

    setWorkspaceStatus(null)
    setIsSwitchingWorkspace(true)
    try {
      await setActiveWorkspace(workspaceId)
      await refreshWorkspaces()
      setWorkspaceStatus('Active workspace updated.')
    } catch (err) {
      setWorkspaceStatus(err instanceof Error ? err.message : 'Could not switch workspace.')
    } finally {
      setIsSwitchingWorkspace(false)
    }
  }

  const handleCreateWorkspace = async () => {
    const name = workspaceCreateName.trim()
    if (!name) {
      setWorkspaceAdminError('Workspace name is required')
      return
    }

    setWorkspaceAdminError(null)
    setWorkspaceStatus(null)
    setWorkspaceCreateStatus(null)
    setIsCreatingWorkspace(true)

    try {
      await api.createWorkspace({
        name,
        description: workspaceCreateDescription.trim() || null,
        is_personal: workspaceCreateType === 'personal',
      })

      setWorkspaceCreateName('')
      setWorkspaceCreateDescription('')
      setWorkspaceCreateType('team')

      await refreshWorkspaces()
      setWorkspaceCreateStatus('Workspace created and activated. Next step: invite teammates.')
      window.setTimeout(() => {
        inviteEmailRef.current?.focus()
      }, 0)
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not create workspace')
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  const canManageWorkspace = workspaceUserRole === 'owner' || workspaceUserRole === 'admin'

  useEffect(() => {
    if (!activeWorkspace) {
      setWorkspaceEditName('')
      setWorkspaceEditDescription('')
      setWorkspaceDeleteConfirm('')
      setIsWorkspaceManageOpen(false)
      return
    }

    setWorkspaceEditName(activeWorkspace.name)
    setWorkspaceEditDescription(activeWorkspace.description ?? '')
    setWorkspaceDeleteConfirm('')
    setIsWorkspaceManageOpen(false)
  }, [activeWorkspace])

  const handleUpdateWorkspace = async () => {
    if (!activeWorkspaceId) return

    const name = workspaceEditName.trim()
    if (!name) {
      setWorkspaceEditError('Workspace name is required')
      return
    }

    setWorkspaceEditError(null)
    setWorkspaceEditStatus(null)
    setIsSavingWorkspace(true)

    try {
      await api.updateWorkspace(activeWorkspaceId, {
        name,
        description: workspaceEditDescription.trim() || null,
      })
      await refreshWorkspaces()
      setWorkspaceEditStatus('Workspace details saved.')
    } catch (err) {
      setWorkspaceEditError(err instanceof Error ? err.message : 'Could not save workspace')
    } finally {
      setIsSavingWorkspace(false)
    }
  }

  const handleDeleteWorkspace = async () => {
    if (!activeWorkspaceId || !activeWorkspace) return

    if (workspaceDeleteConfirm.trim() !== activeWorkspace.name.trim()) {
      setWorkspaceDeleteError('Type the workspace name to confirm deletion.')
      return
    }

    setWorkspaceDeleteError(null)
    setWorkspaceDeleteStatus(null)
    setIsDeletingWorkspace(true)

    try {
      await api.deleteWorkspace(activeWorkspaceId)
      setWorkspaceDeleteStatus('Workspace deleted.')
      setWorkspaceDeleteConfirm('')
      await refreshWorkspaces()
    } catch (err) {
      setWorkspaceDeleteError(err instanceof Error ? err.message : 'Could not delete workspace')
    } finally {
      setIsDeletingWorkspace(false)
    }
  }

  useEffect(() => {
    if (activeSection !== 'workspace' || !activeWorkspaceId) return

    let cancelled = false

    const loadWorkspaceAdminData = async () => {
      setIsLoadingWorkspaceAdmin(true)
      setWorkspaceAdminError(null)

      try {
        const [membersPayload, invitesPayload] = await Promise.all([
          api.getWorkspaceMembers(activeWorkspaceId),
          api.getWorkspaceInvitations(activeWorkspaceId),
        ])

        if (cancelled) return

        const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
          ? ((membersPayload as { members: WorkspaceMember[] }).members)
          : []

        const nextInvites = Array.isArray((invitesPayload as { invitations?: unknown[] })?.invitations)
          ? ((invitesPayload as { invitations: WorkspaceInvitation[] }).invitations)
          : []

        setWorkspaceMembers(nextMembers)
        setWorkspaceInvitations(nextInvites)

        const roleCandidate = String((membersPayload as { current_user_role?: string })?.current_user_role ?? 'member').toLowerCase()
        if (roleCandidate === 'owner' || roleCandidate === 'admin' || roleCandidate === 'member' || roleCandidate === 'viewer') {
          setWorkspaceUserRole(roleCandidate)
        }
      } catch (err) {
        if (cancelled) return
        setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not load workspace members')
      } finally {
        if (!cancelled) {
          setIsLoadingWorkspaceAdmin(false)
        }
      }
    }

    void loadWorkspaceAdminData()

    return () => {
      cancelled = true
    }
  }, [activeSection, activeWorkspaceId, api])

  const handleUpdateMemberRole = async (userId: string, role: 'admin' | 'member' | 'viewer') => {
    if (!activeWorkspaceId) return
    setWorkspaceAdminError(null)
    setMemberActionId(userId)

    try {
      await api.updateWorkspaceMemberRole(activeWorkspaceId, userId, role)
      const membersPayload = await api.getWorkspaceMembers(activeWorkspaceId)
      const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
        ? ((membersPayload as { members: WorkspaceMember[] }).members)
        : []
      setWorkspaceMembers(nextMembers)
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not update member role')
    } finally {
      setMemberActionId(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!activeWorkspaceId) return
    setWorkspaceAdminError(null)
    setMemberActionId(userId)

    try {
      await api.removeWorkspaceMember(activeWorkspaceId, userId)
      const membersPayload = await api.getWorkspaceMembers(activeWorkspaceId)
      const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
        ? ((membersPayload as { members: WorkspaceMember[] }).members)
        : []
      setWorkspaceMembers(nextMembers)
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not remove member')
    } finally {
      setMemberActionId(null)
    }
  }

  const handleCreateInvitation = async () => {
    if (!activeWorkspaceId) return
    const email = inviteEmail.trim()
    if (!email) {
      setWorkspaceAdminError('Invite email is required')
      return
    }

    setWorkspaceAdminError(null)
    setWorkspaceStatus(null)
    setIsSendingInvite(true)

    try {
      const payload = await api.createWorkspaceInvitation(activeWorkspaceId, {
        email,
        role: inviteRole,
      }) as { invite_url?: string; invite_token?: string }

      setInviteEmail('')
      setInviteRole('member')
      setInviteLink(payload.invite_url ?? null)
      setInviteToken(payload.invite_token ?? null)

      const invitesPayload = await api.getWorkspaceInvitations(activeWorkspaceId)
      const nextInvites = Array.isArray((invitesPayload as { invitations?: unknown[] })?.invitations)
        ? ((invitesPayload as { invitations: WorkspaceInvitation[] }).invitations)
        : []
      setWorkspaceInvitations(nextInvites)
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not create invitation')
    } finally {
      setIsSendingInvite(false)
    }
  }

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!activeWorkspaceId) return
    setWorkspaceAdminError(null)
    setInvitationActionId(invitationId)

    try {
      await api.revokeWorkspaceInvitation(activeWorkspaceId, invitationId)
      const invitesPayload = await api.getWorkspaceInvitations(activeWorkspaceId)
      const nextInvites = Array.isArray((invitesPayload as { invitations?: unknown[] })?.invitations)
        ? ((invitesPayload as { invitations: WorkspaceInvitation[] }).invitations)
        : []
      setWorkspaceInvitations(nextInvites)
    } catch (err) {
      setWorkspaceAdminError(err instanceof Error ? err.message : 'Could not revoke invitation')
    } finally {
      setInvitationActionId(null)
    }
  }

  return (
    <div className="h-screen bg-[#f5f7fb] text-gray-900 flex flex-col">
      <div className="h-8 bg-white border-b border-gray-100" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />

      <header className="h-16 border-b border-gray-200 px-5 flex items-center justify-between bg-white" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => {
              void window.desktopWindow?.toggleModule('settings')
            }}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
            title="Close Settings"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
            <Settings size={18} className="text-gray-700" />
          </div>
          <div>
            <h1 className="text-[26px] leading-none font-semibold tracking-tight text-gray-900">Settings</h1>
            <p className="text-xs text-gray-500 mt-1">Defaults, accessible controls</p>
          </div>
        </div>

        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => {
              void signOut()
            }}
            className="h-9 px-3 rounded-full border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-[260px_1fr]">
          <aside className="border-r border-gray-200 bg-white p-4 overflow-auto" aria-label="Settings sections">
            <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Account</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">Hi {firstName}</p>
              <p className="text-xs text-gray-600 truncate">{user?.email ?? 'No email available'}</p>
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
                <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="settings-account">
                  <h2 id="settings-account" className="text-lg font-semibold text-gray-900">Account</h2>
                  <p className="mt-1 text-sm text-gray-600">Basic identity and security controls.</p>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label htmlFor="settings-full-name" className="block text-sm font-medium text-gray-700 mb-2">Display name</label>
                      <input
                        id="settings-full-name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        aria-describedby="settings-full-name-help"
                      />
                    </div>

                    <div>
                      <label htmlFor="settings-email" className="block text-sm font-medium text-gray-700 mb-2">Email</label>
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
                          <label htmlFor="settings-password" className="block text-xs font-medium text-gray-700 mb-1.5">New password</label>
                          <input
                            id="settings-password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                          />
                        </div>
                        <div>
                          <label htmlFor="settings-password-confirm" className="block text-xs font-medium text-gray-700 mb-1.5">Confirm password</label>
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
                        {isUpdatingPassword && <Loader2 size={14} className="animate-spin text-gray-500" />}
                      </div>
                      {passwordError && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-700">
                          <CircleAlert size={12} />
                          {passwordError}
                        </p>
                      )}
                      {passwordStatus && <p className="mt-2 text-xs text-green-700">{passwordStatus}</p>}
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'workspace' && (
                <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="settings-workspace">
                  <h2 id="settings-workspace" className="text-lg font-semibold text-gray-900">Workspace</h2>
                  <p className="mt-1 text-sm text-gray-600">Defaults used across dashboard and modules.</p>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-gray-500">Create workspace</p>
                        <h3 className="mt-1 text-sm font-semibold text-gray-900">Start a new place for Ledger data</h3>
                        <p className="mt-1 text-xs text-gray-600">
                          Team workspaces can be shared with invites. Personal workspaces stay private to you, and you can create more than one.
                        </p>
                      </div>
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700">
                        {workspaceCreateType === 'personal' ? 'Personal' : 'Team'}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                      <input
                        value={workspaceCreateName}
                        onChange={(e) => setWorkspaceCreateName(e.target.value)}
                        placeholder="Workspace name"
                        className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        aria-label="Workspace name"
                      />
                      <select
                        value={workspaceCreateType}
                        onChange={(e) => setWorkspaceCreateType(e.target.value as 'team' | 'personal')}
                        className="h-10 appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-8 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                        aria-label="Workspace type"
                      >
                        <option value="team">Team workspace</option>
                        <option value="personal">Personal workspace</option>
                      </select>
                    </div>

                    <div className="mt-2">
                      <textarea
                        value={workspaceCreateDescription}
                        onChange={(e) => setWorkspaceCreateDescription(e.target.value)}
                        placeholder="Optional description"
                        className="min-h-24 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        aria-label="Workspace description"
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-500">
                        {workspaceCreateType === 'personal'
                          ? 'Use this for solo notes and private planning. You can create multiple personal workspaces.'
                          : 'Use this for shared projects, invites, and collaboration.'}
                      </p>
                      <button
                        onClick={() => void handleCreateWorkspace()}
                        disabled={isCreatingWorkspace || !workspaceCreateName.trim()}
                        className="h-10 rounded-xl bg-[#FF5F40] px-4 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                      >
                        {isCreatingWorkspace ? 'Creating...' : 'Create workspace'}
                      </button>
                    </div>

                    {workspaceCreateStatus && (
                      <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
                        <p className="text-xs font-medium text-green-800">{workspaceCreateStatus}</p>
                        <button
                          onClick={() => inviteEmailRef.current?.focus()}
                          className="mt-2 text-xs font-medium text-green-700 hover:text-green-800"
                        >
                          Jump to invite email
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-gray-500">Active workspace</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{activeWorkspace?.name ?? 'No workspace selected'}</p>
                        <p className="mt-1 text-xs text-gray-600">
                          This workspace keeps your dashboard, projects, calendar, notes, and settings separated from other teams.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void refreshWorkspaces()}
                          disabled={isLoadingWorkspaces || isSwitchingWorkspace}
                          className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                        >
                          Refresh
                        </button>
                        {canManageWorkspace ? (
                          <button
                            onClick={() => setIsWorkspaceManageOpen((prev) => !prev)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                          >
                            <Settings size={13} />
                            {isWorkspaceManageOpen ? 'Close' : 'Manage'}
                          </button>
                        ) : (
                          <span className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500">
                            Owner only
                          </span>
                        )}
                      </div>
                    </div>

                    {isWorkspaceManageOpen && canManageWorkspace && (
                      <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-wider text-gray-500">Workspace management</p>
                            <h3 className="mt-1 text-sm font-semibold text-gray-900">Edit details or delete</h3>
                          </div>
                          <button
                            onClick={() => setIsWorkspaceManageOpen(false)}
                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                          >
                            Done
                          </button>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Details</p>
                            <div className="mt-2 space-y-2">
                              <input
                                value={workspaceEditName}
                                onChange={(e) => setWorkspaceEditName(e.target.value)}
                                disabled={!canManageWorkspace || isSavingWorkspace}
                                placeholder="Workspace name"
                                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                                aria-label="Edit workspace name"
                              />
                              <textarea
                                value={workspaceEditDescription}
                                onChange={(e) => setWorkspaceEditDescription(e.target.value)}
                                disabled={!canManageWorkspace || isSavingWorkspace}
                                placeholder="Optional description"
                                className="min-h-20 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                                aria-label="Edit workspace description"
                              />
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <button
                                onClick={() => void handleUpdateWorkspace()}
                                disabled={!canManageWorkspace || isSavingWorkspace}
                                className="h-9 rounded-xl bg-[#FF5F40] px-3 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                              >
                                {isSavingWorkspace ? 'Saving...' : 'Save'}
                              </button>
                              {workspaceEditStatus && <p className="text-xs text-green-700">{workspaceEditStatus}</p>}
                            </div>

                            {workspaceEditError && <p className="mt-2 text-xs text-red-700">{workspaceEditError}</p>}
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                            <p className="text-xs font-medium uppercase tracking-wider text-red-600">Delete</p>
                            <p className="mt-2 text-xs leading-5 text-gray-600">
                              Remove this workspace and everything inside it.
                            </p>

                            <input
                              value={workspaceDeleteConfirm}
                              onChange={(e) => setWorkspaceDeleteConfirm(e.target.value)}
                              disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace}
                              placeholder={activeWorkspace?.name ?? 'Workspace name'}
                              className="mt-3 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                              aria-label="Confirm workspace deletion"
                            />

                            <div className="mt-3 flex items-center gap-2">
                              <button
                                onClick={() => void handleDeleteWorkspace()}
                                disabled={workspaceUserRole !== 'owner' || isDeletingWorkspace || workspaceDeleteConfirm.trim() !== activeWorkspace?.name?.trim()}
                                className="h-9 rounded-xl bg-red-600 px-3 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                              >
                                {isDeletingWorkspace ? 'Deleting...' : 'Delete'}
                              </button>
                              {workspaceDeleteStatus && <p className="text-xs text-green-700">{workspaceDeleteStatus}</p>}
                            </div>

                            {workspaceDeleteError && <p className="mt-2 text-xs text-red-700">{workspaceDeleteError}</p>}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-3">
                      <label htmlFor="settings-active-workspace" className="mb-2 block text-sm font-medium text-gray-700">Switch workspace</label>
                      <select
                        id="settings-active-workspace"
                        value={activeWorkspaceId ?? ''}
                        onChange={(e) => void handleSwitchWorkspace(e.target.value)}
                        disabled={isLoadingWorkspaces || isSwitchingWorkspace || workspaces.length === 0}
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                        style={selectChevronStyle}
                      >
                        {workspaces.length === 0 && <option value="">No workspaces available</option>}
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
                        <p className="mt-1 text-xs text-gray-600">Manage access for the selected workspace. Owners and admins can add or remove people.</p>
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
                          const displayName = member.full_name || member.email || member.user_id
                          const canEditRole = canManageWorkspace && !member.is_owner && member.user_id !== user?.id
                          return (
                            <div key={member.user_id} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
                              <div className="min-w-0 lg:min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
                                <p className="truncate text-xs text-gray-600">{member.email || 'No email'}{member.is_owner ? ' · Owner' : ''}</p>
                              </div>
                              <select
                                value={member.is_owner ? 'owner' : member.role}
                                onChange={(e) => void handleUpdateMemberRole(member.user_id, e.target.value as 'admin' | 'member' | 'viewer')}
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
                                disabled={!canManageWorkspace || member.is_owner || member.user_id === user?.id || memberActionId === member.user_id}
                                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 lg:w-auto"
                              >
                                Remove
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-gray-900">Invitations</h3>
                    <p className="mt-1 text-xs text-gray-600">Invite teammates by email and set a default role.</p>

                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_140px_auto]">
                      <input
                        ref={inviteEmailRef}
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="name@company.com"
                        disabled={!canManageWorkspace || isSendingInvite}
                        className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                        aria-label="Invite email"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                        disabled={!canManageWorkspace || isSendingInvite}
                        className="h-9 appearance-none rounded-lg border border-gray-200 bg-gray-50 px-2 pr-8 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
                        style={selectChevronStyle}
                        aria-label="Invite role"
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button
                        onClick={() => void handleCreateInvitation()}
                        disabled={!canManageWorkspace || isSendingInvite}
                        className="h-9 rounded-lg bg-[#FF5F40] px-3 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                      >
                        {isSendingInvite ? 'Sending...' : 'Send invite'}
                      </button>
                    </div>

                    {(inviteLink || inviteToken) && (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs font-medium text-gray-700">Latest invite link</p>
                        {inviteLink && <p className="mt-1 break-all text-xs text-gray-600">{inviteLink}</p>}
                        {inviteToken && <p className="mt-1 text-[11px] text-gray-500">Token: {inviteToken}</p>}
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {workspaceInvitations.length === 0 ? (
                        <p className="text-xs text-gray-500">No invitations yet.</p>
                      ) : (
                        workspaceInvitations.map((invite) => (
                          <div key={invite.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-gray-900">{invite.invited_email}</p>
                              <p className="text-xs text-gray-600">{invite.role} · {invite.status}</p>
                            </div>
                            <p className="text-[11px] text-gray-500">{new Date(invite.expires_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</p>
                            <button
                              onClick={() => void handleRevokeInvitation(invite.id)}
                              disabled={!canManageWorkspace || invite.status !== 'pending' || invitationActionId === invite.id}
                              className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                            >
                              Revoke
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {workspaceAdminError && (
                    <p className="mt-3 text-xs text-red-700" role="status">
                      {workspaceAdminError}
                    </p>
                  )}

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="settings-week-start" className="block text-sm font-medium text-gray-700 mb-2">Week starts on</label>
                      <select
                        id="settings-week-start"
                        value={preferences.weekStartsOn}
                        onChange={(e) => setPreferences((prev) => ({ ...prev, weekStartsOn: e.target.value as 'sunday' | 'monday' }))}
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                      >
                        <option value="monday">Monday</option>
                        <option value="sunday">Sunday</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="settings-time-format" className="block text-sm font-medium text-gray-700 mb-2">Time format</label>
                      <select
                        id="settings-time-format"
                        value={preferences.timeFormat}
                        onChange={(e) => setPreferences((prev) => ({ ...prev, timeFormat: e.target.value as '12h' | '24h' }))}
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
                <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="settings-calendar">
                  <h2 id="settings-calendar" className="text-lg font-semibold text-gray-900">Calendar and reminders</h2>
                  <p className="mt-1 text-sm text-gray-600">Set defaults for new events and reminder timing.</p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="settings-event-duration" className="block text-sm font-medium text-gray-700 mb-2">Default event duration</label>
                      <select
                        id="settings-event-duration"
                        value={String(preferences.defaultEventMinutes)}
                        onChange={(e) => setPreferences((prev) => ({
                          ...prev,
                          defaultEventMinutes: Number(e.target.value) as 30 | 45 | 60,
                        }))}
                        className="h-10 w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 pr-9 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        style={selectChevronStyle}
                      >
                        <option value="30">30 minutes</option>
                        <option value="45">45 minutes</option>
                        <option value="60">60 minutes</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="settings-reminder-lead" className="block text-sm font-medium text-gray-700 mb-2">Default reminder</label>
                      <select
                        id="settings-reminder-lead"
                        value={String(preferences.reminderLeadMinutes)}
                        onChange={(e) => setPreferences((prev) => ({
                          ...prev,
                          reminderLeadMinutes: Number(e.target.value) as 5 | 10 | 15 | 30,
                        }))}
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
              {activeSection === 'sidebar' && (
                <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="settings-sidebar">
                  <h2 id="settings-sidebar" className="text-lg font-semibold text-gray-900">Sidebar</h2>
                  <p className="mt-1 text-sm text-gray-600">Control where the sidebar docks, whether it stays visible, and where a floating sidebar opens.</p>

                  <div className="mt-5 space-y-4">
                    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <input
                        id="settings-sidebar-visible"
                        type="checkbox"
                        checked={isVisible}
                        onChange={(event) => setIsVisible(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#FF5F40] focus:ring-2 focus:ring-[#ffd9d0]"
                      />
                      <label htmlFor="settings-sidebar-visible" className="cursor-pointer">
                        <span className="block text-sm font-medium text-gray-900">Show sidebar</span>
                        <span className="mt-1 block text-xs text-gray-600">Use Cmd+Shift+B to toggle quickly.</span>
                      </label>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-gray-900">Position</p>
                      <p className="mt-1 text-xs text-gray-600">Choose where the sidebar appears relative to the main workspace.</p>
                      <div className="mt-3 grid gap-3">
                        {sidebarPositionOptions.map((option) => (
                          <label
                            key={option.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                              position === option.value
                                ? 'border-gray-300 bg-gray-100'
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
                            <span>
                              <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                              <span className="mt-1 block text-xs text-gray-600">{option.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {position === 'floating' && (
                      <div>
                        <p className="text-sm font-medium text-gray-900">Floating position</p>
                        <p className="mt-1 text-xs text-gray-600">Set the default floating window offset when the sidebar opens in floating mode.</p>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-gray-700">X</span>
                            <input
                              type="number"
                              value={floatingPosition.x}
                              onChange={(event) =>
                                setFloatingPosition({
                                  x: Number(event.target.value) || 0,
                                  y: floatingPosition.y,
                                })
                              }
                              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-gray-700">Y</span>
                            <input
                              type="number"
                              value={floatingPosition.y}
                              onChange={(event) =>
                                setFloatingPosition({
                                  x: floatingPosition.x,
                                  y: Number(event.target.value) || 0,
                                })
                              }
                              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {activeSection === 'accessibility' && (
                <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="settings-accessibility">
                  <h2 id="settings-accessibility" className="text-lg font-semibold text-gray-900">Accessibility</h2>
                  <p className="mt-1 text-sm text-gray-600">Comfort controls for readability and navigation.</p>

                  <div className="mt-5 space-y-3">
                    <ToggleField
                      id="settings-reduce-motion"
                      label="Reduce motion"
                      help="Minimize non-essential animations where supported."
                      checked={preferences.reduceMotion}
                      onChange={(checked) => setPreferences((prev) => ({ ...prev, reduceMotion: checked }))}
                    />
                    <ToggleField
                      id="settings-high-contrast"
                      label="High contrast"
                      help="Increase contrast for text and borders in future screens."
                      checked={preferences.highContrast}
                      onChange={(checked) => setPreferences((prev) => ({ ...prev, highContrast: checked }))}
                    />
                    <ToggleField
                      id="settings-compact-density"
                      label="Compact density"
                      help="Fit more content on screen with tighter spacing."
                      checked={preferences.compactDensity}
                      onChange={(checked) => setPreferences((prev) => ({ ...prev, compactDensity: checked }))}
                    />
                    <ToggleField
                      id="settings-dashboard-default"
                      label="Open dashboard by default"
                      help="Use dashboard mode as your preferred entry layout."
                      checked={preferences.openDashboardByDefault}
                      onChange={(checked) => setPreferences((prev) => ({ ...prev, openDashboardByDefault: checked }))}
                    />
                  </div>
                </section>
              )}

                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Save settings</h2>
                      <p className="mt-1 text-xs text-gray-600">Changes sync to your account and workspace defaults.</p>
                    </div>
                    <button
                      onClick={() => void handleSavePrefs()}
                      disabled={isLoadingSettings || isSavingPrefs}
                      className="h-9 rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
                    >
                      {isSavingPrefs ? 'Saving...' : 'Save settings'}
                    </button>
                  </div>
                {saveStatus && (
                  <p className="mt-3 text-xs text-gray-700" role="status">{saveStatus}</p>
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default SettingsWindow
