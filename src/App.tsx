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
} from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { SkeletonProjectCard, SkeletonNoteCard, SkeletonTaskItem } from './components/Common/Skeleton'
import { useSearch } from './context/SearchContext'
import { QuickCaptureWindow } from './components/Common/QuickCaptureWindow'

type PostAuthStage = 'idle' | 'loading' | 'onboarding' | 'ready'
type ModuleKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings' | 'quick-task' | 'quick-note' | 'quick-event' | null

const windowParams = new URLSearchParams(window.location.search)
const isModuleWindow = windowParams.get('window') === 'module'
const moduleKind = (windowParams.get('module') as ModuleKind) ?? null
const moduleFocusContext = windowParams.get('focusContext')?.trim() ?? ''
const moduleFocusTaskId = windowParams.get('focusTaskId')?.trim() ?? ''
const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties & { WebkitAppRegion: 'drag' }
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties & { WebkitAppRegion: 'no-drag' }
function AuthStatusScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900" style={dragRegionStyle}>
      <div className="absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" />
      <button
        type="button"
        onClick={() => {
          void window.desktopWindow?.quitApp()
        }}
        aria-label="Close"
        className="absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900"
        style={noDragRegionStyle}
      >
        <X size={16} />
      </button>
      <div className="relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8" style={noDragRegionStyle}>
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
function DashboardContent({ initialFocusTaskId }: { initialFocusTaskId?: string }) {
  const { user } = useAuthContext()
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const { setState } = useSidebar()
  const todayTasksRef = useRef<HTMLElement | null>(null)
  const followUpsRef = useRef<HTMLElement | null>(null)

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
  const [projects, setProjects] = useState<Array<{ id: string; name: string; status: string; completeness: number; end_date?: string | null }>>([])
  const [upcoming, setUpcoming] = useState<Array<{ id: string; title: string; start_at: string; end_at: string; color?: string }>>([])
  const [notes, setNotes] = useState<Array<{ id: string; title: string; content: string; updated_at: string }>>([])
  const [followUpTasks, setFollowUpTasks] = useState<
    Array<{ id: string; title: string; status?: string | null; description?: string | null; notes?: string | null; updated_at?: string; eventId?: string | null; eventTitle?: string | null }>
  >([])
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(initialFocusTaskId ?? null)
  const [newFocusText, setNewFocusText] = useState('')
  const [isSavingFocus, setIsSavingFocus] = useState(false)
  const [focusActionId, setFocusActionId] = useState<string | null>(null)
  const [expandedTimelineIds, setExpandedTimelineIds] = useState<Set<string>>(new Set())
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set())
  const [dashboardContextMenu, setDashboardContextMenu] = useState<
    | { x: number; y: number; type: 'followup'; taskId: string }
    | { x: number; y: number; type: 'timeline'; eventId: string }
    | { x: number; y: number; type: 'project'; projectId: string }
    | { x: number; y: number; type: 'note'; noteId: string }
    | { x: number; y: number; type: 'checkin' }
    | null
  >(null)
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
      setFollowUpTasks([])
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

        const [dailyData, projectData, upcomingData, noteData, taskData] = await Promise.all([
          api.getDailyAccountability(),
          api.getProjects(),
          api.getUpcomingEvents(),
          api.getNotes(),
          api.getTasks(),
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
        const rawTasks = Array.isArray(taskData)
          ? (taskData as Array<{ id: string; title: string; status?: string | null; description?: string | null; notes?: string | null; updated_at?: string }>)
          : []
        const calendarFollowUps = rawTasks
          .filter((task) => String(task.description ?? '').startsWith('calendar_followup:'))
          .map((task) => {
            const marker = String(task.description ?? '')
            const eventId = marker.startsWith('calendar_followup:') ? marker.slice('calendar_followup:'.length).trim() : ''
            const noteText = String(task.notes ?? '')
            const eventTitle = noteText.startsWith('Follow-up from calendar: ')
              ? noteText.slice('Follow-up from calendar: '.length).trim()
              : ''
            return {
              ...task,
              eventId: eventId || null,
              eventTitle: eventTitle || null,
            }
          })
          .sort(
            (left, right) =>
              new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime()
          )
          .slice(0, 8)
        setFollowUpTasks(calendarFollowUps)
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
            setFollowUpTasks([])
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

  useEffect(() => {
    const handleCheckinUpdated = (
      _event: unknown,
      payload: { finished?: string; blocked?: string; firstTaskTomorrow?: string }
    ) => {
      if (!payload) return
      setDaily((prev) => ({
        ...prev,
        finished: typeof payload.finished === 'string' ? payload.finished : prev.finished,
        blocked: typeof payload.blocked === 'string' ? payload.blocked : prev.blocked,
        firstTaskTomorrow:
          typeof payload.firstTaskTomorrow === 'string'
            ? payload.firstTaskTomorrow
            : prev.firstTaskTomorrow,
      }))
    }

    window.ipcRenderer?.on('daily:checkin-updated', handleCheckinUpdated)
    return () => {
      window.ipcRenderer?.off('daily:checkin-updated', handleCheckinUpdated)
    }
  }, [])

  useEffect(() => {
    if (!initialFocusTaskId) return
    setFocusedTaskId(initialFocusTaskId)
  }, [initialFocusTaskId])

  useEffect(() => {
    const onFocusTask = (_event: unknown, payload: { kind?: string; focusTaskId?: string | null }) => {
      if (payload?.kind !== 'dashboard' || !payload.focusTaskId) return
      setFocusedTaskId(payload.focusTaskId)
      window.setTimeout(() => {
        followUpsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 30)
    }

    window.ipcRenderer?.on('module:focus-task', onFocusTask)
    return () => {
      window.ipcRenderer?.off('module:focus-task', onFocusTask)
    }
  }, [])

  useEffect(() => {
    if (!dashboardContextMenu) return
    const close = () => setDashboardContextMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dashboardContextMenu])

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

  const focusSummary = daily.focusItems.length ? `${completedFocus}/${daily.focusItems.length} focus` : '0 focus'
  const summaryText = `${focusSummary} · ${upcoming.length} upcoming · ${recentNotes.length} recent notes · ${activeProjects} active projects`

  const openModule = (kind: 'calendar' | 'notes' | 'projects') => {
    void window.desktopWindow?.toggleModule(kind)
  }

  const openContextMenu = (
    event: { preventDefault: () => void; clientX: number; clientY: number },
    menu:
      | { type: 'followup'; taskId: string }
      | { type: 'timeline'; eventId: string }
      | { type: 'project'; projectId: string }
      | { type: 'note'; noteId: string }
      | { type: 'checkin' }
  ) => {
    event.preventDefault()
    setDashboardContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...menu,
    })
  }

  const clearCheckin = async () => {
    const previous = daily
    setDaily((current) => ({
      ...current,
      finished: '',
      blocked: '',
      firstTaskTomorrow: '',
    }))
    setDashboardContextMenu(null)
    try {
      await saveDailyAccountability({
        finished: '',
        blocked: '',
        firstTaskTomorrow: '',
      })
    } catch {
      setDaily(previous)
    }
  }

  const markFollowUpDone = async (taskId: string) => {
    const target = followUpTasks.find((task) => task.id === taskId)
    if (!target) return
    const nextStatus = target.status === 'done' ? 'todo' : 'done'
    setFollowUpTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, status: nextStatus } : task)))
    setDashboardContextMenu(null)
    try {
      await api.updateTask(taskId, { status: nextStatus })
    } catch {
      setFollowUpTasks((prev) => prev.map((task) => (task.id === taskId ? target : task)))
    }
  }

  const deleteFollowUp = async (taskId: string) => {
    const previous = followUpTasks
    setFollowUpTasks((prev) => prev.filter((task) => task.id !== taskId))
    setDashboardContextMenu(null)
    try {
      await api.deleteTask(taskId)
    } catch {
      setFollowUpTasks(previous)
    }
  }

  const openFollowUpEvent = (taskId: string) => {
    const target = followUpTasks.find((task) => task.id === taskId)
    if (!target) return
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
    )
    setDashboardContextMenu(null)
  }

  const updateProjectStatus = async (projectId: string, status: 'not_started' | 'in_progress' | 'paused' | 'completed') => {
    const previous = projects
    setProjects((prev) => prev.map((project) => (project.id === projectId ? { ...project, status } : project)))
    setDashboardContextMenu(null)
    try {
      await api.updateProject(projectId, { status })
    } catch {
      setProjects(previous)
    }
  }

  const deleteDashboardProject = async (projectId: string) => {
    const previous = projects
    setProjects((prev) => prev.filter((project) => project.id !== projectId))
    setDashboardContextMenu(null)
    try {
      await api.deleteProject(projectId)
    } catch {
      setProjects(previous)
    }
  }

  const deleteDashboardNote = async (noteId: string) => {
    const previous = notes
    setNotes((prev) => prev.filter((note) => note.id !== noteId))
    setDashboardContextMenu(null)
    try {
      await api.deleteNote(noteId)
    } catch {
      setNotes(previous)
    }
  }

  const deleteTimelineEvent = async (eventId: string) => {
    const previous = upcoming
    setUpcoming((prev) => prev.filter((item) => item.id !== eventId))
    setExpandedTimelineIds((prev) => {
      const next = new Set(prev)
      next.delete(eventId)
      return next
    })
    setDashboardContextMenu(null)
    try {
      await api.deleteEvent(eventId)
    } catch {
      setUpcoming(previous)
    }
  }

  const getProjectAttentionScore = (project: { status: string; completeness: number; end_date?: string | null; updated_at?: string | null }) => {
    const status = String(project.status ?? '').toLowerCase()
    const dueDate = project.end_date ? new Date(project.end_date) : null
    const now = Date.now()
    const dueDays = dueDate ? Math.ceil((dueDate.getTime() - now) / (1000 * 60 * 60 * 24)) : null

    let score = 0
    if (status.includes('pause')) score += 4
    if (dueDays !== null && dueDays <= 3) score += 3
    if (dueDays !== null && dueDays < 0) score += 5
    if (project.completeness >= 70 && project.completeness < 100) score += 2
    if (status.includes('progress')) score += 1
    return score
  }

  const attentionProjects = [...projects]
    .sort((a, b) => getProjectAttentionScore(b as any) - getProjectAttentionScore(a as any))
    .slice(0, 4)

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-[#f6f7f9] shadow-[0_24px_80px_rgba(15,23,42,0.08)]" style={{ scrollbarGutter: 'stable' }}>
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
        <div className='mx-auto max-w-7xl space-y-5'>
          <div>
            <div>
              <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Today</p>
              <h2 className='mt-2 text-2xl font-semibold tracking-tight text-gray-950'>Good to see you, {firstName}</h2>
              <p className='mt-1 max-w-2xl text-sm leading-6 text-gray-600'>What needs your attention today?</p>
              <p className='mt-1 text-sm text-gray-500'>{todayLabel}</p>
            </div>
          </div>

          {!isLoadingDashboard && (
            <div className='rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm'>
              <span className='font-medium text-gray-900'>Today</span>
              <span className='ml-2 text-gray-600'>{summaryText}</span>
            </div>
          )}

          {dashboardError && (
            <div className='rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
              {dashboardError}
            </div>
          )}

          <div className='grid gap-6 xl:grid-cols-[2fr_1fr]'>
            <div className='space-y-6'>
              <section ref={todayTasksRef} className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'>
                <div className='flex items-start justify-between gap-4'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Focus</p>
                    <h3 className='mt-1 text-lg font-semibold text-gray-950'>Today&apos;s focus</h3>
                    <p className='mt-1 text-sm text-gray-500'>One to three priorities. Keep it narrow.</p>
                  </div>
                  <span className='rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600'>
                    {completedFocus}/{daily.focusItems.length || 0}
                  </span>
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
                        className='flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-100'
                      />
                      <button
                        onClick={() => void addFocusItem()}
                        disabled={isSavingFocus}
                        className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FF5F40] text-white transition-colors hover:bg-[#ea5336] disabled:opacity-60'
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    <div className='mt-5 space-y-3'>
                      {daily.focusItems.length === 0 ? (
                        <div className='rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4'>
                          <p className='text-sm font-medium text-gray-800'>No focus set yet.</p>
                          <p className='mt-1 text-sm text-gray-500'>Add what would make today feel handled.</p>
                        </div>
                      ) : (
                        daily.focusItems.map((item) => (
                          <div
                            key={item.id}
                            className='flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3'
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

                  </>
                )}
              </section>

              <section
                className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'
                onContextMenu={(event) => openContextMenu(event, { type: 'checkin' })}
              >
                <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Capture</p>
                <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4'>
                  {[
                    { label: 'Task', icon: CheckCircle2, action: () => window.desktopWindow?.toggleModule('quick-task' as any) },
                    { label: 'Note', icon: StickyNote, action: () => window.desktopWindow?.toggleModule('quick-note' as any) },
                    { label: 'Event', icon: CalendarDays, action: () => window.desktopWindow?.toggleModule('quick-event' as any) },
                    {
                      label: 'Project',
                      icon: Folder,
                      action: () =>
                        window.desktopWindow?.toggleModule('projects', {
                          kind: 'projects',
                          focusProjectId: '__new__',
                        }),
                    },
                  ].map(({ label, icon: Icon, action }) => (
                    <button
                      key={label}
                      onClick={() => void action()}
                      className='flex h-20 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 transition hover:border-gray-300 hover:bg-white'
                    >
                      <Icon size={16} className='text-gray-500' />
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Review</p>
                    <h3 className='mt-1 text-lg font-semibold text-gray-950'>Daily check-in</h3>
                  </div>
                  <button
                    onClick={() => {
                      void window.desktopWindow?.openCheckin()
                      setState('expanded')
                    }}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open check-in
                  </button>
                </div>
                <div className='mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-gray-50'>
                  {[
                    { label: 'Finished', value: daily.finished || 'Nothing yet' },
                    { label: 'Blocked', value: daily.blocked || 'No blockers' },
                    { label: 'First task tomorrow', value: daily.firstTaskTomorrow || 'Not set yet' },
                  ].map((item) => (
                    <div key={item.label} className='flex items-start justify-between gap-4 px-4 py-3'>
                      <p className='shrink-0 text-sm text-gray-500'>{item.label}</p>
                      <p className='text-right text-sm font-medium leading-6 text-gray-900'>{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Recent</p>
                    <h3 className='mt-1 text-lg font-semibold text-gray-950'>Notes</h3>
                  </div>
                  <button
                    onClick={() => openModule('notes')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open notes
                  </button>
                </div>

                <div className='mt-4 divide-y divide-gray-100'>
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
                        onContextMenu={(event) => openContextMenu(event, { type: 'note', noteId: note.id })}
                        onClick={() => openModule('notes')}
                        className='w-full rounded-lg px-2 py-3 text-left transition hover:bg-gray-50'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <p className='text-sm font-medium text-gray-900 truncate'>{note.title}</p>
                            <p className='mt-1 line-clamp-2 text-sm text-gray-600'>
                              {htmlToPlainText(note.content) || 'No content yet'}
                            </p>
                            {expandedNoteIds.has(note.id) && (
                              <p className='mt-2 text-sm text-gray-700 whitespace-pre-wrap wrap-break-word'>
                                {htmlToPlainText(note.content) || 'No content yet'}
                              </p>
                            )}
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
              <section ref={followUpsRef} className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Follow-ups</p>
                    <h3 className='mt-1 text-lg font-semibold text-gray-950'>From Calendar</h3>
                  </div>
                </div>
                <div className='mt-4 space-y-2'>
                  {followUpTasks.length === 0 ? (
                    <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                      <p className='text-sm font-medium text-gray-800'>No follow-up tasks yet.</p>
                      <p className='mt-1 text-sm text-gray-500'>Create one from Calendar event context.</p>
                    </div>
                  ) : (
                    followUpTasks.map((task) => {
                      const isFocused = focusedTaskId === task.id
                      const statusLabel = task.status === 'done' ? 'Done' : 'Todo'
                      return (
                        <button
                          key={task.id}
                          onContextMenu={(event) => openContextMenu(event, { type: 'followup', taskId: task.id })}
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
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            isFocused
                              ? 'border-orange-200 bg-orange-50 ring-1 ring-orange-200'
                              : 'border-gray-200 bg-gray-50 hover:bg-white'
                          }`}
                        >
                          <div className='flex items-center justify-between gap-3'>
                            <p className='min-w-0 truncate text-sm font-medium text-gray-900'>{task.title}</p>
                            <div className='flex items-center gap-2'>
                              <span className='shrink-0 text-xs text-gray-500'>{statusLabel}</span>
                              <button
                                type='button'
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void markFollowUpDone(task.id)
                                }}
                                className='rounded px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-white hover:text-gray-900'
                              >
                                {task.status === 'done' ? 'Undo' : 'Done'}
                              </button>
                            </div>
                          </div>
                          {task.eventTitle && (
                            <p className='mt-1 truncate text-xs text-gray-500'>Event: {task.eventTitle}</p>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </section>

              <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Upcoming</p>
                    <h3 className='mt-1 text-lg font-semibold text-gray-950'>Timeline</h3>
                  </div>
                  <button
                    onClick={() => openModule('calendar')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open calendar
                  </button>
                </div>

                <div className='mt-4 space-y-2'>
                  {isLoadingDashboard ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonNoteCard key={i} />
                    ))
                  ) : upcoming.length === 0 ? (
                    <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                      <p className='text-sm font-medium text-gray-800'>No upcoming events today.</p>
                      <p className='mt-1 text-sm text-gray-500'>Add events or reminders to build your timeline.</p>
                    </div>
                  ) : (
                    upcoming.map((item) => {
                      const start = new Date(item.start_at)
                      const isExpanded = expandedTimelineIds.has(item.id)
                      const timeLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                      const dayLabel = start.toDateString() === new Date().toDateString()
                        ? 'Today'
                        : start.toLocaleDateString([], { month: 'short', day: 'numeric' })
                      return (
                        <button
                          key={item.id}
                          onContextMenu={(event) => openContextMenu(event, { type: 'timeline', eventId: item.id })}
                          onClick={() => openModule('calendar')}
                          className='w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white'
                        >
                          <div className='flex items-center justify-between gap-3'>
                            <p className={`${isExpanded ? '' : 'truncate'} text-sm font-medium text-gray-900`}>{item.title}</p>
                            <p className='shrink-0 text-xs text-gray-500'>{dayLabel}</p>
                          </div>
                          <p className='mt-1 text-xs text-gray-600'>{timeLabel}</p>
                        </button>
                      )
                    })
                  )}
                </div>
              </section>

              <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500'>Projects</p>
                    <h3 className='mt-1 text-lg font-semibold text-gray-950'>Needs attention</h3>
                  </div>
                  <button
                    onClick={() => openModule('projects')}
                    className='rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100'
                  >
                    Open projects
                  </button>
                </div>

                <div className='mt-4 space-y-2'>
                  {isLoadingDashboard ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonProjectCard key={i} />
                    ))
                  ) : attentionProjects.length === 0 ? (
                    <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5'>
                      <p className='text-sm font-medium text-gray-800'>No projects need attention.</p>
                      <p className='mt-1 text-sm text-gray-500'>Your active projects are on track.</p>
                    </div>
                  ) : (
                    attentionProjects.map((project) => {
                      const status = String(project.status).toLowerCase()
                      const label = status.includes('complete')
                        ? 'Completed'
                        : status.includes('progress')
                          ? 'In progress'
                          : status.includes('pause')
                            ? 'Paused'
                            : 'Not started'
                      const due = (project as { end_date?: string | null }).end_date
                      const dueLabel = due
                        ? `Due ${new Date(due).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                        : 'No due date'

                      return (
                        <button
                          key={project.id}
                          onContextMenu={(event) => openContextMenu(event, { type: 'project', projectId: project.id })}
                          onClick={() => openModule('projects')}
                          className='w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white'
                        >
                          <p className='truncate text-sm font-medium text-gray-900'>{project.name}</p>
                          <p className='mt-1 flex items-center gap-2 text-xs text-gray-600'>
                            <Circle size={8} className='fill-current text-[#FF5F40]' />
                            <span>{label}</span>
                            <span>·</span>
                            <span>{Math.max(0, Math.min(100, project.completeness))}%</span>
                          </p>
                          <p className='mt-1 text-xs text-gray-500'>{dueLabel}</p>
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
      {dashboardContextMenu &&
        createPortal(
          <div
            className='fixed z-140 min-w-46.5 rounded-lg border border-gray-200 bg-white py-1 shadow-lg'
            style={{
              left: `${Math.max(8, Math.min(dashboardContextMenu.x, window.innerWidth - 200))}px`,
              top: `${Math.max(8, Math.min(dashboardContextMenu.y, window.innerHeight - 240))}px`,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {dashboardContextMenu.type === 'followup' && (
              <>
                <button onClick={() => openFollowUpEvent(dashboardContextMenu.taskId)} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]'>
                  <CalendarDays size={14} />
                  Jump to event
                </button>
                <button onClick={() => void markFollowUpDone(dashboardContextMenu.taskId)} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'>
                  <CheckCircle2 size={14} />
                  Mark as done
                </button>
                <button onClick={() => void deleteFollowUp(dashboardContextMenu.taskId)} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50'>
                  <Trash2 size={14} />
                  Delete follow-up
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'timeline' && (
              <>
                {expandedTimelineIds.has(dashboardContextMenu.eventId) ? (
                  <button
                    onClick={() => {
                      setExpandedTimelineIds((prev) => {
                        const next = new Set(prev)
                        next.delete(dashboardContextMenu.eventId)
                        return next
                      })
                      setDashboardContextMenu(null)
                    }}
                    className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'
                  >
                    <ChevronUp size={14} />
                    Collapse
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setExpandedTimelineIds((prev) => new Set(prev).add(dashboardContextMenu.eventId))
                      setDashboardContextMenu(null)
                    }}
                    className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'
                  >
                    <ChevronDown size={14} />
                    Expand
                  </button>
                )}
                <button
                  onClick={() => {
                    const event = upcoming.find((item) => item.id === dashboardContextMenu.eventId)
                    if (!event) return
                    void window.desktopWindow?.toggleModule('calendar', { kind: 'calendar', focusContext: `focus-event:${event.id}` })
                    setDashboardContextMenu(null)
                  }}
                  className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]'
                >
                  <CalendarDays size={14} />
                  Open in Calendar
                </button>
                <button onClick={() => void deleteTimelineEvent(dashboardContextMenu.eventId)} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50'>
                  <Trash2 size={14} />
                  Delete Event
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'project' && (
              <>
                <button
                  onClick={() => {
                    void window.desktopWindow?.toggleModule('projects', { kind: 'projects', focusProjectId: dashboardContextMenu.projectId })
                    setDashboardContextMenu(null)
                  }}
                  className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]'
                >
                  <Folder size={14} />
                  Navigate to project
                </button>
                <button onClick={() => void updateProjectStatus(dashboardContextMenu.projectId, 'in_progress')} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'>
                  <MoreHorizontal size={14} />
                  Mark in progress
                </button>
                <button onClick={() => void updateProjectStatus(dashboardContextMenu.projectId, 'paused')} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'>
                  <MoreHorizontal size={14} />
                  Mark paused
                </button>
                <button onClick={() => void updateProjectStatus(dashboardContextMenu.projectId, 'completed')} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'>
                  <CheckCircle2 size={14} />
                  Mark completed
                </button>
                <button onClick={() => void deleteDashboardProject(dashboardContextMenu.projectId)} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50'>
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
                        const next = new Set(prev)
                        next.delete(dashboardContextMenu.noteId)
                        return next
                      })
                      setDashboardContextMenu(null)
                    }}
                    className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'
                  >
                    <ChevronUp size={14} />
                    Collapse
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setExpandedNoteIds((prev) => new Set(prev).add(dashboardContextMenu.noteId))
                      setDashboardContextMenu(null)
                    }}
                    className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'
                  >
                    <ChevronDown size={14} />
                    Expand
                  </button>
                )}
                <button
                  onClick={() => {
                    void window.desktopWindow?.toggleModule('notes', { kind: 'notes', focusNoteId: dashboardContextMenu.noteId })
                    setDashboardContextMenu(null)
                  }}
                  className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#FF5F40] hover:bg-[#fff0eb]'
                >
                  <StickyNote size={14} />
                  Navigate to note
                </button>
                <button onClick={() => void deleteDashboardNote(dashboardContextMenu.noteId)} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50'>
                  <Trash2 size={14} />
                  Delete note
                </button>
              </>
            )}
            {dashboardContextMenu.type === 'checkin' && (
              <button onClick={() => void clearCheckin()} className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50'>
                <Trash2 size={14} />
                Clear check-in
              </button>
            )}
          </div>,
          document.body
        )}
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
    const handleOpenCheckin = () => {
      setIsVisible(true)
      setIsExpanded(true)
      setState('expanded')
    }

    window.ipcRenderer?.on('sidebar:open-checkin', handleOpenCheckin)
    return () => {
      window.ipcRenderer?.off('sidebar:open-checkin', handleOpenCheckin)
    }
  }, [setIsExpanded, setIsVisible, setState])

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
      return <DashboardContent initialFocusTaskId={moduleFocusTaskId || undefined} />
    }

    if (moduleKind === 'settings') {
      return <SettingsWindow />
    }

    if (moduleKind === 'quick-task' || moduleKind === 'quick-note' || moduleKind === 'quick-event') {
      return <QuickCaptureWindow kind={moduleKind} context={moduleFocusContext || undefined} />
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
      <div className='relative flex h-screen items-center justify-center bg-transparent p-3' style={dragRegionStyle}>
        <div className='absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]' />
        <button
          type='button'
          onClick={() => {
            void window.desktopWindow?.quitApp()
          }}
          aria-label='Close'
          className='absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900'
          style={noDragRegionStyle}
        >
          <X size={16} />
        </button>
        <div
          className={`relative z-10 transform transition-all duration-250 ease-out ${
            isAuthExiting ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0'
          }`}
          style={noDragRegionStyle}
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
      <div className='relative min-h-screen overflow-hidden bg-transparent p-3 text-gray-900' style={dragRegionStyle}>
        <div className='absolute inset-3 rounded-[28px] border border-white/60 bg-[#f5f5f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]' />
        <button
          type='button'
          onClick={() => {
            void window.desktopWindow?.quitApp()
          }}
          aria-label='Close'
          className='absolute right-6 top-7 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/60 text-gray-500 transition hover:bg-white/90 hover:text-gray-900'
          style={noDragRegionStyle}
        >
          <X size={16} />
        </button>
        <div className='relative z-10 flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-8' style={noDragRegionStyle}>
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
