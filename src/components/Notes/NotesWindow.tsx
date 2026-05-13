import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
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
import { BulkExportModal } from './BulkExportModal'
import { bulkExportNotes, bulkExportMindMaps } from '../../utils/exportUtils'

type NoteRow = {
  id: string
  workspace_id?: string
  user_id?: string
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

type WorkspaceMember = {
  user_id: string
  email: string | null
  full_name: string | null
}

type NoteTreeNode = NoteRow & {
  depth: number
  children: NoteTreeNode[]
}

type NoteSection = {
  id: string
  name: string
  color: string
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

type SectionContextMenuState = {
  x: number
  y: number
  sectionId: string
  sectionName: string
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
    red: { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', border: 'border-l-2 border-red-400' },
    amber: { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-l-2 border-amber-400' },
    teal: { dot: 'bg-teal-500', text: 'text-teal-600', bg: 'bg-teal-50', border: 'border-l-2 border-teal-400' },
    cyan: { dot: 'bg-cyan-500', text: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-l-2 border-cyan-400' },
    indigo: { dot: 'bg-indigo-500', text: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-l-2 border-indigo-400' },
    violet: { dot: 'bg-violet-500', text: 'text-violet-600', bg: 'bg-violet-50', border: 'border-l-2 border-violet-400' },
    emerald: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-l-2 border-emerald-400' },
    rose: { dot: 'bg-rose-500', text: 'text-rose-600', bg: 'bg-rose-50', border: 'border-l-2 border-rose-400' },
    slate: { dot: 'bg-slate-500', text: 'text-slate-600', bg: 'bg-slate-50', border: 'border-l-2 border-slate-400' },
    gray: { dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', border: 'border-l-2 border-gray-300' },
  }
  return colorMap[color] || colorMap.gray
}

const sectionColorOptions: Array<NoteSection['color']> = [
  'gray',
  'blue',
  'orange',
  'green',
  'purple',
  'pink',
  'red',
  'amber',
  'teal',
  'cyan',
  'indigo',
  'violet',
  'emerald',
  'rose',
  'slate',
]

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

const formatRelativeFromNow = (value: string | null | undefined) => {
  if (!value) return 'just now'
  const delta = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (delta < 60) return `${delta}s ago`
  const minutes = Math.floor(delta / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const displayUserName = (member: WorkspaceMember | null | undefined) => {
  if (!member) return 'Unknown user'
  return member.full_name?.trim() || member.email?.trim() || 'Unknown user'
}

const initialsForName = (value: string) => {
  const tokens = value.split(/\s+/).filter(Boolean)
  if (!tokens.length) return '?'
  if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase()
  return `${tokens[0][0] ?? ''}${tokens[1][0] ?? ''}`.toUpperCase()
}

const InspectorInfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="py-1">
    <p className="text-[11px] text-gray-500">{label}</p>
    <p className="mt-0.5 text-sm font-medium text-gray-900 wrap-break-word">{value}</p>
  </div>
)

const toNonNegativeInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.floor(parsed))
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

const insertRootIntoTree = (nodes: NoteTreeNode[], child: NoteTreeNode): NoteTreeNode[] => [child, ...nodes]

const getDropPreviewClasses = (
  preview: { targetId: string; position: 'inside' | 'before' | 'after' } | null,
  targetId: string
) => {
  if (!preview || preview.targetId !== targetId) return ''
  if (preview.position === 'inside') return 'bg-gray-100 border-l-gray-400'
  if (preview.position === 'before') return 'border-t border-gray-300'
  return 'border-b border-gray-300'
}

export const NotesWindow = () => {
  const { user } = useAuthContext()
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext()
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
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportType, setExportType] = useState<'notes' | 'mindmaps'>('notes')
  const [noteCreationSectionId, setNoteCreationSectionId] = useState<string | null>(null)
  const [showNewSectionPrompt, setShowNewSectionPrompt] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
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
  const [sectionContextMenu, setSectionContextMenu] = useState<SectionContextMenuState | null>(null)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null)
  const [renamingSectionDraft, setRenamingSectionDraft] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [isInspectorActionsOpen, setIsInspectorActionsOpen] = useState(false)
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null)
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)
  const [sectionDropTargetId, setSectionDropTargetId] = useState<string | null>(null)
  const [dropPreview, setDropPreview] = useState<{ targetId: string; position: 'inside' | 'before' | 'after' } | null>(
    null
  )
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
  const newMenuRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameSectionInputRef = useRef<HTMLInputElement | null>(null)
  const [workspaceTemplates, setWorkspaceTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
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

  const beginInlineSectionRename = useCallback((sectionId: string) => {
    const target = sections.find((section) => section.id === sectionId)
    if (!target) return
    setRenamingSectionId(sectionId)
    setRenamingSectionDraft(target.name || 'Untitled folder')
    setSectionContextMenu(null)
    window.setTimeout(() => {
      renameSectionInputRef.current?.focus()
      renameSectionInputRef.current?.select()
    }, 0)
  }, [sections])

  const cancelInlineSectionRename = useCallback(() => {
    setRenamingSectionId(null)
    setRenamingSectionDraft('')
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

  const commitInlineSectionRename = useCallback(async () => {
    if (!renamingSectionId) return

    const trimmed = renamingSectionDraft.trim() || 'Untitled folder'
    const existing = sections.find((item) => item.id === renamingSectionId)
    if (!existing) {
      cancelInlineSectionRename()
      return
    }
    if (trimmed === (existing.name || 'Untitled folder')) {
      cancelInlineSectionRename()
      return
    }

    setSections((prev) => prev.map((item) => (item.id === renamingSectionId ? { ...item, name: trimmed } : item)))

    try {
      const updated = (await api.updateSection(renamingSectionId, { name: trimmed })) as NoteSection
      setSections((prev) => prev.map((item) => (item.id === renamingSectionId ? { ...item, ...updated } : item)))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not rename folder.')
      setSections((prev) => prev.map((item) => (item.id === renamingSectionId ? existing : item)))
    } finally {
      cancelInlineSectionRename()
    }
  }, [api, cancelInlineSectionRename, renamingSectionDraft, renamingSectionId, sections])

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

  const workspaceMemberById = useMemo(() => {
    return new Map(workspaceMembers.map((member) => [member.user_id, member]))
  }, [workspaceMembers])

  const creatorMember = useMemo(() => {
    if (!selectedNote?.user_id) return null
    return workspaceMemberById.get(selectedNote.user_id) ?? null
  }, [selectedNote?.user_id, workspaceMemberById])

  const editorMember = creatorMember

  const activeViewerNames = useMemo(() => {
    const names: string[] = []
    if (user?.id) {
      const me = workspaceMemberById.get(user.id)
      names.push(me ? displayUserName(me) : 'You')
    } else {
      names.push('You')
    }
    return names
  }, [user?.id, workspaceMemberById])

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
    let mounted = true
    const loadTemplates = async () => {
      try {
        const data = await api.getTemplates()
        if (!mounted) return
        setWorkspaceTemplates(
          Array.isArray(data)
            ? data.map((template: { id: string; name: string }) => ({ id: template.id, name: template.name }))
            : []
        )
      } catch {
        if (mounted) setWorkspaceTemplates([])
      }
    }

    void loadTemplates()

    return () => {
      mounted = false
    }
  }, [api, activeWorkspaceId])

  useEffect(() => {
    let mounted = true

    const loadWorkspaceMembers = async () => {
      if (!activeWorkspaceId) {
        if (mounted) setWorkspaceMembers([])
        return
      }

      try {
        const payload = await api.getWorkspaceMembers(activeWorkspaceId) as {
          members?: Array<{ user_id: string; email?: string | null; full_name?: string | null }>
        }
        if (!mounted) return
        const members = Array.isArray(payload?.members)
          ? payload.members.map((member) => ({
              user_id: member.user_id,
              email: member.email ?? null,
              full_name: member.full_name ?? null,
            }))
          : []
        setWorkspaceMembers(members)
      } catch {
        if (mounted) setWorkspaceMembers([])
      }
    }

    void loadWorkspaceMembers()
    return () => {
      mounted = false
    }
  }, [activeWorkspaceId, api])

  const resolveTemplateIdByName = useCallback(
    (name: string) => workspaceTemplates.find((template) => template.name === name)?.id ?? null,
    [workspaceTemplates]
  )

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
        const selectedExists = selectedNoteId ? rows.some((note) => note.id === selectedNoteId) : false
        setNotes(rows)
        setNoteTree(tree)
        setExpandedNoteIds(new Set())

        setSelectedNoteId((currentId) => {
          const currentSelected = currentId ? rows.find((note) => note.id === currentId) ?? null : null

          if (currentSelected) {
            return currentSelected.id
          }

          return null
        })

        if ((rows.length === 0 || !selectedExists) && !isEditingRef.current && !isDirtyRef.current) {
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
    [api, activeWorkspaceId, hasLoadedOnce, selectedNoteId, syncDraftFromNote, user]
  )

  const loadSections = useCallback(async () => {
    try {
      const data = await api.getSections()
      const rows = Array.isArray(data) ? data : []
      if (rows.length === 0 && activeWorkspaceId) {
        const defaultSections = await Promise.all([
          api.createSection({ name: 'Work', color: 'orange' }),
          api.createSection({ name: 'Personal', color: 'green' }),
          api.createSection({ name: 'Ideas', color: 'purple' }),
        ])
        const nextSections = defaultSections.sort((left, right) => left.sort_order - right.sort_order)
        setSections(nextSections)
        localStorage.setItem('notes-sections', JSON.stringify(nextSections))
        const nextCollapsedIds = new Set<string>(['__unsorted__', ...nextSections.map((section) => section.id)])
        setCollapsedSectionIds(nextCollapsedIds)
        localStorage.setItem('notes-sections-collapsed', JSON.stringify([...nextCollapsedIds]))
        return nextSections
      }

      setSections(rows)
      localStorage.setItem('notes-sections', JSON.stringify(rows))
      const nextCollapsedIds = new Set<string>(['__unsorted__', ...rows.map((section) => section.id)])
      setCollapsedSectionIds(nextCollapsedIds)
      localStorage.setItem('notes-sections-collapsed', JSON.stringify([...nextCollapsedIds]))
      return rows
    } catch (error) {
      console.error('Failed to load sections:', error)
      return []
    }
  }, [activeWorkspaceId, api])

  const updateSectionColor = useCallback(
    async (sectionId: string, color: NoteSection['color']) => {
      const previous = sections
      const next = sections.map((section) => (section.id === sectionId ? { ...section, color } : section))
      setSections(next)
      localStorage.setItem('notes-sections', JSON.stringify(next))

      try {
        const updated = await api.updateSection(sectionId, { color })
        setSections((current) =>
          current.map((section) =>
            section.id === sectionId ? { ...section, ...(updated as Partial<NoteSection>) } : section
          )
        )
      } catch (error) {
        setSections(previous)
        localStorage.setItem('notes-sections', JSON.stringify(previous))
        setError(error instanceof Error ? error.message : 'Could not update folder color.')
      }
    },
    [api, sections]
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

  const runQuickAutosaveThen = useCallback((after: () => void, timeoutMs = 120) => {
    let completed = false
    const finish = () => {
      if (completed) return
      completed = true
      after()
    }
    window.setTimeout(finish, timeoutMs)
    void flushAutosave().finally(finish)
  }, [flushAutosave])

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

  const createSection = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setError(null)
      try {
        const created = await api.createSection({ name: trimmed, color: 'gray' })
        const nextSections = [...sections, created].sort((left, right) => left.sort_order - right.sort_order)
        setSections(nextSections)
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Could not create section.')
      }
    },
    [api, sections]
  )

  const duplicateNoteById = useCallback(
    async (noteId: string) => {
      const source = notes.find((note) => note.id === noteId)
      if (!source) return
      try {
        const duplicated = (await api.duplicateNote(noteId)) as NoteRow
        setNotes((prev) => [duplicated, ...prev])
        setNoteTree((prev) => {
          if (duplicated.parent_id) {
            return insertChildIntoTree(prev, duplicated.parent_id, { ...duplicated, depth: duplicated.depth ?? 0, children: [] })
          }
          return insertRootIntoTree(prev, { ...duplicated, depth: duplicated.depth ?? 0, children: [] })
        })
        setSelectedNoteId(duplicated.id)
        syncDraftFromNote(duplicated)
        void loadNotes({ silent: true })
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not duplicate note.')
      }
    },
    [api, loadNotes, notes, syncDraftFromNote]
  )

  const moveNote = useCallback(
    async (noteId: string, update: { parent_id?: string | null; section_id?: string | null; sort_order?: number }) => {
      const source = notes.find((note) => note.id === noteId)
      if (!source) return null

      try {
        const updated = (await api.updateNote(noteId, {
          parent_id: update.parent_id,
          section_id: update.section_id,
          sort_order: update.sort_order,
        })) as NoteRow

        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)))
        setNoteTree((prev) => {
          const removed = removeNoteFromTree(prev, updated.id)
          const movedNode: NoteTreeNode = { ...updated, depth: updated.depth ?? 0, children: [] }
          if (updated.parent_id) {
            return insertChildIntoTree(removed, updated.parent_id, movedNode)
          }
          return insertRootIntoTree(removed, movedNode)
        })
        if (updated.parent_id) {
          setExpandedNoteIds((current) => new Set(current).add(updated.parent_id!))
        }
        void loadNotes({ silent: true })
        return updated
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not move note.')
        return null
      }
    },
    [api, notes]
  )

  const handleTreeDragStart = useCallback((noteId: string) => {
    if (draggedSectionId) return
    setDraggedNoteId(noteId)
  }, [])

  const handleTreeDragEnd = useCallback(() => {
    setDraggedNoteId(null)
    setDropPreview(null)
  }, [])

  const handleSectionDragStart = useCallback((sectionId: string, event?: DragEvent<HTMLElement>) => {
    if (draggedNoteId) return
    setDraggedSectionId(sectionId)
    if (event?.dataTransfer) {
      event.dataTransfer.setData('application/x-ledger-section-id', sectionId)
      event.dataTransfer.effectAllowed = 'move'
    }
  }, [draggedNoteId])

  const handleSectionDrop = useCallback(
    async (targetSectionId: string, dropSectionId?: string | null) => {
      const sourceSectionId = dropSectionId ?? draggedSectionId
      if (!sourceSectionId || sourceSectionId === targetSectionId) return

      const fromIndex = sections.findIndex((section) => section.id === sourceSectionId)
      const toIndex = sections.findIndex((section) => section.id === targetSectionId)
      if (fromIndex < 0 || toIndex < 0) return

      const reordered = [...sections]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moved)
      const normalized = reordered.map((section, index) => ({ ...section, sort_order: index }))

      setSections(normalized)
      localStorage.setItem('notes-sections', JSON.stringify(normalized))
      setDraggedSectionId(null)
      setSectionDropTargetId(null)

      try {
        await api.reorderSections(normalized.map((section) => ({ id: section.id, sort_order: section.sort_order })))
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not reorder folders.')
        void loadSections()
      }
    },
    [api, draggedSectionId, loadSections, sections]
  )

  const handleSectionDragEnd = useCallback(() => {
    setDraggedSectionId(null)
    setSectionDropTargetId(null)
  }, [])

  const handleDropOnSection = useCallback(
    async (sectionId: string | null) => {
      if (!draggedNoteId) return
      const targetSortOrder = notes.reduce((max, note) => {
        const sameSection = (note.section_id ?? null) === (sectionId ?? null)
        if (!sameSection || note.parent_id) return max
        return Math.max(max, toNonNegativeInt(note.sort_order))
      }, -1)

      await moveNote(draggedNoteId, {
        parent_id: null,
        section_id: sectionId,
        sort_order: targetSortOrder + 1,
      })
      handleTreeDragEnd()
    },
    [draggedNoteId, handleTreeDragEnd, moveNote, notes]
  )

  const handleDropOnNote = useCallback(
    async (target: NoteRow, position: 'inside' | 'before' | 'after') => {
      if (!draggedNoteId || draggedNoteId === target.id) return
      const source = notes.find((note) => note.id === draggedNoteId)
      if (!source) return

      if (position === 'inside') {
        const siblingTop = notes.reduce((max, note) => (note.parent_id === target.id ? Math.max(max, toNonNegativeInt(note.sort_order)) : max), -1)
        await moveNote(draggedNoteId, {
          parent_id: target.id,
          section_id: target.section_id ?? null,
          sort_order: siblingTop + 1,
        })
        setExpandedNoteIds((current) => new Set(current).add(target.id))
        handleTreeDragEnd()
        return
      }

      const siblingParentId = target.parent_id ?? null
      const siblingSectionId = target.section_id ?? null
      const nextSortOrder = position === 'before' ? toNonNegativeInt(target.sort_order) : toNonNegativeInt(target.sort_order) + 1
      await moveNote(draggedNoteId, {
        parent_id: siblingParentId,
        section_id: siblingSectionId,
        sort_order: nextSortOrder,
      })
      handleTreeDragEnd()
    },
    [draggedNoteId, handleTreeDragEnd, moveNote, notes]
  )

  const handleTreeDropPreview = useCallback((event: DragEvent, targetId: string) => {
    if (!draggedNoteId || draggedNoteId === targetId) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const relativeY = (event.clientY - rect.top) / Math.max(rect.height, 1)
    const position = relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside'
    setDropPreview({ targetId, position })
  }, [draggedNoteId])

  const getDropPosition = useCallback((event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const relativeY = (event.clientY - rect.top) / Math.max(rect.height, 1)
    return relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside'
  }, [])

  const handleBulkExport = useCallback(async (format: 'pdf' | 'png' | 'html' | 'txt', selectedIds: Set<string>) => {
    try {
      if (exportType === 'mindmaps') {
        const mindMapsToExport = notes
          .filter((note) => selectedIds.has(note.id) && note.mode === 'mind_map')
          .map((note) => {
            const element = document.querySelector(`[data-mindmap-id="${note.id}"]`) as HTMLElement | null
            if (!element) {
              console.warn(`Mind map element not found for note ${note.id}`)
            }
            return {
              id: note.id,
              title: note.title || 'Untitled',
              element: element,
              created_at: note.created_at,
            }
          })
          .filter((item) => item.element !== null && item.element !== undefined)
        
        if (mindMapsToExport.length === 0) {
          setError('No mind maps found to export. Make sure the mind map is rendered on screen.')
          return
        }
        
        await bulkExportMindMaps(mindMapsToExport as any, format as 'pdf' | 'png' | 'txt')
      } else {
        const notesToExport = notes
          .filter((note) => selectedIds.has(note.id))
          .map((note) => ({
            id: note.id,
            title: note.title || 'Untitled',
            content: note.content || '',
            date: note.date,
            created_at: note.created_at,
          }))
        await bulkExportNotes(notesToExport, format as 'pdf' | 'html' | 'txt')
      }
    } catch (error) {
      console.error('Bulk export failed:', error)
      setError('Export failed. Please try again.')
    }
  }, [notes, exportType])

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
    if (activeWorkspaceId) {
      void loadSections()
    }
  }, [activeWorkspaceId, loadSections])

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
    if (!sectionContextMenu) return

    const closeMenu = () => setSectionContextMenu(null)
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
  }, [sectionContextMenu])

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

  useEffect(() => {
    if (!showNewMenu) return

    const onPointerDown = (event: MouseEvent) => {
      if (newMenuRef.current?.contains(event.target as Node)) return
      setShowNewMenu(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowNewMenu(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [showNewMenu])

  return (
    <div className="h-screen overflow-hidden rounded-[28px] border border-gray-200 bg-[#f5f7fb] flex flex-col shadow-[0_24px_80px_rgba(15,23,42,0.08)]" style={{ scrollbarGutter: 'stable' }}>
      <ModuleWindowHeader
        title="Notes"
        subtitle="Your simple note workspace"
        icon={<StickyNote size={18} className="text-amber-600" />}
        closeLabel="Close notes"
        minimizeLabel="Minimize notes"
        onMinimize={() => {
          runQuickAutosaveThen(() => {
            void window.desktopWindow?.minimizeModule('notes')
          }, 100)
        }}
        fullscreenLabel="Fullscreen notes"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('notes')
        }}
        onClose={() => {
          runQuickAutosaveThen(() => {
            void window.desktopWindow?.closeModule('notes')
          }, 120)
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
                onClick={() => {
                  setNoteCreationSectionId(null)
                  setShowCreateNoteModal(true)
                }}
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
            <button
              onClick={() => {
                setExportType(selectedNote?.mode === 'mind_map' ? 'mindmaps' : 'notes')
                setShowExportModal(true)
              }}
              disabled={notes.length === 0}
              className="h-8 rounded-full border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-40"
              title="Export notes or mind maps"
            >
              <Download size={13} />
              Export
            </button>
          </div>
        }
      />

      {error && (
        <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed && hasLoadedOnce && (
          <>
            <aside
              className={`border-r border-gray-200 bg-white flex flex-col overflow-hidden shrink-0 ${isCompactLayout ? 'text-sm' : ''}`}
              style={{ width: `${leftPaneWidth}px` }}
            >
          <div className={`${isCompactLayout ? 'p-3' : 'p-4'} border-b border-gray-100`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-600">Notes</h2>
              <div className="relative" ref={newMenuRef}>
                <button
                  onClick={() => setShowNewMenu((current) => !current)}
                  disabled={isCreating}
                  className="h-7 px-2.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition inline-flex items-center gap-1.5 disabled:opacity-60"
                  title="Create new"
                >
                  <Plus size={11} />
                  New
                  <ChevronDown size={11} />
                </button>
                {showNewMenu && (
                  <div className="absolute right-0 top-8 z-40 min-w-32 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false)
                        setShowNewSectionPrompt(false)
                        setNoteCreationSectionId(null)
                        setShowCreateNoteModal(true)
                      }}
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-gray-800 hover:bg-gray-50"
                    >
                      New note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false)
                        setShowNewSectionPrompt(true)
                      }}
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-gray-800 hover:bg-gray-50"
                    >
                      New folder
                    </button>
                  </div>
                )}
              </div>
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

          {showNewSectionPrompt && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-1.5">
              <input
                autoFocus
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="Folder name"
                className="min-w-0 flex-1 bg-transparent px-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                      void createSection(newSectionName).then(() => {
                        setNewSectionName('')
                        setShowNewSectionPrompt(false)
                      })
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setNewSectionName('')
                      setShowNewSectionPrompt(false)
                    }
                  }}
                />
                <button
                  onClick={() => {
                    void createSection(newSectionName).then(() => {
                      setNewSectionName('')
                      setShowNewSectionPrompt(false)
                    })
                  }}
                  disabled={!newSectionName.trim()}
                  className="h-7 rounded-full bg-gray-900 px-3 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            )}
          </div>

          <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isCompactLayout ? 'p-2' : 'p-3'} space-y-0`}>
            {isLoading ? (
              <div className="space-y-2 px-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonNoteCard key={i} />
                ))}
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
                      className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                        active ? 'bg-gray-50 text-gray-900' : 'bg-transparent hover:bg-gray-50/50 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <StickyNote size={12} className="text-gray-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate text-sm">{note.title || 'Untitled'}</p>
                          <p className="text-xs text-gray-400 truncate">{preview}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              // Tree view with sections
              <div className="space-y-2">
                {sections.map((section) => {
                  const sectionColor = getColorClasses(section.color)
                  const isSectionCollapsed = collapsedSectionIds.has(section.id)
                  const sectionNotes = notes.filter((n) => n.section_id === section.id && !n.parent_id)
                  
                  return (
                    <div
                      key={section.id}
                      onDragOver={(event) => {
                        if (!draggedSectionId) return
                        event.preventDefault()
                        if (draggedSectionId !== section.id) {
                          setSectionDropTargetId(section.id)
                        }
                      }}
                      onDrop={(event) => {
                        if (!draggedSectionId) return
                        event.preventDefault()
                        const dropSectionId = event.dataTransfer.getData('application/x-ledger-section-id') || draggedSectionId
                        if (!dropSectionId || dropSectionId === section.id) return
                        void handleSectionDrop(section.id, dropSectionId)
                      }}
                    >
                      {/* Section header */}
                      <button
                        draggable
                        onDragStart={(event) => handleSectionDragStart(section.id, event)}
                        onDragEnd={handleSectionDragEnd}
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
                        onDragOver={(event) => {
                          event.preventDefault()
                          if (!draggedSectionId) {
                            setDropPreview({ targetId: section.id, position: 'inside' })
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (draggedSectionId && draggedSectionId !== section.id) {
                            const dropSectionId = event.dataTransfer.getData('application/x-ledger-section-id') || draggedSectionId
                            void handleSectionDrop(section.id, dropSectionId)
                            return
                          }
                          void handleDropOnSection(section.id)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setSectionContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            sectionId: section.id,
                            sectionName: section.name,
                          })
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-lg transition group ${
                          sectionDropTargetId === section.id
                            ? 'bg-orange-50 ring-1 ring-orange-200 border border-dashed border-orange-300'
                            : draggedSectionId === section.id
                              ? 'bg-orange-50/60 ring-1 ring-orange-100'
                              : dropPreview?.targetId === section.id
                                ? 'bg-orange-50 ring-1 ring-orange-200'
                                : ''
                        }`}
                      >
                        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${sectionColor.dot}`} />
                        <Folder size={14} className="text-gray-500 shrink-0" />
                        <span className="flex-1 truncate">
                          {renamingSectionId === section.id ? (
                            <input
                              ref={renameSectionInputRef}
                              value={renamingSectionDraft}
                              onChange={(event) => setRenamingSectionDraft(event.target.value)}
                              onBlur={() => {
                                void commitInlineSectionRename()
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void commitInlineSectionRename()
                                } else if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelInlineSectionRename()
                                }
                              }}
                              onClick={(event) => event.stopPropagation()}
                              className="w-full bg-transparent text-sm font-semibold text-gray-900 outline-none"
                            />
                          ) : (
                            section.name
                          )}
                        </span>
                        <ChevronRight
                          size={14}
                          className={`text-gray-400 transition-transform shrink-0 ${!isSectionCollapsed ? 'rotate-90' : ''}`}
                        />
                        <span className="text-xs text-gray-400 mr-1">{sectionNotes.length}</span>
                      </button>
                      
                      {/* Section notes */}
                      {!isSectionCollapsed && (
                        <div className="space-y-1 pl-4 mt-0.5">
                          {sectionNotes.map((note) => {
                            const active = note.id === selectedNoteId
                            const preview = htmlToPlainText(note.content).slice(0, 60) || 'No content'
                            const isExpanded = expandedNoteIds.has(note.id)
                            // Count children
                            const childCount = notes.filter((n) => n.parent_id === note.id).length
                            
                            return (
                              <div key={note.id} className="space-y-1">
                                {/* Note row */}
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    onClick={() => void openNote(note)}
                                    draggable
                                    onDragStart={() => handleTreeDragStart(note.id)}
                                    onDragEnd={handleTreeDragEnd}
                                    onDragOver={(event) => {
                                      event.preventDefault()
                                      handleTreeDropPreview(event, note.id)
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault()
                                      void handleDropOnNote(note, getDropPosition(event))
                                    }}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      setNoteContextMenu({ x: event.clientX, y: event.clientY, noteId: note.id })
                                    }}
                                    className={`flex-1 min-w-0 px-2.5 py-1.5 rounded text-left text-sm transition ${
                                      active
                                        ? 'bg-gray-50 text-gray-900'
                                        : 'bg-transparent hover:bg-gray-50/50 text-gray-700'
                                    } ${getDropPreviewClasses(dropPreview, note.id)}`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {childCount > 0 ? (
                                        <Folder size={12} className="text-gray-400 shrink-0" />
                                      ) : (
                                        <StickyNote size={12} className="text-gray-400 shrink-0" />
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
                                          <p className="font-medium truncate text-sm">{note.title || 'Untitled'}</p>
                                        )}
                                        <p className="text-xs text-gray-400 truncate">{preview}</p>
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
                                            draggable
                                            onDragStart={() => handleTreeDragStart(child.id)}
                                            onDragEnd={handleTreeDragEnd}
                                            onDragOver={(event) => {
                                              event.preventDefault()
                                              handleTreeDropPreview(event, child.id)
                                            }}
                                            onDrop={(event) => {
                                              event.preventDefault()
                                              void handleDropOnNote(child, getDropPosition(event))
                                            }}
                                            onContextMenu={(event) => {
                                              event.preventDefault()
                                              setNoteContextMenu({ x: event.clientX, y: event.clientY, noteId: child.id })
                                            }}
                                            className={`flex-1 min-w-0 px-2.5 py-1.5 rounded text-left text-xs transition ${
                                              selectedNoteId === child.id
                                                ? 'bg-gray-50 text-gray-900'
                                                : 'bg-transparent hover:bg-gray-50/50 text-gray-600'
                                            } ${getDropPreviewClasses(dropPreview, child.id)}`}
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
                              setNoteCreationSectionId(section.id)
                              setShowCreateNoteModal(true)
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50/50 transition flex items-center gap-2"
                          >
                            <Plus size={12} />
                            Add note
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {notes.length === 0 && (
                  <div className="px-3 py-5 text-center">
                    <p className="text-sm font-medium text-gray-800">No notes yet</p>
                    <p className="mt-1 text-xs text-gray-500">Create a note or drop one into a folder to start organizing.</p>
                  </div>
                )}
                
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
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDropPreview({ targetId: '__unsorted__', position: 'inside' })
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          void handleDropOnSection(null)
                        }}
                        className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-lg transition group"
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
                        <div className="space-y-1 pl-3.5 mt-0.5">
                          {unsortedNotes.map((note) => {
                            const active = note.id === selectedNoteId
                            const preview = htmlToPlainText(note.content).slice(0, 60) || 'No content'
                            const isExpanded = expandedNoteIds.has(note.id)
                            const childCount = notes.filter((n) => n.parent_id === note.id).length
                            
                            return (
                              <div key={note.id} className="space-y-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    onClick={() => void openNote(note)}
                                    draggable
                                    onDragStart={() => handleTreeDragStart(note.id)}
                                    onDragEnd={handleTreeDragEnd}
                                    onDragOver={(event) => {
                                      event.preventDefault()
                                      handleTreeDropPreview(event, note.id)
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault()
                                      void handleDropOnNote(note, getDropPosition(event))
                                    }}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      setNoteContextMenu({ noteId: note.id, x: event.clientX, y: event.clientY })
                                    }}
                        className={`flex-1 min-w-0 text-left px-2.5 py-1 rounded text-sm transition flex items-center gap-2 ${
                                      active ? 'bg-gray-50 text-gray-900' : 'bg-transparent hover:bg-gray-50/50 text-gray-700'
                                    } ${getDropPreviewClasses(dropPreview, note.id)}`}
                                  >
                                    {childCount > 0 ? (
                                      <Folder size={13} className="text-gray-400 shrink-0" />
                                    ) : (
                                      <StickyNote size={13} className="text-gray-400 shrink-0" />
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
                                  <div className="space-y-1 pl-3.5">
                                    {notes
                                      .filter((n) => n.parent_id === note.id)
                                      .map((child) => {
                                        const childActive = child.id === selectedNoteId
                                        const childPreview = htmlToPlainText(child.content).slice(0, 50) || 'No content'
                                        return (
                                          <button
                                            key={child.id}
                                            onClick={() => void openNote(child)}
                                            draggable
                                            onDragStart={() => handleTreeDragStart(child.id)}
                                            onDragEnd={handleTreeDragEnd}
                                            onDragOver={(event) => {
                                              event.preventDefault()
                                              handleTreeDropPreview(event, child.id)
                                            }}
                                            onDrop={(event) => {
                                              event.preventDefault()
                                              void handleDropOnNote(child, getDropPosition(event))
                                            }}
                                            onContextMenu={(event) => {
                                              event.preventDefault()
                                              setNoteContextMenu({ noteId: child.id, x: event.clientX, y: event.clientY })
                                            }}
                                            className={`w-full text-left px-2.5 py-1 rounded text-xs transition flex items-center gap-2 ${
                                              childActive ? 'bg-gray-50 text-gray-900' : 'bg-transparent hover:bg-gray-50/50 text-gray-600'
                                            } ${getDropPreviewClasses(dropPreview, child.id)}`}
                                          >
                                            <StickyNote size={12} className="text-gray-400 shrink-0" />
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
              <div className="px-3 py-2 space-y-0.5 bg-transparent">
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
                          const resolvedTemplateId = resolveTemplateIdByName(template.name)
                          if (!resolvedTemplateId) {
                            throw new Error('Template not found')
                          }
                          const note = await api.createNoteFromTemplate(resolvedTemplateId)
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
                    className="w-full text-left px-2.5 py-1 rounded text-sm text-gray-700 bg-transparent hover:bg-gray-50 transition truncate"
                  >
                    {template.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setNoteCreationSectionId(null)
                    setShowCreateNoteModal(true)
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition"
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
                                void duplicateNoteById(selectedNote.id)
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
                      <div className="w-full min-h-[calc(100vh-330px)] mt-4" data-mindmap-id={selectedNote?.id}>
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
                    onClick={() => {
                      setNoteCreationSectionId(null)
                      setShowCreateNoteModal(true)
                    }}
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
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Inspector</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
                      {selectedNote ? 'Current note' : 'No note selected'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      {selectedNote
                        ? selectedBreadcrumb.length
                          ? selectedBreadcrumb.map((crumb) => crumb.title).join(' > ')
                          : 'Home'
                        : 'Click a note to view details'}
                    </p>
                  </div>

                  {selectedNote && (
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
                            void duplicateNoteById(selectedNote.id)
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
                  )}
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
                  {selectedNote ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {activeWorkspace?.name?.trim() || 'Current workspace'}
                      </div>
                      <InspectorInfoRow label="Created by" value={displayUserName(creatorMember)} />
                      <InspectorInfoRow
                        label="Last edited by"
                        value={`${displayUserName(editorMember)} · ${formatRelativeFromNow(selectedNote.updated_at)}`}
                      />
                      <div className="py-1">
                        <p className="text-[11px] text-gray-500">Viewing</p>
                        {activeViewerNames.length <= 1 ? (
                          <p className="mt-0.5 text-sm font-medium text-gray-900">Only you</p>
                        ) : (
                          <div className="mt-1 flex items-center gap-1">
                            {activeViewerNames.slice(0, 3).map((name) => (
                              <span
                                key={name}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-700"
                                title={name}
                              >
                                {initialsForName(name)}
                              </span>
                            ))}
                            {activeViewerNames.length > 3 && (
                              <span className="text-[11px] text-gray-500">+{activeViewerNames.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <InspectorInfoRow label="Notes" value={String(notes.length)} />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Select a note to view workspace details.</p>
                  )}
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Recent updates</p>
                  </div>
                  {recentNotes.length > 0 ? (
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
                  ) : (
                    <p className="text-sm text-gray-500">No recent updates yet.</p>
                  )}
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
            <div className="flex-1 min-h-0 p-4" data-mindmap-id={selectedNote?.id}>
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

      {sectionContextMenu && (
        <div
          className="fixed z-210 min-w-40 rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg p-0"
          style={{
            left: Math.max(8, Math.min(sectionContextMenu.x, window.innerWidth - 180)),
            top: Math.max(8, Math.min(sectionContextMenu.y, window.innerHeight - 220)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              beginInlineSectionRename(sectionContextMenu.sectionId)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-gray-50 flex items-center gap-3 text-sm transition border-b border-gray-100"
          >
            <span className="text-gray-500 shrink-0">Aa</span>
            <span className="font-medium">Rename folder</span>
          </button>
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Folder color</p>
            <div className="relative mt-2">
              <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex items-center gap-1.5 w-max pr-8">
                  {sectionColorOptions.map((color) => {
                    const isActive = sections.find((section) => section.id === sectionContextMenu.sectionId)?.color === color
                    const swatch = getColorClasses(color)
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          void updateSectionColor(sectionContextMenu.sectionId, color)
                        }}
                        className={`h-5 w-5 rounded-full border transition ${isActive ? 'border-gray-500 scale-110' : 'border-gray-200 hover:border-gray-300'}`}
                        title={`Set ${sectionContextMenu.sectionName} color to ${color}`}
                      >
                        <span className={`block h-full w-full rounded-full ${swatch.dot}`} />
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="pointer-events-none absolute right-0 top-0 h-6 w-7 bg-linear-to-l from-white to-transparent" />
            </div>
          </div>
          <button
            onClick={() => {
              const target = sections.find((section) => section.id === sectionContextMenu.sectionId)
              if (target) {
                setShowNewSectionPrompt(false)
                void api.deleteSection(target.id).then(() => {
                  setSections((prev) => prev.filter((section) => section.id !== target.id))
                  setCollapsedSectionIds((prev) => {
                    const next = new Set(prev)
                    next.delete(target.id)
                    return next
                  })
                  void loadSections()
                  void loadNotes({ silent: true })
                }).catch((error) => {
                  setError(error instanceof Error ? error.message : 'Could not delete folder.')
                })
              }
              setSectionContextMenu(null)
            }}
            className="w-full h-9 px-3 rounded-none text-left hover:bg-red-50 flex items-center gap-3 text-sm transition"
          >
            <Trash2 size={14} className="text-red-500 shrink-0" />
            <span className="font-medium text-red-600">Delete folder</span>
          </button>
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
              void duplicateNoteById(noteContextMenu.noteId)
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
        defaultSectionId={noteCreationSectionId}
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

      <BulkExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleBulkExport}
        notes={notes}
        isMindMapOnly={exportType === 'mindmaps'}
      />
    </div>
  )
}

export default NotesWindow
