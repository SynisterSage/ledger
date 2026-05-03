import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, X, BellRing, ClipboardPaste, CalendarPlus, Trash2 } from 'lucide-react'
import { Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { useApi } from '../../hooks/useApi'

type CalendarRow = {
  id: string
  name: string
  color: string
  workspace_id: string
  is_personal: boolean
}

type EventRow = {
  id: string
  title: string
  start_at: string
  end_at: string
  calendar_id: string
  color?: string
  status?: 'planned' | 'done' | 'missed' | 'cancelled'
  recurrence_rule?: 'none' | 'daily' | 'weekly' | 'weekdays'
}

type ReminderRow = {
  id: string
  title: string
  remind_at: string
  calendar_id: string
  color?: string
  is_done: boolean
}

type GridQuickAddState = {
  dateKey: string
  hour: number
}

type CalendarContextMenuState = {
  x: number
  y: number
  dateKey: string
  hour: number
}

type ListContextMenuState = {
  x: number
  y: number
  kind: 'event' | 'reminder'
  id: string
}

type CalendarViewMode = 'day' | 'week' | 'month'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 12 }, (_, i) => `${i + 8}:00`)
const NOTIFICATION_VISIBLE_MS = 4000
const NOTIFICATION_FADE_MS = 350
const SIDEBAR_MIN_WIDTH = 250
const SIDEBAR_MAX_WIDTH = 460

const startOfWeek = (date: Date) => {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const endOfWeek = (date: Date) => {
  const s = startOfWeek(date)
  const e = new Date(s)
  e.setDate(s.getDate() + 7)
  return e
}

const startOfDay = (date: Date) => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

const addDays = (date: Date, daysToAdd: number) => {
  const d = new Date(date)
  d.setDate(d.getDate() + daysToAdd)
  return d
}

const startOfMonth = (date: Date) => {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

const startOfMonthGrid = (date: Date) => {
  const monthStart = startOfMonth(date)
  const day = monthStart.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(monthStart, diff)
}

const addMonths = (date: Date, monthsToAdd: number) => {
  const d = new Date(date)
  d.setMonth(d.getMonth() + monthsToAdd)
  return d
}

const formatDateKey = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
const parseDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0)
}
const endOfLocalDay = (date: Date) => {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}
const baseEventId = (id: string) => id.split('__')[0]
const ICAL_SERVICE_URL = (import.meta.env.VITE_ICAL_SERVICE_URL ?? '').replace(/\/$/, '')

type ParsedIcsEvent = {
  title: string
  startAt: string
  endAt: string
  notes?: string
  location?: string
}

const unfoldIcsLines = (raw: string) => {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.replace(/\n[ \t]/g, '')
}

const parseIcsDate = (value: string): Date | null => {
  const v = value.trim()
  if (!v) return null

  const direct = new Date(v)
  if (!Number.isNaN(direct.getTime())) return direct

  const compactIso = v.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z)?$/i
  )
  if (compactIso) {
    const [, y, m, d, hh, mm, ss = '00', z] = compactIso
    if (z) {
      return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
    }
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  }
  const utcMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (utcMatch) {
    const [, y, m, d, hh, mm, ss] = utcMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
  }

  const utcNoSeconds = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/)
  if (utcNoSeconds) {
    const [, y, m, d, hh, mm] = utcNoSeconds
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0))
  }

  const localMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/)
  if (localMatch) {
    const [, y, m, d, hh, mm, ss] = localMatch
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  }

  const localNoSeconds = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/)
  if (localNoSeconds) {
    const [, y, m, d, hh, mm] = localNoSeconds
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0)
  }

  const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return new Date(Number(y), Number(m) - 1, Number(d), 9, 0, 0)
  }

  return null
}

const parseIcsEvents = (rawIcs: string): ParsedIcsEvent[] => {
  const text = unfoldIcsLines(rawIcs)
  const out: ParsedIcsEvent[] = []

  const parseBlock = (section: string, blockType: 'VEVENT' | 'VTODO' | 'VJOURNAL') => {
    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean)
    const props: Record<string, string[]> = {}

    for (const line of lines) {
      const sep = line.indexOf(':')
      if (sep <= 0) continue
      const keyRaw = line.slice(0, sep).toUpperCase()
      const key = keyRaw.split(';')[0]
      const value = line.slice(sep + 1)

      if (!props[key]) props[key] = []
      props[key].push(value)
    }

    const summary = props.SUMMARY?.[0] ?? ''
    const dtStart = props.DTSTART?.[0] ?? ''
    const dtEnd = props.DTEND?.[0] ?? ''
    const dtStamp = props.DTSTAMP?.[0] ?? ''
    const due = props.DUE?.[0] ?? ''
    const description = (props.DESCRIPTION?.[0] ?? '')
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
    const location = (props.LOCATION?.[0] ?? '').replace(/\\,/g, ',').replace(/\\;/g, ';')

    const start = parseIcsDate(dtStart || due || dtStamp)
    let end = parseIcsDate(dtEnd || due)
    if (!start) return
    if (!end) {
      end = new Date(start)
      const isDateOnly = /^\d{8}$/.test((dtStart || due || '').trim())
      end.setHours(start.getHours() + (isDateOnly ? 24 : 1))
    }
    if (end <= start) {
      const fallbackEnd = new Date(start)
      fallbackEnd.setHours(start.getHours() + (blockType === 'VTODO' ? 24 : 1))
      end = fallbackEnd
    }

    out.push({
      title: summary || 'Imported Event',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      notes: description || undefined,
      location: location || undefined,
    })
  }

  const componentRegex = /BEGIN:(VEVENT|VTODO|VJOURNAL)\s*([\s\S]*?)END:\1/gi
  for (const match of text.matchAll(componentRegex)) {
    const blockType = (match[1] || '').toUpperCase() as 'VEVENT' | 'VTODO' | 'VJOURNAL'
    const section = match[2] || ''
    parseBlock(section, blockType)
  }

  return out
}

export const CalendarWindow = () => {
  const { user } = useAuthContext()
  const { activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const centerScrollRef = useRef<HTMLDivElement | null>(null)
  const hasLoadedDataRef = useRef(false)
  const initialFocusDate = new URLSearchParams(window.location.search).get('focusDate')
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [viewAnchor, setViewAnchor] = useState(() => {
    if (initialFocusDate) {
      const date = new Date(initialFocusDate)
      date.setHours(0, 0, 0, 0)
      return date
    }
    return new Date()
  })
  const [calendars, setCalendars] = useState<CalendarRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [reminders, setReminders] = useState<ReminderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventDate, setNewEventDate] = useState(() => formatDateKey(new Date()))
  const [newEventTime, setNewEventTime] = useState('09:00')
  const [newEventRecurrence, setNewEventRecurrence] = useState<'none' | 'daily' | 'weekly' | 'weekdays'>('none')
  const [composerMode, setComposerMode] = useState<'event' | 'reminder'>('event')
  const [isSavingEvent, setIsSavingEvent] = useState(false)
  const [, setIsSyncingApple] = useState(false)
  const [appleSyncMessage, setAppleSyncMessage] = useState<string | null>(null)
  const [isAppleSyncMessageVisible, setIsAppleSyncMessageVisible] = useState(false)
  const [, setIsImportingIcs] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [isImportMessageVisible, setIsImportMessageVisible] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [gridQuickAdd, setGridQuickAdd] = useState<GridQuickAddState | null>(null)
  const [gridQuickTitle, setGridQuickTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<CalendarContextMenuState | null>(null)
  const [listContextMenu, setListContextMenu] = useState<ListContextMenuState | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null)
  const [eventEditorEvent, setEventEditorEvent] = useState<EventRow | null>(null)
  const [selectedReminder, setSelectedReminder] = useState<ReminderRow | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editStatus, setEditStatus] = useState<'planned' | 'done' | 'missed' | 'cancelled'>('planned')
  const [editColor, setEditColor] = useState('#93C5FD')
  const [editRecurrence, setEditRecurrence] = useState<'none' | 'daily' | 'weekly' | 'weekdays'>('none')
  const [reminderEditTitle, setReminderEditTitle] = useState('')
  const [reminderEditDate, setReminderEditDate] = useState('')
  const [reminderEditTime, setReminderEditTime] = useState('')
  const [reminderEditColor, setReminderEditColor] = useState('#F59E0B')
  const [reminderEditDone, setReminderEditDone] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEvent, setIsDeletingEvent] = useState(false)
  const [isDeletingReminder, setIsDeletingReminder] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [calendarColorDrafts, setCalendarColorDrafts] = useState<Record<string, string>>({})
  const [isSavingColorId, setIsSavingColorId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [rightPaneWidth, setRightPaneWidth] = useState(320)
  const [isResizingRightPane, setIsResizingRightPane] = useState(false)
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false)
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(false)
  const [overflowDayKey, setOverflowDayKey] = useState<string | null>(null)
  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed
  const monthPreview = useMemo(() => {
    const start = startOfMonthGrid(viewAnchor)
    return {
      label: viewAnchor.toLocaleDateString([], { month: 'long', year: 'numeric' }),
      dates: Array.from({ length: 42 }, (_, i) => addDays(start, i)),
    }
  }, [viewAnchor])
  const selectedEventPreview = useMemo(() => {
    if (!selectedEvent) return null
    const fresh = events.find((row) => row.id === baseEventId(selectedEvent.id))
    if (!fresh) return selectedEvent
    if (fresh.id === selectedEvent.id) return fresh
    return {
      ...fresh,
      id: selectedEvent.id,
      start_at: selectedEvent.start_at,
      end_at: selectedEvent.end_at,
    }
  }, [events, selectedEvent])
  const isInitialLoading = isLoading && !hasLoadedData

  const getEventStatusMeta = (status?: EventRow['status']) => {
    switch (status) {
      case 'done':
        return {
          label: 'Done',
          chipClass: 'border-green-200 bg-green-50 text-green-900',
          dotClass: 'bg-green-500',
          previewClass: 'bg-green-50 border-green-200 text-green-950',
        }
      case 'missed':
        return {
          label: 'Missed',
          chipClass: 'border-amber-200 bg-amber-50 text-amber-900',
          dotClass: 'bg-amber-500',
          previewClass: 'bg-amber-50 border-amber-200 text-amber-950',
        }
      case 'cancelled':
        return {
          label: 'Cancelled',
          chipClass: 'border-gray-200 bg-gray-100 text-gray-700',
          dotClass: 'bg-gray-400',
          previewClass: 'bg-gray-100 border-gray-200 text-gray-700',
        }
      default:
        return {
          label: 'Planned',
          chipClass: 'border-blue-200 bg-blue-50 text-blue-900',
          dotClass: 'bg-blue-500',
          previewClass: 'bg-blue-50 border-blue-200 text-blue-950',
        }
    }
  }
  const selectedReminderPreview = selectedReminder ?? null

  useEffect(() => {
    const applyFocusDate = (focusDate: string) => {
      const date = new Date(focusDate)
      date.setHours(0, 0, 0, 0)
      setViewAnchor(date)
    }

    if (initialFocusDate) {
      applyFocusDate(initialFocusDate)
    }

    const focusDateListener = (_event: unknown, payload: { kind?: string; focusDate?: string | null }) => {
      if (payload?.kind === 'calendar' && payload.focusDate) {
        applyFocusDate(payload.focusDate)
      }
    }

    window.ipcRenderer?.on('module:focus-date', focusDateListener)

    return () => {
      window.ipcRenderer?.off('module:focus-date', focusDateListener)
    }
  }, [initialFocusDate])

  const viewConfig = useMemo(() => {
    if (viewMode === 'day') {
      const start = startOfDay(viewAnchor)
      const end = addDays(start, 1)
      return {
        label: start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
        start,
        end,
        dates: [start],
      }
    }

    if (viewMode === 'month') {
      const monthStart = startOfMonth(viewAnchor)
      const start = startOfMonthGrid(viewAnchor)
      const end = addDays(start, 42)
      const monthLabel = monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' })
      return {
        label: monthLabel,
        start,
        end,
        dates: Array.from({ length: 42 }, (_, i) => addDays(start, i)),
      }
    }

    const start = startOfWeek(viewAnchor)
    const end = endOfWeek(viewAnchor)
    return {
      label: `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${new Date(end.getTime() - 1).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`,
      start,
      end,
      dates: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    }
  }, [viewAnchor, viewMode])

  const visibleEvents = useMemo(() => {
    const expanded: EventRow[] = []
    for (const event of events) {
      const recurrence = event.recurrence_rule ?? 'none'
      if (recurrence === 'none') {
        expanded.push(event)
        continue
      }

      const baseStart = new Date(event.start_at)
      const baseEnd = new Date(event.end_at)
      const durationMs = baseEnd.getTime() - baseStart.getTime()

      let cursor = startOfDay(viewConfig.start)
      const hardEnd = endOfLocalDay(viewConfig.end)

      while (cursor <= hardEnd) {
        const sameWeekday = cursor.getDay() === baseStart.getDay()
        const isWeekday = cursor.getDay() >= 1 && cursor.getDay() <= 5
        const matches =
          recurrence === 'daily' ||
          (recurrence === 'weekly' && sameWeekday) ||
          (recurrence === 'weekdays' && isWeekday)

        if (matches) {
          const occurrenceStart = new Date(cursor)
          occurrenceStart.setHours(
            baseStart.getHours(),
            baseStart.getMinutes(),
            baseStart.getSeconds(),
            baseStart.getMilliseconds()
          )

          if (occurrenceStart >= baseStart && occurrenceStart >= viewConfig.start && occurrenceStart < viewConfig.end) {
            const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
            expanded.push({
              ...event,
              id: `${event.id}__${formatDateKey(occurrenceStart)}`,
              start_at: occurrenceStart.toISOString(),
              end_at: occurrenceEnd.toISOString(),
            })
          }
        }

        cursor = addDays(cursor, 1)
      }
    }

    expanded.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    return expanded
  }, [events, viewConfig.start, viewConfig.end])

  const eventsByDay = useMemo(() => {
    const grouped: Record<string, EventRow[]> = {}
    for (const date of viewConfig.dates) grouped[formatDateKey(date)] = []

    for (const evt of visibleEvents) {
      const key = formatDateKey(new Date(evt.start_at))
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(evt)
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    }

    return grouped
  }, [visibleEvents, viewConfig.dates])

  const remindersByDay = useMemo(() => {
    const grouped: Record<string, ReminderRow[]> = {}
    for (const date of viewConfig.dates) grouped[formatDateKey(date)] = []

    for (const reminder of reminders) {
      const key = formatDateKey(new Date(reminder.remind_at))
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(reminder)
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime())
    }

    return grouped
  }, [reminders, viewConfig.dates])

  const overflowEvents = useMemo(
    () => (overflowDayKey ? eventsByDay[overflowDayKey] ?? [] : []),
    [overflowDayKey, eventsByDay]
  )

  const overflowReminders = useMemo(
    () => (overflowDayKey ? remindersByDay[overflowDayKey] ?? [] : []),
    [overflowDayKey, remindersByDay]
  )

  useEffect(() => {
    let cancelled = false

    const loadCalendarData = async () => {
      if (!user || !activeWorkspaceId) {
        if (!cancelled) {
          setCalendars([])
          setEvents([])
          setReminders([])
          setHasLoadedData(false)
          setIsLoading(false)
          setIsRefreshing(false)
        }
        return
      }

      const isInitialLoad = !hasLoadedDataRef.current
      if (isInitialLoad) {
        setIsLoading(true)
      } else {
        setIsRefreshing(true)
      }
      setError(null)

      try {
        const loadedCalendars = await api.getCalendars()

        if (cancelled) return

        let finalCalendars = (loadedCalendars ?? []) as CalendarRow[]

        if (finalCalendars.length === 0) {
          const createdCalendar = await api.createCalendar('Personal', '#3B82F6')
          if (cancelled) return

          if (!createdCalendar) {
            setError('Could not create default calendar.')
            return
          }

          finalCalendars = [createdCalendar as CalendarRow]
        }

        setCalendars(finalCalendars)
        setCalendarColorDrafts(
          Object.fromEntries(finalCalendars.map((calendar) => [calendar.id, calendar.color]))
        )

        const [eventRows, reminderRows] = await Promise.all([
          api.getEvents(viewConfig.start.toISOString(), viewConfig.end.toISOString()),
          api.getReminders(),
        ])

        if (cancelled) return

        setEvents((eventRows ?? []) as EventRow[])
        setReminders(
          ((reminderRows ?? []) as ReminderRow[]).filter((reminder) => {
            const remindAt = new Date(reminder.remind_at).getTime()
            return remindAt >= viewConfig.start.getTime() && remindAt < viewConfig.end.getTime()
          })
        )
        hasLoadedDataRef.current = true
        setHasLoadedData(true)
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load calendar data:', error)
          setError('Could not load calendar data right now.')
          if (!hasLoadedDataRef.current) {
            setCalendars([])
            setEvents([])
            setReminders([])
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    loadCalendarData()

    const refreshTimer = window.setInterval(() => {
      void loadCalendarData()
    }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
    }
  }, [user?.id, activeWorkspaceId, viewConfig.start.toISOString(), viewConfig.end.toISOString(), api])

  useEffect(() => {
    if (!appleSyncMessage) return
    setIsAppleSyncMessageVisible(true)

    const hideTimer = window.setTimeout(() => {
      setIsAppleSyncMessageVisible(false)
    }, NOTIFICATION_VISIBLE_MS)

    const clearTimer = window.setTimeout(() => {
      setAppleSyncMessage(null)
    }, NOTIFICATION_VISIBLE_MS + NOTIFICATION_FADE_MS)

    return () => {
      window.clearTimeout(hideTimer)
      window.clearTimeout(clearTimer)
    }
  }, [appleSyncMessage])

  useEffect(() => {
    if (!importMessage) return
    setIsImportMessageVisible(true)

    const hideTimer = window.setTimeout(() => {
      setIsImportMessageVisible(false)
    }, NOTIFICATION_VISIBLE_MS)

    const clearTimer = window.setTimeout(() => {
      setImportMessage(null)
    }, NOTIFICATION_VISIBLE_MS + NOTIFICATION_FADE_MS)

    return () => {
      window.clearTimeout(hideTimer)
      window.clearTimeout(clearTimer)
    }
  }, [importMessage])

  useEffect(() => {
    if (!contextMenu) return

    const closeMenu = () => setContextMenu(null)
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
  }, [contextMenu])

  useEffect(() => {
    if (!listContextMenu) return

    const closeMenu = () => setListContextMenu(null)
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
  }, [listContextMenu])

  useEffect(() => {
    if (!isResizingSidebar) return

    const handleMove = (event: MouseEvent) => {
      const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, event.clientX))
      setSidebarWidth(next)
    }

    const handleUp = () => {
      setIsResizingSidebar(false)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizingSidebar])

  useEffect(() => {
    if (!isResizingRightPane) return

    const handleMove = (event: MouseEvent) => {
      const next = window.innerWidth - event.clientX
      const clamped = Math.max(260, Math.min(420, next))
      setRightPaneWidth(clamped)
    }

    const handleUp = () => {
      setIsResizingRightPane(false)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizingRightPane])

  const openComposerAtSlot = (
    dateKey: string,
    hour: number,
    title = '',
    mode: 'event' | 'reminder' = 'event'
  ) => {
    setGridQuickAdd(null)
    setGridQuickTitle('')
    setNewEventDate(dateKey)
    setNewEventTime(`${String(hour).padStart(2, '0')}:00`)
    setNewEventTitle(title)
    setNewEventRecurrence('none')
    setComposerMode(mode)
    setIsComposerOpen(true)
  }

  const moveView = (direction: -1 | 1) => {
    setViewAnchor((prev) => {
      if (viewMode === 'day') return addDays(prev, direction)
      if (viewMode === 'month') return addMonths(prev, direction)
      return addDays(prev, direction * 7)
    })
  }

  const jumpToToday = () => {
    setViewAnchor(new Date())
  }

  const createQuickEvent = async () => {
    if (!user || !newEventTitle.trim() || calendars.length === 0) return

    const selectedCalendar = calendars[0]
    const start = new Date(`${newEventDate}T${newEventTime}:00`)
    const end = new Date(start)
    end.setHours(start.getHours() + 1)

    setIsSavingEvent(true)
    setError(null)

    if (composerMode === 'reminder') {
      const createdReminder = (await api.createReminder({
        title: newEventTitle.trim(),
        remind_at: start.toISOString(),
        calendar_id: selectedCalendar.id,
        color: selectedCalendar.color,
        is_done: false,
      })) as ReminderRow

      setIsSavingEvent(false)

      if (!createdReminder) {
        setError('Could not create reminder.')
        return
      }

      setReminders((prev) =>
        [...prev, createdReminder].sort(
          (a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
        )
      )
      setNewEventTitle('')
      setIsComposerOpen(false)
      setComposerMode('event')
      setNewEventRecurrence('none')
      return
    }

    const createdEvent = (await api.createEvent({
      title: newEventTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      calendar_id: selectedCalendar.id,
      color: selectedCalendar.color,
      recurrence_rule: newEventRecurrence,
      status: 'planned',
    })) as EventRow

    setIsSavingEvent(false)

    if (!createdEvent) {
      setError('Could not create event.')
      return
    }

    setEvents((prev) => [...prev, createdEvent].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()))
    setNewEventTitle('')
    setIsComposerOpen(false)
    setComposerMode('event')
    setNewEventRecurrence('none')
  }

  const toggleReminderDone = async (reminder: ReminderRow) => {
    try {
      const updated = (await api.updateReminder(reminder.id, {
        is_done: !reminder.is_done,
      })) as ReminderRow

      if (!updated) {
        setError('Could not update reminder.')
        return
      }

      setReminders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (error) {
      setError('Could not update reminder.')
      return
    }
  }

  const quickDeleteReminder = async (reminderId: string) => {
    try {
      await api.deleteReminder(reminderId)
      setReminders((prev) => prev.filter((item) => item.id !== reminderId))
    } catch (error) {
      setError('Could not delete reminder.')
      return
    }
  }

  const openReminderEditor = (reminder: ReminderRow) => {
    const start = new Date(reminder.remind_at)
    setSelectedReminder(reminder)
    setReminderEditTitle(reminder.title)
    setReminderEditDate(formatDateKey(start))
    setReminderEditTime(
      `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    )
    setReminderEditColor(reminder.color ?? '#F59E0B')
    setReminderEditDone(reminder.is_done)
  }

  const saveReminderEdits = async () => {
    if (!selectedReminder || !reminderEditTitle.trim()) return
    setIsSavingEdit(true)
    setError(null)

    const remindAt = new Date(`${reminderEditDate}T${reminderEditTime}:00`)
    const updated = (await api.updateReminder(selectedReminder.id, {
      title: reminderEditTitle.trim(),
      remind_at: remindAt.toISOString(),
      color: reminderEditColor,
      is_done: reminderEditDone,
    })) as ReminderRow

    setIsSavingEdit(false)

    if (!updated) {
      setError('Could not update reminder.')
      return
    }

    setReminders((prev) =>
      prev
        .map((item) => (item.id === updated.id ? updated : item))
        .sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime())
    )
    setSelectedReminder(null)
  }

  const deleteReminderFromEditor = async () => {
    if (!selectedReminder) return
    setIsDeletingReminder(true)
    setError(null)

    try {
      await api.deleteReminder(selectedReminder.id)
      setReminders((prev) => prev.filter((item) => item.id !== selectedReminder.id))
      setSelectedReminder(null)
    } catch (error) {
      setError('Could not delete reminder.')
    } finally {
      setIsDeletingReminder(false)
    }
  }

  const openEventEditor = (event: EventRow) => {
    const source = events.find((row) => row.id === baseEventId(event.id)) ?? event
    const start = new Date(event.start_at)
    setSelectedEvent(source)
    setEventEditorEvent(source)
    setEditTitle(source.title)
    setEditDate(formatDateKey(start))
    setEditTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`)
    setEditStatus(source.status ?? 'planned')
    setEditColor(source.color ?? '#93C5FD')
    setEditRecurrence(source.recurrence_rule ?? 'none')
    setConfirmDelete(false)
  }

  const saveEventEdits = async () => {
    if (!eventEditorEvent || !editTitle.trim()) return

    const start = new Date(`${editDate}T${editTime}:00`)
    const end = new Date(start)
    end.setHours(start.getHours() + 1)

    setIsSavingEdit(true)
    setError(null)

    const updated = (await api.updateEvent(eventEditorEvent.id, {
      title: editTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      color: editColor,
      status: editStatus,
      recurrence_rule: editRecurrence,
    })) as EventRow

    setIsSavingEdit(false)

    if (!updated) {
      setError('Could not update event.')
      return
    }

    setEvents((prev) =>
      prev
        .map((evt) => (evt.id === updated.id ? updated : evt))
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    )
    setSelectedEvent((current) => (current?.id === updated.id ? updated : current))
    setEventEditorEvent(null)
  }

  const deleteEvent = async () => {
    if (!eventEditorEvent) return

    setIsDeletingEvent(true)
    setError(null)

    try {
      await api.deleteEvent(eventEditorEvent.id)
      setEvents((prev) => prev.filter((evt) => evt.id !== eventEditorEvent.id))
      setSelectedEvent((current) => (current?.id === eventEditorEvent.id ? null : current))
      setEventEditorEvent(null)
      setConfirmDelete(false)
    } catch (error) {
      setError('Could not delete event.')
    } finally {
      setIsDeletingEvent(false)
    }
  }

  const quickDeleteEvent = async (eventId: string) => {
    const targetId = baseEventId(eventId)
    try {
      await api.deleteEvent(targetId)
      setEvents((prev) => prev.filter((evt) => evt.id !== targetId))
    } catch (error) {
      setError('Could not delete event.')
    }
  }

  const saveCalendarColor = async (calendar: CalendarRow, color: string) => {
    if (calendar.color === color) return

    setIsSavingColorId(calendar.id)
    setError(null)

    try {
      const updated = (await api.updateCalendar(calendar.id, { color })) as CalendarRow
      if (!updated) {
        setError('Could not update calendar color.')
        return
      }

      setCalendars((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (error) {
      setError('Could not update calendar color.')
    } finally {
      setIsSavingColorId(null)
    }
  }

  const createGridEvent = async () => {
    if (!user || !gridQuickAdd || !gridQuickTitle.trim() || calendars.length === 0) return

    const selectedCalendar = calendars[0]
    const hourString = String(gridQuickAdd.hour).padStart(2, '0')
    const start = new Date(`${gridQuickAdd.dateKey}T${hourString}:00:00`)
    const end = new Date(start)
    end.setHours(start.getHours() + 1)

    setIsSavingEvent(true)
    setError(null)

    const result = (await api.createEvent({
      title: gridQuickTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      calendar_id: selectedCalendar.id,
      color: selectedCalendar.color,
      recurrence_rule: 'none',
      status: 'planned',
    })) as EventRow

    setIsSavingEvent(false)

    if (!result) {
      setError('Could not create event.')
      return
    }

    setEvents((prev) => [...prev, result].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()))
    setGridQuickAdd(null)
    setGridQuickTitle('')
  }

  const syncAppleCalendar = async () => {
    if (!user) return
    if (!ICAL_SERVICE_URL) {
      setError('Missing VITE_ICAL_SERVICE_URL in frontend environment.')
      return
    }

    setIsSyncingApple(true)
    setError(null)
    setAppleSyncMessage(null)

    try {
      const response = await fetch(`${ICAL_SERVICE_URL}/sync-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })

      const json = (await response.json()) as { token?: string; error?: string }
      if (!response.ok || !json.token) {
        throw new Error(json.error || 'Failed to generate sync token')
      }

      const url = `${ICAL_SERVICE_URL}/ical/${json.token}.ics`
      const webcalUrl = url.replace(/^https?:\/\//i, 'webcal://')

      try {
        await window.desktopWindow?.openExternal(webcalUrl)
        setAppleSyncMessage('Opened Apple Calendar subscription. Confirm once to finish sync.')
      } catch {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url)
          setAppleSyncMessage('Could not auto-open Calendar. iCal link copied instead.')
        } else {
          setAppleSyncMessage(`Could not auto-open Calendar. Copy this URL: ${url}`)
        }
      }
    } catch (syncErr) {
      const message = syncErr instanceof Error ? syncErr.message : 'Sync setup failed'
      setError(`Could not generate Apple iCal link. ${message}`)
    } finally {
      setIsSyncingApple(false)
    }
  }

  const importIcsFile = async (file: File) => {
    if (!user || calendars.length === 0) return

    setIsImportingIcs(true)
    setError(null)
    setImportMessage(null)

    try {
      const raw = await file.text()
      const parsed = parseIcsEvents(raw)
      if (parsed.length === 0) {
        const unfolded = unfoldIcsLines(raw)
        const veventCount = (unfolded.match(/BEGIN:VEVENT/gi) ?? []).length
        const vtodoCount = (unfolded.match(/BEGIN:VTODO/gi) ?? []).length
        const vjournalCount = (unfolded.match(/BEGIN:VJOURNAL/gi) ?? []).length
        setImportMessage(
          `No importable events found. Detected VEVENT:${veventCount}, VTODO:${vtodoCount}, VJOURNAL:${vjournalCount}.`
        )
        setIsImportingIcs(false)
        return
      }

      const selectedCalendar = calendars[0]
      const payload = parsed.map((evt) => ({
        calendar_id: selectedCalendar.id,
        workspace_id: selectedCalendar.workspace_id,
        created_by: user.id,
        title: evt.title,
        notes: evt.notes ?? null,
        location: evt.location ?? null,
        start_at: evt.startAt,
        end_at: evt.endAt,
        color: selectedCalendar.color,
        status: 'planned',
      }))

      const importedEvents = [] as EventRow[]
      for (const item of payload) {
        const created = (await api.createEvent({
          title: item.title,
          start_at: item.start_at,
          end_at: item.end_at,
          calendar_id: item.calendar_id,
          color: item.color,
          status: item.status,
          recurrence_rule: 'none',
          notes: item.notes ?? null,
          location: item.location ?? null,
        })) as EventRow

        if (created) {
          importedEvents.push(created)
        }
      }
      setEvents((prev) =>
        [...prev, ...importedEvents].sort(
          (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        )
      )
      setImportMessage(`Imported ${importedEvents.length} event${importedEvents.length === 1 ? '' : 's'} from .ics`)
    } catch (importErr) {
      const message = importErr instanceof Error ? importErr.message : 'Import failed'
      setError(`Could not import .ics. ${message}`)
    } finally {
      setIsImportingIcs(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const loadingSkeleton = (
    <div className="h-full overflow-auto bg-white">
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-6 w-56 rounded bg-gray-200" />
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-gray-200">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-12 bg-gray-100" />
          ))}
          {Array.from({ length: 28 }).map((_, index) => (
            <div key={index} className="min-h-16 border-t border-gray-200 bg-gray-50 p-2">
              <div className="h-3 w-6 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-4/5 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-2/3 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-screen bg-[#f5f7fb] flex flex-col">
      <div
        className="h-8 bg-white border-b border-gray-100"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />
      <header
        className="h-16 border-b border-gray-200 px-5 flex items-center justify-between bg-white"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => {
              void window.desktopWindow?.toggleModule('calendar')
            }}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
            title="Close Calendar"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
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
            className="h-8 px-3 rounded-full border border-gray-200 bg-gray-50 text-xs font-medium text-gray-700 hover:bg-gray-100 transition"
            title={areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
          >
            {areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
          </button>
          <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
            <CalendarDays size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-[26px] leading-none font-semibold tracking-tight text-gray-900">Calendar</h1>
            <p className="text-xs text-gray-500 mt-1">{viewConfig.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          {isRefreshing && !isInitialLoading && (
            <span className="text-[11px] text-gray-500 mr-1">Syncing...</span>
          )}
          <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1 shadow-sm">
            <button
              onClick={() => moveView(-1)}
              className="h-8 w-8 rounded-full hover:bg-white text-gray-600 flex items-center justify-center"
              title="Previous period"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => jumpToToday()}
              className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
            >
              Today
            </button>
            <button
              onClick={() => moveView(1)}
              className="h-8 w-8 rounded-full hover:bg-white text-gray-600 flex items-center justify-center"
              title="Next period"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="flex items-center rounded-full border border-gray-200 bg-gray-50 p-0.5 shadow-sm">
            {(['day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                  viewMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importIcsFile(file)
            }}
          />
        </div>
      </header>

      {appleSyncMessage && (
        <div
          className={`px-5 py-2 text-xs text-green-700 bg-green-50 border-b border-green-100 transition-opacity duration-300 ${
            isAppleSyncMessageVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {appleSyncMessage}
        </div>
      )}
      {importMessage && (
        <div
          className={`px-5 py-2 text-xs text-blue-700 bg-blue-50 border-b border-blue-100 transition-opacity duration-300 ${
            isImportMessageVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {importMessage}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed ? (
          <>
            <aside
              className="border-r border-gray-200 p-4 overflow-auto shrink-0 bg-white"
              style={{ width: `${sidebarWidth}px` }}
            >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Workspace</p>
            <button
              onClick={() => setIsLeftPaneCollapsed(true)}
              className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Hide left panel"
            >
              <ChevronLeft size={13} strokeWidth={2.25} />
            </button>
          </div>
          <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Month</p>
                <h2 className="text-sm font-semibold text-gray-900">{monthPreview.label}</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveView(-1)}
                  className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                  title="Previous period"
                >
                  <ChevronLeft size={13} strokeWidth={2.25} />
                </button>
                <button
                  onClick={() => jumpToToday()}
                  className="h-7 px-2 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                >
                  Today
                </button>
                <button
                  onClick={() => moveView(1)}
                  className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                  title="Next period"
                >
                  <ChevronRight size={13} strokeWidth={2.25} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-[10px] font-medium text-gray-400 mb-2">
              {days.map((day) => (
                <span key={day} className="text-center">
                  {day.slice(0, 1)}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthPreview.dates.map((dayDate) => {
                const key = formatDateKey(dayDate)
                const inMonth = dayDate.getMonth() === viewAnchor.getMonth()
                const isToday = key === formatDateKey(new Date())
                const isActive = key === formatDateKey(viewAnchor)

                return (
                  <button
                    key={key}
                    onClick={() => {
                      setViewAnchor(dayDate)
                      setViewMode('day')
                    }}
                    className={`h-7 rounded-md text-[11px] font-medium transition ${
                      isActive
                        ? 'bg-gray-900 text-white'
                        : isToday
                          ? 'bg-blue-50 text-blue-700'
                          : inMonth
                            ? 'text-gray-700 hover:bg-white'
                            : 'text-gray-300 hover:bg-white'
                    }`}
                  >
                    {dayDate.getDate()}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mb-5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Overview</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Events</p>
                <p className="text-xl font-semibold text-gray-900 leading-tight">{visibleEvents.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Reminders</p>
                <p className="text-xl font-semibold text-gray-900 leading-tight">{reminders.length}</p>
              </div>
            </div>
          </div>

          <div className="mb-5 border-t border-gray-100 pt-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Calendars</h2>
            <div className="space-y-2">
              {calendars.map((calendar) => (
                <div key={calendar.id} className="flex items-center justify-between gap-2 text-sm text-gray-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: calendar.color }} />
                    <span className="truncate font-medium">{calendar.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={calendarColorDrafts[calendar.id] ?? calendar.color}
                      onChange={(e) => {
                        const next = e.target.value
                        setCalendarColorDrafts((prev) => ({ ...prev, [calendar.id]: next }))
                        void saveCalendarColor(calendar, next)
                      }}
                      title={`Change ${calendar.name} color`}
                      className="h-5 w-5 rounded border border-gray-200 bg-white p-0 cursor-pointer"
                    />
                    {isSavingColorId === calendar.id && (
                      <span className="text-[10px] text-gray-400">...</span>
                    )}
                  </div>
                </div>
              ))}
              {!isLoading && calendars.length === 0 && <p className="text-xs text-gray-500">No calendars yet.</p>}
            </div>
          </div>

          <div className="mb-5 border-t border-gray-100 pt-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setComposerMode('event')
                  setNewEventRecurrence('none')
                  setIsComposerOpen(true)
                }}
                className="h-9 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 transition"
              >
                New Event
              </button>
              <button
                onClick={() => {
                  setComposerMode('reminder')
                  setNewEventRecurrence('none')
                  setIsComposerOpen(true)
                }}
                className="h-9 rounded-md bg-gray-100 text-gray-800 text-xs font-medium hover:bg-gray-200 transition"
              >
                New Reminder
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                className="h-9 rounded-md border border-gray-200 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 transition"
              >
                Import .ics
              </button>
              <button
                onClick={() => void syncAppleCalendar()}
                className="h-9 rounded-md border border-gray-200 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 transition"
              >
                Sync iCal
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-600 mt-4">{error}</p>}
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault()
                setIsResizingSidebar(true)
              }}
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-gray-200 transition-colors ${
                isResizingSidebar ? 'bg-gray-300' : ''
              }`}
              title="Drag to resize sidebar"
            />
          </>
        ) : (
          <div className="w-10 shrink-0 border-r border-gray-200 bg-white flex items-start justify-center pt-4">
            <button
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="h-8 w-8 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Show left panel"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        <section className="flex-1 min-w-0 p-2.5">
          <div className="h-full rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div
            ref={centerScrollRef}
            className="flex-1 min-w-0 overflow-auto"
            onWheel={(event) => {
                const container = centerScrollRef.current
                if (!container) return

                const hasHorizontalOverflow = container.scrollWidth > container.clientWidth
                if (!hasHorizontalOverflow) return

                const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
                if (delta === 0) return

                event.preventDefault()
              container.scrollLeft += delta
            }}
          >
            {isInitialLoading ? (
              loadingSkeleton
            ) : viewMode === 'month' ? (
              <div className="min-w-210 p-3">
                <div className="grid grid-cols-7 border-l border-t border-gray-200 rounded-t-lg overflow-hidden">
                {days.map((day) => (
                  <div
                    key={day}
                    className="h-10 flex items-center justify-center bg-gray-50 border-r border-b border-gray-200 text-xs font-semibold text-gray-600"
                  >
                    {day}
                  </div>
                ))}
                {viewConfig.dates.map((dayDate) => {
                  const key = formatDateKey(dayDate)
                  const dayEvents = eventsByDay[key] ?? []
                  const dayReminders = remindersByDay[key] ?? []
                  const visibleEvents = dayEvents.slice(0, 2)
                  const visibleReminders = dayReminders.slice(0, 1)
                  const extraCount = dayEvents.length + dayReminders.length - visibleEvents.length - visibleReminders.length
                  const inMonth = dayDate.getMonth() === viewAnchor.getMonth()

                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setViewMode('day')
                        setViewAnchor(dayDate)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setContextMenu({ x: event.clientX, y: event.clientY, dateKey: key, hour: 9 })
                      }}
                      className={`min-h-29 border-r border-b border-gray-200 text-left p-2 align-top hover:bg-blue-50/40 transition-colors ${
                        inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <span className={`text-xs font-semibold ${inMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                          {dayDate.getDate()}
                        </span>
                        {dayEvents.length + dayReminders.length > 0 && (
                          <span className="text-[10px] text-gray-500">{dayEvents.length + dayReminders.length}</span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        {visibleReminders.map((reminder) => (
                          <div
                            key={reminder.id}
                            className="text-[10px] rounded px-1.5 py-0.5 truncate"
                            style={{ backgroundColor: `${reminder.color ?? '#F59E0B'}33`, color: '#1F2937' }}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setListContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                kind: 'reminder',
                                id: reminder.id,
                              })
                            }}
                          >
                            {reminder.title}
                          </div>
                        ))}
                        {visibleEvents.map((event) => (
                          (() => {
                            const meta = getEventStatusMeta(event.status)
                            return (
                          <div
                            key={event.id}
                            className={`text-[10px] rounded px-1.5 py-0.5 truncate border ${
                              meta.previewClass
                            } ${event.status === 'done' ? 'line-through opacity-80' : ''} ${event.status === 'cancelled' ? 'opacity-65' : ''}`}
                            style={{ backgroundColor: `${event.color ?? '#93C5FD'}22` }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setListContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: 'event',
                                id: event.id,
                              })
                            }}
                          >
                            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                            {event.title}
                          </div>
                            )
                          })()
                        ))}
                        {extraCount > 0 && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              setOverflowDayKey(key)
                            }}
                            className="text-[10px] text-gray-500 hover:text-gray-700"
                          >
                            +{extraCount} more
                          </button>
                        )}
                      </div>
                    </button>
                  )
                })}
                </div>
              </div>
            ) : (
              <div
                className="grid min-w-210"
                style={{ gridTemplateColumns: `72px repeat(${viewConfig.dates.length}, minmax(0, 1fr))` }}
              >
              <div className="sticky top-0 z-10 h-12 bg-white border-b border-gray-200" />
              {viewConfig.dates.map((dayDate) => (
                <div
                  key={dayDate.toISOString()}
                  className="sticky top-0 z-10 h-12 bg-white border-b border-l border-gray-200 flex flex-col items-center justify-center"
                >
                  <span className="text-xs font-semibold text-gray-600">{dayDate.toLocaleDateString([], { weekday: 'short' })}</span>
                  <span className="text-[10px] text-gray-400">{dayDate.getMonth() + 1}/{dayDate.getDate()}</span>
                </div>
              ))}

              {hours.map((hour) => (
                <Fragment key={hour}>
                  <div className="h-16 border-b border-gray-100 pr-3 text-[11px] text-gray-400 flex items-start justify-end pt-1.5">
                    {hour}
                  </div>
                  {viewConfig.dates.map((dayDate) => {
                    const key = formatDateKey(dayDate)
                    const hourInt = Number.parseInt(hour.split(':')[0], 10)
                    const items = (eventsByDay[key] ?? []).filter((evt) => new Date(evt.start_at).getHours() === hourInt)
                    const dayReminders = remindersByDay[key] ?? []
                    const visibleItems = items.slice(0, 2)
                    const hiddenCount = items.length - visibleItems.length
                    const visibleReminders = hourInt === 8 ? dayReminders.slice(0, 2) : []
                    const hiddenReminders = hourInt === 8 ? dayReminders.length - visibleReminders.length : 0
                    const isQuickAddOpen =
                      gridQuickAdd?.dateKey === key && gridQuickAdd?.hour === hourInt

                    return (
                      <div
                        key={`${hour}-${key}`}
                        className="h-16 border-b border-l border-gray-100 relative px-1 py-1 hover:bg-blue-50/40 cursor-pointer"
                        onClick={() => {
                          setContextMenu(null)
                          setListContextMenu(null)
                          setGridQuickAdd(null)
                          setGridQuickTitle('')
                          setViewMode('day')
                          setViewAnchor(dayDate)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setGridQuickAdd(null)
                          setGridQuickTitle('')
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            dateKey: key,
                            hour: hourInt,
                          })
                        }}
                      >
                        {isQuickAddOpen && (
                          <div
                            className="absolute top-1 left-1 right-1 z-20 rounded-md border border-gray-200 bg-white shadow-lg p-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              autoFocus
                              value={gridQuickTitle}
                              onChange={(e) => setGridQuickTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  void createGridEvent()
                                }
                                if (e.key === 'Escape') {
                                  setGridQuickAdd(null)
                                  setGridQuickTitle('')
                                }
                              }}
                              placeholder="Quick event title"
                              className="w-full h-7 px-2 text-[11px] border border-gray-200 rounded focus:outline-none focus:border-gray-400"
                            />
                            <div className="mt-1 flex justify-end gap-1">
                              <button
                                onClick={() => {
                                  setGridQuickAdd(null)
                                  setGridQuickTitle('')
                                }}
                                className="px-1.5 py-0.5 text-[10px] text-gray-600 bg-gray-100 rounded"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void createGridEvent()}
                                disabled={!gridQuickTitle.trim() || isSavingEvent}
                                className="px-1.5 py-0.5 text-[10px] text-white bg-gray-900 rounded disabled:opacity-60"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        )}
                        {visibleReminders.map((reminder) => (
                          <button
                            key={reminder.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              void toggleReminderDone(reminder)
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setListContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: 'reminder',
                                id: reminder.id,
                              })
                            }}
                            className={`text-[10px] rounded px-1.5 py-0.5 truncate w-full text-left mb-0.5 ${
                              reminder.is_done ? 'line-through opacity-60' : ''
                            }`}
                            style={{
                              backgroundColor: `${reminder.color ?? '#F59E0B'}33`,
                              color: '#1F2937',
                            }}
                            title={`${new Date(reminder.remind_at).toLocaleTimeString([], {
                              hour: 'numeric',
                              minute: '2-digit',
                            })} • ${reminder.title}`}
                          >
                            Reminder: {reminder.title}
                          </button>
                        ))}
                        {hiddenReminders > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setOverflowDayKey(key)
                            }}
                            className="text-[10px] text-amber-700 font-medium mb-0.5"
                            title={`${hiddenReminders} more reminder${hiddenReminders === 1 ? '' : 's'}`}
                          >
                            +{hiddenReminders} reminders
                          </button>
                        )}
                        {visibleItems.map((evt) => (
                          <button
                            key={evt.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedEvent(events.find((row) => row.id === baseEventId(evt.id)) ?? evt)
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setListContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: 'event',
                                id: evt.id,
                              })
                            }}
                            className="text-[10px] rounded px-1.5 py-0.5 truncate w-full text-left mb-0.5 last:mb-0"
                            style={{
                              backgroundColor: `${evt.color ?? '#93C5FD'}44`,
                              color: '#1F2937',
                            }}
                          >
                            {evt.title}
                          </button>
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setOverflowDayKey(key)
                            }}
                            className="text-[10px] text-gray-600 hover:text-gray-800 px-1.5 py-0.5"
                          >
                            +{hiddenCount} more
                          </button>
                        )}
                      </div>
                    )
                  })}
                </Fragment>
              ))}
              </div>
            )}
            </div>
          </div>
        </section>

        {!isRightPaneCollapsed && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault()
                setIsResizingRightPane(true)
              }}
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-gray-200 transition-colors ${
                isResizingRightPane ? 'bg-gray-300' : ''
              }`}
              title="Drag to resize inspector"
            />

            <aside
              className="border-l border-gray-200 bg-[#fbfcfe] overflow-auto p-4 space-y-4"
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Inspector</p>
                <button
                  onClick={() => setIsRightPaneCollapsed(true)}
                  className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                  title="Hide right panel"
                >
                  <ChevronRight size={13} strokeWidth={2.25} />
                </button>
              </div>
              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">At a glance</p>
                <h2 className="mt-1 text-sm font-semibold text-gray-900">{viewConfig.label}</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Events</p>
                    <p className="text-lg font-semibold text-gray-900">{visibleEvents.length}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Reminders</p>
                    <p className="text-lg font-semibold text-gray-900">{reminders.length}</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Selection</p>
                {selectedEventPreview ? (
                  <div className="mt-3 space-y-2">
                    {(() => {
                      const meta = getEventStatusMeta(selectedEventPreview.status)
                      return (
                    <div className={`rounded-xl border p-3 ${meta.previewClass}`}>
                      <p className="text-xs font-semibold">{selectedEventPreview.title}</p>
                      <p className="mt-1 text-[11px] opacity-80">
                        {new Date(selectedEventPreview.start_at).toLocaleString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                      <span className={`mt-2 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.chipClass}`}>
                        {meta.label}
                      </span>
                    </div>
                      )
                    })()}
              <button
                onClick={() => openEventEditor(selectedEventPreview)}
                className="w-full h-8 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800"
              >
                Open Editor
              </button>
                  </div>
                ) : selectedReminderPreview ? (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                      <p className="text-xs font-semibold text-amber-900">{selectedReminderPreview.title}</p>
                      <p className="mt-1 text-[11px] text-amber-800">
                        {new Date(selectedReminderPreview.remind_at).toLocaleString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <button
                      onClick={() => openReminderEditor(selectedReminderPreview)}
                      className="w-full h-8 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800"
                    >
                      Edit Reminder
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-medium text-gray-800">No item selected</p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Open an event or reminder to inspect it here.
                    </p>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Upcoming</p>
                  <button
                    onClick={() => setViewMode('day')}
                    className="text-[11px] text-gray-500 hover:text-gray-900"
                  >
                    Focus day
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-auto pr-1">
                  {events.length === 0 && !isLoading && <p className="text-xs text-gray-500">No events in this view.</p>}
                  {events.slice(0, 6).map((event) => (
                    (() => {
                      const meta = getEventStatusMeta(event.status)
                      return (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setListContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          kind: 'event',
                          id: event.id,
                        })
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-left hover:bg-gray-100 transition ${meta.previewClass} ${
                        event.status === 'done' ? 'line-through opacity-80' : ''
                      } ${event.status === 'cancelled' ? 'opacity-65' : ''} ${
                        selectedEventPreview?.id === event.id ? 'ring-1 ring-gray-400' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} style={{ backgroundColor: event.color ?? undefined }} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{event.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {new Date(event.start_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                          </p>
                          <span className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.chipClass}`}>
                            {meta.label}
                          </span>
                        </div>
                      </div>
                    </button>
                      )
                    })()
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-3">Reminders</p>
                <div className="space-y-2 max-h-40 overflow-auto pr-1">
                  {reminders.length === 0 && !isLoading && (
                    <p className="text-xs text-gray-500">No reminders in this view.</p>
                  )}
                  {reminders.slice(0, 6).map((reminder) => (
                    <button
                      key={reminder.id}
                      onClick={() => void toggleReminderDone(reminder)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setListContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          kind: 'reminder',
                          id: reminder.id,
                        })
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                        reminder.is_done ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: reminder.color ?? '#F59E0B' }} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{reminder.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {new Date(reminder.remind_at).toLocaleString([], {
                              weekday: 'short',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </>
        )}
        {isRightPaneCollapsed && (
          <div className="w-10 shrink-0 border-l border-gray-200 bg-[#fbfcfe] flex items-start justify-center pt-4">
            <button
              onClick={() => setIsRightPaneCollapsed(false)}
              className="h-8 w-8 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Show right panel"
            >
              <ChevronLeft size={13} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>

      {isComposerOpen && (
        <div className="fixed inset-0 z-100 bg-black/20 flex items-start justify-center pt-20">
          <div className="w-105 rounded-xl border border-gray-200 bg-white shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {composerMode === 'reminder' ? 'New Reminder' : 'New Event'}
              </h3>
              <button onClick={() => setIsComposerOpen(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={14} className="text-gray-600" />
              </button>
            </div>
            <div className="space-y-2.5">
              <input
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
                placeholder={composerMode === 'reminder' ? 'Reminder title' : 'Event title'}
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <input
                  type="time"
                  value={newEventTime}
                  onChange={(e) => setNewEventTime(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
              </div>
              {composerMode === 'event' && (
                <div className="relative">
                  <select
                    value={newEventRecurrence}
                    onChange={(e) =>
                      setNewEventRecurrence(e.target.value as 'none' | 'daily' | 'weekly' | 'weekdays')
                    }
                    className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="weekdays">Weekdays</option>
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setIsComposerOpen(false)} className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">
                Cancel
              </button>
              <button
                onClick={() => void createQuickEvent()}
                disabled={isSavingEvent || !newEventTitle.trim()}
                className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
              >
                {isSavingEvent ? 'Saving...' : composerMode === 'reminder' ? 'Create Reminder' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventEditorEvent && (
        <div className="fixed inset-0 z-110 bg-black/20 flex items-start justify-center pt-20">
          <div className="w-110 rounded-xl border border-gray-200 bg-white shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Edit Event</h3>
              <button
                onClick={() => {
                  setEventEditorEvent(null)
                  setConfirmDelete(false)
                }}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Event title"
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
              </div>
              <div className="relative">
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'planned' | 'done' | 'missed' | 'cancelled')}
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                >
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                  <option value="missed">Missed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
              <div className="relative">
                <select
                  value={editRecurrence}
                  onChange={(e) =>
                    setEditRecurrence(e.target.value as 'none' | 'daily' | 'weekly' | 'weekdays')
                  }
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="weekdays">Weekdays</option>
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
              <div className="flex items-center justify-between border border-gray-200 rounded-md px-2.5 h-9">
                <span className="text-sm text-gray-700">Event color</span>
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="h-6 w-8 p-0 border-0 bg-transparent cursor-pointer"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-2 text-xs text-gray-700 bg-gray-100 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void deleteEvent()}
                      disabled={isDeletingEvent}
                      className="px-2.5 py-2 text-xs text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-60"
                    >
                      {isDeletingEvent ? 'Deleting...' : 'Confirm'}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEventEditorEvent(null)
                    setConfirmDelete(false)
                  }}
                  className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Close
                </button>
                <button
                  onClick={() => void saveEventEdits()}
                  disabled={isSavingEdit || !editTitle.trim()}
                  className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedReminder && (
        <div className="fixed inset-0 z-112 bg-black/20 flex items-start justify-center pt-20">
          <div className="w-110 rounded-xl border border-gray-200 bg-white shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Edit Reminder</h3>
              <button onClick={() => setSelectedReminder(null)} className="p-1 rounded hover:bg-gray-100">
                <X size={14} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input
                value={reminderEditTitle}
                onChange={(e) => setReminderEditTitle(e.target.value)}
                placeholder="Reminder title"
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={reminderEditDate}
                  onChange={(e) => setReminderEditDate(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <input
                  type="time"
                  value={reminderEditTime}
                  onChange={(e) => setReminderEditTime(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
              </div>
              <label className="flex items-center justify-between border border-gray-200 rounded-md px-2.5 h-9">
                <span className="text-sm text-gray-700">Done</span>
                <input
                  type="checkbox"
                  checked={reminderEditDone}
                  onChange={(e) => setReminderEditDone(e.target.checked)}
                />
              </label>
              <div className="flex items-center justify-between border border-gray-200 rounded-md px-2.5 h-9">
                <span className="text-sm text-gray-700">Reminder color</span>
                <input
                  type="color"
                  value={reminderEditColor}
                  onChange={(e) => setReminderEditColor(e.target.value)}
                  className="h-6 w-8 p-0 border-0 bg-transparent cursor-pointer"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => void deleteReminderFromEditor()}
                disabled={isDeletingReminder}
                className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md disabled:opacity-60"
              >
                {isDeletingReminder ? 'Deleting...' : 'Delete'}
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedReminder(null)} className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">
                  Close
                </button>
                <button
                  onClick={() => void saveReminderEdits()}
                  disabled={isSavingEdit || !reminderEditTitle.trim()}
                  className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {overflowDayKey && (
        <div className="fixed inset-0 z-111 bg-black/20 flex items-start justify-center pt-20">
          <div className="w-130 max-h-[72vh] rounded-xl border border-gray-200 bg-white shadow-xl p-4 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {parseDateKey(overflowDayKey).toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>
              <button onClick={() => setOverflowDayKey(null)} className="p-1 rounded hover:bg-gray-100">
                <X size={14} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Reminders</p>
                <div className="space-y-1.5">
                  {overflowReminders.length === 0 && <p className="text-xs text-gray-500">No reminders.</p>}
                  {overflowReminders.map((reminder) => (
                    <button
                      key={reminder.id}
                      onClick={() => openReminderEditor(reminder)}
                      className="w-full text-left rounded-md border border-amber-100 bg-amber-50 px-2.5 py-2 text-xs text-gray-800"
                    >
                      <span className="font-medium">{reminder.title}</span>
                      <span className="ml-2 text-gray-600">
                        {new Date(reminder.remind_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Events</p>
                <div className="space-y-1.5">
                  {overflowEvents.length === 0 && <p className="text-xs text-gray-500">No events.</p>}
                  {overflowEvents.map((event) => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`w-full text-left rounded-md border px-2.5 py-2 text-xs text-gray-800 ${
                        selectedEventPreview?.id === event.id
                          ? 'border-gray-400 bg-gray-100'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{event.title}</span>
                      <span className="ml-2 text-gray-600">
                        {new Date(event.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-200 min-w-42 rounded-xl border border-white/20 bg-[#1f2530]/95 text-white shadow-2xl backdrop-blur-md p-1.5"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 188)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 138)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              openComposerAtSlot(contextMenu.dateKey, contextMenu.hour)
              setContextMenu(null)
            }}
            className="w-full h-8 px-2 rounded-lg text-left hover:bg-white/10 flex items-center gap-2"
          >
            <CalendarPlus size={13} className="text-gray-200" />
            <span className="text-[20px] leading-none text-gray-200" aria-hidden>
              ·
            </span>
            <span className="text-[14px] font-medium tracking-tight">New Event</span>
          </button>
          <button
            onClick={() => {
              openComposerAtSlot(contextMenu.dateKey, contextMenu.hour, 'Reminder', 'reminder')
              setContextMenu(null)
            }}
            className="w-full h-8 px-2 rounded-lg text-left hover:bg-white/10 flex items-center gap-2"
          >
            <BellRing size={13} className="text-gray-200" />
            <span className="text-[20px] leading-none text-gray-200" aria-hidden>
              ·
            </span>
            <span className="text-[14px] font-medium tracking-tight">New Reminder</span>
          </button>
          <button
            disabled
            className="w-full h-8 px-2 rounded-lg text-left text-white/35 flex items-center gap-2 cursor-not-allowed"
          >
            <ClipboardPaste size={13} />
            <span className="text-[20px] leading-none" aria-hidden>
              ·
            </span>
            <span className="text-[14px] font-medium tracking-tight">Paste Event</span>
          </button>
        </div>
      )}

      {listContextMenu && (
        <div
          className="fixed z-210 min-w-38 rounded-xl border border-white/20 bg-[#1f2530]/95 text-white shadow-2xl backdrop-blur-md p-1.5"
          style={{
            left: Math.max(8, Math.min(listContextMenu.x, window.innerWidth - 168)),
            top: Math.max(8, Math.min(listContextMenu.y, window.innerHeight - 74)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if (listContextMenu.kind === 'event') {
                const event = events.find((item) => item.id === baseEventId(listContextMenu.id))
                if (event) openEventEditor(event)
              } else {
                const reminder = reminders.find((item) => item.id === listContextMenu.id)
                if (reminder) openReminderEditor(reminder)
              }
              setListContextMenu(null)
            }}
            className="w-full h-8 px-2 rounded-lg text-left hover:bg-white/10 flex items-center gap-2"
          >
            <CalendarPlus size={13} className="text-gray-200" />
            <span className="text-[20px] leading-none text-gray-200" aria-hidden>
              ·
            </span>
            <span className="text-[14px] font-medium tracking-tight">
              Edit {listContextMenu.kind === 'event' ? 'Event' : 'Reminder'}
            </span>
          </button>
          {listContextMenu.kind === 'event' ? (
            <button
              onClick={() => {
                const event = events.find((item) => item.id === baseEventId(listContextMenu.id))
                if (event) {
                  const nextStatus = event.status === 'done' ? 'planned' : 'done'
                  void api.updateEvent(event.id, { status: nextStatus })
                  setEvents((prev) =>
                    prev.map((item) =>
                      item.id === event.id ? { ...item, status: nextStatus } : item
                    )
                  )
                  setSelectedEvent((current) =>
                    current && baseEventId(current.id) === event.id ? { ...current, status: nextStatus } : current
                  )
                }
                setListContextMenu(null)
              }}
              className="w-full h-8 px-2 rounded-lg text-left hover:bg-white/10 flex items-center gap-2"
            >
              <BellRing size={13} className="text-gray-200" />
              <span className="text-[20px] leading-none text-gray-200" aria-hidden>
                ·
              </span>
              <span className="text-[14px] font-medium tracking-tight">
                Mark {events.find((item) => item.id === baseEventId(listContextMenu.id))?.status === 'done' ? 'Planned' : 'Done'}
              </span>
            </button>
          ) : (
            <button
              onClick={() => {
                const reminder = reminders.find((item) => item.id === listContextMenu.id)
                if (reminder) void toggleReminderDone(reminder)
                setListContextMenu(null)
              }}
              className="w-full h-8 px-2 rounded-lg text-left hover:bg-white/10 flex items-center gap-2"
            >
              <BellRing size={13} className="text-gray-200" />
              <span className="text-[20px] leading-none text-gray-200" aria-hidden>
                ·
              </span>
              <span className="text-[14px] font-medium tracking-tight">
                Toggle Done
              </span>
            </button>
          )}
          <button
            onClick={() => {
              if (listContextMenu.kind === 'event') {
                void quickDeleteEvent(listContextMenu.id)
              } else {
                void quickDeleteReminder(listContextMenu.id)
              }
              setListContextMenu(null)
            }}
            className="w-full h-8 px-2 rounded-lg text-left hover:bg-white/10 flex items-center gap-2 text-red-300"
          >
            <Trash2 size={13} />
            <span className="text-[20px] leading-none" aria-hidden>
              ·
            </span>
            <span className="text-[14px] font-medium tracking-tight">
              Delete {listContextMenu.kind === 'event' ? 'Event' : 'Reminder'}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

export default CalendarWindow
