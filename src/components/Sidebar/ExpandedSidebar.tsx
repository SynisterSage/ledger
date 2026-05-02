import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  LogOut,
  Plus,
  Settings,
  StickyNote,
  Trash2,
  CircleHelp,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useSidebar } from '../../context/SidebarContext'
import { useApi } from '../../hooks/useApi'
import { SkeletonList } from '../Common/Skeleton'

type FocusItem = {
  id: string
  text: string
  done: boolean
}

type QuickNote = {
  id: string
  title: string
  body: string
  createdAt: string
}
type QuickCaptureMode = 'none' | 'task' | 'note' | 'event'
type ProjectStatus = 'NotStarted' | 'InProgress' | 'Paused' | 'Completed'
type ProjectSemanticStatus = 'not_started' | 'in_progress' | 'paused' | 'completed'

const todayKey = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const ExpandedSidebar = () => {
  const { user, signOut } = useAuthContext()
  const { setState } = useSidebar()
  const api = useApi()
  const fullName = (user?.user_metadata?.full_name as string | undefined)?.trim() ?? ''
  const firstName = fullName ? fullName.split(' ')[0] : (user?.email?.split('@')[0] ?? 'User')

  const [focusItems, setFocusItems] = useState<FocusItem[]>([])
  const [newFocusText, setNewFocusText] = useState('')
  const [checkin, setCheckin] = useState({
    finished: '',
    blocked: '',
    firstTaskTomorrow: '',
  })
  const [checkinSaved, setCheckinSaved] = useState(false)
  const [isCheckinExpanded, setIsCheckinExpanded] = useState(false)
  const [isLoadingDaily, setIsLoadingDaily] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [quickCaptureMode, setQuickCaptureMode] = useState<QuickCaptureMode>('none')
  const [taskDraft, setTaskDraft] = useState('')
  const [taskPriority, setTaskPriority] = useState<'none' | 'high' | 'medium' | 'low'>('none')
  const [taskTag, setTaskTag] = useState('')
  const [taskCaptureSaved, setTaskCaptureSaved] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([])
  const [eventDraft, setEventDraft] = useState('')
  const [eventDate, setEventDate] = useState(todayKey())
  const [eventStartTime, setEventStartTime] = useState('09:00')
  const [eventEndTime, setEventEndTime] = useState('10:00')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const todayBucketRef = useRef(todayKey())
  const [projects, setProjects] = useState<Array<{ id: string; name: string; status: ProjectStatus | string; completeness: number }>>([])
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [projectUpdating, setProjectUpdating] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [upcomingItems, setUpcomingItems] = useState<Array<{ id: string; title: string; type: 'event' | 'task'; dueDate: string; time?: string; rawDate: string }>>([])
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(true)
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ type: 'project' | 'upcoming'; id: string; x: number; y: number } | null>(null)
  const taskCaptureRef = useRef<HTMLInputElement | null>(null)
  const noteCaptureRef = useRef<HTMLTextAreaElement | null>(null)
  const eventCaptureRef = useRef<HTMLInputElement | null>(null)

  const normalizeProjectStatus = (status: string): ProjectSemanticStatus => {
    const value = status.toLowerCase()
    if (value.includes('complete')) return 'completed'
    if (value.includes('pause') || value.includes('archiv')) return 'paused'
    if (value.includes('progress') || value.includes('in_')) return 'in_progress'
    return 'not_started'
  }

  const projectStatusLabels: Record<ProjectSemanticStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    paused: 'Paused',
    completed: 'Completed',
  }

  const projectStatusStyles: Record<ProjectSemanticStatus, string> = {
    not_started: 'text-blue-700 bg-blue-50',
    in_progress: 'text-amber-700 bg-amber-50',
    paused: 'text-gray-700 bg-gray-100',
    completed: 'text-green-700 bg-green-50',
  }

  const projectStatusCandidates: Record<ProjectSemanticStatus, string[]> = {
    not_started: ['NotStarted', 'active', 'not_started'],
    in_progress: ['InProgress', 'in_progress'],
    paused: ['Paused', 'archived', 'paused'],
    completed: ['Completed', 'completed'],
  }

  const updateProjectStatusWithFallback = async (projectId: string, semantic: ProjectSemanticStatus) => {
    const candidates = projectStatusCandidates[semantic]
    let lastError: unknown = null

    for (const candidate of candidates) {
      try {
        await api.updateProject(projectId, { status: candidate })
        return candidate
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Could not update project status.')
  }

  useEffect(() => {
    let cancelled = false

    const loadDaily = async () => {
      if (!user) {
        if (!cancelled) {
          setFocusItems([])
          setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' })
          setCheckinSaved(false)
          setWorkspaceId(null)
          setIsLoadingDaily(false)
        }
        return
      }

      setIsLoadingDaily(true)
      setSaveError(null)

      try {
        const data = await api.getDailyAccountability()

        if (cancelled) return

        const row = data as {
          focus_items?: FocusItem[] | null
          checkin_finished?: string | null
          checkin_blocked?: string | null
          checkin_first_task_tomorrow?: string | null
        } | null

        setFocusItems(Array.isArray(row?.focus_items) ? row!.focus_items : [])
        setCheckin({
          finished: row?.checkin_finished ?? '',
          blocked: row?.checkin_blocked ?? '',
          firstTaskTomorrow: row?.checkin_first_task_tomorrow ?? '',
        })

        setCheckinSaved(
          Boolean(
            (row?.checkin_finished ?? '').trim() ||
              (row?.checkin_blocked ?? '').trim() ||
              (row?.checkin_first_task_tomorrow ?? '').trim()
          )
        )
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load daily accountability:', error)
          setFocusItems([])
          setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' })
          setCheckinSaved(false)
        }
      } finally {
        if (!cancelled) {
          setWorkspaceId(user.id)
          setIsLoadingDaily(false)
        }
      }
    }

    loadDaily()

    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    let cancelled = false

    const loadQuickNotes = async () => {
      if (!user) {
        setQuickNotes([])
        return
      }

      try {
        const data = await api.getNotes()

        if (cancelled) return

        const mapped = ((data ?? []) as Array<{ id: string; title: string; content: string; created_at: string }>).map((row) => ({
          id: row.id,
          title: row.title,
          body: row.content,
          createdAt: row.created_at,
        }))

        setQuickNotes(mapped)
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load notes:', error)
          setQuickNotes([])
        }
      }
    }

    void loadQuickNotes()

    return () => {
      cancelled = true
    }
  }, [user?.id, workspaceId])

  useEffect(() => {
    if (!user) {
      setIsLoadingProjects(false)
      setProjects([])
      return
    }

    if (!workspaceId) {
      return
    }

    let cancelled = false

    const loadProjects = async () => {
      try {
        setIsLoadingProjects(true)
        const data = await api.getProjects()
        if (!cancelled) {
          const projects = (data as Array<{ id: string; name: string; status: string; completeness: number }>)
            .filter((project) => normalizeProjectStatus(project.status) !== 'completed')
            .map((project) => ({
              ...project,
              status: normalizeProjectStatus(project.status),
            }))
          setProjects(projects)
        }
      } catch (error) {
        console.error('Failed to load projects:', error)
      } finally {
        if (!cancelled) setIsLoadingProjects(false)
      }
    }

    void loadProjects()

    const refreshTimer = window.setInterval(() => {
      void loadProjects()
    }, 45_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
    }
  }, [user?.id, workspaceId])

  useEffect(() => {
    if (!user) {
      setIsLoadingUpcoming(false)
      setUpcomingItems([])
      return
    }

    if (!workspaceId) {
      return
    }

    let cancelled = false

    const loadUpcoming = async () => {
      try {
        setIsLoadingUpcoming(true)
        const events = await api.getUpcomingEvents()
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayISO = today.toISOString().slice(0, 10)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowISO = tomorrow.toISOString().slice(0, 10)

        const eventItems = (events || []).map((e: any) => {
          const startDate = new Date(e.start_at)
          const eventDateISO = startDate.toISOString().slice(0, 10)
          let dateDisplay = ''

          if (eventDateISO === todayISO) {
            dateDisplay = 'Today'
          } else if (eventDateISO === tomorrowISO) {
            dateDisplay = 'Tomorrow'
          } else {
            dateDisplay = startDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
          }

          return {
            id: e.id,
            title: e.title,
            type: 'event' as const,
            dueDate: dateDisplay,
            rawDate: eventDateISO,
            time: startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          }
        })

        if (!cancelled) {
          setUpcomingItems(eventItems.slice(0, 5))
        }
      } catch (error) {
        console.error('Failed to load upcoming:', error)
      } finally {
        if (!cancelled) setIsLoadingUpcoming(false)
      }
    }

    void loadUpcoming()

    const refreshTimer = window.setInterval(() => {
      void loadUpcoming()
    }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
    }
  }, [user?.id, workspaceId])

  useEffect(() => {
    if (quickCaptureMode === 'none') return
    const t = window.setTimeout(() => {
      if (quickCaptureMode === 'task') taskCaptureRef.current?.focus()
      if (quickCaptureMode === 'note') noteCaptureRef.current?.focus()
    }, 120)
    return () => window.clearTimeout(t)
  }, [quickCaptureMode])

  useEffect(() => {
    const syncToNextDay = () => {
      const currentDay = todayKey()
      if (todayBucketRef.current === currentDay) return

      todayBucketRef.current = currentDay
      setFocusItems([])
      setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' })
      setCheckinSaved(false)
      setIsLoadingDaily(true)

      void (async () => {
        try {
          const data = await api.getDailyAccountability()
          const row = data as {
            focus_items?: FocusItem[] | null
            checkin_finished?: string | null
            checkin_blocked?: string | null
            checkin_first_task_tomorrow?: string | null
          } | null

          setFocusItems(Array.isArray(row?.focus_items) ? row!.focus_items : [])
          setCheckin({
            finished: row?.checkin_finished ?? '',
            blocked: row?.checkin_blocked ?? '',
            firstTaskTomorrow: row?.checkin_first_task_tomorrow ?? '',
          })
          setCheckinSaved(
            Boolean(
              (row?.checkin_finished ?? '').trim() ||
                (row?.checkin_blocked ?? '').trim() ||
                (row?.checkin_first_task_tomorrow ?? '').trim()
            )
          )
        } catch (error) {
          console.error('Failed to refresh daily accountability on day rollover:', error)
        } finally {
          setIsLoadingDaily(false)
        }
      })()
    }

    syncToNextDay()
    const timer = window.setInterval(syncToNextDay, 60_000)
    return () => window.clearInterval(timer)
  }, [api])

  const saveDaily = async (next: {
    focusItems?: FocusItem[]
    checkin?: { finished: string; blocked: string; firstTaskTomorrow: string }
  }) => {
    if (!user) return false

    const nextFocus = next.focusItems ?? focusItems
    const nextCheckin = next.checkin ?? checkin

    const data = await api.saveDailyAccountability({
      focus_items: nextFocus,
      finished: nextCheckin.finished.trim(),
      blocked: nextCheckin.blocked.trim(),
      first_task_tomorrow: nextCheckin.firstTaskTomorrow.trim(),
    })

    if (!data) {
      setSaveError('Could not save. Try again.')
      return false
    }

    setSaveError(null)
    return true
  }

  const toggleFocusDone = async (id: string) => {
    const next = focusItems.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    setFocusItems(next)
    const saved = await saveDaily({ focusItems: next })
    if (saved) {
      setTaskCaptureSaved(true)
      window.setTimeout(() => setTaskCaptureSaved(false), 1500)
    }
  }

  const addFocusItem = async () => {
    const text = newFocusText.trim()
    if (!text) return

    const next = [...focusItems, { id: `f-${Date.now()}`, text, done: false }]
    setFocusItems(next)
    setNewFocusText('')
    await saveDaily({ focusItems: next })
  }

  const removeFocusItem = async (id: string) => {
    const next = focusItems.filter((item) => item.id !== id)
    setFocusItems(next)
    await saveDaily({ focusItems: next })
  }

  const saveCheckin = async () => {
    const success = await saveDaily({ checkin })
    if (success) setCheckinSaved(true)
  }

  const clearCheckin = async () => {
    const empty = { finished: '', blocked: '', firstTaskTomorrow: '' }
    setCheckin(empty)
    const success = await saveDaily({ checkin: empty })
    if (success) setCheckinSaved(false)
  }

  const saveQuickNote = async () => {
    const text = noteDraft.trim()
    if (!text || !user || !workspaceId) return

    const firstLine = text.split('\n').find((line) => line.trim())?.trim() ?? 'Untitled note'
    const title = firstLine.replace(/^#\s*/, '').slice(0, 72)

    const data = await api.createNote(title, text)

    if (!data) {
      setSaveError('Could not save note.')
      return
    }

    const row = data as { id: string; title: string; content: string; created_at: string }
    const note: QuickNote = {
      id: row.id,
      title: row.title,
      body: row.content,
      createdAt: row.created_at ?? new Date().toISOString(),
    }

    setQuickNotes((prev) => [note, ...prev].slice(0, 24))
    setNoteDraft('')
    setQuickCaptureMode('none')
  }

  const saveQuickTask = async () => {
    const base = taskDraft.trim()
    if (!base) return

    const priorityLabel =
      taskPriority === 'high'
        ? '[High]'
        : taskPriority === 'medium'
          ? '[Medium]'
          : taskPriority === 'low'
            ? '[Low]'
            : ''

    const tagLabel = taskTag.trim() ? `#${taskTag.trim().replace(/^#/, '')}` : ''
    const text = [priorityLabel, tagLabel, base].filter(Boolean).join(' ')
    const next = [...focusItems, { id: `f-${Date.now()}`, text, done: false }]
    setFocusItems(next)
    setTaskDraft('')
    setTaskPriority('none')
    setTaskTag('')
    setQuickCaptureMode('none')
    await saveDaily({ focusItems: next })
  }

  const saveQuickEvent = async () => {
    const title = eventDraft.trim()
    if (!title || !user) return

    // Combine date and time for start/end times
    const startDateTime = new Date(`${eventDate}T${eventStartTime}:00`)
    const endDateTime = new Date(`${eventDate}T${eventEndTime}:00`)

    const data = await api.createEvent({
      title,
      start_at: startDateTime.toISOString(),
      end_at: endDateTime.toISOString(),
      notes: '',
      all_day: false,
      status: 'planned',
    })

    if (!data) {
      setSaveError('Could not save event.')
      return
    }

    setEventDraft('')
    setEventDate(todayKey())
    setEventStartTime('09:00')
    setEventEndTime('10:00')
    setQuickCaptureMode('none')
  }

  const updateProjectStatus = async (projectId: string, newStatus: ProjectStatus) => {
    setProjectUpdating(projectId)
    const semantic = normalizeProjectStatus(newStatus)
    try {
      const resolvedStatus = await updateProjectStatusWithFallback(projectId, semantic)
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status: normalizeProjectStatus(resolvedStatus!) } : p))
      )
    } catch (error) {
      console.error('Project status update error:', error)
      setSaveError('Could not update project status.')
    }
    setProjectUpdating(null)
  }

  const updateProjectCompleteness = async (projectId: string, completeness: number) => {
    completeness = Math.max(0, Math.min(100, completeness))
    try {
      await api.updateProject(projectId, { completeness })
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, completeness } : p))
      )
    } catch (error) {
      setSaveError('Could not update progress.')
    }
  }

  const createProject = async () => {
    const name = newProjectName.trim()
    if (!name || !user || !workspaceId) {
      setSaveError('Missing name, user, or workspace')
      return
    }

    setIsCreatingProject(true)
    try {
      const data = await api.createProject(name)
      const createdProject = {
        ...(data as { id: string; name: string; status: string; completeness: number }),
        status: normalizeProjectStatus((data as { status: string }).status),
      }
      setProjects((prev) => [createdProject, ...prev])
      setNewProjectName('')
    } catch (error) {
      console.error('Project creation error:', error)
      setSaveError(error instanceof Error ? error.message : 'Could not create project.')
    } finally {
      setIsCreatingProject(false)
    }
  }

  const completedCount = focusItems.filter((item) => item.done).length

  const deleteProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId)
      setProjects((prev) => prev.filter((p) => p.id !== projectId))
      setContextMenu(null)
    } catch (error) {
      setSaveError('Could not delete project.')
    }
  }

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) setContextMenu(null)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [contextMenu])

  return (
    <div className="w-80 h-screen bg-white border-r border-gray-200 flex flex-col py-5">
      <div className="px-6 pb-4 border-b border-white/20">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-gray-900">Ledger</h1>
          <button
            onClick={() => setState('minimized')}
            className="p-1 hover:bg-white/30 rounded-lg transition"
            title="Collapse"
          >
            <ChevronLeft size={20} className="text-gray-700" />
          </button>
        </div>

        <div className="bg-white rounded-lg p-3 border border-gray-200 flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{firstName}</p>
            <p className="text-xs text-gray-700 truncate">{user?.email}</p>
          </div>
          <button
            className="p-1.5 hover:bg-gray-100 rounded-md transition text-gray-600 hover:text-gray-900 shrink-0"
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      <div className="px-6 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setState('fullscreen')}
            className="h-9 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Dashboard
          </button>
          <button
            onClick={() => window.desktopWindow?.toggleModule('notes')}
            className="h-9 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <StickyNote size={13} />
            Notes
          </button>
          <button
            onClick={() => window.desktopWindow?.toggleModule('calendar')}
            className="h-9 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <CalendarDays size={13} />
            Calendar
          </button>
        </div>
      </div>

      <div className="px-6 py-6 space-y-5 flex-1 overflow-auto">
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Today's Tasks</h2>
              <div className="relative group">
                <button
                  aria-label="Today tasks help"
                  className="text-gray-400 hover:text-gray-600 transition"
                >
                  <CircleHelp size={12} />
                </button>
                <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 w-48 rounded-md bg-gray-900 text-white text-[10px] leading-4 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
                  Add your tasks for today. Items save to your profile and reset daily.
                </div>
              </div>
            </div>
            <span className="text-[10px] text-gray-500">{completedCount}/{focusItems.length}</span>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={newFocusText}
                onChange={(e) => setNewFocusText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addFocusItem()
                  }
                }}
                placeholder="Add a task for today"
                className="flex-1 h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                disabled={isLoadingDaily}
              />
              <button
                onClick={() => void addFocusItem()}
                className="h-8 w-8 rounded-md bg-gray-900 text-white flex items-center justify-center hover:bg-gray-800 disabled:opacity-60"
                title="Add task"
                disabled={isLoadingDaily}
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-500">Press Enter or + to add</p>
              <p
                className={`text-[11px] text-green-700 transition-opacity duration-200 ${
                  taskCaptureSaved ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {isLoadingDaily ? 'Loading today tasks...' : 'Added to Today'}
              </p>
            </div>

            {focusItems.map((item) => (
              <div key={item.id} className="w-full flex items-start gap-2">
                <button
                  onClick={() => void toggleFocusDone(item.id)}
                  className="flex-1 text-left flex items-start gap-2"
                >
                  <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${item.done ? 'bg-green-500 border-green-500' : 'border-gray-400 bg-white/60'}`}>
                    {item.done && <Check size={11} className="text-white" />}
                  </span>
                  <p className={`text-xs leading-5 ${item.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.text}</p>
                </button>
                <button
                  onClick={() => void removeFocusItem(item.id)}
                  className="mt-0.5 p-1 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-400/20 transition"
                  title="Delete focus item"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Quick Capture</h2>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setQuickCaptureMode((prev) => (prev === 'task' ? 'none' : 'task'))}
              className={`px-2.5 py-2 text-xs font-medium rounded-lg transition flex items-center justify-center gap-1.5 ${
                quickCaptureMode === 'task'
                  ? 'text-gray-900 bg-gray-100 border border-gray-200'
                  : 'text-gray-700 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <Plus size={13} />
              Task
            </button>
            <button
              onClick={() => setQuickCaptureMode((prev) => (prev === 'note' ? 'none' : 'note'))}
              className={`px-2.5 py-2 text-xs font-medium rounded-lg transition flex items-center justify-center gap-1.5 ${
                quickCaptureMode === 'note'
                  ? 'text-gray-900 bg-gray-100 border border-gray-200'
                  : 'text-gray-700 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <StickyNote size={13} />
              Note
            </button>
            <button
              onClick={() => setQuickCaptureMode((prev) => (prev === 'event' ? 'none' : 'event'))}
              className={`px-2.5 py-2 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition flex items-center justify-center gap-1.5 ${
                quickCaptureMode === 'event'
                  ? 'text-gray-900 bg-gray-100 border border-gray-200'
                  : 'text-gray-700 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <CalendarDays size={13} />
              Event
            </button>
          </div>

          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              quickCaptureMode === 'task' ? 'max-h-56 opacity-100 mt-2.5' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="rounded-lg border border-gray-200 bg-white p-2.5">
              <input
                ref={taskCaptureRef}
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void saveQuickTask()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    if (!taskDraft.trim()) setQuickCaptureMode('none')
                  }
                }}
                placeholder="Add a task..."
                className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value as 'none' | 'high' | 'medium' | 'low')}
                  className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                >
                  <option value="none">No priority</option>
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
                <input
                  value={taskTag}
                  onChange={(e) => setTaskTag(e.target.value)}
                  placeholder="Tag (optional)"
                  className="h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-[10px] text-gray-500 leading-4">
                  <p>Press Enter to save quickly</p>
                </div>
                <button
                  onClick={() => void saveQuickTask()}
                  disabled={!taskDraft.trim()}
                  className="px-2 py-1 text-[11px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  Add Task
                </button>
              </div>
            </div>
          </div>

          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              quickCaptureMode === 'note' ? 'max-h-48 opacity-100 mt-2.5' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="rounded-lg border border-gray-200 bg-white p-2.5 translate-y-0">
              <textarea
                ref={noteCaptureRef}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    saveQuickNote()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    if (!noteDraft.trim()) setQuickCaptureMode('none')
                  }
                }}
                placeholder="Write a quick note... (Cmd/Ctrl+Enter to save)"
                className="w-full h-24 resize-none text-xs leading-5 text-gray-800 placeholder:text-gray-400 bg-transparent focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Esc to close</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setNoteDraft('')
                      setQuickCaptureMode('none')
                    }}
                    className="px-2 py-1 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
                  >
                    Clear
                  </button>
                  <button
                    onClick={saveQuickNote}
                    disabled={!noteDraft.trim()}
                    className="px-2 py-1 text-[11px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              quickCaptureMode === 'event' ? 'max-h-80 opacity-100 mt-2.5' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
              <input
                ref={eventCaptureRef}
                value={eventDraft}
                onChange={(e) => setEventDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void saveQuickEvent()
                  }
                }}
                placeholder="Event title"
                className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
              />
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-600 font-medium">Start</label>
                  <input
                    type="time"
                    value={eventStartTime}
                    onChange={(e) => setEventStartTime(e.target.value)}
                    className="h-7 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-600 font-medium">End</label>
                  <input
                    type="time"
                    value={eventEndTime}
                    onChange={(e) => setEventEndTime(e.target.value)}
                    className="h-7 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setEventDraft('')
                    setEventDate(todayKey())
                    setEventStartTime('09:00')
                    setEventEndTime('10:00')
                    setQuickCaptureMode('none')
                  }}
                  className="flex-1 h-7 px-2 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Clear
                </button>
                <button
                  onClick={() => void saveQuickEvent()}
                  disabled={!eventDraft.trim()}
                  className="flex-1 h-7 px-2 text-[11px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </div>
          </div>

          {quickNotes.length > 0 && (
            <div className="mt-2 space-y-1.5 max-h-40 overflow-auto pr-0.5">
              {quickNotes.slice(0, 6).map((note) => (
                <div
                  key={note.id}
                  className="w-full rounded-md border border-gray-200 bg-white hover:bg-gray-50 px-2 py-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => {
                        setNoteDraft(note.body)
                        setQuickCaptureMode('note')
                      }}
                      className="min-w-0 text-left flex-1"
                    >
                      <p className="text-[11px] font-medium text-gray-900 truncate">{note.title}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {new Date(note.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          await api.deleteNote(note.id)
                        } catch (error) {
                          setSaveError('Could not delete note.')
                          return
                        }
                        setQuickNotes((prev) => prev.filter((item) => item.id !== note.id))
                      }}
                      className="mt-0.5 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                      title="Delete note"
                      aria-label="Delete note"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-3.5">
          <button
            onClick={() => setIsCheckinExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5">
              <ClipboardCheck size={14} className="text-gray-700" />
              <p className="text-xs font-semibold text-gray-900">Daily Check-in</p>
            </div>
            <div className="flex items-center gap-2">
              {checkinSaved && <span className="text-[10px] text-green-700 font-medium">Saved</span>}
              {isCheckinExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
            </div>
          </button>

          {!isCheckinExpanded && (
            <p className="mt-2 text-[11px] text-gray-500">
              {checkinSaved ? 'Saved for today. Click to edit.' : 'Click to add your daily check-in.'}
            </p>
          )}

          {isCheckinExpanded && (
            <>
              <div className="mt-2.5 space-y-2">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    Finished
                  </label>
                  <input
                    value={checkin.finished}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, finished: e.target.value }))
                      setCheckinSaved(false)
                    }}
                    placeholder="What did you finish?"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                    disabled={isLoadingDaily}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    Blocked
                  </label>
                  <input
                    value={checkin.blocked}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, blocked: e.target.value }))
                      setCheckinSaved(false)
                    }}
                    placeholder="What blocked you?"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                    disabled={isLoadingDaily}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    First Task Tomorrow
                  </label>
                  <input
                    value={checkin.firstTaskTomorrow}
                    onChange={(e) => {
                      setCheckin((prev) => ({ ...prev, firstTaskTomorrow: e.target.value }))
                      setCheckinSaved(false)
                    }}
                    placeholder="What's first tomorrow?"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                    disabled={isLoadingDaily}
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => void clearCheckin()}
                  className="h-8 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition disabled:opacity-60"
                  disabled={
                    isLoadingDaily ||
                    (!checkinSaved &&
                      !checkin.finished.trim() &&
                      !checkin.blocked.trim() &&
                      !checkin.firstTaskTomorrow.trim())
                  }
                >
                  Clear
                </button>
                <button
                  onClick={() => void saveCheckin()}
                  className="h-8 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-md transition disabled:opacity-60"
                  disabled={isLoadingDaily}
                >
                  Save Check-in
                </button>
              </div>
            </>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Project Pulse</h2>
            <button
              onClick={() => setIsCreatingProject(!isCreatingProject)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50"
            >
              {isCreatingProject ? 'Cancel' : '+ New'}
            </button>
          </div>

          {isCreatingProject && (
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-2 space-y-2">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createProject()
                  }
                }}
                placeholder="Project name"
                className="w-full h-8 px-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:border-gray-500 bg-gray-50 text-gray-900 placeholder-gray-500"
                autoFocus
              />
              <button
                onClick={() => void createProject()}
                disabled={!newProjectName.trim()}
                className="w-full h-7 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                Create Project
              </button>
            </div>
          )}

          <div className="space-y-2">
            {isLoadingProjects ? (
              <SkeletonList count={2} />
            ) : projects.length === 0 ? (
              <p className="text-xs text-gray-500">No active projects</p>
            ) : (
              projects.map((project) => {
                const isExpanded = expandedProjectId === project.id
                const statusKey = normalizeProjectStatus(String(project.status))
                const statusLabel = projectStatusLabels[statusKey]
                const statusColor = projectStatusStyles[statusKey]

                const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const percent = Math.round(((e.clientX - rect.left) / rect.width) * 100)
                  void updateProjectCompleteness(project.id, percent)
                }

                return (
                  <div
                    key={project.id}
                    className="bg-white rounded-lg border border-gray-200"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ type: 'project', id: project.id, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <button
                      onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
                      className="w-full text-left p-3 flex items-start justify-between hover:bg-gray-50 transition"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">{project.name}</p>
                        <div
                          onClick={(e) => {
                            e.stopPropagation()
                            handleProgressClick(e)
                          }}
                          className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden cursor-pointer hover:bg-gray-300 transition"
                        >
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${project.completeness}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-gray-600">{project.completeness}% complete</p>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform shrink-0 ml-2 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-gray-50 p-3 space-y-2">
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-gray-600">Project Status</label>
                          <div className="mt-1.5 flex gap-1 flex-wrap">
                            {(['NotStarted', 'InProgress', 'Paused', 'Completed'] as ProjectStatus[]).map((status) => (
                              <button
                                key={status}
                                onClick={() => updateProjectStatus(project.id, status)}
                                disabled={projectUpdating === project.id}
                                className={`text-[10px] font-medium px-2 py-1 rounded transition ${
                                  normalizeProjectStatus(String(project.status)) === normalizeProjectStatus(status)
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300'
                                }`}
                              >
                                {projectStatusLabels[normalizeProjectStatus(status)]}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Upcoming</h2>
          <div className="space-y-2">
            {isLoadingUpcoming ? (
              <SkeletonList count={2} />
            ) : upcomingItems.length === 0 ? (
              <p className="text-xs text-gray-500">No upcoming events</p>
            ) : (
              upcomingItems.map((item) => {
                const isExpanded = expandedUpcomingId === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setExpandedUpcomingId(isExpanded ? null : item.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ type: 'upcoming', id: item.id, x: e.clientX, y: e.clientY })
                    }}
                    className="w-full text-left bg-white rounded-lg p-2.5 border border-gray-200 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">
                        {item.type === 'event' ? (
                          <CalendarDays size={12} className="text-blue-600" />
                        ) : (
                          <CheckCircle2 size={12} className="text-green-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium text-gray-900 ${isExpanded ? '' : 'truncate'}`}>
                          {item.title}
                        </p>
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          {item.dueDate}
                          {item.time && ` · ${item.time}`}
                        </p>
                      </div>
                      <div className="shrink-0 mt-0.5">
                        {isExpanded ? (
                          <ChevronUp size={12} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={12} className="text-gray-400" />
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </section>

        {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-max"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'project' && (
            <>
              <button
                onClick={() => {
                  const project = projects.find((p) => p.id === contextMenu.id)
                  if (project) {
                    setExpandedProjectId(contextMenu.id)
                    setContextMenu(null)
                  }
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
              >
                <ChevronDown size={14} />
                Expand
              </button>
              <button
                onClick={() => {
                  void deleteProject(contextMenu.id)
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </>
          )}

          {contextMenu.type === 'upcoming' && (
            <>
              <button
                onClick={() => {
                  setExpandedUpcomingId(contextMenu.id)
                  setContextMenu(null)
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
              >
                <ChevronDown size={14} />
                Expand
              </button>
              <button
                onClick={() => {
                  const event = upcomingItems.find((e) => e.id === contextMenu.id)
                  if (event) {
                    setState('expanded')
                    void window.desktopWindow?.toggleModule('calendar', event.rawDate)
                    setContextMenu(null)
                  }
                }}
                className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 transition flex items-center gap-2"
              >
                <CalendarDays size={14} />
                Open in Calendar
              </button>
            </>
          )}
        </div>
      )}

      <div className="px-6 space-y-3 border-t border-white/20 pt-4">
        <button
          onClick={() => setState('fullscreen')}
          className="w-full px-3 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition"
        >
          Open Dashboard
        </button>
        <button
          onClick={signOut}
          className="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition flex items-center justify-center gap-2"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default ExpandedSidebar
