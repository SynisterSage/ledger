import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Folder,
  Loader2,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuthContext } from './context/AuthContext'
import { useWorkspaceContext } from './context/WorkspaceContext'
import { useWorkspaceInit } from './hooks/useWorkspaceInit'
import { useApi } from './hooks/useApi'
import { useSidebar } from './context/SidebarContext'
import { MainLayout } from './components/Common/MainLayout'
import { ModuleWindowHeader } from './components/Common/ModuleWindowHeader'
import LoginForm from './components/Common/LoginForm'
import CalendarWindow from './components/Calendar/CalendarWindow'
import NotesWindow from './components/Notes/NotesWindow'
import ProjectsWindow from './components/Projects/ProjectsWindow'
import SettingsWindow from './components/Settings/SettingsWindow'
import { SearchModal } from './components/Search/SearchModal'
import { SearchProvider } from './context/SearchContext'
import { SkeletonStatCards, SkeletonProjectCard, SkeletonNoteCard, SkeletonTaskItem } from './components/Common/Skeleton'
import { useSearch } from './context/SearchContext'
import { QuickCaptureWindow } from './components/Common/QuickCaptureWindow'

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'ready'
type ModuleKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings' | 'quick-task' | 'quick-note' | 'quick-event' | null

const windowParams = new URLSearchParams(window.location.search)
const isModuleWindow = windowParams.get('window') === 'module'
const moduleKind = (windowParams.get('module') as ModuleKind) ?? null
function AuthStatusScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900">
      <div className="absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
      <button
        type="button"
        onClick={() => {
          void window.desktopWindow?.quitApp()
        }}
        aria-label="Close"
        className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900"
      >
        <X size={16} />
      </button>
      <div className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8">
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
  )
}

const htmlToPlainText = (value: string) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Dashboard content component
function DashboardContent() {
  const { user } = useAuthContext()
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const { setState } = useSidebar()
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
  const hasLoadedDashboardRef = useRef(false)

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
    if (!user || !activeWorkspaceId) {
      hasLoadedDashboardRef.current = false
      setIsLoadingDashboard(false)
      setDashboardError(null)
      setDaily({
        focusItems: [],
        finished: '',
        blocked: '',
        firstTaskTomorrow: '',
      })
      setProjects([])
      setUpcoming([])
      setNotes([])
      return
    }

    let cancelled = false

    const loadDashboard = async () => {
      const isInitialLoad = !hasLoadedDashboardRef.current

      try {
        if (isInitialLoad) {
          setIsLoadingDashboard(true)
          setDashboardError(null)
        }

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

        const normalizedNotes = Array.isArray(noteData)
          ? (noteData as Array<{ id: string; title: string; content: string; updated_at: string }>)
          : Array.isArray((noteData as { notes?: Array<{ id: string; title: string; content: string; updated_at: string }> } | null)?.notes)
            ? ((noteData as { notes: Array<{ id: string; title: string; content: string; updated_at: string }> }).notes)
            : []

        setProjects(((projectData ?? []) as Array<{ id: string; name: string; status: string; completeness: number }>).slice(0, 4))
        setUpcoming(((upcomingData ?? []) as Array<{ id: string; title: string; start_at: string; end_at: string; color?: string }>).slice(0, 4))
        setNotes(normalizedNotes.slice(0, 4))
        hasLoadedDashboardRef.current = true
      } catch (error) {
        if (!cancelled) {
          if (isInitialLoad) {
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
          } else {
            console.error('Background dashboard refresh failed:', error)
          }
        }
      } finally {
        if (!cancelled && isInitialLoad) setIsLoadingDashboard(false)
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
  }, [activeWorkspaceId, api, user])

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
    <div className="flex h-screen flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(245,247,251,1)_45%)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]" style={{ scrollbarGutter: 'stable' }}>
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
        closeLabel="Close dashboard"
        minimizeLabel="Minimize dashboard"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('dashboard')
        }}
        fullscreenLabel="Fullscreen dashboard"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('dashboard')
        }}
        onClose={() => {
          void window.desktopWindow?.closeModule('dashboard')
        }}
        actions={
          <>
            <button
              onClick={() => window.desktopWindow?.toggleModule('calendar')}
              className='px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
            >
              <CalendarDays size={15} />
              Calendar
            </button>
            <button
              onClick={() => window.desktopWindow?.toggleModule('projects')}
              className='px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
            >
              <Folder size={15} />
              Projects
            </button>
            <button
              onClick={() => window.desktopWindow?.toggleModule('notes')}
              className='px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium'
            >
              <StickyNote size={15} />
              Notes
            </button>
          </>
        }
      />

      <div className='flex-1 min-h-0 overflow-auto p-8' style={{ scrollbarGutter: 'stable' }}>
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

          {isLoadingDashboard ? (
            <SkeletonStatCards count={4} />
          ) : (
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
          )}

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
                  <div className='mt-5 space-y-3'>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonTaskItem key={i} />
                    ))}
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
                    Array.from({ length: 2 }).map((_, i) => (
                      <SkeletonNoteCard key={i} />
                    ))
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
                              {htmlToPlainText(note.content) || 'No content yet'}
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
                    Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonProjectCard key={i} />
                    ))
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
                    Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonNoteCard key={i} />
                    ))
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
function AppShell() {
  const { user, isLoading, error: authError } = useAuthContext()
  const { activeWorkspace, activeWorkspaceId, refreshWorkspaces } = useWorkspaceContext()
  const api = useApi()
  const { state, setState, isExpanded, setIsExpanded, isVisible, setIsVisible, sidebarPreferences, collapseSidebar, collapseToRail } = useSidebar()
  const { openSearch } = useSearch()
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
  const [onboardingWorkspaceName, setOnboardingWorkspaceName] = useState('')
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const handledInviteTokenRef = useRef<string | null>(null)
  const postAuthBootstrapUserRef = useRef<string | null>(null)
  const ensuredVisibleOnBootRef = useRef(false)
  
  // Initialize workspace for authenticated users
  useWorkspaceInit()
  const effectiveUiMode: 'auth' | 'app' = user ? 'app' : uiMode

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'k') return

      event.preventDefault()
      if (!user || isLoading) return

      if (state !== 'expanded') {
        setState('expanded')
        window.setTimeout(() => {
          openSearch()
        }, 220)
        return
      }

      openSearch()
    }

    window.addEventListener('keydown', handleSearchShortcut)
    return () => window.removeEventListener('keydown', handleSearchShortcut)
  }, [isLoading, openSearch, setState, state, user])

  useEffect(() => {
    const handleSidebarExpandShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (!event.shiftKey) return
      if (event.key.toLowerCase() !== 'e') return

      event.preventDefault()
      if (!user || isLoading || !isVisible) return

      if (state === 'expanded') {
        collapseToRail()
        return
      }

      setState('expanded')
      setIsExpanded(true)
    }

    const handleSidebarCollapseShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (!event.shiftKey) return
      if (event.key.toLowerCase() !== 'c') return

      event.preventDefault()
      if (!user || isLoading || !isVisible) return

      if (state === 'expanded') {
        collapseToRail()
        return
      }

      if (!isExpanded) {
        setIsExpanded(true)
      } else {
        collapseSidebar()
      }
    }

    window.addEventListener('keydown', handleSidebarExpandShortcut)
    window.addEventListener('keydown', handleSidebarCollapseShortcut)
    return () => {
      window.removeEventListener('keydown', handleSidebarExpandShortcut)
      window.removeEventListener('keydown', handleSidebarCollapseShortcut)
    }
  }, [isExpanded, isLoading, isVisible, setIsExpanded, setState, state, user])

  useEffect(() => {
    const handleModuleNavigation = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.shiftKey) return
      if (!user || isLoading) return

      const key = event.key.toLowerCase()
      
      // Module navigation: Cmd+1 to Cmd+5
      if (key === '1') {
        event.preventDefault()
        void window.desktopWindow?.toggleModule('dashboard')
        return
      }
      
      if (key === '2') {
        event.preventDefault()
        void window.desktopWindow?.toggleModule('calendar')
        return
      }
      
      if (key === '3') {
        event.preventDefault()
        void window.desktopWindow?.toggleModule('notes')
        return
      }
      
      if (key === '4') {
        event.preventDefault()
        void window.desktopWindow?.toggleModule('projects')
        return
      }
      
      if (key === '5') {
        event.preventDefault()
        void window.desktopWindow?.toggleModule('settings')
        return
      }
    }

    window.addEventListener('keydown', handleModuleNavigation)
    return () => {
      window.removeEventListener('keydown', handleModuleNavigation)
    }
  }, [isLoading, user])

  useEffect(() => {
    const handleSidebarVisibilityChanged = (_event: unknown, payload: { isVisible?: boolean }) => {
      if (typeof payload?.isVisible !== 'boolean') return
      setIsVisible(payload.isVisible)
    }

    window.ipcRenderer?.on('sidebar:visibility-changed', handleSidebarVisibilityChanged)
    return () => {
      window.ipcRenderer?.off('sidebar:visibility-changed', handleSidebarVisibilityChanged)
    }
  }, [setIsVisible])

  useEffect(() => {
    const handleTouchBarOpenSearch = () => {
      if (!user || isLoading) return

      if (state !== 'expanded') {
        setState('expanded')
        window.setTimeout(() => {
          openSearch()
        }, 220)
        return
      }

      openSearch()
    }

    window.ipcRenderer?.on('touchbar:open-search', handleTouchBarOpenSearch)
    return () => {
      window.ipcRenderer?.off('touchbar:open-search', handleTouchBarOpenSearch)
    }
  }, [isLoading, openSearch, setState, state, user])

  useEffect(() => {
    if (isModuleWindow) return
    if (isLoading) return
    window.desktopWindow?.setVisible(isVisible).catch(() => {
      // No-op outside Electron (browser dev mode)
    })
  }, [isLoading, isVisible])

  useEffect(() => {
    if (isLoading) return
    if (uiMode !== 'auth') return
    if (isVisible) return

    setIsVisible(true)
  }, [isLoading, isVisible, setIsVisible, uiMode])

  useEffect(() => {
    if (isModuleWindow) return
    if (isLoading) return
    if (!user) {
      ensuredVisibleOnBootRef.current = false
      return
    }
    if (effectiveUiMode !== 'app') return
    if (postAuthStage !== 'ready') return
    if (ensuredVisibleOnBootRef.current) return

    ensuredVisibleOnBootRef.current = true
    // Respect explicit hidden preference (e.g. shortcut toggle) instead of
    // forcing the sidebar visible again during post-auth boot sync.
    if (sidebarPreferences.isHidden) return
    if (!isVisible) {
      setIsVisible(true)
    }
  }, [effectiveUiMode, isLoading, isVisible, postAuthStage, setIsVisible, sidebarPreferences.isHidden, user])

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

    if (moduleKind === 'quick-task' || moduleKind === 'quick-note' || moduleKind === 'quick-event') {
      return <QuickCaptureWindow kind={moduleKind} />
    }

    return (
      <div className='flex h-screen items-center justify-center bg-white'>
        <p className='text-sm text-gray-600'>Unknown module</p>
      </div>
    )
  }

  useEffect(() => {
    if (user && uiMode !== 'app') {
      setUiMode('app')
      setIsAuthExiting(false)
      return
    }

    if (!user && !isLoading && uiMode !== 'auth') {
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
    if (postAuthStage !== 'onboarding') return
    if (onboardingWorkspaceName.trim()) return
    const suggested = activeWorkspace?.name?.trim() || 'My Workspace'
    setOnboardingWorkspaceName(suggested)
  }, [activeWorkspace?.name, onboardingWorkspaceName, postAuthStage])

  useEffect(() => {
    const userId = user?.id ?? null

    if (!userId) {
      postAuthBootstrapUserRef.current = null
      return
    }

    if (isLoading || effectiveUiMode !== 'app') return
    if (postAuthBootstrapUserRef.current === userId) return

    let isCancelled = false
    postAuthBootstrapUserRef.current = userId
    setPostAuthStage('loading')

    const loadPostAuthStage = async () => {
      try {
        const data = await api.getOnboardingStatus()

        if (isCancelled) return

        const onboardingCompleted = Boolean((data as { onboarding_completed?: boolean } | null)?.onboarding_completed)
        setPostAuthStage(onboardingCompleted ? 'ready' : 'onboarding')
      } catch (error) {
        if (isCancelled) return
        console.warn('Unexpected onboarding state error:', error)
        setPostAuthStage('ready')
      }
    }

    loadPostAuthStage()

    const fallbackTimer = window.setTimeout(() => {
      if (isCancelled) return
      setPostAuthStage((current) => (current === 'loading' ? 'ready' : current))
    }, 2500)

    return () => {
      isCancelled = true
      window.clearTimeout(fallbackTimer)
    }
  }, [effectiveUiMode, isLoading, user?.id])

  useEffect(() => {
    if (isModuleWindow) return
    if (isLoading) return
    const { opacity: _opacity, ...restPreferences } = sidebarPreferences
    void window.desktopWindow?.applySidebarPreferences(restPreferences).catch(() => {
      // No-op outside Electron (browser dev mode)
    })
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
  ])

  useEffect(() => {
    if (isModuleWindow) return
    if (isLoading) return
    void window.desktopWindow?.applySidebarPreferences({ opacity: sidebarPreferences.opacity }).catch(() => {
      // No-op outside Electron (browser dev mode)
    })
  }, [isLoading, sidebarPreferences.opacity])

  useEffect(() => {
    if (isModuleWindow) return
    if (isLoading) return

    const isCenteredFlow =
      effectiveUiMode === 'auth' ||
      postAuthStage === 'idle' ||
      postAuthStage === 'loading' ||
      postAuthStage === 'onboarding'

    const mode = isCenteredFlow ? 'auth' : state === 'expanded' ? 'expanded' : isExpanded ? 'minimized' : 'compact'
    window.desktopWindow?.setMode(mode).catch(() => {
      // No-op outside Electron (browser dev mode)
    })
  }, [isExpanded, isLoading, state, effectiveUiMode, postAuthStage])

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
  if (!user) {
    return (
      <div className='relative flex h-screen items-center justify-center bg-transparent p-3'>
        <div className='absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]' />
        <button
          type='button'
          onClick={() => {
            void window.desktopWindow?.quitApp()
          }}
          aria-label='Close'
          className='absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900'
        >
          <X size={16} />
        </button>
        <div
          className={`relative z-10 transform transition-all duration-250 ease-out ${
            isAuthExiting ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0'
          }`}
        >
          <LoginForm notice={pendingInviteToken ? 'Sign in to accept your workspace invitation.' : null} />
        </div>
      </div>
    )
  }

  if (postAuthStage === 'idle' || postAuthStage === 'loading') {
    return <AuthStatusScreen title='Preparing your workspace' subtitle='Loading your account and workspace context.' />
  }

  if (postAuthStage === 'onboarding') {
    const workspaceName = onboardingWorkspaceName.trim()
    return (
      <div className='relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900'>
        <div className='absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]' />
        <button
          type='button'
          onClick={() => {
            void window.desktopWindow?.quitApp()
          }}
          aria-label='Close'
          className='absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900'
        >
          <X size={16} />
        </button>
        <div className='relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8'>
          <div className='w-full max-w-97.5'>
            <div className='mb-7 text-center'>
              <img src="./logo-color.svg" alt="Ledger" className="mx-auto mb-4 h-12 w-12" />
              <h2 className='text-[28px] font-semibold leading-tight text-gray-950'>Welcome to Ledger</h2>
              <p className='mt-2 text-sm leading-6 text-gray-500'>Quick setup for your first workspace and team flow.</p>
            </div>
            <div className='mb-7 space-y-3.5'>
              <label className='block text-left'>
                <span className='mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500'>Workspace name</span>
                <input
                  value={onboardingWorkspaceName}
                  onChange={(event) => setOnboardingWorkspaceName(event.target.value)}
                  placeholder='My Workspace'
                  className='h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300'
                />
              </label>
              <div className='flex items-start gap-3'>
                <CheckCircle2 size={18} className='text-green-600 mt-0.5' />
                <p className='text-sm text-gray-700'>You can invite teammates later from dashboard settings.</p>
              </div>
            </div>
            {onboardingError ? (
              <div className='mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>{onboardingError}</div>
            ) : null}
            <button
              disabled={isSavingOnboarding}
              onClick={async () => {
                if (!user || isSavingOnboarding) return
                if (!workspaceName) {
                  setOnboardingError('Workspace name is required.')
                  return
                }
                setIsSavingOnboarding(true)
                setOnboardingError(null)
                try {
                  if (activeWorkspaceId) {
                    await api.updateWorkspace(activeWorkspaceId, { name: workspaceName })
                  }
                  await api.completeOnboarding()
                  await refreshWorkspaces()
                  setPostAuthStage('ready')
                } catch (error) {
                  setOnboardingError(error instanceof Error ? error.message : 'Could not complete onboarding.')
                } finally {
                  setIsSavingOnboarding(false)
                }
              }}
              className='inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5F40] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,64,0.24)] transition-colors hover:bg-[#ea5336] disabled:opacity-60'
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

  // Authenticated view - sidebar shell
  if (postAuthStage !== 'ready') {
    return <AuthStatusScreen title='Preparing your workspace' subtitle='Loading your account and workspace context.' />
  }

  return (
    <>
      {inviteFlowStatus === 'error' && inviteFlowError && (
        <div className='mx-auto mt-4 w-full max-w-3xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
          {inviteFlowError}
        </div>
      )}
      <MainLayout>
        <div className='flex-1 min-w-0 bg-transparent' />
      </MainLayout>
    </>
  )
}

function App() {
  return (
    <SearchProvider>
      <AppShell />
      <SearchModal />
    </SearchProvider>
  )
}

export default App
