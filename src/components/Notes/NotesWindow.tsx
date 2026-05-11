import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { modulePaneSizing, clampPaneWidth, getPaneWidthForViewport } from '../../config/modulePaneSizes'
import { useApi } from '../../hooks/useApi'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader'
import { SkeletonLoader, SkeletonNoteCard } from '../Common/Skeleton'
import { MindMapEditor } from './MindMapEditor'
import { RichTextEditor } from './RichTextEditor'
import { useViewportWidth } from '../../hooks/useViewportWidth'
import { CreateNoteModal } from './CreateNoteModal'

type NoteRow = {
  id: string
  title: string
  content: string
  date: string
  mood: string | null
  source: string
  parent_id?: string | null
  section_id?: string | null
  sort_order?: number
  depth?: number
  color?: string | null
  mode?: 'text' | 'mind_map'
  mind_map_structure?: unknown
  created_at: string
  updated_at: string
}

type NoteTreeNode = NoteRow & {
  depth: number
  children: NoteTreeNode[]
}

type NoteSection = {
  id: string
  name: string
  color: 'blue' | 'orange' | 'purple' | 'green' | 'pink' | 'gray'
  sort_order: number
  collapsed: boolean
}

const POLL_INTERVAL_MS = 15000
const LEFT_PANE_MIN_WIDTH = 260
const LEFT_PANE_MAX_WIDTH = 380
const RIGHT_PANE_MIN_WIDTH = 250
const RIGHT_PANE_MAX_WIDTH = 360
type NoteContextMenuState = {
  x: number
  y: number
  noteId: string
}

const todayKey = () => new Date().toISOString().slice(0, 10)

const htmlToPlainText = (value: string) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeEditorHtml = (value: string) => {
  const trimmed = String(value ?? '').trim().toLowerCase()
  if (!trimmed || trimmed === '<p><br></p>' || trimmed === '<p></p>') {
    return '<p></p>'
  }
  return String(value ?? '')
}

const wordCount = (text: string) =>
  htmlToPlainText(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

const getColorClasses = (color: string) => {
  const colorMap: Record<string, { dot: string; text: string; bg: string; border: string }> = {
    blue: { dot: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-l-2 border-blue-400' },
    orange: { dot: 'bg-orange-500', text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-l-2 border-orange-400' },
    purple: { dot: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-l-2 border-purple-400' },
    green: { dot: 'bg-green-500', text: 'text-green-600', bg: 'bg-green-50', border: 'border-l-2 border-green-400' },
    pink: { dot: 'bg-pink-500', text: 'text-pink-600', bg: 'bg-pink-50', border: 'border-l-2 border-pink-400' },
    gray: { dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', border: 'border-l-2 border-gray-300' },
  }
  return colorMap[color] || colorMap.gray
}

const formatCompactDateTime = (value: string) =>
  new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const formatSavedStatus = (savedAt: string | null, isSaving: boolean, isDirty: boolean) => {
  if (isSaving) return 'Saving...'
  if (!savedAt) return isDirty ? 'Unsaved' : 'Saved'

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(savedAt).getTime()) / 1000))
  if (elapsedSeconds < 2) return 'Saved'
  if (elapsedSeconds < 60) return `Saved ${elapsedSeconds}s ago`

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `Saved ${elapsedMinutes}m ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  return `Saved ${elapsedHours}h ago`
}

const removeNoteFromTree = (nodes: NoteTreeNode[], noteId: string): NoteTreeNode[] => {
  return nodes
    .filter((node) => node.id !== noteId)
    .map((node) => ({
      ...node,
      children: removeNoteFromTree(node.children ?? [], noteId),
    }))
}

const insertChildIntoTree = (nodes: NoteTreeNode[], parentId: string, child: NoteTreeNode): NoteTreeNode[] => {
  return nodes.map((node) => {
    if (node.id === parentId) {
      return {
        ...node,
        children: [...(node.children ?? []), child],
      }
    }
    if (node.children?.length) {
      return {
        ...node,
        children: insertChildIntoTree(node.children, parentId, child),
      }
    }
    return node
  })
}

export const NotesWindow = () => {
  const { user } = useAuthContext()
  const { activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const viewportWidth = useViewportWidth()
  const initialFocusNoteId = new URLSearchParams(window.location.search).get('focusNoteId')
  const titleRef = useRef<HTMLInputElement | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const savingIndicatorTimerRef = useRef<number | null>(null)
  const isEditingRef = useRef(false)
  const isDirtyRef = useRef(false)

  const [notes, setNotes] = useState<NoteRow[]>([])
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([])
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftDate, setDraftDate] = useState(todayKey())
  const [draftMood, setDraftMood] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showSavingIndicator, setShowSavingIndicator] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [saveStatusTick, setSaveStatusTick] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false)
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.notes.left)
  )
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.notes.right)
  )
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false)
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(false)
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false)
  const [isResizingRightPane, setIsResizingRightPane] = useState(false)
  const [noteContextMenu, setNoteContextMenu] = useState<NoteContextMenuState | null>(null)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [isInspectorActionsOpen, setIsInspectorActionsOpen] = useState(false)
  const [draftMode, setDraftMode] = useState<'text' | 'mind_map'>('text')
  const [draftMindMapStructure, setDraftMindMapStructure] = useState<unknown>(null)
  const [isMindMapFullscreen, setIsMindMapFullscreen] = useState(false)
  const [isNoteActionsOpen, setIsNoteActionsOpen] = useState(false)
  const [isTemplatesExpanded, setIsTemplatesExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('notes-templates-expanded')
      return stored !== null ? JSON.parse(stored) : false
    } catch {
      return false
    }
  })
  const [sections, setSections] = useState<NoteSection[]>(() => {
    try {
      const stored = localStorage.getItem('notes-sections')
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {}
    return []
  })
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('notes-sections-collapsed')
      return new Set(stored ? JSON.parse(stored) : [])
    } catch {
      return new Set()
    }
  })
  const noteActionsMenuRef = useRef<HTMLDivElement | null>(null)
  const inspectorActionsRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const quickTemplates = [
    { id: 'meeting-notes', name: 'Meeting Notes' },
    { id: 'project-brief', name: 'Project Brief' },
    { id: 'daily-reflection', name: 'Daily Reflection' },
    { id: 'book-notes', name: 'Book Notes' },
  ]

  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed
  const isCompactLayout = viewportWidth < modulePaneSizing.notes.left.compactBreakpoint

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  )

  const exitMindMapFullscreen = useCallback(() => {
    setIsMindMapFullscreen(false)
  }, [])

  const beginInlineRename = useCallback((noteId: string) => {
    const note = notes.find((item) => item.id === noteId)
    if (!note) return

    setRenamingNoteId(noteId)
    setRenameDraft(note.title || '')
    window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }, [notes])

  const cancelInlineRename = useCallback(() => {
    setRenamingNoteId(null)
    setRenameDraft('')
  }, [])

  const commitInlineRename = useCallback(async () => {
    if (!renamingNoteId) return

    const trimmed = renameDraft.trim() || 'Untitled note'
    const existing = notes.find((item) => item.id === renamingNoteId)
    if (!existing) {
      cancelInlineRename()
      return
    }
    if (trimmed === (existing.title || 'Untitled note')) {
      cancelInlineRename()
      return
    }

    setNotes((prev) => prev.map((item) => (item.id === renamingNoteId ? { ...item, title: trimmed } : item)))
    if (selectedNoteId === renamingNoteId) {
      setDraftTitle(trimmed)
    }

    try {
      const updated = (await api.updateNote(renamingNoteId, { title: trimmed })) as NoteRow
      setNotes((prev) => prev.map((item) => (item.id === renamingNoteId ? updated : item)))
      setLastSavedAt(updated.updated_at)
      if (selectedNoteId === renamingNoteId) {
        setDraftTitle(updated.title || trimmed)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not rename note.')
      setNotes((prev) => prev.map((item) => (item.id === renamingNoteId ? existing : item)))
      if (selectedNoteId === renamingNoteId) {
        setDraftTitle(existing.title || '')
      }
    } finally {
      cancelInlineRename()
    }
  }, [api, cancelInlineRename, notes, renameDraft, renamingNoteId, selectedNoteId])

  const visibleNotes = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return notes

    return notes.filter((note) => {
      const haystack = [note.title, htmlToPlainText(note.content), note.mood ?? '', note.date].join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [notes, search])

  const nodeById = useMemo(() => {
    const map = new Map<string, NoteTreeNode>()
    const walk = (nodes: NoteTreeNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node)
        if (node.children?.length) walk(node.children)
      }
    }
    walk(noteTree)
    return map
  }, [noteTree])

  const selectedBreadcrumb = useMemo(() => {
    if (!selectedNoteId) return []
    const crumbs: Array<{ id: string; title: string }> = []
    const seen = new Set<string>()
    let cursor = nodeById.get(selectedNoteId) ?? null
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      crumbs.unshift({ id: cursor.id, title: cursor.title || 'Untitled note' })
      cursor = cursor.parent_id ? nodeById.get(cursor.parent_id) ?? null : null
    }
    return crumbs
  }, [nodeById, selectedNoteId])

  const recentNotes = useMemo(
    () =>
      [...notes]
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
        .slice(0, 5),
    [notes]
  )

  const saveStatus = useMemo(
    () => formatSavedStatus(lastSavedAt, showSavingIndicator, isDirty),
    [isDirty, lastSavedAt, saveStatusTick, showSavingIndicator]
  )

  const syncDraftFromNote = useCallback((note: NoteRow) => {
    setDraftTitle(note.title)
    setDraftContent(normalizeEditorHtml(note.content))
    setDraftDate(note.date || todayKey())
    setDraftMood(note.mood ?? '')
    setDraftMode(note.mode || 'text')
    setDraftMindMapStructure(note.mind_map_structure || null)
    setLastSavedAt(note.updated_at)
    setIsDirty(false)
  }, [])

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  const loadNotes = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user || !activeWorkspaceId) {
        setNotes([])
        setSelectedNoteId(null)
        setDraftTitle('')
        setDraftContent('')
        setDraftDate(todayKey())
        setDraftMood('')
        setIsDirty(false)
        setIsLoading(false)
        return
      }

      if (opts?.silent) {
        setIsRefreshing(true)
      } else {
        if (!hasLoadedOnce) {
          setIsLoading(true)
        }
      }

      setError(null)

      try {
        const data = await api.getNotes()
        const payload = data as { notes?: NoteRow[]; tree?: NoteTreeNode[] } | NoteRow[]
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.notes) ? payload.notes : []
        const tree = Array.isArray(payload) ? [] : Array.isArray(payload?.tree) ? payload.tree : []
        setNotes(rows)
        setNoteTree(tree)
        setExpandedNoteIds((current) => {
          if (!tree.length) return current
          const next = new Set(current)
          const ensureParentsOpen = (nodes: NoteTreeNode[]) => {
            for (const node of nodes) {
              if (node.children?.length) next.add(node.id)
            }
          }
          ensureParentsOpen(tree)
          return next
        })

        setSelectedNoteId((currentId) => {
          const currentSelected = currentId ? rows.find((note) => note.id === currentId) ?? null : null

          if (currentSelected) {
            return currentSelected.id
          }

          if (rows.length > 0) {
            const next = rows[0]
            if (!isEditingRef.current && !isDirtyRef.current) {
              syncDraftFromNote(next)
            }
            return next.id
          }

          return null
        })

        if (rows.length === 0 && !isEditingRef.current && !isDirtyRef.current) {
          setDraftTitle('')
          setDraftContent('')
          setDraftDate(todayKey())
          setDraftMood('')
          setLastSavedAt(null)
          setIsDirty(false)
        }
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Could not load notes.')
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
        setHasLoadedOnce(true)
      }
    },
    [api, activeWorkspaceId, hasLoadedOnce, syncDraftFromNote, user]
  )

  const flushAutosave = useCallback(
    async (override?: { title?: string; content?: string; date?: string; mood?: string }) => {
      if (!selectedNoteId) return null

      const noteTitle = (override?.title ?? draftTitle).trim() || 'Untitled note'
      const noteContent = normalizeEditorHtml(override?.content ?? draftContent)
      const noteDate = (override?.date ?? draftDate).trim() || todayKey()
      const noteMood = (override?.mood ?? draftMood).trim() || null
      const meaningfulLength = `${noteTitle}${htmlToPlainText(noteContent)}`.replace(/\s/g, '').length

      if (meaningfulLength < 2) {
        return null
      }

      if (savingIndicatorTimerRef.current) {
        window.clearTimeout(savingIndicatorTimerRef.current)
      }
      savingIndicatorTimerRef.current = window.setTimeout(() => {
        setShowSavingIndicator(true)
      }, 350)
      setError(null)

      try {
      const data = await api.updateNote(selectedNoteId, {
        title: noteTitle,
        content_html: noteContent,
        date: noteDate,
        mood: noteMood,
        source: 'workspace',
        mode: draftMode,
        mind_map_structure: draftMindMapStructure,
      })
        const updated = data as NoteRow
        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)))
        setIsDirty(false)
        setLastSavedAt(updated.updated_at)
        return updated
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save note.')
        return null
      } finally {
        if (savingIndicatorTimerRef.current) {
          window.clearTimeout(savingIndicatorTimerRef.current)
          savingIndicatorTimerRef.current = null
        }
        setShowSavingIndicator(false)
      }
    },
    [api, draftContent, draftDate, draftMood, draftMode, draftMindMapStructure, draftTitle, selectedNoteId]
  )

  const openNote = useCallback(
    async (note: NoteRow) => {
      if (selectedNoteId === note.id) return
      if (isDirty) {
        const saved = await flushAutosave()
        if (!saved) return
      }
      setSelectedNoteId(note.id)
      syncDraftFromNote(note)
      titleRef.current?.focus()
    },
    [flushAutosave, isDirty, selectedNoteId, syncDraftFromNote]
  )

  const createNewNote = useCallback(async () => {
    if (!user) return
    if (isDirty) {
      const saved = await flushAutosave()
      if (!saved) return
    }

    setIsCreating(true)
    setError(null)

    try {
      const data = await api.createNote('Untitled note', '', {
        content_html: '<p></p>',
        date: todayKey(),
        mood: null,
        source: 'workspace',
      })

      const created = data as NoteRow
      setNotes((prev) => [created, ...prev])
      setNoteTree((prev) => [
        {
          ...created,
          depth: 0,
          children: [],
        },
        ...prev,
      ])
      setSelectedNoteId(created.id)
      syncDraftFromNote(created)
      setTimeout(() => titleRef.current?.focus(), 0)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create note.')
    } finally {
      setIsCreating(false)
    }
  }, [api, flushAutosave, isDirty, syncDraftFromNote, user])

  const createChildNote = useCallback(
    async (parentId: string) => {
      if (!user || !parentId) return
      if (isDirty) {
        const saved = await flushAutosave()
        if (!saved) return
      }

      setIsCreating(true)
      setError(null)
      try {
        const created = (await api.createChildNote(parentId, {
          title: 'Untitled child note',
          content_html: '<p></p>',
          date: todayKey(),
          mood: null,
          source: 'workspace',
        })) as NoteRow
        setNotes((prev) => [created, ...prev])
        setNoteTree((prev) => {
          const childNode: NoteTreeNode = {
            ...created,
            depth: created.depth ?? 1,
            children: [],
          }
          if (!prev.length) return [childNode]
          return insertChildIntoTree(prev, parentId, childNode)
        })
        setSelectedNoteId(created.id)
        syncDraftFromNote(created)
        setExpandedNoteIds((current) => new Set(current).add(parentId))
        setTimeout(() => titleRef.current?.focus(), 0)
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Could not create child note.')
      } finally {
        setIsCreating(false)
      }
    },
    [api, flushAutosave, isDirty, syncDraftFromNote, user]
  )

  const deleteSelectedNote = useCallback(async () => {
    if (!selectedNote) return

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    setIsDeleting(true)
    setError(null)

    try {
      await api.deleteNote(selectedNote.id)
      setNotes((prev) => {
        const next = prev.filter((note) => note.id !== selectedNote.id)
        const fallback = next[0] ?? null
        if (fallback) {
          setSelectedNoteId(fallback.id)
          syncDraftFromNote(fallback)
        } else {
          setSelectedNoteId(null)
          setDraftTitle('')
          setDraftContent('')
          setDraftDate(todayKey())
          setDraftMood('')
          setIsDirty(false)
        }
        return next
      })
      setNoteTree((prev) => removeNoteFromTree(prev, selectedNote.id))
      setExpandedNoteIds((prev) => {
        const next = new Set(prev)
        next.delete(selectedNote.id)
        return next
      })
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete note.')
    } finally {
      setIsDeleting(false)
    }
  }, [api, selectedNote, syncDraftFromNote])

  const deleteNoteById = useCallback(
    async (noteId: string) => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }

      const target = notes.find((note) => note.id === noteId)
      if (!target) return

      setIsDeleting(true)
      setError(null)

      try {
        await api.deleteNote(noteId)
        setNotes((prev) => {
          const next = prev.filter((note) => note.id !== noteId)
          const fallback = next[0] ?? null
          if (fallback) {
            setSelectedNoteId(fallback.id)
            syncDraftFromNote(fallback)
          } else {
            setSelectedNoteId(null)
            setDraftTitle('')
            setDraftContent('')
            setDraftDate(todayKey())
            setDraftMood('')
            setIsDirty(false)
          }
          return next
        })
        setNoteTree((prev) => removeNoteFromTree(prev, noteId))
        setExpandedNoteIds((prev) => {
          const next = new Set(prev)
          next.delete(noteId)
          return next
        })
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : 'Could not delete note.')
      } finally {
        setIsDeleting(false)
      }
    },
    [api, notes, syncDraftFromNote]
  )

  useEffect(() => {
    void loadNotes()
    const poll = window.setInterval(() => {
      if (isEditingRef.current || isDirty) return
      void loadNotes({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(poll)
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
      if (savingIndicatorTimerRef.current) {
        window.clearTimeout(savingIndicatorTimerRef.current)
      }
    }
  }, [loadNotes, activeWorkspaceId])

  // Load sections from database when workspace changes
  useEffect(() => {
    const loadSections = async () => {
      try {
        const data = await api.getSections()
        setSections(data || [])
        localStorage.setItem('notes-sections', JSON.stringify(data || []))
      } catch (error) {
        console.error('Failed to load sections:', error)
      }
    }

    if (activeWorkspaceId) {
      void loadSections()
    }
  }, [activeWorkspaceId, api])

  useEffect(() => {
    setLeftPaneWidth((current) => clampPaneWidth(current, viewportWidth, modulePaneSizing.notes.left))
    setRightPaneWidth((current) => clampPaneWidth(current, viewportWidth, modulePaneSizing.notes.right))
  }, [viewportWidth])

  useEffect(() => {
    if (!selectedNoteId || !isDirty) return

    const noteTitle = draftTitle.trim() || 'Untitled note'
    const noteContent = normalizeEditorHtml(draftContent)
    const meaningfulLength = `${noteTitle}${htmlToPlainText(noteContent)}`.replace(/\s/g, '').length
    if (meaningfulLength < 2) return

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void flushAutosave()
    }, 1200)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [draftContent, draftDate, draftMood, draftTitle, flushAutosave, isDirty, selectedNoteId])

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
    if (!noteContextMenu) return

    const closeMenu = () => setNoteContextMenu(null)
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
  }, [noteContextMenu])

  useEffect(() => {
    if (!isInspectorActionsOpen) return

    const closeMenu = () => setIsInspectorActionsOpen(false)
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
  }, [isInspectorActionsOpen])

  useEffect(() => {
    if (draftMode !== 'mind_map') {
      setIsMindMapFullscreen(false)
    }
  }, [draftMode, selectedNoteId])

  useEffect(() => {
    if (!isMindMapFullscreen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        exitMindMapFullscreen()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exitMindMapFullscreen, isMindMapFullscreen])

  useEffect(() => {
    if (!initialFocusNoteId) return
    if (!notes.length) return
    if (selectedNoteId === initialFocusNoteId) return

    const target = notes.find((note) => note.id === initialFocusNoteId)
    if (!target) return
    void openNote(target)
  }, [initialFocusNoteId, notes, openNote, selectedNoteId])

  useEffect(() => {
    const focusNoteListener = (_event: unknown, payload: { kind?: string; focusNoteId?: string | null }) => {
      if (payload?.kind !== 'notes' || !payload.focusNoteId) return
      const target = notes.find((note) => note.id === payload.focusNoteId)
      if (!target) return
      void openNote(target)
    }

    window.ipcRenderer?.on('module:focus-note', focusNoteListener)

    return () => {
      window.ipcRenderer?.off('module:focus-note', focusNoteListener)
    }
  }, [notes, openNote])

  useEffect(() => {
    if (!lastSavedAt || isDirty || showSavingIndicator) return

    const timer = window.setInterval(() => {
      setSaveStatusTick((current) => current + 1)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [isDirty, lastSavedAt, showSavingIndicator])

  useEffect(() => {
    if (!isNoteActionsOpen) return

    const closeMenu = () => setIsNoteActionsOpen(false)
    const onPointerDown = (event: MouseEvent) => {
      if (noteActionsMenuRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [isNoteActionsOpen])

  return (
    <div className="h-screen overflow-hidden rounded-[28px] border border-gray-200 bg-[#f5f7fb] flex flex-col shadow-[0_24px_80px_rgba(15,23,42,0.08)]" style={{ scrollbarGutter: 'stable' }}>
      <ModuleWindowHeader
        title="Notes"
        subtitle="Your simple note workspace"
        icon={<StickyNote size={18} className="text-amber-600" />}
        closeLabel="Close notes"
        minimizeLabel="Minimize notes"
        onMinimize={() => {
          void flushAutosave().finally(() => {
            void window.desktopWindow?.minimizeModule('notes')
          })
        }}
        fullscreenLabel="Fullscreen notes"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('notes')
        }}
        onClose={() => {
          void flushAutosave().finally(() => {
            void window.desktopWindow?.closeModule('notes')
          })
        }}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1 shadow-sm">
              <button
                onClick={() => {
                  if (areSidePanelsCollapsed) {
                    setIsLeftPaneCollapsed(false)
                    setIsRightPaneCollapsed(false)
                  } else {
                    setIsLeftPaneCollapsed(true)
                    setIsRightPaneCollapsed(true)
                  }
                }}
                className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
                title={areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
              >
                {areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
              </button>
              <button
                onClick={() => setShowCreateNoteModal(true)}
                disabled={isCreating}
                className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none disabled:opacity-60"
              >
                <Plus size={13} />
                {isCreating ? 'Creating...' : 'New note'}
              </button>
            </div>
            <button
              onClick={() => void loadNotes({ silent: true })}
              className="h-8 rounded-full border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5"
              title="Refresh notes"
            >
              <Clock size={13} />
              {isRefreshing ? 'Syncing' : 'Live'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed && (
          <>
            <aside
              className={`border-r border-gray-200 bg-white flex flex-col overflow-hidden shrink-0 ${isCompactLayout ? 'text-sm' : ''}`}
              style={{ width: `${leftPaneWidth}px` }}
            >
          <div className={`${isCompactLayout ? 'p-3' : 'p-4'} border-b border-gray-100`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-600">Notes</h2>
              <button
                onClick={() => setShowCreateNoteModal(true)}
                disabled={isCreating}
                className="h-7 px-2.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition inline-flex items-center gap-1.5 disabled:opacity-60"
                title="Create a new note"
              >
                <Plus size={12} />
                New
              </button>
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes"
                className="w-full h-8 pl-9 pr-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200"
              />
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isCompactLayout ? 'p-2' : 'p-3'} space-y-0`}>
            {isLoading ? (
              <div className="space-y-2 px-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonNoteCard key={i} />
                ))}
              </div>
            ) : visibleNotes.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-sm font-medium text-gray-800">
                  {notes.length === 0 ? 'No notes yet' : 'No matching notes'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {notes.length === 0 ? 'Create your first note to start writing.' : 'Try a different search.'}
                </p>
              </div>
            ) : search.trim() ? (
              // Search results - flat view
              <div className="space-y-0.5">
                {visibleNotes.map((note) => {
                  const active = note.id === selectedNoteId
                  const preview = htmlToPlainText(note.content).slice(0, 80) || '—'
                  
                  return (
                    <button
                      key={note.id}
                      onClick={() => void openNote(note)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setNoteContextMenu({ x: event.clientX, y: event.clientY, noteId: note.id })
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition ${
                        active ? 'bg-[#fff1ec] text-[#b7442c]' : 'bg-transparent hover:bg-gray-50 text-gray-900'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <StickyNote size={13} className="text-gray-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{note.title || 'Untitled'}</p>
                          <p className="text-xs text-gray-500 truncate">{preview}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              // Tree view with sections
              <div className="space-y-1.5">
                {sections.map((section) => {
                  const sectionColor = getColorClasses(section.color)
                  const isSectionCollapsed = collapsedSectionIds.has(section.id)
                  const sectionNotes = notes.filter((n) => n.section_id === section.id && !n.parent_id)
                  
                  return (
                    <div key={section.id}>
                      {/* Section header */}
                      <button
                        onClick={() => {
                          const next = new Set(collapsedSectionIds)
                          if (next.has(section.id)) next.delete(section.id)
                          else next.add(section.id)
                          setCollapsedSectionIds(next)
                          try {
                            localStorage.setItem('notes-sections-collapsed', JSON.stringify([...next]))
                          } catch (e) {
                            console.error('Failed to save section state:', e)
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          // TODO: Add section context menu
                        }}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-lg transition group"
                      >
                        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${sectionColor.dot}`} />
                        <Folder size={14} className="text-gray-500 shrink-0" />
                        <span className="flex-1 truncate">{section.name}</span>
                        <ChevronRight
                          size={14}
                          className={`text-gray-400 transition-transform shrink-0 ${!isSectionCollapsed ? 'rotate-90' : ''}`}
                        />
                        <span className="text-xs text-gray-400 mr-1">{sectionNotes.length}</span>
                      </button>
                      
                      {/* Section notes */}
                      {!isSectionCollapsed && (
                        <div className="space-y-0.5 pl-4">
                          {sectionNotes.map((note) => {
                            const active = note.id === selectedNoteId
                            const preview = htmlToPlainText(note.content).slice(0, 60) || 'No content'
                            const isExpanded = expandedNoteIds.has(note.id)
                            // Count children
                            const childCount = notes.filter((n) => n.parent_id === note.id).length
                            
                            return (
                              <div key={note.id} className="space-y-0.5">
                                {/* Note row */}
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    onClick={() => void openNote(note)}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      setNoteContextMenu({ x: event.clientX, y: event.clientY, noteId: note.id })
                                    }}
                                    className={`flex-1 min-w-0 px-2.5 py-2 rounded-lg text-left text-sm transition ${
                                      active
                                        ? 'bg-[#fff1ec] text-[#b7442c]'
                                        : 'bg-transparent hover:bg-gray-50 text-gray-900'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {childCount > 0 ? (
                                        <Folder size={12} className="text-gray-500 shrink-0" />
                                      ) : (
                                        <StickyNote size={12} className="text-gray-500 shrink-0" />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        {renamingNoteId === note.id ? (
                                          <input
                                            ref={renameInputRef}
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onBlur={() => {
                                              void commitInlineRename()
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault()
                                                void commitInlineRename()
                                              } else if (e.key === 'Escape') {
                                                e.preventDefault()
                                                cancelInlineRename()
                                              }
                                            }}
                                            className="w-full bg-transparent font-medium text-gray-900 outline-none"
                                          />
                                        ) : (
                                          <p className="font-medium truncate">{note.title || 'Untitled'}</p>
                                        )}
                                        <p className="text-xs text-gray-500 truncate">{preview}</p>
                                      </div>
                                    </div>
                                  </button>
                                  {childCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExpandedNoteIds((current) => {
                                          const next = new Set(current)
                                          if (next.has(note.id)) next.delete(note.id)
                                          else next.add(note.id)
                                          return next
                                        })
                                      }}
                                      className="h-5 w-5 shrink-0 rounded text-gray-500 hover:text-gray-700"
                                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                    >
                                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </button>
                                  )}
                                </div>
                                
                                {/* Child notes */}
                                {isExpanded && childCount > 0 && (
                                  <div className="space-y-0.5 pl-4">
                                    {notes
                                      .filter((n) => n.parent_id === note.id)
                                      .map((child) => (
                                        <div key={child.id} className="flex items-center gap-1 min-w-0">
                                          <div className="w-5 shrink-0" />
                                          <button
                                            onClick={() => void openNote(child)}
                                            onContextMenu={(event) => {
                                              event.preventDefault()
                                              setNoteContextMenu({ x: event.clientX, y: event.clientY, noteId: child.id })
                                            }}
                                            className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-left text-xs transition ${
                                              selectedNoteId === child.id
                                                ? 'bg-[#fff1ec] text-[#b7442c]'
                                                : 'bg-transparent hover:bg-gray-50 text-gray-800'
                                            }`}
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <StickyNote size={11} className="text-gray-400 shrink-0" />
                                              <p className="font-medium truncate">{child.title || 'Untitled'}</p>
                                            </div>
                                          </button>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          
                          {/* Add note button in section */}
                          <button
                            onClick={() => {
                              // TODO: Open create note modal with section pre-selected
                              setShowCreateNoteModal(true)
                            }}
                            className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition flex items-center gap-2"
                          >
                            <Plus size={12} />
                            Add note
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                
                {/* Unsorted section for notes without a section */}
                {(() => {
                  const unsortedNotes = notes.filter((n) => !n.section_id && !n.parent_id)
                  if (unsortedNotes.length === 0) return null
                  
                  const isUnsortedCollapsed = collapsedSectionIds.has('__unsorted__')
                  const sectionColor = getColorClasses('gray')
                  
                  return (
                    <div>
                      <button
                        onClick={() => {
                          const next = new Set(collapsedSectionIds)
                          if (next.has('__unsorted__')) next.delete('__unsorted__')
                          else next.add('__unsorted__')
                          setCollapsedSectionIds(next)
                          try {
                            localStorage.setItem('notes-sections-collapsed', JSON.stringify([...next]))
                          } catch (e) {
                            console.error('Failed to save section state:', e)
                          }
                        }}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-lg transition group"
                      >
                        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${sectionColor.dot}`} />
                        <Folder size={14} className="text-gray-500 shrink-0" />
                        <span className="flex-1 truncate">Unsorted</span>
                        <ChevronRight
                          size={14}
                          className={`text-gray-400 transition-transform shrink-0 ${!isUnsortedCollapsed ? 'rotate-90' : ''}`}
                        />
                        <span className="text-xs text-gray-400 mr-1">{unsortedNotes.length}</span>
                      </button>
                      
                      {!isUnsortedCollapsed && (
                        <div className="space-y-0.5 pl-4">
                          {unsortedNotes.map((note) => {
                            const active = note.id === selectedNoteId
                            const preview = htmlToPlainText(note.content).slice(0, 60) || 'No content'
                            const isExpanded = expandedNoteIds.has(note.id)
                            const childCount = notes.filter((n) => n.parent_id === note.id).length
                            
                            return (
                              <div key={note.id} className="space-y-0.5">
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    onClick={() => void openNote(note)}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      setNoteContextMenu({ noteId: note.id, x: event.clientX, y: event.clientY })
                                    }}
                                    className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer flex items-center gap-2 ${
                                      active ? 'bg-[#fff1ec] text-[#b7442c]' : 'text-gray-700'
                                    }`}
                                  >
                                    {childCount > 0 ? (
                                      <Folder size={13} className="shrink-0" />
                                    ) : (
                                      <StickyNote size={13} className="shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      {renamingNoteId === note.id ? (
                                        <input
                                          ref={renameInputRef}
                                          value={renameDraft}
                                          onChange={(e) => setRenameDraft(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          onMouseDown={(e) => e.stopPropagation()}
                                          onBlur={() => {
                                            void commitInlineRename()
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              void commitInlineRename()
                                            } else if (e.key === 'Escape') {
                                              e.preventDefault()
                                              cancelInlineRename()
                                            }
                                          }}
                                          className="w-full bg-transparent font-medium text-gray-900 outline-none"
                                        />
                                      ) : (
                                        <p className="font-medium truncate">{note.title || 'Untitled'}</p>
                                      )}
                                      <p className="text-xs text-gray-500 truncate">{preview}</p>
                                    </div>
                                  </button>
                                  {childCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExpandedNoteIds((current) => {
                                          const next = new Set(current)
                                          if (next.has(note.id)) next.delete(note.id)
                                          else next.add(note.id)
                                          return next
                                        })
                                      }}
                                      className="h-5 w-5 shrink-0 rounded text-gray-500 hover:text-gray-700"
                                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                    >
                                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </button>
                                  )}
                                </div>
                                {isExpanded && childCount > 0 && (
                                  <div className="space-y-0.5 pl-6">
                                    {notes
                                      .filter((n) => n.parent_id === note.id)
                                      .map((child) => {
                                        const childActive = child.id === selectedNoteId
                                        const childPreview = htmlToPlainText(child.content).slice(0, 50) || 'No content'
                                        return (
                                          <button
                                            key={child.id}
                                            onClick={() => void openNote(child)}
                                            onContextMenu={(event) => {
                                              event.preventDefault()
                                              setNoteContextMenu({ noteId: child.id, x: event.clientX, y: event.clientY })
                                            }}
                                            className={`w-full text-left px-2 py-1 rounded-lg text-sm flex items-center gap-2 transition ${
                                              childActive ? 'bg-[#fff1ec] text-[#b7442c]' : 'text-gray-600 hover:bg-gray-100'
                                            }`}
                                          >
                                            <StickyNote size={12} className="shrink-0" />
                                            <div className="min-w-0 flex-1">
                                              {renamingNoteId === child.id ? (
                                                <input
                                                  ref={renameInputRef}
                                                  value={renameDraft}
                                                  onChange={(e) => setRenameDraft(e.target.value)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  onMouseDown={(e) => e.stopPropagation()}
                                                  onBlur={() => {
                                                    void commitInlineRename()
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                      e.preventDefault()
                                                      void commitInlineRename()
                                                    } else if (e.key === 'Escape') {
                                                      e.preventDefault()
                                                      cancelInlineRename()
                                                    }
                                                  }}
                                                  className="w-full bg-transparent font-medium text-gray-900 outline-none"
                                                />
                                              ) : (
                                                <p className="font-medium truncate">{child.title || 'Untitled'}</p>
                                              )}
                                              <p className="text-xs text-gray-500 truncate">{childPreview}</p>
                                            </div>
                                          </button>
                                        )
                                      })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Collapsible Templates section */}
          <div className="border-t border-gray-100">
            <button
              onClick={() => {
                const newState = !isTemplatesExpanded
                setIsTemplatesExpanded(newState)
                try {
                  localStorage.setItem('notes-templates-expanded', JSON.stringify(newState))
                } catch (e) {
                  console.error('Failed to save templates state:', e)
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              <span className="flex items-center gap-2">
                <Zap size={13} className="text-gray-500" />
                Templates
              </span>
              <ChevronRight
                size={13}
                className={`text-gray-400 transition-transform ${isTemplatesExpanded ? 'rotate-90' : ''}`}
              />
            </button>
            
            {isTemplatesExpanded && (
              <div className="px-3 py-3 space-y-1.5 bg-transparent">
                {quickTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      const handleTemplate = async () => {
                        if (isDirty) {
                          const saved = await flushAutosave()
                          if (!saved) return
                        }
                        setIsCreating(true)
                        try {
                          const note = await api.createNoteFromTemplate(template.id)
                          setNotes((prev) => [note as NoteRow, ...prev])
                          setNoteTree((prev) => [
                            {
                              ...(note as NoteRow),
                              depth: (note as NoteRow).depth ?? 0,
                              children: [],
                            },
                            ...prev,
                          ])
                          setSelectedNoteId(note.id)
                          syncDraftFromNote(note as NoteRow)
                          setTimeout(() => titleRef.current?.focus(), 0)
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to create note')
                        } finally {
                          setIsCreating(false)
                        }
                      }
                      void handleTemplate()
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100 transition truncate"
                  >
                    {template.name}
                  </button>
                ))}
                <button
                  onClick={() => setShowCreateNoteModal(true)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold border border-[#ea5336] bg-[#FF5F40] text-white hover:bg-[#ea5336] active:bg-[#d94b31] transition flex items-center justify-center"
                >
                  Browse All Templates
                </button>
              </div>
            )}
          </div>
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={() => setIsResizingLeftPane(true)}
              className="w-1.5 cursor-col-resize bg-transparent hover:bg-gray-200/70 transition"
              title="Resize panels"
            />
          </>
        )}

        <section className={`flex-1 min-w-0 ${areSidePanelsCollapsed ? 'p-4' : isCompactLayout ? 'p-2' : 'p-2.5'}`}>
          <div className="h-full rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
            {isLoading ? (
              <div className="flex-1 p-5 space-y-4">
                <SkeletonLoader />
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-20 rounded-2xl bg-gray-100 animate-pulse" />
                  <div className="h-20 rounded-2xl bg-gray-100 animate-pulse" />
                  <div className="h-20 rounded-2xl bg-gray-100 animate-pulse" />
                </div>
              </div>
            ) : selectedNote ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="border-b border-gray-100 px-6 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-[11px] text-gray-500 truncate">
                      Home{selectedBreadcrumb.length ? ` > ${selectedBreadcrumb.map((crumb) => crumb.title).join(' > ')}` : ''}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-gray-500">{saveStatus}</span>
                      <div className="relative" ref={noteActionsMenuRef}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setIsNoteActionsOpen((current) => !current)
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                          aria-label="Note actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {isNoteActionsOpen && (
                          <div className="absolute right-0 top-9 z-40 min-w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false)
                                void createChildNote(selectedNote.id)
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Add child note
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false)
                                titleRef.current?.focus()
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false)
                                const firstSection = sections[0]
                                if (!firstSection) return
                                void api.updateNote(selectedNote.id, { section_id: firstSection.id }).then((updated) => {
                                  const row = updated as NoteRow
                                  setNotes((prev) => prev.map((note) => (note.id === row.id ? row : note)))
                                })
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Move to section...
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false)
                                void api.saveNoteAsTemplate(selectedNote.id, { name: draftTitle || selectedNote.title || 'Untitled note' })
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Save as template
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false)
                                void createNewNote()
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Duplicate
                            </button>
                            <button
                              disabled={isDeleting}
                              onClick={() => {
                                setIsNoteActionsOpen(false)
                                void deleteSelectedNote()
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {isDeleting ? 'Deleting...' : 'Delete note'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <input
                      ref={titleRef}
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value)
                        setIsDirty(true)
                      }}
                      onFocus={() => {
                        isEditingRef.current = true
                      }}
                      onBlur={() => {
                        isEditingRef.current = false
                      }}
                      placeholder="Untitled note"
                      className="w-full text-4xl font-semibold tracking-tight text-gray-900 placeholder:text-gray-300 focus:outline-none bg-transparent"
                    />
                    <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftMode('text')
                          setIsDirty(true)
                        }}
                        className={`h-7 rounded-md px-2.5 text-xs font-medium ${draftMode === 'text' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        Write
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftMode('mind_map')
                          setIsDirty(true)
                        }}
                        className={`h-7 rounded-md px-2.5 text-xs font-medium ${draftMode === 'mind_map' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        Mind Map
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto p-6">
                  <div className="max-w-3xl mx-auto space-y-6">
                    {draftMode === 'text' ? (
                      <RichTextEditor
                        editorKey={selectedNote.id}
                        initialValue={draftContent}
                        onChange={(nextHtml) => {
                          const normalizedNext = normalizeEditorHtml(nextHtml)
                          const normalizedCurrent = normalizeEditorHtml(draftContent)
                          if (normalizedNext === normalizedCurrent) return
                          setDraftContent(normalizedNext)
                          setIsDirty(true)
                        }}
                        onFocus={() => {
                          isEditingRef.current = true
                        }}
                        onBlur={() => {
                          isEditingRef.current = false
                          void flushAutosave()
                        }}
                      />
                    ) : (
                      <div className="w-full min-h-[calc(100vh-330px)] mt-4">
                        <MindMapEditor
                          structure={draftMindMapStructure}
                          onChange={(structure) => {
                            setDraftMindMapStructure(structure)
                            setIsDirty(true)
                          }}
                          isFullscreen={isMindMapFullscreen}
                          onToggleFullscreen={() => setIsMindMapFullscreen((current) => !current)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                  <div className="h-12 w-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto">
                    <StickyNote size={22} className="text-amber-600" />
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-gray-900">No note selected</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Create a note to start writing, planning, or dumping ideas.
                  </p>
                  <button
                    onClick={() => void createNewNote()}
                    className="mt-5 px-4 py-2 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
                  >
                    New note
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {!isRightPaneCollapsed && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={() => setIsResizingRightPane(true)}
              className="w-1.5 cursor-col-resize bg-transparent hover:bg-gray-200/70 transition"
              title="Resize panels"
            />

            <aside
              className={`border-l border-gray-200 bg-[#fbfcfe] overflow-auto ${isCompactLayout ? 'p-3 space-y-3' : 'p-4 space-y-4'} shrink-0`}
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Inspector</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
                      {selectedNote ? 'Current note' : 'No note selected'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      {selectedNote
                        ? selectedBreadcrumb.length
                          ? selectedBreadcrumb.map((crumb) => crumb.title).join(' > ')
                          : 'Home'
                        : 'Select a note to view details.'}
                    </p>
                  </div>

                  <div className="relative shrink-0" ref={inspectorActionsRef}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setIsInspectorActionsOpen((current) => !current)
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      aria-label="Inspector actions"
                    >
                      <MoreHorizontal size={14} />
                    </button>

                    {isInspectorActionsOpen && selectedNote && (
                      <div className="absolute right-0 top-10 z-40 min-w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                        <button
                          onClick={() => {
                            setIsInspectorActionsOpen(false)
                            titleRef.current?.focus()
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => {
                            setIsInspectorActionsOpen(false)
                            void createNewNote()
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => {
                            setIsInspectorActionsOpen(false)
                            void api.saveNoteAsTemplate(selectedNote.id, {
                              name: draftTitle || selectedNote.title || 'Untitled note',
                            })
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Save as template
                        </button>
                        <button
                          onClick={() => {
                            setIsInspectorActionsOpen(false)
                            const firstSection = sections[0]
                            if (!firstSection) return
                            void api.updateNote(selectedNote.id, { section_id: firstSection.id }).then((updated) => {
                              const row = updated as NoteRow
                              setNotes((prev) => prev.map((note) => (note.id === row.id ? row : note)))
                            })
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Move to section...
                        </button>
                        <button
                          onClick={() => {
                            setIsInspectorActionsOpen(false)
                            void createChildNote(selectedNote.id)
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Add child note
                        </button>
                        <div className="my-1 h-px bg-gray-100" />
                        <button
                          disabled={isDeleting}
                          onClick={() => {
                            setIsInspectorActionsOpen(false)
                            void deleteSelectedNote()
                          }}
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {isDeleting ? 'Deleting...' : 'Delete note'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Details</p>
                  {selectedNote ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-500">Created</span>
                        <span className="text-gray-900">{formatCompactDateTime(selectedNote.created_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-500">Updated</span>
                        <span className="text-gray-900">{formatCompactDateTime(selectedNote.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-500">Date</span>
                        <span className="text-gray-900">{selectedNote.date || 'Not set'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-500">Mood</span>
                        <span className="text-gray-900">{selectedNote.mood || 'Not set'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-500">Words</span>
                        <span className="text-gray-900">{wordCount(selectedNote.content)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No metadata to show until a note is selected.</p>
                  )}
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Workspace</p>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-500">Notes</span>
                    <span className="text-gray-900">
                      {notes.length} notes · {visibleNotes.length} visible
                    </span>
                  </div>
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Recent updates</p>
                    <span className="text-[11px] text-gray-400">View all</span>
                  </div>
                  <div className="space-y-1">
                    {recentNotes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => void openNote(note)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-50 transition"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{note.title || 'Untitled note'}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-gray-500">{formatCompactDateTime(note.updated_at)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {draftMode === 'mind_map' && isMindMapFullscreen && (
        <div className="fixed inset-0 z-80 bg-[#f5f7fb]">
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 shadow-sm">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Mind map fullscreen</p>
                <h2 className="truncate text-sm font-semibold text-gray-900">{draftTitle || 'Untitled note'}</h2>
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={exitMindMapFullscreen}
                className="rounded-full border border-gray-200 bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
              >
                Exit fullscreen
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4">
              <MindMapEditor
                structure={draftMindMapStructure}
                onChange={(structure) => {
                  setDraftMindMapStructure(structure)
                  setIsDirty(true)
                }}
                isFullscreen
                onToggleFullscreen={exitMindMapFullscreen}
              />
            </div>
          </div>
        </div>
      )}

      {noteContextMenu && (
        <div
          className="fixed z-210 min-w-44 rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg p-0"
          style={{
            left: Math.max(8, Math.min(noteContextMenu.x, window.innerWidth - 180)),
            top: Math.max(8, Math.min(noteContextMenu.y, window.innerHeight - 280)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* First group: Open, Rename, Create child */}
          <button
            onClick={() => {
              const note = notes.find((item) => item.id === noteContextMenu.noteId)
              if (note) void openNote(note)
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition"
          >
            <StickyNote size={14} className="text-gray-600 shrink-0" />
            <span className="font-medium">Open</span>
          </button>
          <button
            onClick={() => {
              beginInlineRename(noteContextMenu.noteId)
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition"
          >
            <span className="text-gray-500 shrink-0">Aa</span>
            <span className="font-medium">Rename</span>
          </button>
          <button
            onClick={() => {
              void createChildNote(noteContextMenu.noteId)
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition"
          >
            <Plus size={14} className="text-gray-600 shrink-0" />
            <span className="font-medium">Create child</span>
          </button>
          <button
            onClick={() => {
              void api.moveNoteParent(noteContextMenu.noteId, null).then(() => loadNotes({ silent: true })).catch(() => {})
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition"
          >
            <Folder size={14} className="text-gray-600 shrink-0" />
            <span className="font-medium">Move to root</span>
          </button>

          {/* Divider */}
          <div className="h-px bg-gray-100 my-1" />

          {/* Second group: Duplicate, Save as template */}
          <button
            onClick={() => {
              // TODO: Implement duplicate
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition"
          >
            <Copy size={14} className="text-gray-600 shrink-0" />
            <span className="font-medium">Duplicate</span>
          </button>
          <button
            onClick={() => {
              // TODO: Implement save as template
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition"
          >
            <Zap size={14} className="text-gray-600 shrink-0" />
            <span className="font-medium">Save as template</span>
          </button>

          {/* Divider */}
          <div className="h-px bg-gray-100 my-1" />

          {/* Third group: Delete (destructive) */}
          <button
            onClick={() => {
              void deleteNoteById(noteContextMenu.noteId)
              setNoteContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-red-50 flex items-center gap-3 text-sm transition"
          >
            <Trash2 size={14} className="text-red-500 shrink-0" />
            <span className="font-medium text-red-600">Delete</span>
          </button>
        </div>
      )}

      <CreateNoteModal
        isOpen={showCreateNoteModal}
        onClose={() => setShowCreateNoteModal(false)}
        onNoteCreated={(note) => {
          if (isDirty) {
            void flushAutosave().then(() => {
              const created = note as NoteRow
              setNotes((prev) => [created, ...prev])
              setNoteTree((prev) => [
                {
                  ...created,
                  depth: created.depth ?? 0,
                  children: [],
                },
                ...prev,
              ])
              setSelectedNoteId(created.id)
              syncDraftFromNote(created)
            })
          } else {
            const created = note as NoteRow
            setNotes((prev) => [created, ...prev])
            setNoteTree((prev) => [
              {
                ...created,
                depth: created.depth ?? 0,
                children: [],
              },
              ...prev,
            ])
            setSelectedNoteId(created.id)
            syncDraftFromNote(created)
          }
        }}
      />
    </div>
  )
}

export default NotesWindow
