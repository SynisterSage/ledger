import {
  ChevronDown,
  Clock3,
  FileText,
  Folder,
  Plus,
  Search,
  CheckCircle2,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { modulePaneSizing, clampPaneWidth, getPaneWidthForViewport } from '../../config/modulePaneSizes'
import { useApi } from '../../hooks/useApi'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader'
import { SkeletonList, SkeletonProjectCard, SkeletonTaskItem } from '../Common/Skeleton'
import { useViewportWidth } from '../../hooks/useViewportWidth'

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
  notes: string | null
  due_date: string | null
  due_time: string | null
  status: 'todo' | 'in_progress' | 'completed' | 'cancelled' | string
  priority: 'low' | 'medium' | 'high' | 'urgent' | string
  tags: string[]
  created_at: string
  updated_at: string
}

type ProjectStatusFilter = 'active' | 'paused' | 'completed'
type ProjectSemanticStatus = 'not_started' | 'in_progress' | 'paused' | 'completed'
type ProjectContextMenuState = { x: number; y: number; projectId: string }
type TaskContextMenuState = { x: number; y: number; taskId: string }

const LEFT_PANE_MIN_WIDTH = 260
const LEFT_PANE_MAX_WIDTH = 400
const RIGHT_PANE_MIN_WIDTH = 260
const RIGHT_PANE_MAX_WIDTH = 340
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

const statusOrder: ProjectStatusFilter[] = ['active', 'paused', 'completed']

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

const projectColorOptions = [
  '#007AFF',
  '#FF5F40',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EF4444',
  '#0EA5E9',
  '#111827',
]

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

const formatProjectDateRange = (startDate: string | null, endDate: string | null) => {
  const start = formatLongDate(startDate)
  const end = formatLongDate(endDate)
  const hasStart = start !== 'Not set'
  const hasEnd = end !== 'Not set'
  if (!hasStart && !hasEnd) return null
  if (hasStart && hasEnd) return `${start} → ${end}`
  return hasStart ? start : end
}

const getProgressStateColor = (value: number) => {
  const percent = Math.max(0, Math.min(100, value))
  if (percent < 35) return '#FF5F40'
  if (percent < 70) return '#F59E0B'
  return '#22C55E'
}

const getTimelineCompleteness = (startDate: string | null, endDate: string | null) => {
  if (!startDate || !endDate) return null
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T23:59:59`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null
  const now = Date.now()
  if (now <= start.getTime()) return 0
  if (now >= end.getTime()) return 100
  const ratio = (now - start.getTime()) / (end.getTime() - start.getTime())
  return Math.max(0, Math.min(100, Math.round(ratio * 100)))
}

const CONTEXT_MENU_GUTTER = 8

const getClampedMenuPosition = (x: number, y: number, width: number, height: number) => {
  const maxX = Math.max(CONTEXT_MENU_GUTTER, window.innerWidth - width - CONTEXT_MENU_GUTTER)
  const maxY = Math.max(CONTEXT_MENU_GUTTER, window.innerHeight - height - CONTEXT_MENU_GUTTER)
  return {
    x: Math.min(Math.max(x, CONTEXT_MENU_GUTTER), maxX),
    y: Math.min(Math.max(y, CONTEXT_MENU_GUTTER), maxY),
  }
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
    const { activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const viewportWidth = useViewportWidth()
  const initialFocusProjectId = new URLSearchParams(window.location.search).get('focusProjectId')
  const initialFocusTaskId = new URLSearchParams(window.location.search).get('focusTaskId')
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
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.projects.left)
  )
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.projects.right)
  )
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
  const [isTaskComposerOpen, setIsTaskComposerOpen] = useState(false)
  const [taskNotesTaskId, setTaskNotesTaskId] = useState<string | null>(null)
  const [taskNotesDraft, setTaskNotesDraft] = useState('')
  const [isSavingTaskNotes, setIsSavingTaskNotes] = useState(false)

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

  const taskCounts = useMemo(() => {
    const active = selectedProjectTasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').length
    const completed = selectedProjectTasks.filter((task) => task.status === 'completed').length
    return { active, completed, total: selectedProjectTasks.length }
  }, [selectedProjectTasks])

  const projectMenuPosition = useMemo(() => {
    if (!projectContextMenu) return null
    return getClampedMenuPosition(projectContextMenu.x, projectContextMenu.y, 208, 304)
  }, [projectContextMenu])

  const taskMenuPosition = useMemo(() => {
    if (!taskContextMenu) return null
    return getClampedMenuPosition(taskContextMenu.x, taskContextMenu.y, 208, 220)
  }, [taskContextMenu])

  const isCompactLayout = viewportWidth < modulePaneSizing.projects.right.compactBreakpoint
  const taskNotesTask = useMemo(
    () => tasks.find((task) => task.id === taskNotesTaskId) ?? null,
    [taskNotesTaskId, tasks]
  )

  const syncDraftFromProject = useCallback((project: ProjectRow) => {
    const timelineCompleteness = getTimelineCompleteness(project.start_date, project.end_date)
    setProjectDraft({
      name: project.name,
      description: project.description ?? '',
      status: parseProjectStatus(String(project.status)),
      completeness: timelineCompleteness ?? Math.max(0, Math.min(100, Number(project.completeness) || 0)),
      color: project.color || '#007AFF',
      startDate: project.start_date ?? '',
      endDate: project.end_date ?? '',
    })
    isDirtyRef.current = false
  }, [])

  const loadProjects = useCallback(async () => {
    if (!user || !activeWorkspaceId) {
      setProjects([])
      setSelectedProjectId(null)
      setProjectDraft({
        name: '',
        description: '',
        status: 'not_started',
        completeness: 0,
        color: '#007AFF',
        startDate: '',
        endDate: '',
      })
      setIsLoadingProjects(false)
      setError(null)
      return
    }
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
  }, [api, activeWorkspaceId, syncDraftFromProject, user])

  const loadTasks = useCallback(async () => {
    if (!user || !activeWorkspaceId || !selectedProjectId) {
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
  }, [api, activeWorkspaceId, selectedProjectId, user])

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

  const updateProjectColor = useCallback(
    async (projectId: string, color: string) => {
      try {
        const data = await api.updateProject(projectId, { color })
        const updated = data as ProjectRow
        setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)))
        if (selectedProjectId === projectId) {
          syncDraftFromProject(updated)
        }
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : 'Could not update project color.')
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
      const previousTask = task
      const nextTask = { ...task, status }

      setTasks((prev) => prev.map((row) => (row.id === task.id ? nextTask : row)))

      try {
        const data = await api.updateTask(task.id, { status })
        const updated = data as TaskRow
        setTasks((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      } catch (updateError) {
        setTaskError(updateError instanceof Error ? updateError.message : 'Could not update task.')
        setTasks((prev) => prev.map((row) => (row.id === task.id ? previousTask : row)))
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

  const openTaskNotes = useCallback((task: TaskRow) => {
    setTaskNotesTaskId(task.id)
    setTaskNotesDraft(task.notes ?? '')
  }, [])

  const saveTaskNotes = useCallback(async () => {
    if (!taskNotesTaskId) return
    setIsSavingTaskNotes(true)
    setTaskError(null)
    try {
      const data = await api.updateTask(taskNotesTaskId, { notes: taskNotesDraft.trim() || null })
      const updated = data as TaskRow
      setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)))
      setTaskNotesTaskId(null)
      setTaskNotesDraft('')
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not save task notes.')
    } finally {
      setIsSavingTaskNotes(false)
    }
  }, [api, taskNotesDraft, taskNotesTaskId])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    setLeftPaneWidth((current) => clampPaneWidth(current, viewportWidth, modulePaneSizing.projects.left))
    setRightPaneWidth((current) => clampPaneWidth(current, viewportWidth, modulePaneSizing.projects.right))
  }, [viewportWidth])

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
    if (!initialFocusTaskId) return
    if (!tasks.length) return
    const task = tasks.find((item) => item.id === initialFocusTaskId)
    if (!task) return
    setSelectedTaskId(task.id)
    const element = document.getElementById(`task-row-${task.id}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [initialFocusTaskId, tasks])

  useEffect(() => {
    const focusTaskListener = (_event: unknown, payload: { kind?: string; focusTaskId?: string | null }) => {
      if (payload?.kind !== 'projects' || !payload.focusTaskId) return
      const task = tasks.find((item) => item.id === payload.focusTaskId)
      if (!task) return
      setSelectedTaskId(task.id)
      const element = document.getElementById(`task-row-${task.id}`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    window.ipcRenderer?.on('module:focus-task', focusTaskListener)

    return () => {
      window.ipcRenderer?.off('module:focus-task', focusTaskListener)
    }
  }, [tasks])

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
    const onPointerDown = (event: MouseEvent) => {
      if (projectContextRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onEscape)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onEscape)
    }
  }, [projectContextMenu])

  useEffect(() => {
    if (!taskContextMenu) return

    const closeMenu = () => setTaskContextMenu(null)
    const onPointerDown = (event: MouseEvent) => {
      if (taskContextRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onEscape)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onEscape)
    }
  }, [taskContextMenu])

  return (
    <div className="h-screen overflow-hidden rounded-[28px] border border-gray-200 bg-[#f5f7fb] flex flex-col text-gray-900 shadow-[0_24px_80px_rgba(15,23,42,0.08)]" style={{ scrollbarGutter: 'stable' }}>
      <ModuleWindowHeader
        title="Projects"
        subtitle="Simple outcomes, clear next steps"
        icon={<Folder size={18} className="text-blue-600" />}
        closeLabel="Close projects"
        minimizeLabel="Minimize projects"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('projects')
        }}
        fullscreenLabel="Fullscreen projects"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('projects')
        }}
        onClose={() => {
          void window.desktopWindow?.closeModule('projects')
        }}
        actions={
          <div className="flex items-center gap-2">
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
                onClick={() => setIsCreatingProject(!isCreatingProject)}
                className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
              >
                <Plus size={13} />
                {isCreatingProject ? 'Cancel' : 'New project'}
              </button>
            </div>
            <button
              onClick={() => void loadProjects()}
              className="h-8 w-8 rounded-full border border-gray-200 bg-white hover:bg-gray-100 text-gray-600 flex items-center justify-center shadow-sm"
              title="Refresh projects"
            >
              <Clock3 size={15} />
            </button>
          </div>
        }
      />

      {error && <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</div>}

      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed && (
          <>
            <aside className="border-r border-gray-200 bg-white flex flex-col overflow-hidden shrink-0" style={{ width: `${leftPaneWidth}px` }}>
              <div className={`${isCompactLayout ? 'p-3' : 'p-4'} border-b border-gray-100`}>
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

              <div className={`flex-1 overflow-auto ${isCompactLayout ? 'p-2.5' : 'p-3'} space-y-2`}>
                {isLoadingProjects ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonProjectCard key={i} />
                    ))}
                  </div>
                ) : visibleProjects.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-800">No matching projects.</p>
                    <p className="mt-1 text-sm text-gray-500">Create one for internships, classes, or job applications.</p>
                  </div>
                ) : (
                  visibleProjects.map((project) => {
                    const semantic = parseProjectStatus(String(project.status))
                    const active = selectedProjectId === project.id
                    const projectDateRange = formatProjectDateRange(project.start_date, project.end_date)
                    const timelineCompleteness = getTimelineCompleteness(project.start_date, project.end_date)
                    const displayCompleteness = timelineCompleteness ?? project.completeness
                    const progressColor = getProgressStateColor(displayCompleteness)

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
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full border border-black/5"
                                style={{ backgroundColor: project.color || '#007AFF' }}
                              />
                              <p className="text-sm font-semibold text-gray-900 truncate">{project.name}</p>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500">{formatShortDate(project.end_date || project.start_date || project.created_at)}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${projectStatusTone[semantic]}`}>
                            {projectStatusLabels[semantic]}
                          </span>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, displayCompleteness))}%`, backgroundColor: progressColor }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                          <span>{displayCompleteness}% complete</span>
                          {projectDateRange ? <span>{projectDateRange}</span> : null}
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
          <div className={`h-full overflow-auto ${isCompactLayout ? 'p-4' : 'p-5'}`}>
            {selectedProject ? (
              <div className="mx-auto max-w-4xl space-y-4">
                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-3xl font-semibold tracking-tight text-gray-900">{projectDraft.name}</h2>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${projectStatusTone[projectDraft.status]}`}>
                          {projectStatusLabels[projectDraft.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {isSavingProject ? 'Saving…' : isDirtyRef.current ? 'Unsaved changes' : 'Saved'}
                      </p>
                    </div>
                    <div className="relative shrink-0">
                      <select
                        value={projectDraft.status}
                        onChange={(e) => void updateProjectStatus(selectedProject.id, e.target.value as ProjectSemanticStatus)}
                        className="h-9 appearance-none rounded-xl border border-gray-200 bg-white py-0 pl-3 pr-8 text-sm font-medium text-gray-800 outline-none focus:border-gray-300"
                      >
                        {(Object.keys(projectStatusLabels) as ProjectSemanticStatus[]).map((status) => (
                          <option key={status} value={status}>{projectStatusLabels[status]}</option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                    </div>
                  </div>
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-end">
                      <span className="text-sm font-semibold text-gray-900">{projectDraft.completeness}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={projectDraft.completeness}
                      onPointerDown={() => {
                        isCompletenessDraggingRef.current = true
                        if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
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
                      style={{ accentColor: getProgressStateColor(projectDraft.completeness) }}
                      className="w-full"
                    />
                  </div>
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Timeline</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Start</span>
                      <input
                        type="date"
                        value={projectDraft.startDate}
                        onChange={(e) => {
                          const nextStartDate = e.target.value
                          const timelineCompleteness = getTimelineCompleteness(nextStartDate || null, projectDraft.endDate || null)
                          updateProjectDraft({
                            startDate: nextStartDate,
                            ...(timelineCompleteness === null ? {} : { completeness: timelineCompleteness }),
                          })
                        }}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Due</span>
                      <input
                        type="date"
                        value={projectDraft.endDate}
                        onChange={(e) => {
                          const nextEndDate = e.target.value
                          const timelineCompleteness = getTimelineCompleteness(projectDraft.startDate || null, nextEndDate || null)
                          updateProjectDraft({
                            endDate: nextEndDate,
                            ...(timelineCompleteness === null ? {} : { completeness: timelineCompleteness }),
                          })
                        }}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-gray-300"
                      />
                    </label>
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
                    <button
                      onClick={() => setIsTaskComposerOpen((prev) => !prev)}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      <Plus size={14} />
                      Add next action
                    </button>

                    {isTaskComposerOpen && (
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
                        <div className={`grid gap-2 ${isCompactLayout ? 'grid-cols-1' : 'sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,150px)_auto]'}`}>
                          <div className="relative min-w-0">
                            <select
                              value={newTaskPriority}
                              onChange={(e) => setNewTaskPriority(e.target.value as typeof newTaskPriority)}
                              className={`w-full min-w-0 appearance-none rounded-xl border border-gray-200 bg-white text-sm text-gray-700 outline-none ${isCompactLayout ? 'py-2 pl-3 pr-9' : 'py-2 pl-3 pr-10'}`}
                            >
                              {Object.entries(taskPriorityLabels).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                            <ChevronDown
                              size={isCompactLayout ? 12 : 14}
                              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                            />
                          </div>
                          <input
                            type="date"
                            value={newTaskDueDate}
                            onChange={(e) => setNewTaskDueDate(e.target.value)}
                            className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
                          />
                          <button
                            onClick={() => void createTask()}
                            disabled={!newTaskTitle.trim() || isCreatingTask}
                            className="w-full rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
                          >
                            {isCreatingTask ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      </div>
                    )}

                    {taskError && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{taskError}</div>}

                    <div className="space-y-3">
                      {isLoadingTasks ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <SkeletonTaskItem key={i} />
                          ))}
                        </div>
                      ) : selectedProjectTasks.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
                          <p className="text-sm font-medium text-gray-800">No tasks yet.</p>
                          <p className="mt-1 text-sm text-gray-500">Capture the next action here so the project stays moving.</p>
                        </div>
                      ) : (
                        selectedProjectTasks.map((task) => {
                          const completed = task.status === 'completed'
                          const activeTask = selectedTaskId === task.id
                          return (
                            <button
                              id={`task-row-${task.id}`}
                              key={task.id}
                              onClick={() => {
                                setSelectedTaskId(task.id)
                                void updateTaskStatus(task, completed ? 'todo' : 'completed')
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setTaskContextMenu({ x: e.clientX, y: e.clientY, taskId: task.id })
                              }}
                              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                                activeTask
                                  ? 'border-gray-300 bg-white shadow-sm'
                                  : 'border-gray-200 bg-gray-50 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border transition ${completed ? 'border-green-600 bg-green-600' : 'border-gray-300 bg-white'}`}>
                                  {completed && <CheckCircle2 size={12} className="text-white" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <div className="min-w-0">
                                      <p className={`min-w-0 text-sm font-medium ${completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{task.title}</p>
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
              <div className="p-4 border-b border-gray-100">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">At a glance</p>
                {selectedProject ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                      <p className="truncate text-sm font-medium text-gray-900">{selectedProject.name}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-gray-200 bg-white p-2">
                          <p className="text-[10px] uppercase tracking-wide text-gray-500">Active</p>
                          <p className="mt-1 font-semibold text-gray-900">{taskCounts.active}</p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-2">
                          <p className="text-[10px] uppercase tracking-wide text-gray-500">Done</p>
                          <p className="mt-1 font-semibold text-gray-900">{taskCounts.completed}</p>
                        </div>
                      </div>
                      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2 text-[11px] text-gray-600">
                        Updated {formatShortDate(selectedProject.updated_at)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
                    <p className="text-sm font-medium text-gray-800">No project selected.</p>
                    <p className="mt-1 text-sm text-gray-500">Pick a project to view quick stats.</p>
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      {taskNotesTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Task notes</p>
              <p className="mt-1 truncate text-base font-semibold text-gray-900">{taskNotesTask.title}</p>
            </div>
            <div className="p-5">
              <textarea
                value={taskNotesDraft}
                onChange={(e) => setTaskNotesDraft(e.target.value)}
                placeholder="Capture details, links, blockers, or handoff notes for this task."
                className="h-48 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-300"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setTaskNotesTaskId(null)
                    setTaskNotesDraft('')
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveTaskNotes()}
                  disabled={isSavingTaskNotes}
                  className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {isSavingTaskNotes ? 'Saving...' : 'Save notes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {projectContextMenu && projectMenuPosition && (
        <div
          ref={projectContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${projectMenuPosition.x}px`, top: `${projectMenuPosition.y}px` }}
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
          <div className="px-4 py-2">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">Color</p>
            <div className="grid grid-cols-8 gap-2">
              {projectColorOptions.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    void updateProjectColor(projectContextMenu.projectId, color)
                    setProjectContextMenu(null)
                  }}
                  className="h-4 w-4 rounded-full border border-black/10 transition hover:scale-110"
                  style={{ backgroundColor: color }}
                  aria-label={`Set project color ${color}`}
                />
              ))}
            </div>
          </div>
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

      {taskContextMenu && taskMenuPosition && (
        <div
          ref={taskContextRef}
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: `${taskMenuPosition.x}px`, top: `${taskMenuPosition.y}px` }}
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
              const task = tasks.find((item) => item.id === taskContextMenu.taskId)
              if (task) openTaskNotes(task)
              setTaskContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <FileText size={14} />
            Task notes
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
