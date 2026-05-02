import {
  ChevronLeft,
  CircleAlert,
  Loader2,
  Settings,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import authService from '../../services/auth'

type SettingsSectionId = 'account' | 'workspace' | 'calendar' | 'accessibility'

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

const sectionOrder: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'account', label: 'Account', description: 'Identity and security' },
  { id: 'workspace', label: 'Workspace', description: 'Display and behavior defaults' },
  { id: 'calendar', label: 'Calendar', description: 'Event and reminder defaults' },
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

const loadPreferences = (): UserPreferences => {
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

const savePreferences = (prefs: UserPreferences) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
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
  const [hasLoadedPrefs, setHasLoadedPrefs] = useState(false)
  const [isSavingPrefs, setIsSavingPrefs] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null)

  useEffect(() => {
    setPreferences(loadPreferences())
    setHasLoadedPrefs(true)
  }, [])

  useEffect(() => {
    const seedName = String(user?.user_metadata?.full_name ?? '').trim()
    if (seedName) {
      setFullName(seedName)
      return
    }
    setFullName(user?.email?.split('@')[0] ?? '')
  }, [user?.email, user?.user_metadata?.full_name])

  const firstName = useMemo(() => {
    const candidate = fullName.trim()
    if (!candidate) return 'there'
    return candidate.split(' ')[0]
  }, [fullName])

  const handleSavePrefs = async () => {
    setIsSavingPrefs(true)
    setSaveStatus(null)

    try {
      savePreferences(preferences)
      setSaveStatus('Preferences saved.')
    } catch {
      setSaveStatus('Could not save preferences.')
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
            <p className="text-xs text-gray-500 mt-1">Minimal defaults, accessible controls</p>
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
                      <label htmlFor="settings-full-name" className="block text-sm font-medium text-gray-700 mb-2">Full name</label>
                      <input
                        id="settings-full-name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        aria-describedby="settings-full-name-help"
                      />
                      <p id="settings-full-name-help" className="mt-1 text-xs text-gray-500">Profile editing endpoint can be connected next.</p>
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

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-gray-500">Active workspace</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{activeWorkspace?.name ?? 'No workspace selected'}</p>
                        <p className="mt-1 text-xs text-gray-600">This workspace is used by dashboard, projects, calendar, and notes.</p>
                      </div>
                      <button
                        onClick={() => void refreshWorkspaces()}
                        disabled={isLoadingWorkspaces || isSwitchingWorkspace}
                        className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      >
                        Refresh
                      </button>
                    </div>

                    <div className="mt-3">
                      <label htmlFor="settings-active-workspace" className="mb-2 block text-sm font-medium text-gray-700">Switch workspace</label>
                      <select
                        id="settings-active-workspace"
                        value={activeWorkspaceId ?? ''}
                        onChange={(e) => void handleSwitchWorkspace(e.target.value)}
                        disabled={isLoadingWorkspaces || isSwitchingWorkspace || workspaces.length === 0}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100 disabled:opacity-60"
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

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="settings-week-start" className="block text-sm font-medium text-gray-700 mb-2">Week starts on</label>
                      <select
                        id="settings-week-start"
                        value={preferences.weekStartsOn}
                        onChange={(e) => setPreferences((prev) => ({ ...prev, weekStartsOn: e.target.value as 'sunday' | 'monday' }))}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
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
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
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
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
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
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
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
                    <p className="mt-1 text-xs text-gray-600">Preferences are saved locally for now.</p>
                  </div>
                  <button
                    onClick={() => void handleSavePrefs()}
                    disabled={!hasLoadedPrefs || isSavingPrefs}
                    className="h-9 rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
                  >
                    {isSavingPrefs ? 'Saving...' : 'Save preferences'}
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
