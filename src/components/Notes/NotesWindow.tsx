import {
  ChevronLeft,
  Clock3,
  Plus,
  Search,
  StickyNote,
} from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useApi } from '../../hooks/useApi'
import { SkeletonLoader, SkeletonList } from '../Common/Skeleton'

type NoteRow = {
  id: string
  title: string
  content: string
  date: string
  mood: string | null
  created_at: string
  updated_at: string
}

const AUTOSAVE_DELAY_MS = 700
const POLL_INTERVAL_MS = 15000

const todayKey = () => new Date().toISOString().slice(0, 10)

const wordCount = (text: string) =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const NotesWindow = () => {
  const { user } = useAuthContext()
  const api = useApi()
  const titleRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const lastSavedAtRef = useRef<string | null>(null)

  const [notes, setNotes] = useState<NoteRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftDate, setDraftDate] = useState(todayKey())
  const [draftMood, setDraftMood] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveMessageVisible, setSaveMessageVisible] = useState(false)

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  )

  const visibleNotes = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return notes

    return notes.filter((note) => {
      const haystack = [note.title, note.content, note.mood ?? '', note.date].join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [notes, search])

  const syncDraftFromNote = useCallback((note: NoteRow) => {
    setDraftTitle(note.title)
    setDraftContent(note.content)
    setDraftDate(note.date || todayKey())
    setDraftMood(note.mood ?? '')
    setIsDirty(false)
  }, [])

  const loadNotes = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user) return

      if (opts?.silent) {
        setIsRefreshing(true)
      } else {
        setIsLoading(true)
      }

      setError(null)

      try {
        const data = await api.getNotes()
        const rows = (data ?? []) as NoteRow[]
        setNotes(rows)

        setSelectedNoteId((currentId) => {
          const currentSelected = currentId ? rows.find((note) => note.id === currentId) ?? null : null

          if (currentSelected) {
            if (!isDirty) {
              syncDraftFromNote(currentSelected)
            }
            return currentSelected.id
          }

          if (rows.length > 0) {
            const next = rows[0]
            syncDraftFromNote(next)
            return next.id
          }

          return null
        })

        if (rows.length === 0) {
          setDraftTitle('')
          setDraftContent('')
          setDraftDate(todayKey())
          setDraftMood('')
          setIsDirty(false)
        }
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Could not load notes.')
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [api, isDirty, syncDraftFromNote, user]
  )

  const flushAutosave = useCallback(
    async (override?: { title?: string; content?: string; date?: string; mood?: string }) => {
      if (!selectedNoteId) return null

      const noteTitle = (override?.title ?? draftTitle).trim() || 'Untitled note'
      const noteContent = override?.content ?? draftContent
      const noteDate = (override?.date ?? draftDate).trim() || todayKey()
      const noteMood = (override?.mood ?? draftMood).trim() || null

      setIsSaving(true)
      setError(null)

      try {
        const data = await api.updateNote(selectedNoteId, {
          title: noteTitle,
          content: noteContent,
          date: noteDate,
          mood: noteMood,
        })
        const updated = data as NoteRow
        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)))
        setDraftTitle(updated.title)
        setDraftContent(updated.content)
        setDraftDate(updated.date || todayKey())
        setDraftMood(updated.mood ?? '')
        setIsDirty(false)
        lastSavedAtRef.current = updated.updated_at
        setSaveMessage('Saved')
        setSaveMessageVisible(true)
        window.setTimeout(() => setSaveMessageVisible(false), 1200)
        window.setTimeout(() => setSaveMessage(null), 1600)
        return updated
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save note.')
        return null
      } finally {
        setIsSaving(false)
      }
    },
    [api, draftContent, draftDate, draftMood, draftTitle, selectedNoteId]
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
        date: todayKey(),
        mood: null,
      })

      const created = data as NoteRow
      setNotes((prev) => [created, ...prev])
      setSelectedNoteId(created.id)
      syncDraftFromNote(created)
      setTimeout(() => titleRef.current?.focus(), 0)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create note.')
    } finally {
      setIsCreating(false)
    }
  }, [api, flushAutosave, isDirty, syncDraftFromNote, user])

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
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete note.')
    } finally {
      setIsDeleting(false)
    }
  }, [api, selectedNote, syncDraftFromNote])

  useEffect(() => {
    void loadNotes()
    const poll = window.setInterval(() => {
      void loadNotes({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(poll)
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [loadNotes])

  useEffect(() => {
    if (!selectedNote || isDirty) return
    syncDraftFromNote(selectedNote)
  }, [isDirty, selectedNote, syncDraftFromNote])

  useEffect(() => {
    if (!selectedNoteId || !isDirty) return

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void flushAutosave()
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [draftContent, draftDate, draftMood, draftTitle, flushAutosave, isDirty, selectedNoteId])

  useEffect(() => {
    if (!saveMessage) return
    setSaveMessageVisible(true)
    const hideTimer = window.setTimeout(() => setSaveMessageVisible(false), 1200)
    const clearTimer = window.setTimeout(() => setSaveMessage(null), 1600)
    return () => {
      window.clearTimeout(hideTimer)
      window.clearTimeout(clearTimer)
    }
  }, [saveMessage])

  return (
    <div className="h-screen bg-[#f5f7fb] flex flex-col">
      <div className="h-8 bg-white border-b border-gray-100" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />

      <header
        className="h-16 border-b border-gray-200 px-5 flex items-center justify-between bg-white"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => void window.desktopWindow?.toggleModule('notes')}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
            title="Close Notes"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
            <StickyNote size={18} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-[26px] leading-none font-semibold tracking-tight text-gray-900">Notes</h1>
            <p className="text-xs text-gray-500 mt-1">A simple, Notion-style note workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1 shadow-sm">
            <button
              onClick={() => void loadNotes({ silent: true })}
              className="h-8 w-8 rounded-full hover:bg-white text-gray-600 flex items-center justify-center"
              title="Refresh notes"
            >
              <Clock3 size={15} />
            </button>
            <button
              onClick={() => void createNewNote()}
              disabled={isCreating}
              className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none disabled:opacity-60"
            >
              <Plus size={13} />
              {isCreating ? 'Creating...' : 'New note'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</div>
      )}
      {saveMessage && (
        <div
          className={`px-5 py-2 text-xs text-green-700 bg-green-50 border-b border-green-100 transition-opacity duration-300 ${
            saveMessageVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {saveMessage}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[320px] border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Notebook</p>
                <h2 className="text-sm font-semibold text-gray-900">{notes.length} notes</h2>
              </div>
              <span className="text-[10px] text-gray-500">
                {isRefreshing ? 'Syncing...' : 'Live'}
              </span>
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes"
                className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-full bg-gray-50 focus:outline-none focus:border-gray-300"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {isLoading ? (
              <SkeletonList count={4} />
            ) : visibleNotes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-sm font-medium text-gray-800">
                  {notes.length === 0 ? 'No notes yet' : 'No matching notes'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {notes.length === 0 ? 'Create your first note to start writing.' : 'Try a different search.'}
                </p>
              </div>
            ) : (
              visibleNotes.map((note) => {
                const active = note.id === selectedNoteId
                const preview = note.content.trim().split('\n').find((line) => line.trim()) ?? 'No content yet'

                return (
                  <button
                    key={note.id}
                    onClick={() => void openNote(note)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      active
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${active ? 'text-white' : 'text-gray-900'}`}>
                          {note.title || 'Untitled note'}
                        </p>
                        <p className={`mt-1 text-[11px] truncate ${active ? 'text-white/70' : 'text-gray-500'}`}>
                          {preview}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {note.mood && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              active ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {note.mood}
                          </span>
                        )}
                        <span className={`text-[10px] ${active ? 'text-white/70' : 'text-gray-500'}`}>
                          {new Date(note.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                    <div className={`mt-2 flex items-center justify-between text-[10px] ${active ? 'text-white/70' : 'text-gray-500'}`}>
                      <span>{formatDateTime(note.updated_at)}</span>
                      <span>{wordCount(note.content)} words</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="flex-1 min-w-0 p-2.5">
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
                <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Editing</p>
                    <h2 className="text-sm font-semibold text-gray-900">
                      {selectedNote.title || 'Untitled note'}
                    </h2>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-gray-500">
                      {isSaving ? 'Saving...' : isDirty ? 'Unsaved changes' : 'Saved'}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {lastSavedAtRef.current ? `Last saved ${formatDateTime(lastSavedAtRef.current)}` : 'Auto-save enabled'}
                    </p>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto p-6">
                  <div className="max-w-3xl mx-auto space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Date</p>
                        <input
                          value={draftDate}
                          onChange={(e) => {
                            setDraftDate(e.target.value)
                            setIsDirty(true)
                          }}
                          className="mt-1 w-full bg-transparent text-sm font-medium text-gray-900 focus:outline-none"
                          placeholder="YYYY-MM-DD"
                        />
                      </div>
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Mood</p>
                        <input
                          value={draftMood}
                          onChange={(e) => {
                            setDraftMood(e.target.value)
                            setIsDirty(true)
                          }}
                          className="mt-1 w-full bg-transparent text-sm font-medium text-gray-900 focus:outline-none"
                          placeholder="Calm, focused, etc."
                        />
                      </div>
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Words</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">{wordCount(draftContent)}</p>
                      </div>
                    </div>

                    <input
                      ref={titleRef}
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value)
                        setIsDirty(true)
                      }}
                      placeholder="Untitled note"
                      className="w-full text-4xl font-semibold tracking-tight text-gray-900 placeholder:text-gray-300 focus:outline-none bg-transparent"
                    />

                    <textarea
                      ref={bodyRef}
                      value={draftContent}
                      onChange={(e) => {
                        setDraftContent(e.target.value)
                        setIsDirty(true)
                      }}
                      placeholder="Start writing..."
                      className="w-full min-h-[calc(100vh-330px)] resize-none bg-transparent text-[16px] leading-8 text-gray-800 placeholder:text-gray-300 focus:outline-none"
                    />
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

        <aside className="w-[292px] border-l border-gray-200 bg-[#fbfcfe] overflow-auto p-4 space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">At a glance</p>
            <h2 className="mt-1 text-sm font-semibold text-gray-900">Notes workspace</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Total</p>
                <p className="text-lg font-semibold text-gray-900">{notes.length}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Visible</p>
                <p className="text-lg font-semibold text-gray-900">{visibleNotes.length}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Current note</p>
              <button
                onClick={() => void deleteSelectedNote()}
                disabled={!selectedNote || isDeleting}
                className="text-[11px] text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>

            {selectedNote ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-900 truncate">{selectedNote.title}</p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Created {formatDateTime(selectedNote.created_at)}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Updated</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{formatDateTime(selectedNote.updated_at)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Date field</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{selectedNote.date || 'Not set'}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Mood</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{selectedNote.mood || 'Not set'}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Words</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{wordCount(selectedNote.content)}</p>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-800">No note selected</p>
                <p className="mt-1 text-[11px] text-gray-500">Create or select a note to inspect it here.</p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-3">Recent updates</p>
            <div className="space-y-2">
              {notes.slice(0, 4).map((note) => (
                <button
                  key={note.id}
                  onClick={() => void openNote(note)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 transition"
                >
                  <div className="flex items-start gap-2">
                    <Clock3 size={13} className="mt-0.5 text-gray-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{note.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{formatDateTime(note.updated_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default NotesWindow
