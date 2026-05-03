import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Folder,
  Loader2,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useAuthContext } from './context/AuthContext'
import { useWorkspaceContext } from './context/WorkspaceContext'
import { useWorkspaceInit } from './hooks/useWorkspaceInit'
import { useApi } from './hooks/useApi'
import { useSidebar } from './context/SidebarContext'
import { MainLayout } from './components/Common/MainLayout'
import LoginForm from './components/Common/LoginForm'
import CalendarWindow from './components/Calendar/CalendarWindow'
import NotesWindow from './components/Notes/NotesWindow'
import ProjectsWindow from './components/Projects/ProjectsWindow'
import SettingsWindow from './components/Settings/SettingsWindow'
import { SkeletonList } from './components/Common/Skeleton'

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'welcome' | 'ready'
type ModuleKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings' | null

const windowParams = new URLSearchParams(window.location.search)
const isModuleWindow = windowParams.get('window') === 'module'
const moduleKind = (windowParams.get('module') as ModuleKind) ?? null

function AuthStatusScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6f7fb] text-gray-900">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),rgba(246,247,251,1)_45%)]" />
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border border-white/70 bg-white/80 shadow-[0_20px_60px_rgba(17,24,39,0.08)] backdrop-blur-sm">
            <img src="/logo-color.svg" alt="Ledger" className="h-11 w-11" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-gray-600">{subtitle}</p>
          <div className="mt-5 flex items-center gap-2 text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs uppercase tracking-[0.22em]">Loading</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Dashboard content component
function DashboardContent() {
  const { user } = useAuthContext()
  const api = useApi()
  const { state, setState } = useSidebar()
  const todayTasksRef = useRef<HTMLElement | null>(null)
  const notesRef = useRef<HTMLElement | null>(null)
  const projectsRef = useRef<HTMLElement | null>(null)
  const calendarRef = useRef<HTMLElement | null>(null)

  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [daily, setDaily] = useState<{
    focusItems: Array<{ id: string; text: string; done: boolean }>
    finished: string
    blocked: string
    firstTaskTomorrow: string
  }>({
    focusItems: [],
    finished: '',
    blocked: '',
    firstTaskTomorrow: '',
  })
  const [projects, setProjects] = useState<Array<{ id: string; name: string; status: string; completeness: number }>>([])
  const [upcoming, setUpcoming] = useState<Array<{ id: string; title: string; start_at: string; end_at: string; color?: string }>>([])
  const [notes, setNotes] = useState<Array<{ id: string; title: string; content: string; updated_at: string }>>([])
  const [newFocusText, setNewFocusText] = useState('')
  const [isSavingFocus, setIsSavingFocus] = useState(false)
  const [focusActionId, setFocusActionId] = useState<string | null>(null)

  useEffect(() => {
    const handleSidebarStateChanged = (
      _event: unknown,
      payload: { state?: 'minimized' | 'expanded' | 'fullscreen' }
    ) => {
      if (!payload?.state) return
      setState(payload.state)
    }

    window.ipcRenderer?.on('sidebar:state-changed', handleSidebarStateChanged)

    return () => {
      window.ipcRenderer?.off('sidebar:state-changed', handleSidebarStateChanged)
    }
  }, [setState])

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const loadDashboard = async () => {
      try {
        setIsLoadingDashboard(true)
        setDashboardError(null)

        const [dailyData, projectData, upcomingData, noteData] = await Promise.all([
          api.getDailyAccountability(),
          api.getProjects(),
          api.getUpcomingEvents(),
          api.getNotes(),
        ])

        if (cancelled) return

        const row = dailyData as {
          focus_items?: Array<{ id: string; text: string; done: boolean }> | null
          checkin_finished?: string | null
          checkin_blocked?: string | null
          checkin_first_task_tomorrow?: string | null
        } | null

        setDaily({
          focusItems: Array.isArray(row?.focus_items) ? row!.focus_items : [],
          finished: row?.checkin_finished ?? '',
          blocked: row?.checkin_blocked ?? '',
          firstTaskTomorrow: row?.checkin_first_task_tomorrow ?? '',
        })

        setProjects(((projectData ?? []) as Array<{ id: string; name: string; status: string; completeness: number }>).slice(0, 4))
        setUpcoming(((upcomingData ?? []) as Array<{ id: string; title: string; start_at: string; end_at: string; color?: string }>).slice(0, 4))
        setNotes(((noteData ?? []) as Array<{ id: string; title: string; content: string; updated_at: string }>).slice(0, 4))
      } catch (error) {
        if (!cancelled) {
          setDashboardError(error instanceof Error ? error.message : 'Could not load dashboard.')
          setDaily({
            focusItems: [],
            finished: '',
            blocked: '',
            firstTaskTomorrow: '',
          })
          setProjects([])
          setUpcoming([])
          setNotes([])
        }
      } finally {
        if (!cancelled) setIsLoadingDashboard(false)
      }
    }

    void loadDashboard()
    const timer = window.setInterval(() => {
      void loadDashboard()
    }, 60000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, user])

  const saveDailyAccountability = async (next: {
    focusItems?: Array<{ id: string; text: string; done: boolean }>
    finished?: string
    blocked?: string
    firstTaskTomorrow?: string
  }) => {
    const response = await api.saveDailyAccountability({
      focus_items: next.focusItems ?? daily.focusItems,
      finished: (next.finished ?? daily.finished).trim(),
      blocked: (next.blocked ?? daily.blocked).trim(),
      first_task_tomorrow: (next.firstTaskTomorrow ?? daily.firstTaskTomorrow).trim(),
    })

    if (!response) {
      throw new Error('Could not save daily accountability.')
    }

    const row = response as {
      focus_items?: Array<{ id: string; text: string; done: boolean }> | null
      checkin_finished?: string | null
      checkin_blocked?: string | null
      checkin_first_task_tomorrow?: string | null
    }

    setDaily({
      focusItems: Array.isArray(row.focus_items) ? row.focus_items : [],
      finished: row.checkin_finished ?? '',
      blocked: row.checkin_blocked ?? '',
      firstTaskTomorrow: row.checkin_first_task_tomorrow ?? '',
    })
  }

  const addFocusItem = async () => {
    const text = newFocusText.trim()
    if (!text) return

    const next = [...daily.focusItems, { id: `focus-${Date.now()}`, text, done: false }]
    setNewFocusText('')
    setIsSavingFocus(true)
    try {
      await saveDailyAccountability({ focusItems: next })
    } finally {
      setIsSavingFocus(false)
    }
  }

  const toggleFocusDone = async (id: string) => {
    setFocusActionId(id)
    try {
      const next = daily.focusItems.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
      await saveDailyAccountability({ focusItems: next })
    } finally {
      setFocusActionId(null)
    }
  }

  const removeFocusItem = async (id: string) => {
    setFocusActionId(id)
    try {
      const next = daily.focusItems.filter((item) => item.id !== id)
      await saveDailyAccountability({ focusItems: next })
    } finally {
      setFocusActionId(null)
    }
  }

  const completedFocus = daily.focusItems.filter((item) => item.done).length
  const activeProjects = projects.filter((project) => String(project.status).toLowerCase().includes('progress')).length
  const recentNotes = notes
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.trim()?.split(' ')[0] || user?.email?.split('@')[0] || 'User'
  const todayLabel = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const scrollToSection = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openModule = (kind: 'calendar' | 'notes' | 'projects') => {
    void window.desktopWindow?.toggleModule(kind)
  }

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(245,247,251,1)_45%)]">
      <div
        className='h-8 bg-white border-b border-gray-100'
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />
      <div
        className='h-16 border-b border-gray-200 flex items-center justify-between px-8 bg-white'
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div>
          {state === 'fullscreen' && (
            <div className='flex items-center gap-3'>
              <div className='flex h-9 w-9 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm'>
                <img src="/logo-color.svg" alt="Ledger" className="h-5 w-5" />
              </div>
              <h1 className='text-lg font-semibold text-gray-900'>Ledger</h1>
            </div>
          )}
          {state !== 'fullscreen' && (
            <>
              <div className='flex items-center gap-2'>
                <div className='flex h-8 w-8 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm'>
                  <img src="/logo-color.svg" alt="Ledger" className="h-4 w-4" />
                </div>
                <div>
                  <p className='text-xs text-gray-500'>Workspace</p>
                  <h1 className='text-lg font-semibold text-gray-900 mt-0.5'>My Work</h1>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => window.desktopWindow?.toggleModule('calendar')}
            className='px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
          >
            <CalendarDays size={15} />
            Calendar
          </button>
          <button
            onClick={() => window.desktopWindow?.toggleModule('notes')}
            className='px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
          >
            <StickyNote size={15} />
            Notes
          </button>
          <button
            onClick={() => setState('expanded')}
            className='px-4 py-2 bg-[#FF5F40] hover:bg-[#ea5336] text-white rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
          >
            <Plus size={16} />
            Collapse
          </button>
        </div>
      </div>

      <div className='flex-1 overflow-auto p-8'>
        <div className='mx-auto max-w-7xl space-y-8'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <p className='text-xs uppercase tracking-[0.2em] text-gray-500'>Dashboard</p>
              <h2 className='mt-2 text-3xl font-semibold tracking-tight text-gray-900'>Good to see you, {firstName}</h2>
              <p className='mt-2 max-w-2xl text-sm leading-6 text-gray-600'>
                {todayLabel}. What awaits you today?
              </p>
            </div>
          </div>

          {dashboardError && (
            <div className='rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
              {dashboardError}
            </div>
          )}

          <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
            {[
              { label: 'Today focus', value: `${completedFocus}/${daily.focusItems.length}`, note: daily.focusItems.length ? 'From your daily checklist' : 'No items set yet', icon: CheckCircle2, action: () => scrollToSection(todayTasksRef), actionLabel: 'Jump to tasks' },
              { label: 'Active projects', value: String(activeProjects), note: 'Project Tracker items in progress', icon: Folder, action: () => openModule('projects'), actionLabel: 'Open projects' },
              { label: 'Upcoming items', value: String(upcoming.length), note: 'Events from your calendar', icon: CalendarDays, action: () => openModule('calendar'), actionLabel: 'Open calendar' },
              { label: 'Recent notes', value: String(recentNotes.length), note: 'Fresh ideas and captures', icon: StickyNote, action: () => openModule('notes'), actionLabel: 'Open notes' },
            ].map(({ label, value, note, icon: Icon, action, actionLabel }) => (
              <button
                key={label}
                onClick={action}
                className='group rounded-3xl border border-gray-200 bg-white p-5 shadow-sm text-left transition-transform hover:-translate-y-0.5 hover:shadow-md'
              >
                <div className='flex items-center justify-between'>
                  <p className='text-sm font-medium text-gray-600'>{label}</p>
                  <div className='flex items-center gap-2 text-gray-400'>
                    <span className='text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100'>{actionLabel}</span>
                    <Icon size={18} className='text-gray-400' />
                  </div>
                </div>
                <p className='mt-4 text-3xl font-semibold tracking-tight text-gray-900'>{value}</p>
                <p className='mt-1 text-xs text-gray-500'>{note}</p>
              </button>
            ))}
          </div>

          <div className='grid gap-6 xl:grid-cols-[1.25fr_0.75fr]'>
            <div className='space-y-6'>
              <section ref={todayTasksRef} className='rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-gray-500'>Today</p>
                    <h3 className='mt-1 text-xl font-semibold text-gray-900'>Today&apos;s tasks</h3>
                  </div>
                  <button
                    onClick={() => openModule('projects')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open projects
                  </button>
                </div>

                {isLoadingDashboard ? (
                  <div className='mt-5'>
                    <SkeletonList count={3} />
                  </div>
                ) : (
                  <>
                    <div className='mt-5 flex items-center gap-2'>
                      <input
                        value={newFocusText}
                        onChange={(e) => setNewFocusText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void addFocusItem()
                          }
                        }}
                        placeholder='Add a focus task for today'
                        className='flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100'
                      />
                      <button
                        onClick={() => void addFocusItem()}
                        disabled={isSavingFocus}
                        className='inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FF5F40] text-white transition-colors hover:bg-[#ea5336] disabled:opacity-60'
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    <div className='mt-5 space-y-3'>
                      {daily.focusItems.length === 0 ? (
                        <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                          <p className='text-sm font-medium text-gray-800'>No tasks signed for today yet.</p>
                          <p className='mt-1 text-sm text-gray-500'>Add your top priorities here or from the sidebar.</p>
                        </div>
                      ) : (
                        daily.focusItems.map((item) => (
                          <div
                            key={item.id}
                            className='flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3'
                          >
                            <button
                              onClick={() => void toggleFocusDone(item.id)}
                              disabled={focusActionId === item.id}
                              className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border transition ${
                                item.done ? 'border-green-500 bg-green-500' : 'border-gray-300 bg-white'
                              }`}
                            >
                              {item.done && <CheckCircle2 size={12} className='text-white' />}
                            </button>
                            <div className='min-w-0 flex-1'>
                              <p className={`text-sm font-medium ${item.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                {item.text}
                              </p>
                            </div>
                            <button
                              onClick={() => void removeFocusItem(item.id)}
                              className='mt-0.5 rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-600 transition'
                              title='Delete task'
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className='mt-5 grid gap-3 md:grid-cols-3'>
                      {[
                        { label: 'Finished', value: daily.finished || 'Nothing yet' },
                        { label: 'Blocked', value: daily.blocked || 'No blockers' },
                        { label: 'Next task', value: daily.firstTaskTomorrow || 'Not set yet' },
                      ].map((item) => (
                        <div key={item.label} className='rounded-2xl border border-gray-200 bg-white p-4'>
                          <p className='text-[10px] uppercase tracking-wider text-gray-500'>{item.label}</p>
                          <p className='mt-2 text-sm leading-6 text-gray-800'>{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section ref={notesRef} className='rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-gray-500'>Notes</p>
                    <h3 className='mt-1 text-xl font-semibold text-gray-900'>Recent captures</h3>
                  </div>
                  <button
                    onClick={() => openModule('notes')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open notes
                  </button>
                </div>

                <div className='mt-5 grid gap-3'>
                  {isLoadingDashboard ? (
                    <SkeletonList count={2} />
                  ) : recentNotes.length === 0 ? (
                    <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                      <p className='text-sm font-medium text-gray-800'>No notes yet.</p>
                      <p className='mt-1 text-sm text-gray-500'>Capture a thought, meeting note, or plan from the sidebar.</p>
                    </div>
                  ) : (
                    recentNotes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => openModule('notes')}
                        className='rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white hover:shadow-sm'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <p className='text-sm font-medium text-gray-900 truncate'>{note.title}</p>
                            <p className='mt-1 line-clamp-2 text-sm text-gray-600'>
                              {note.content.trim() || 'No content yet'}
                            </p>
                          </div>
                          <p className='shrink-0 text-[11px] text-gray-500'>
                            {new Date(note.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </div>

            <div className='space-y-6'>
              <section ref={projectsRef} className='rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-gray-500'>Projects</p>
                    <h3 className='mt-1 text-xl font-semibold text-gray-900'>Project Tracker</h3>
                  </div>
                  <button
                    onClick={() => openModule('projects')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open
                  </button>
                </div>

                <div className='mt-5 space-y-3'>
                  {isLoadingDashboard ? (
                    <SkeletonList count={3} />
                  ) : projects.length === 0 ? (
                    <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                      <p className='text-sm font-medium text-gray-800'>No projects yet.</p>
                      <p className='mt-1 text-sm text-gray-500'>Create internship, class, or job search projects in the sidebar.</p>
                    </div>
                  ) : (
                    projects.map((project) => {
                      const status = String(project.status).toLowerCase()
                      const label = status.includes('complete')
                        ? 'Completed'
                        : status.includes('progress')
                          ? 'In progress'
                          : status.includes('pause')
                            ? 'Paused'
                            : 'Not started'

                      return (
                        <button
                          key={project.id}
                          onClick={() => openModule('projects')}
                          className='w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left transition hover:bg-white hover:shadow-sm'
                        >
                          <div className='flex items-start justify-between gap-3'>
                            <div className='min-w-0'>
                              <p className='text-sm font-medium text-gray-900 truncate'>{project.name}</p>
                              <p className='mt-1 text-[11px] text-gray-500'>{label}</p>
                            </div>
                            <span className='text-[11px] font-medium text-gray-700'>{project.completeness}%</span>
                          </div>
                          <div className='mt-3 h-2 rounded-full bg-gray-200'>
                            <div
                              className='h-2 rounded-full bg-gray-900'
                              style={{ width: `${Math.max(0, Math.min(100, project.completeness))}%` }}
                            />
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </section>

              <section ref={calendarRef} className='rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-gray-500'>Calendar</p>
                    <h3 className='mt-1 text-xl font-semibold text-gray-900'>Upcoming</h3>
                  </div>
                  <button
                    onClick={() => openModule('calendar')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open
                  </button>
                </div>

                <div className='mt-5 space-y-3'>
                  {isLoadingDashboard ? (
                    <SkeletonList count={3} />
                  ) : upcoming.length === 0 ? (
                    <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                      <p className='text-sm font-medium text-gray-800'>No upcoming items.</p>
                      <p className='mt-1 text-sm text-gray-500'>Add events or reminders to see them here.</p>
                    </div>
                  ) : (
                    upcoming.map((item) => {
                      const time = new Date(item.start_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })

                      return (
                        <button
                          key={item.id}
                          onClick={() => openModule('calendar')}
                          className='w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white hover:shadow-sm'
                        >
                          <p className='text-sm font-medium text-gray-900 truncate'>{item.title}</p>
                          <p className='mt-1 text-[11px] text-gray-500'>{time}</p>
                        </button>
                      )
                    })
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main app component
function App() {
  const { user, isLoading, error: authError } = useAuthContext()
  const { refreshWorkspaces } = useWorkspaceContext()
  const api = useApi()
  const { state, setState } = useSidebar()
  const [uiMode, setUiMode] = useState<'auth' | 'app'>(user ? 'app' : 'auth')
  const [isAuthExiting, setIsAuthExiting] = useState(false)
  const [postAuthStage, setPostAuthStage] = useState<PostAuthStage>('idle')
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false)
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() => {
    const token = new URLSearchParams(window.location.search).get('token')?.trim()
    return token || null
  })
  const [inviteFlowStatus, setInviteFlowStatus] = useState<'idle' | 'awaiting-auth' | 'processing' | 'error'>('idle')
  const [inviteFlowError, setInviteFlowError] = useState<string | null>(null)
  const handledInviteTokenRef = useRef<string | null>(null)
  
  // Initialize workspace for authenticated users
  useWorkspaceInit()

  if (isModuleWindow) {
    if (isLoading) {
      return <AuthStatusScreen title='Loading module' subtitle='Bringing your workspace into view.' />
    }

    if (!user) {
      return <AuthStatusScreen title='Sign in required' subtitle='Please sign in from the Ledger sidebar window first.' />
    }

    if (moduleKind === 'calendar') {
      return <CalendarWindow />
    }

    if (moduleKind === 'notes') {
      return <NotesWindow />
    }

    if (moduleKind === 'projects') {
      return <ProjectsWindow />
    }

    if (moduleKind === 'dashboard') {
      return <DashboardContent />
    }

    if (moduleKind === 'settings') {
      return <SettingsWindow />
    }

    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <p className='text-sm text-gray-600'>Unknown module</p>
      </div>
    )
  }

  useEffect(() => {
    if (isLoading) return

    if (user && uiMode === 'auth') {
      setIsAuthExiting(true)
      const timer = window.setTimeout(() => {
        setUiMode('app')
        setIsAuthExiting(false)
      }, 260)

      return () => window.clearTimeout(timer)
    }

    if (!user && uiMode !== 'auth') {
      setUiMode('auth')
      setIsAuthExiting(false)
      setPostAuthStage('idle')
    }
  }, [user, isLoading, uiMode])

  useEffect(() => {
    if (!pendingInviteToken) {
      setInviteFlowStatus((current) => (current === 'error' ? current : 'idle'))
      return
    }

    if (isLoading) return

    if (!user) {
      setInviteFlowStatus('awaiting-auth')
      return
    }

    if (handledInviteTokenRef.current === pendingInviteToken) {
      return
    }

    handledInviteTokenRef.current = pendingInviteToken

    let cancelled = false

    const acceptInvitation = async () => {
      try {
        setInviteFlowStatus('processing')
        setInviteFlowError(null)

        await api.acceptWorkspaceInvitation(pendingInviteToken)
        await refreshWorkspaces()

        if (cancelled) return
        setInviteFlowStatus('idle')
      } catch (error) {
        if (cancelled) return
        setInviteFlowStatus('error')
        setInviteFlowError(error instanceof Error ? error.message : 'Could not accept invitation.')
      } finally {
        if (cancelled) return

        const params = new URLSearchParams(window.location.search)
        params.delete('token')
        const query = params.toString()
        window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
        setPendingInviteToken(null)
      }
    }

    void acceptInvitation()

    return () => {
      cancelled = true
    }
  }, [pendingInviteToken, isLoading, user, api, refreshWorkspaces])

  useEffect(() => {
    if (isLoading || !user || uiMode !== 'app' || postAuthStage !== 'idle') return

    let isCancelled = false

    const loadPostAuthStage = async () => {
      try {
        setPostAuthStage('loading')

        const data = await api.getOnboardingStatus()

        if (isCancelled) return

        const onboardingCompleted = Boolean((data as { onboarding_completed?: boolean } | null)?.onboarding_completed)
        setPostAuthStage(onboardingCompleted ? 'welcome' : 'onboarding')
      } catch (error) {
        if (isCancelled) return
        console.warn('Unexpected onboarding state error:', error)
        setPostAuthStage('welcome')
      }
    }

    loadPostAuthStage()

    return () => {
      isCancelled = true
    }
  }, [isLoading, user, uiMode, postAuthStage])

  useEffect(() => {
    if (postAuthStage !== 'loading') return

    const timeout = window.setTimeout(() => {
      setPostAuthStage('welcome')
    }, 4000)

    return () => window.clearTimeout(timeout)
  }, [postAuthStage])

  useEffect(() => {
    if (postAuthStage !== 'welcome') return

    const openTimer = window.setTimeout(() => {
      setState('expanded')
    }, 80)

    const closeTimer = window.setTimeout(() => {
      setState('minimized')
      setPostAuthStage('ready')
    }, 680)

    return () => {
      window.clearTimeout(openTimer)
      window.clearTimeout(closeTimer)
    }
  }, [postAuthStage, setState])

  useEffect(() => {
    if (isLoading) return

    const isCenteredFlow =
      uiMode === 'auth' ||
      postAuthStage === 'loading' ||
      postAuthStage === 'onboarding' ||
      postAuthStage === 'welcome'

    const mode = isCenteredFlow ? 'auth' : state
    window.desktopWindow?.setMode(mode).catch(() => {
      // No-op outside Electron (browser dev mode)
    })
  }, [isLoading, state, uiMode, postAuthStage])

  if (isLoading) {
    return <AuthStatusScreen title='Loading' subtitle='Preparing Ledger.' />
  }

  if (authError) {
    return (
      <AuthStatusScreen
        title='Configuration issue'
        subtitle={authError.message}
      />
    )
  }

  if (inviteFlowStatus === 'processing') {
    return <AuthStatusScreen title='Accepting invitation' subtitle='Joining your workspace and syncing access.' />
  }

  // Show login if not authenticated
  if (uiMode === 'auth' && user) {
    return <AuthStatusScreen title='Restoring your session' subtitle='Picking up your workspace state.' />
  }

  if (uiMode === 'auth') {
    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <div
          className={`transform transition-all duration-250 ease-out ${
            isAuthExiting ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0'
          }`}
        >
          <LoginForm notice={pendingInviteToken ? 'Sign in to accept your workspace invitation.' : null} />
        </div>
      </div>
    )
  }

  if (postAuthStage === 'loading') {
    return <AuthStatusScreen title='Preparing your workspace' subtitle='Loading your account and workspace context.' />
  }

  if (postAuthStage === 'onboarding') {
    return (
      <div className='relative min-h-screen overflow-hidden bg-gray-50 px-4 py-6 text-gray-900'>
        <div className='absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(248,250,252,1)_55%)]' />
        <div className='flex min-h-[calc(100vh-3rem)] items-center justify-center px-4'>
          <div className='w-full max-w-md rounded-3xl border border-gray-200 bg-white p-7 shadow-sm'>
            <div className='mb-5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm'>
              <img src="/logo-color.svg" alt="Ledger" className="h-6 w-6" />
            </div>
            <h2 className='text-2xl font-semibold tracking-tight text-gray-900 mb-2'>Welcome to Ledger</h2>
            <p className='text-sm leading-6 text-gray-600 mb-5'>Quick setup for your first workspace and team flow.</p>
            <div className='space-y-3 mb-7'>
              <div className='flex items-start gap-3'>
                <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
                <p className='text-sm text-gray-700'>Your personal workspace is ready.</p>
              </div>
              <div className='flex items-start gap-3'>
                <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
                <p className='text-sm text-gray-700'>Invite teammates later from the dashboard.</p>
              </div>
              <div className='flex items-start gap-3'>
                <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
                <p className='text-sm text-gray-700'>Use the sidebar widget to quickly track tasks and time.</p>
              </div>
            </div>
            <button
              disabled={isSavingOnboarding}
              onClick={async () => {
                if (!user || isSavingOnboarding) return
                setIsSavingOnboarding(true)

                await api.completeOnboarding()

                setIsSavingOnboarding(false)
                setPostAuthStage('welcome')
              }}
              className='w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#ea5336] disabled:opacity-60'
            >
              {isSavingOnboarding ? (
                <>
                  <Loader2 size={18} className='animate-spin' />
                  Saving...
                </>
              ) : (
                <>
                  Continue to Ledger
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (postAuthStage === 'welcome') {
    return <AuthStatusScreen title='Welcome back' subtitle='Opening your sidebar.' />
  }

  // Authenticated view - Dashboard with sidebar
  return (
    <>
      {inviteFlowStatus === 'error' && inviteFlowError && (
        <div className='mx-auto mt-4 w-full max-w-3xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
          {inviteFlowError}
        </div>
      )}
      <MainLayout>
        <DashboardContent />
      </MainLayout>
    </>
  )
}

export default App
