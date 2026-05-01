import {
  AlertCircle,
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
import { supabase } from '../../services/supabase'

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

const todayKey = () => new Date().toISOString().slice(0, 10)

export const ExpandedSidebar = () => {
  const { user, signOut } = useAuthContext()
  const { setState } = useSidebar()
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
  const [projects, setProjects] = useState<Array<{ id: string; name: string; status: string; completeness: number }>>([])
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [projectUpdating, setProjectUpdating] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [upcomingItems, setUpcomingItems] = useState<Array<{ id: string; title: string; type: 'event' | 'task'; dueDate: string; time?: string; rawDate: string }>>([])
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<string | null>(null)
  const taskCaptureRef = useRef<HTMLInputElement | null>(null)
  const noteCaptureRef = useRef<HTMLTextAreaElement | null>(null)
  const eventCaptureRef = useRef<HTMLInputElement | null>(null)

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

      const workspaceResult: any = await supabase
        .from('workspaces' as never)
        .select('id')
        .eq('owner_id', user.id)
        .eq('is_personal', true)
        .maybeSingle()

      let currentWorkspaceId: string | null =
        workspaceResult.error || !workspaceResult.data
          ? null
          : (workspaceResult.data as { id: string }).id

      if (!currentWorkspaceId) {
        const membershipResult: any = await supabase
          .from('workspace_members' as never)
          .select('workspace_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle()

        if (!membershipResult.error && membershipResult.data) {
          currentWorkspaceId = (membershipResult.data as { workspace_id: string }).workspace_id
        }
      }

      const { data, error } = await supabase
        .from('daily_accountability' as never)
        .select('focus_items, checkin_finished, checkin_blocked, checkin_first_task_tomorrow')
        .eq('user_id', user.id)
        .eq('entry_date', todayKey())
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setSaveError('Could not load today data.')
        setFocusItems([])
        setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' })
        setCheckinSaved(false)
        setIsLoadingDaily(false)
        return
      }

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
      setWorkspaceId(currentWorkspaceId)
      setIsLoadingDaily(false)
    }

    loadDaily()

    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    let cancelled = false

    const loadQuickNotes = async () => {
      if (!user || !workspaceId) {
        setQuickNotes([])
        return
      }

      const { data, error } = await supabase
        .from('notes' as never)
        .select('id, title, content, created_at')
        .eq('user_id', user.id)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(24)

      if (cancelled) return

      if (error) {
        setSaveError('Could not load notes.')
        setQuickNotes([])
        return
      }

      const mapped = ((data ?? []) as Array<{ id: string; title: string; content: string; created_at: string }>).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.content,
        createdAt: row.created_at,
      }))

      setQuickNotes(mapped)
    }

    void loadQuickNotes()

    return () => {
      cancelled = true
    }
  }, [user?.id, workspaceId])

  useEffect(() => {
    if (!user || !workspaceId) return

    let cancelled = false

    const loadProjects = async () => {
      const { data, error } = await supabase
        .from('projects' as never)
        .select('id, name, status, completeness')
        .eq('workspace_id', workspaceId)
        .neq('status', 'Completed')
        .limit(5)

      if (!cancelled && !error && data) {
        const projects = data as Array<{ id: string; name: string; status: string; completeness: number }>
        setProjects(projects)
      }
    }

    void loadProjects()

    return () => {
      cancelled = true
    }
  }, [user?.id, workspaceId])

  useEffect(() => {
    if (!user || !workspaceId) return

    let cancelled = false

    const loadUpcoming = async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayISO = today.toISOString().slice(0, 10)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowISO = tomorrow.toISOString().slice(0, 10)
      const endDate = new Date(today)
      endDate.setDate(endDate.getDate() + 30)

      // Fetch upcoming events
      const { data: events } = await supabase
        .from('events' as never)
        .select('id, title, start_at')
        .eq('workspace_id', workspaceId)
        .gte('start_at', todayISO)
        .lte('start_at', endDate.toISOString().slice(0, 10))
        .limit(10)

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
    }

    void loadUpcoming()

    return () => {
      cancelled = true
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

  const saveDaily = async (next: {
    focusItems?: FocusItem[]
    checkin?: { finished: string; blocked: string; firstTaskTomorrow: string }
  }) => {
    if (!user) return false

    const nextFocus = next.focusItems ?? focusItems
    const nextCheckin = next.checkin ?? checkin

    const { error } = await supabase
      .from('daily_accountability' as never)
      .upsert(
        {
          user_id: user.id,
          entry_date: todayKey(),
          focus_items: nextFocus,
          checkin_finished: nextCheckin.finished.trim(),
          checkin_blocked: nextCheckin.blocked.trim(),
          checkin_first_task_tomorrow: nextCheckin.firstTaskTomorrow.trim(),
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'user_id,entry_date' }
      )

    if (error) {
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

    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('notes' as never)
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        title,
        content: text,
        date: todayKey(),
        tags: [] as string[],
        is_public: false,
      } as never)
      .select('id, title, content, created_at')
      .single()

    if (error || !data) {
      setSaveError('Could not save note.')
      return
    }

    const row = data as { id: string; title: string; content: string; created_at: string }
    const note: QuickNote = {
      id: row.id,
      title: row.title,
      body: row.content,
      createdAt: row.created_at ?? nowIso,
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
    if (!title || !user || !workspaceId) return

    // Get or create default calendar for workspace
    const calendarResult: any = await supabase
      .from('calendars' as never)
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_default', true)
      .maybeSingle()

    let calendarId: string | null = calendarResult.data?.id ?? null

    if (!calendarId) {
      const createCalResult: any = await supabase
        .from('calendars' as never)
        .insert({
          workspace_id: workspaceId,
          owner_id: user.id,
          name: 'Personal',
          color: '#3B82F6',
          is_default: true,
          is_personal: true,
        } as never)
        .select('id')
        .single()

      if (createCalResult.error) {
        setSaveError('Could not create calendar.')
        return
      }

      calendarId = createCalResult.data?.id
    }

    // Combine date and time for start/end times
    const startDateTime = new Date(`${eventDate}T${eventStartTime}:00`)
    const endDateTime = new Date(`${eventDate}T${eventEndTime}:00`)

    const { error } = await supabase
      .from('events' as never)
      .insert({
        calendar_id: calendarId,
        workspace_id: workspaceId,
        created_by: user.id,
        title,
        notes: '',
        start_at: startDateTime.toISOString(),
        end_at: endDateTime.toISOString(),
        all_day: false,
        status: 'planned',
      } as never)

    if (error) {
      setSaveError('Could not save event.')
      return
    }

    setEventDraft('')
    setEventDate(todayKey())
    setEventStartTime('09:00')
    setEventEndTime('10:00')
    setQuickCaptureMode('none')
  }

  const updateProjectStatus = async (projectId: string, newStatus: string) => {
    setProjectUpdating(projectId)
    const { error } = await supabase
      .from('projects' as never)
      .update({ status: newStatus } as never)
      .eq('id', projectId)

    if (!error) {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status: newStatus } : p))
      )
    } else {
      setSaveError('Could not update project status.')
    }
    setProjectUpdating(null)
  }

  const updateProjectCompleteness = async (projectId: string, completeness: number) => {
    completeness = Math.max(0, Math.min(100, completeness))
    const { error } = await supabase
      .from('projects' as never)
      .update({ completeness } as never)
      .eq('id', projectId)

    if (!error) {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, completeness } : p))
      )
    } else {
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
    const { data, error } = await supabase
      .from('projects' as never)
      .insert({
        workspace_id: workspaceId,
        created_by: user.id,
        name,
        status: 'NotStarted',
        completeness: 0,
        category_id: null,
      } as never)
      .select('id, name, status, completeness')
      .single()

    if (!error && data) {
      const newProject = data as { id: string; name: string; status: string; completeness: number }
      setProjects((prev) => [newProject, ...prev])
      setNewProjectName('')
      setIsCreatingProject(false)
    } else {
      console.error('Project creation error:', error)
      setSaveError(error?.message || 'Could not create project.')
      setIsCreatingProject(false)
    }
  }

  const completedCount = focusItems.filter((item) => item.done).length

  return (
    <div className="w-80 h-screen bg-white border-r border-gray-200 flex flex-col py-6">
      <div className="px-6 pb-6 border-b border-white/20">
        <div className="flex items-center justify-between mb-4">
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
                        const { error } = await supabase
                          .from('notes' as never)
                          .delete()
                          .eq('id', note.id)
                        if (error) {
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
            {projects.length === 0 ? (
              <p className="text-xs text-gray-500">No active projects</p>
            ) : (
              projects.map((project) => {
                const isExpanded = expandedProjectId === project.id
                const statusColors = {
                  'NotStarted': 'text-gray-700 bg-gray-50',
                  'InProgress': 'text-blue-700 bg-blue-50',
                  'Completed': 'text-green-700 bg-green-50',
                  'Paused': 'text-yellow-700 bg-yellow-50',
                }
                const statusLabel = project.status
                const statusColor = statusColors[project.status as keyof typeof statusColors] || 'text-gray-700 bg-gray-50'

                const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const percent = Math.round(((e.clientX - rect.left) / rect.width) * 100)
                  void updateProjectCompleteness(project.id, percent)
                }

                return (
                  <div key={project.id} className="bg-white rounded-lg border border-gray-200">
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
                        className={`text-gray-400 transition-transform flex-shrink-0 ml-2 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-gray-50 p-3 space-y-2">
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-gray-600">Project Status</label>
                          <div className="mt-1.5 flex gap-1 flex-wrap">
                            {['NotStarted', 'InProgress', 'Paused', 'Completed'].map((status) => (
                              <button
                                key={status}
                                onClick={() => updateProjectStatus(project.id, status)}
                                disabled={projectUpdating === project.id}
                                className={`text-[10px] font-medium px-2 py-1 rounded transition ${
                                  project.status === status
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300'
                                }`}
                              >
                                {status}
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
            {upcomingItems.length === 0 ? (
              <p className="text-xs text-gray-500">No upcoming events</p>
            ) : (
              upcomingItems.map((item) => {
                const isExpanded = expandedUpcomingId === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setExpandedUpcomingId(isExpanded ? null : item.id)}
                    className="w-full text-left bg-white rounded-lg p-2.5 border border-gray-200 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 mt-0.5">
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
                      <div className="flex-shrink-0 mt-0.5">
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
