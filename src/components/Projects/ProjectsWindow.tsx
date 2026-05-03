import {
  ChevronDown,
  ChevronLeft,
  Clock3,
  Folder,
  Plus,
  Search,
  CheckCircle2,
  Trash2,
} from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useApi } from '../../hooks/useApi'
import { SkeletonList } from '../Common/Skeleton'

type ProjectRow = {
  id: string
  name: string
  description: string | null
  status: string
  completeness: number
  color: string
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

type TaskRow = {
  id: string
  project_id: string | null
  title: string
  description: string | null
  due_date: string | null
  due_time: string | null
  status: 'todo' | 'in_progress' | 'completed' | 'cancelled' | string
  priority: 'low' | 'medium' | 'high' | 'urgent' | string
  tags: string[]
  created_at: string
  updated_at: string
}

type ProjectStatusFilter = 'active' | 'all' | 'paused' | 'completed'
type ProjectSemanticStatus = 'not_started' | 'in_progress' | 'paused' | 'completed'
type ProjectContextMenuState = { x: number; y: number; projectId: string }
type TaskContextMenuState = { x: number; y: number; taskId: string }

const LEFT_PANE_MIN_WIDTH = 260
const LEFT_PANE_MAX_WIDTH = 400
const RIGHT_PANE_MIN_WIDTH = 290
const RIGHT_PANE_MAX_WIDTH = 420
const AUTO_SAVE_DELAY_MS = 900

const projectStatusLabels: Record<ProjectSemanticStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
}

const projectStatusTone: Record<ProjectSemanticStatus, string> = {
  not_started: 'bg-blue-50 text-blue-700 border-blue-100',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  paused: 'bg-gray-100 text-gray-700 border-gray-200',
  completed: 'bg-green-50 text-green-700 border-green-100',
}

const projectStatusCandidates: Record<ProjectSemanticStatus, string[]> = {
  not_started: ['NotStarted', 'not_started', 'todo'],
  in_progress: ['InProgress', 'in_progress', 'doing'],
  paused: ['Paused', 'paused', 'archived'],
  completed: ['Completed', 'completed', 'done'],
}

const statusOrder: ProjectStatusFilter[] = ['active', 'paused', 'completed', 'all']

const taskStatusLabels: Record<string, string> = {
  todo: 'To do',
  in_progress: 'Doing',
  completed: 'Done',
  cancelled: 'Cancelled',
}

const taskPriorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

const taskPriorityTone: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-amber-50 text-amber-700',
  urgent: 'bg-red-50 text-red-700',
}

const colorOptions = ['#007AFF', '#0EA5E9', '#8B5CF6', '#F59E0B', '#EF4444', '#10B981']

const normalizeProjectNameKey = (value: unknown) => String(value ?? '').trim().toLowerCase()

const todayKey = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseProjectStatus = (status: string): ProjectSemanticStatus => {
  const value = status.toLowerCase()
  if (value.includes('complete') || value.includes('done')) return 'completed'
  if (value.includes('pause') || value.includes('archiv')) return 'paused'
  if (value.includes('progress') || value.includes('doing') || value.includes('in_')) return 'in_progress'
  return 'not_started'
}

const formatShortDate = (value: string | null) => {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const formatLongDate = (value: string | null) => {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

const formatTime = (value: string | null) => {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const buildProjectUpdate = (draft: ProjectDraft) => ({
  name: draft.name,
  description: draft.description,
  status: draft.status,
  completeness: draft.completeness,
  color: draft.color,
  start_date: draft.startDate || null,
  end_date: draft.endDate || null,
})

type ProjectDraft = {
  name: string
  description: string
  status: ProjectSemanticStatus
  completeness: number
  color: string
  startDate: string
  endDate: string
}

export const ProjectsWindow = () => {
  const { user } = useAuthContext()
  const api = useApi()
  const initialFocusProjectId = new URLSearchParams(window.location.search).get('focusProjectId')
  const titleRef = useRef<HTMLInputElement | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const isDirtyRef = useRef(false)
  const isCompletenessDraggingRef = useRef(false)
  const projectContextRef = useRef<HTMLDivElement | null>(null)
  const taskContextRef = useRef<HTMLDivElement | null>(null)

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('active')
  const [leftPaneWidth, setLeftPaneWidth] = useState(320)
  const [rightPaneWidth, setRightPaneWidth] = useState(340)
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false)
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(false)
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false)
  const [isResizingRightPane, setIsResizingRightPane] = useState(false)
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(null)
  const [taskContextMenu, setTaskContextMenu] = useState<TaskContextMenuState | null>(null)
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreatingProjectNow, setIsCreatingProjectNow] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({
    name: '',
    description: '',
    status: 'not_started',
    completeness: 0,
    color: '#007AFF',
    startDate: '',
    endDate: '',
  })
  const [isSavingProject, setIsSavingProject] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [newTaskDueDate, setNewTaskDueDate] = useState(todayKey())
  const [newTaskDueTime, setNewTaskDueTime] = useState('')
  const [isCreatingTask, setIsCreatingTask] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLowerCase()

    return projects.filter((project) => {
      const semantic = parseProjectStatus(String(project.status))
      const matchesSearch =
        !term ||
        [project.name, project.description ?? '', project.start_date ?? '', project.end_date ?? '', project.status]
          .join(' ')
          .toLowerCase()
          .includes(term)

      if (!matchesSearch) return false
      if (statusFilter === 'all') return true
      if (statusFilter === 'active') return semantic !== 'completed' && semantic !== 'paused'
      return semantic === statusFilter
    })
  }, [projects, search, statusFilter])

  const selectedProjectTasks = useMemo(() => {
    return tasks
      .filter((task) => task.project_id === selectedProjectId)
      .sort((a, b) => {
        const aDate = a.due_date ?? '9999-12-31'
        const bDate = b.due_date ?? '9999-12-31'
        if (aDate !== bDate) return aDate.localeCompare(bDate)
        return b.created_at.localeCompare(a.created_at)
      })
  }, [selectedProjectId, tasks])

  const projectCounts = useMemo(() => {
    const active = projects.filter((project) => parseProjectStatus(String(project.status)) !== 'completed').length
    const completed = projects.filter((project) => parseProjectStatus(String(project.status)) === 'completed').length
    const paused = projects.filter((project) => parseProjectStatus(String(project.status)) === 'paused').length
    return { active, completed, paused }
  }, [projects])

  const taskCounts = useMemo(() => {
    const active = selectedProjectTasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').length
    const completed = selectedProjectTasks.filter((task) => task.status === 'completed').length
    return { active, completed, total: selectedProjectTasks.length }
  }, [selectedProjectTasks])

  const isCompactRightPane = rightPaneWidth < 320

  const syncDraftFromProject = useCallback((project: ProjectRow) => {
    setProjectDraft({
      name: project.name,
      description: project.description ?? '',
      status: parseProjectStatus(String(project.status)),
      completeness: Math.max(0, Math.min(100, Number(project.completeness) || 0)),
      color: project.color || '#007AFF',
      startDate: project.start_date ?? '',
      endDate: project.end_date ?? '',
    })
    isDirtyRef.current = false
  }, [])

  const loadProjects = useCallback(async () => {
    if (!user) return
    setIsLoadingProjects(true)
    setError(null)

    try {
      const data = await api.getProjects({ includeCompleted: true })
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)

      setSelectedProjectId((currentId) => {
        if (currentId && rows.some((project) => project.id === currentId)) {
          return currentId
        }

        const next = rows[0] ?? null
        if (next) {
          syncDraftFromProject(next)
          return next.id
        }

        isDirtyRef.current = false
        setProjectDraft({
          name: '',
          description: '',
          status: 'not_started',
          completeness: 0,
          color: '#007AFF',
          startDate: '',
          endDate: '',
        })
        return null
      })
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load projects.')
      setProjects([])
      setSelectedProjectId(null)
    } finally {
      setIsLoadingProjects(false)
    }
  }, [api, syncDraftFromProject, user])

  const loadTasks = useCallback(async () => {
    if (!user || !selectedProjectId) {
      setTasks([])
      setIsLoadingTasks(false)
      return
    }

    setIsLoadingTasks(true)
    setTaskError(null)

    try {
      const data = await api.getTasks({ projectId: selectedProjectId })
      const rows = (data ?? []) as TaskRow[]
      setTasks(rows)
      setSelectedTaskId((current) => (current && rows.some((task) => task.id === current) ? current : rows[0]?.id ?? null))
    } catch (fetchError) {
      setTaskError(fetchError instanceof Error ? fetchError.message : 'Could not load tasks.')
      setTasks([])
      setSelectedTaskId(null)
    } finally {
      setIsLoadingTasks(false)
    }
  }, [api, selectedProjectId, user])

  const flushProjectDraft = useCallback(async () => {
    if (!selectedProject) return null
    if (!isDirtyRef.current) return selectedProject

    const nextName = projectDraft.name.trim()
    if (!nextName) {
      setError('Project name is required.')
      return null
    }

    setIsSavingProject(true)
    setError(null)

    try {
      const updated = (await api.updateProject(selectedProject.id, buildProjectUpdate(projectDraft))) as ProjectRow
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)))
      syncDraftFromProject(updated)
      return updated
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save project.')
      return null
    } finally {
      setIsSavingProject(false)
    }
  }, [api, projectDraft, selectedProject, syncDraftFromProject])

  const selectProject = useCallback(
    async (project: ProjectRow) => {
      if (selectedProjectId === project.id) return
      const saved = await flushProjectDraft()
      if (!saved && isDirtyRef.current) return
      setSelectedProjectId(project.id)
      syncDraftFromProject(project)
      setSelectedTaskId(null)
    },
    [flushProjectDraft, selectedProjectId, syncDraftFromProject]
  )

  const focusProjectById = useCallback(
    async (projectId: string) => {
      const project = projects.find((item) => item.id === projectId)
      if (!project) return
      await selectProject(project)
    },
    [projects, selectProject]
  )

  const updateProjectDraft = useCallback((patch: Partial<ProjectDraft>) => {
    isDirtyRef.current = true
    setProjectDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  const createProject = useCallback(async () => {
    const name = newProjectName.trim()
    if (!name) return

    setIsCreatingProjectNow(true)
    setError(null)

    try {
      const data = await api.createProject({
        name,
        description: '',
        color: '#007AFF',
        start_date: null,
        end_date: null,
      })
      const created = data as ProjectRow
      setProjects((prev) => {
        const next = prev.filter((project) => normalizeProjectNameKey(project.name) !== normalizeProjectNameKey(created.name))
        return [created, ...next]
      })
      setSelectedProjectId(created.id)
      syncDraftFromProject(created)
      setNewProjectName('')
      setIsCreatingProject(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create project.')
    } finally {
      setIsCreatingProjectNow(false)
    }
  }, [api, newProjectName, syncDraftFromProject])

  const deleteProject = useCallback(
    async (projectId: string) => {
      try {
        await api.deleteProject(projectId)
        setProjects((prev) => prev.filter((project) => project.id !== projectId))
        if (selectedProjectId === projectId) {
          setSelectedProjectId(null)
          setTasks([])
          setSelectedTaskId(null)
          isDirtyRef.current = false
          setProjectDraft({
            name: '',
            description: '',
            status: 'not_started',
            completeness: 0,
            color: '#007AFF',
            startDate: '',
            endDate: '',
          })
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : 'Could not delete project.')
      }
    },
    [api, selectedProjectId]
  )

  const updateProjectStatus = useCallback(
    async (projectId: string, semantic: ProjectSemanticStatus) => {
      try {
        const data = await api.updateProject(projectId, {
          status: projectStatusCandidates[semantic][0],
        })
        const updated = data as ProjectRow
        setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)))

        if (selectedProjectId === projectId) {
          syncDraftFromProject(updated)
        }
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : 'Could not update project status.')
      }
    },
    [api, selectedProjectId, syncDraftFromProject]
  )

  const createTask = useCallback(async () => {
    if (!selectedProjectId) return
    const title = newTaskTitle.trim()
    if (!title) return

    setIsCreatingTask(true)
    setTaskError(null)

    try {
      const data = await api.createTask({
        title,
        project_id: selectedProjectId,
        priority: newTaskPriority,
        due_date: newTaskDueDate || null,
        due_time: newTaskDueTime || null,
        status: 'todo',
      })
      const created = data as TaskRow
      setTasks((prev) => [created, ...prev])
      setNewTaskTitle('')
      setNewTaskPriority('medium')
      setNewTaskDueDate(todayKey())
      setNewTaskDueTime('')
    } catch (createError) {
      setTaskError(createError instanceof Error ? createError.message : 'Could not create task.')
    } finally {
      setIsCreatingTask(false)
    }
  }, [api, newTaskDueDate, newTaskDueTime, newTaskPriority, newTaskTitle, selectedProjectId])

  const updateTaskStatus = useCallback(
    async (task: TaskRow, status: string) => {
      try {
        const data = await api.updateTask(task.id, { status })
        const updated = data as TaskRow
        setTasks((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      } catch (updateError) {
        setTaskError(updateError instanceof Error ? updateError.message : 'Could not update task.')
      }
    },
    [api]
  )

  const deleteTask = useCallback(
    async (taskId: string) => {
      try {
        await api.deleteTask(taskId)
        setTasks((prev) => prev.filter((task) => task.id !== taskId))
        if (selectedTaskId === taskId) {
          setSelectedTaskId(null)
        }
      } catch (deleteError) {
        setTaskError(deleteError instanceof Error ? deleteError.message : 'Could not delete task.')
      }
    },
    [api, selectedTaskId]
  )

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (!selectedProject) return
    syncDraftFromProject(selectedProject)
  }, [selectedProject, syncDraftFromProject])

  useEffect(() => {
    if (!selectedProject || !isDirtyRef.current) return
    if (isCompletenessDraggingRef.current) return

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void flushProjectDraft()
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [flushProjectDraft, projectDraft, selectedProject])

  useEffect(() => {
    if (!initialFocusProjectId) return
    if (!projects.length) return
    if (selectedProjectId === initialFocusProjectId) return
    void focusProjectById(initialFocusProjectId)
  }, [focusProjectById, initialFocusProjectId, projects, selectedProjectId])

  useEffect(() => {
    const focusProjectListener = (_event: unknown, payload: { kind?: string; focusProjectId?: string | null }) => {
      if (payload?.kind !== 'projects' || !payload.focusProjectId) return
      void focusProjectById(payload.focusProjectId)
    }

    window.ipcRenderer?.on('module:focus-project', focusProjectListener)

    return () => {
      window.ipcRenderer?.off('module:focus-project', focusProjectListener)
    }
  }, [focusProjectById])

  useEffect(() => {
    if (!isResizingLeftPane) return

    const handleMove = (event: MouseEvent) => {
      const next = Math.max(LEFT_PANE_MIN_WIDTH, Math.min(LEFT_PANE_MAX_WIDTH, event.clientX))
      setLeftPaneWidth(next)
    }

    const handleUp = () => setIsResizingLeftPane(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizingLeftPane])

  useEffect(() => {
    if (!isResizingRightPane) return

    const handleMove = (event: MouseEvent) => {
      const next = window.innerWidth - event.clientX
      const clamped = Math.max(RIGHT_PANE_MIN_WIDTH, Math.min(RIGHT_PANE_MAX_WIDTH, next))
      setRightPaneWidth(clamped)
    }

    const handleUp = () => setIsResizingRightPane(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizingRightPane])

  useEffect(() => {
    if (!projectContextMenu) return

    const closeMenu = () => setProjectContextMenu(null)
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('mousedown', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onEscape)

    return () => {
      window.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onEscape)
    }
  }, [projectContextMenu])

  useEffect(() => {
    if (!taskContextMenu) return

    const closeMenu = () => setTaskContextMenu(null)
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('mousedown', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onEscape)

    return () => {
      window.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onEscape)
    }
  }, [taskContextMenu])

  return (
    <div className="h-screen bg-[#f5f7fb] flex flex-col text-gray-900">
      <div className="h-8 bg-white border-b border-gray-100" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />

      <header className="h-16 border-b border-gray-200 px-5 flex items-center justify-between bg-white" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => {
              void window.desktopWindow?.toggleModule('projects')
            }}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
            title="Close Projects"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
            <Folder size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-[26px] leading-none font-semibold tracking-tight text-gray-900">Projects</h1>
            <p className="text-xs text-gray-500 mt-1">Simple outcomes, clear next steps</p>
          </div>
        </div>

        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1 shadow-sm">
            <button
              onClick={() => {
                if (isLeftPaneCollapsed && isRightPaneCollapsed) {
                  setIsLeftPaneCollapsed(false)
                  setIsRightPaneCollapsed(false)
                } else {
                  setIsLeftPaneCollapsed(true)
                  setIsRightPaneCollapsed(true)
                }
              }}
              className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
              title={isLeftPaneCollapsed && isRightPaneCollapsed ? 'Show panels' : 'Hide panels'}
            >
              {isLeftPaneCollapsed && isRightPaneCollapsed ? 'Show panels' : 'Hide panels'}
            </button>
            <button
              onClick={() => void loadProjects()}
              className="h-8 w-8 rounded-full hover:bg-white text-gray-600 flex items-center justify-center"
              title="Refresh projects"
            >
              <Clock3 size={15} />
            </button>
            <button
              onClick={() => setIsCreatingProject(!isCreatingProject)}
              className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
            >
              <Plus size={13} />
              {isCreatingProject ? 'Cancel' : 'New project'}
            </button>
          </div>
        </div>
      </header>

      {error && <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</div>}

      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed && (
          <>
            <aside className="border-r border-gray-200 bg-white flex flex-col overflow-hidden shrink-0" style={{ width: `${leftPaneWidth}px` }}>
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Library</p>
                    <h2 className="text-sm font-semibold text-gray-900">{projects.length} projects</h2>
                  </div>
                  <span className="text-[10px] text-gray-500">{isLoadingProjects ? 'Syncing...' : 'Live'}</span>
                </div>

                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects"
                    className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {statusOrder.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                        statusFilter === filter
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {filter === 'active' ? 'Active' : filter === 'paused' ? 'Paused' : filter === 'completed' ? 'Completed' : 'All'}
                    </button>
                  ))}
                </div>

                {isCreatingProject && (
                  <div className="mt-3 space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
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
                      className="w-full h-9 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-300 bg-white text-gray-900 placeholder-gray-500"
                      autoFocus
                    />
                    <button
                      onClick={() => void createProject()}
                      disabled={!newProjectName.trim() || isCreatingProjectNow}
                      className="w-full h-9 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-60"
                    >
                      {isCreatingProjectNow ? 'Creating...' : 'Create project'}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-3 space-y-2">
                {isLoadingProjects ? (
                  <SkeletonList count={3} />
                ) : visibleProjects.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-800">No matching projects.</p>
                    <p className="mt-1 text-sm text-gray-500">Create one for internships, classes, or job applications.</p>
                  </div>
                ) : (
                  visibleProjects.map((project) => {
                    const semantic = parseProjectStatus(String(project.status))
                    const active = selectedProjectId === project.id

                    return (
                      <button
                        key={project.id}
                        onClick={() => void selectProject(project)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setProjectContextMenu({ x: e.clientX, y: e.clientY, projectId: project.id })
                        }}
                        className={`w-full rounded-2xl border p-3 text-left transition ${
                          active
                            ? 'border-blue-200 bg-blue-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{project.name}</p>
                            <p className="mt-1 text-[11px] text-gray-500">{formatShortDate(project.end_date || project.start_date || project.created_at)}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${projectStatusTone[semantic]}`}>
                            {projectStatusLabels[semantic]}
                          </span>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, project.completeness))}%`, backgroundColor: project.color }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                          <span>{project.completeness}% complete</span>
                          <span>{formatLongDate(project.start_date)} → {formatLongDate(project.end_date)}</span>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </aside>

            <div
              className="w-1.5 cursor-col-resize bg-gray-100 hover:bg-gray-200 transition touch-none"
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizingLeftPane(true)
              }}
            />
          </>
        )}

        <main className="flex-1 overflow-hidden bg-[#f5f7fb]">
          <div className="h-full overflow-auto p-5">
            {selectedProject ? (
              <div className="mx-auto max-w-7xl grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-6 py-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Project</p>
                      <h3 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Project detail</h3>
                      <p className="mt-2 text-sm text-gray-500">Keep the plan lean. Update the brief, target dates, and status in one place.</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
                      {isSavingProject ? 'Saving...' : isDirtyRef.current ? 'Unsaved changes' : 'Saved'}
                    </div>
                  </div>

                  <div className="grid gap-0 xl:grid-cols-[1fr]">
                    <div className="min-w-0 p-6 space-y-5">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Project name</label>
                        <input
                          ref={titleRef}
                          value={projectDraft.name}
                          onChange={(e) => updateProjectDraft({ name: e.target.value })}
                          placeholder="Project title"
                          className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-lg font-semibold text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Project brief</label>
                        <textarea
                          ref={descriptionRef}
                          value={projectDraft.description}
                          onChange={(e) => updateProjectDraft({ description: e.target.value })}
                          placeholder="What are you trying to finish? What is the next move?"
                          className="min-h-32 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Status</label>
                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(projectStatusLabels) as ProjectSemanticStatus[]).map((status) => (
                            <button
                              key={status}
                              onClick={() => void updateProjectStatus(selectedProject.id, status)}
                              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                projectDraft.status === status
                                  ? 'border-gray-900 bg-gray-900 text-white'
                                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {projectStatusLabels[status]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Progress</label>
                          <span className="text-xs text-gray-600">{projectDraft.completeness}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={projectDraft.completeness}
                          onPointerDown={() => {
                            isCompletenessDraggingRef.current = true
                            if (autosaveTimerRef.current) {
                              window.clearTimeout(autosaveTimerRef.current)
                            }
                          }}
                          onChange={(e) => updateProjectDraft({ completeness: Number(e.target.value) })}
                          onPointerUp={() => {
                            isCompletenessDraggingRef.current = false
                            void flushProjectDraft()
                          }}
                          onPointerCancel={() => {
                            isCompletenessDraggingRef.current = false
                            void flushProjectDraft()
                          }}
                          onBlur={() => {
                            isCompletenessDraggingRef.current = false
                            void flushProjectDraft()
                          }}
                          className="w-full accent-gray-900"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Start date</label>
                          <input
                            type="date"
                            value={projectDraft.startDate}
                            onChange={(e) => updateProjectDraft({ startDate: e.target.value })}
                            className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Target date</label>
                          <input
                            type="date"
                            value={projectDraft.endDate}
                            onChange={(e) => updateProjectDraft({ endDate: e.target.value })}
                            className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Color</label>
                        <div className="flex flex-wrap gap-2">
                          {colorOptions.map((color) => (
                            <button
                              key={color}
                              onClick={() => updateProjectDraft({ color })}
                              className={`h-9 w-9 rounded-full border-2 transition ${
                                projectDraft.color === color ? 'border-gray-900 scale-105' : 'border-transparent hover:scale-105'
                              }`}
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-6 py-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Tasks</p>
                      <h3 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Project tasks</h3>
                      <p className="mt-2 text-sm text-gray-500">Short, actionable items that move the project forward.</p>
                    </div>
                    <div className="text-left sm:text-right text-xs text-gray-500 shrink-0">
                      <p>{taskCounts.active} active</p>
                      <p>{taskCounts.completed} done</p>
                    </div>
                  </div>

                  <div className="min-w-0 p-6 space-y-4">
                    <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <input
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void createTask()
                          }
                        }}
                        placeholder="Add a next action"
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-100"
                      />
                      <div className={`grid gap-2 ${isCompactRightPane ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,150px)_minmax(0,150px)_auto]'}`}>
                        <div className="relative min-w-0">
                          <select
                            value={newTaskPriority}
                            onChange={(e) => setNewTaskPriority(e.target.value as typeof newTaskPriority)}
                            className={`w-full min-w-0 appearance-none rounded-xl border border-gray-200 bg-white text-sm text-gray-700 outline-none ${isCompactRightPane ? 'py-2 pl-3 pr-9' : 'py-2 pl-3 pr-10'}`}
                          >
                            {Object.entries(taskPriorityLabels).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                          <ChevronDown
                            size={isCompactRightPane ? 12 : 14}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                          />
                        </div>
                        <input
                          type="date"
                          value={newTaskDueDate}
                          onChange={(e) => setNewTaskDueDate(e.target.value)}
                          className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
                        />
                        <input
                          type="time"
                          value={newTaskDueTime}
                          onChange={(e) => setNewTaskDueTime(e.target.value)}
                          className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
                        />
                        <button
                          onClick={() => void createTask()}
                          disabled={!newTaskTitle.trim() || isCreatingTask}
                          className={`w-full rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60 ${isCompactRightPane ? '' : 'sm:col-span-2 lg:col-span-1'}`}
                        >
                          {isCreatingTask ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                    </div>

                    {taskError && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{taskError}</div>}

                    <div className="space-y-3">
                      {isLoadingTasks ? (
                        <SkeletonList count={3} />
                      ) : selectedProjectTasks.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                          <p className="text-sm font-medium text-gray-800">No tasks yet.</p>
                          <p className="mt-1 text-sm text-gray-500">Capture the next action here so the project stays moving.</p>
                        </div>
                      ) : (
                        selectedProjectTasks.map((task) => {
                          const completed = task.status === 'completed'
                          return (
                            <button
                              key={task.id}
                              onClick={() => void updateTaskStatus(task, completed ? 'todo' : 'completed')}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setTaskContextMenu({ x: e.clientX, y: e.clientY, taskId: task.id })
                              }}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition hover:bg-white"
                            >
                              <div className="flex items-start gap-3">
                                <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border transition ${completed ? 'border-green-500 bg-green-500' : 'border-gray-300 bg-white'}`}>
                                  {completed && <CheckCircle2 size={12} className="text-white" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <div className="min-w-0">
                                      <p className={`min-w-0 text-sm font-medium ${completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.title}</p>
                                      <p className="mt-1 wrap-break-word text-[11px] text-gray-500">
                                        {formatShortDate(task.due_date)}{formatTime(task.due_time) ? ` · ${formatTime(task.due_time)}` : ''}
                                      </p>
                                    </div>
                                    <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${taskPriorityTone[String(task.priority)] ?? 'bg-gray-100 text-gray-700'}`}>
                                      {taskPriorityLabels[String(task.priority)] ?? 'Medium'}
                                    </span>
                                  </div>
                                  {task.description ? (
                                    <p className="mt-2 line-clamp-2 text-sm text-gray-600">{task.description}</p>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white px-8 py-10 text-center shadow-sm">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50">
                    <Folder size={18} className="text-gray-700" />
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">Start a project</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Projects keep internships, applications, classes, and personal goals organized around a clear next step.
                  </p>
                  <button
                    onClick={() => setIsCreatingProject(true)}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                  >
                    <Plus size={16} />
                    New project
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        {!isRightPaneCollapsed && (
          <>
            <div
              className="w-1.5 cursor-col-resize bg-gray-100 hover:bg-gray-200 transition touch-none"
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizingRightPane(true)
              }}
            />

            <aside className="flex shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white" style={{ width: `${rightPaneWidth}px` }}>
              <div className={`${isCompactRightPane ? 'p-3' : 'p-4'} border-b border-gray-100`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Pulse</p>
                    <h2 className={`${isCompactRightPane ? 'text-xs' : 'text-sm'} font-semibold text-gray-900`}>Execution view</h2>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[10px] text-gray-500">
                    <span>{projectCounts.active} open</span>
                    <span>{taskCounts.completed} done</span>
                  </div>
                </div>
                {selectedProject ? (
                  <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`${isCompactRightPane ? 'text-xs' : 'text-sm'} truncate font-medium text-gray-900`}>{selectedProject.name}</p>
                        <p className="text-[11px] text-gray-500">Updated {formatShortDate(selectedProject.updated_at)}</p>
                      </div>
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: projectDraft.color }} />
                    </div>
                    <div className={`grid gap-2 text-center ${isCompactRightPane ? 'grid-cols-1' : 'grid-cols-3'}`}>
                      <div className="rounded-xl bg-white border border-gray-200 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Progress</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{projectDraft.completeness}%</p>
                      </div>
                      <div className="rounded-xl bg-white border border-gray-200 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Tasks</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{taskCounts.total}</p>
                      </div>
                      <div className="rounded-xl bg-white border border-gray-200 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Done</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{taskCounts.completed}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
                    <p className="text-sm font-medium text-gray-800">No project selected.</p>
                    <p className="mt-1 text-sm text-gray-500">Pick a project on the left or create a new one.</p>
                  </div>
                )}
              </div>

              <div className={`flex-1 overflow-auto ${isCompactRightPane ? 'p-3' : 'p-4'} space-y-3`}>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">Project context</h3>
                    {selectedProject && (
                      <button
                        onClick={() => void deleteProject(selectedProject.id)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {selectedProject ? (
                    <div className="space-y-3 text-sm text-gray-700">
                      <p>{selectedProject.description?.trim() || 'No project brief yet.'}</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <p className="uppercase tracking-wider text-gray-500">Start</p>
                          <p className="mt-1 font-medium text-gray-900">{formatLongDate(selectedProject.start_date)}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <p className="uppercase tracking-wider text-gray-500">Target</p>
                          <p className="mt-1 font-medium text-gray-900">{formatLongDate(selectedProject.end_date)}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Select a project to see its context and task list.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">Next actions</h3>
                    <span className="text-xs text-gray-500">{selectedProjectTasks.length} items</span>
                  </div>
                  {taskError && <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{taskError}</div>}
                  <div className="space-y-2">
                    {isLoadingTasks ? (
                      <SkeletonList count={2} />
                    ) : selectedProjectTasks.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-medium text-gray-800">No tasks yet.</p>
                        <p className="mt-1 text-sm text-gray-500">Add one next action at a time.</p>
                      </div>
                    ) : (
                      selectedProjectTasks.map((task) => {
                        const completed = task.status === 'completed'
                        return (
                          <div
                            key={task.id}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setTaskContextMenu({ x: e.clientX, y: e.clientY, taskId: task.id })
                            }}
                            className={`rounded-2xl border border-gray-200 bg-gray-50 ${isCompactRightPane ? 'px-3 py-2.5' : 'px-4 py-3'}`}
                          >
                            <button
                              onClick={() => void updateTaskStatus(task, completed ? 'todo' : 'completed')}
                              className="flex w-full items-start gap-3 text-left"
                            >
                              <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border transition ${completed ? 'border-green-500 bg-green-500' : 'border-gray-300 bg-white'}`}>
                                {completed && <CheckCircle2 size={12} className="text-white" />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className={`flex gap-2 ${isCompactRightPane ? 'flex-col' : 'items-start justify-between'}`}>
                                  <p className={`min-w-0 text-sm font-medium ${completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.title}</p>
                                  <span className={`self-start rounded-full px-2 py-1 text-[10px] font-medium ${taskPriorityTone[String(task.priority)] ?? 'bg-gray-100 text-gray-700'}`}>
                                    {taskPriorityLabels[String(task.priority)] ?? 'Medium'}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-gray-500">
                                  {formatShortDate(task.due_date)}{formatTime(task.due_time) ? ` · ${formatTime(task.due_time)}` : ''}
                                  {' · '}
                                  {taskStatusLabels[String(task.status)] ?? 'To do'}
                                </p>
                                {task.description ? <p className="mt-2 line-clamp-2 text-sm text-gray-600">{task.description}</p> : null}
                              </div>
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {projectContextMenu && (
        <div
          ref={projectContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${projectContextMenu.x}px`, top: `${projectContextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              const project = projects.find((item) => item.id === projectContextMenu.projectId)
              if (project) {
                await selectProject(project)
              }
              setProjectContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <Folder size={14} />
            Open
          </button>
          <button onClick={() => { void updateProjectStatus(projectContextMenu.projectId, 'in_progress'); setProjectContextMenu(null) }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
            <ChevronDown size={14} />
            Mark active
          </button>
          <button onClick={() => { void updateProjectStatus(projectContextMenu.projectId, 'paused'); setProjectContextMenu(null) }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
            <ChevronDown size={14} />
            Mark paused
          </button>
          <button onClick={() => { void updateProjectStatus(projectContextMenu.projectId, 'completed'); setProjectContextMenu(null) }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
            <CheckCircle2 size={14} />
            Mark complete
          </button>
          <button
            onClick={() => {
              void deleteProject(projectContextMenu.projectId)
              setProjectContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {taskContextMenu && (
        <div
          ref={taskContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${taskContextMenu.x}px`, top: `${taskContextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId)
              if (task) void updateTaskStatus(task, 'todo')
              setTaskContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckCircle2 size={14} />
            Mark todo
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId)
              if (task) void updateTaskStatus(task, 'in_progress')
              setTaskContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <ChevronDown size={14} />
            Mark in progress
          </button>
          <button
            onClick={() => {
              const task = tasks.find((item) => item.id === taskContextMenu.taskId)
              if (task) void updateTaskStatus(task, 'completed')
              setTaskContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckCircle2 size={14} />
            Mark complete
          </button>
          <button
            onClick={() => {
              void deleteTask(taskContextMenu.taskId)
              setTaskContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

export default ProjectsWindow
