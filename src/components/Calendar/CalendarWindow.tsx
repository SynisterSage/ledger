import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Plus, X, BellRing, ClipboardPaste, CalendarPlus, Trash2 } from 'lucide-react'
import { Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { supabase } from '../../services/supabase'

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
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [viewAnchor, setViewAnchor] = useState(() => new Date())
  const [calendars, setCalendars] = useState<CalendarRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [reminders, setReminders] = useState<ReminderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventDate, setNewEventDate] = useState(() => formatDateKey(new Date()))
  const [newEventTime, setNewEventTime] = useState('09:00')
  const [newEventRecurrence, setNewEventRecurrence] = useState<'none' | 'daily' | 'weekly' | 'weekdays'>('none')
  const [composerMode, setComposerMode] = useState<'event' | 'reminder'>('event')
  const [isSavingEvent, setIsSavingEvent] = useState(false)
  const [isSyncingApple, setIsSyncingApple] = useState(false)
  const [appleSyncMessage, setAppleSyncMessage] = useState<string | null>(null)
  const [isAppleSyncMessageVisible, setIsAppleSyncMessageVisible] = useState(false)
  const [isImportingIcs, setIsImportingIcs] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [isImportMessageVisible, setIsImportMessageVisible] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [gridQuickAdd, setGridQuickAdd] = useState<GridQuickAddState | null>(null)
  const [gridQuickTitle, setGridQuickTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<CalendarContextMenuState | null>(null)
  const [listContextMenu, setListContextMenu] = useState<ListContextMenuState | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null)
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
  const [overflowDayKey, setOverflowDayKey] = useState<string | null>(null)

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
      if (!user) return

      setIsLoading(true)
      setError(null)

      const workspaceResult: any = await supabase
        .from('workspaces' as never)
        .select('id')
        .eq('owner_id', user.id)
        .eq('is_personal', true)
        .maybeSingle()

      if (cancelled) return

      let workspaceId: string | null =
        workspaceResult.error || !workspaceResult.data
          ? null
          : (workspaceResult.data as { id: string }).id

      if (!workspaceId) {
        const membershipResult: any = await supabase
          .from('workspace_members' as never)
          .select('workspace_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle()

        if (!membershipResult.error && membershipResult.data) {
          workspaceId = (membershipResult.data as { workspace_id: string }).workspace_id
        }
      }

      if (!workspaceId) {
        const createWorkspace: any = await supabase
          .from('workspaces' as never)
          .insert({
            owner_id: user.id,
            name: 'My Work',
            is_personal: true,
          } as never)
          .select('id')
          .single()

        if (!createWorkspace.error && createWorkspace.data) {
          workspaceId = (createWorkspace.data as { id: string }).id
        }
      }

      if (!workspaceId) {
        const details =
          workspaceResult.error?.message ?? 'No workspace row found and create fallback failed.'
        setError(`Could not load workspace for calendar. ${details}`)
        setIsLoading(false)
        return
      }

      const calResult: any = await supabase
        .from('calendars' as never)
        .select('id, name, color, workspace_id, is_personal')
        .eq('workspace_id', workspaceId)

      if (cancelled) return

      if (calResult.error) {
        if (calResult.error.code === '42P01') {
          setError('Calendar tables are missing. Run migration 014 in Supabase first.')
        } else {
          setError(`Could not load calendars. ${calResult.error.message}`)
        }
        setIsLoading(false)
        return
      }

      let loadedCalendars = (calResult.data ?? []) as CalendarRow[]

      if (loadedCalendars.length === 0) {
        const createResult: any = await supabase
          .from('calendars' as never)
          .insert({
            workspace_id: workspaceId,
            owner_id: user.id,
            name: 'Personal',
            color: '#3B82F6',
            is_default: true,
            is_personal: true,
          } as never)
          .select('id, name, color, workspace_id, is_personal')
          .single()

        if (cancelled) return

        if (createResult.error || !createResult.data) {
          const details = createResult.error?.message ?? 'Unknown create error.'
          setError(`Could not create default calendar. ${details}`)
          setIsLoading(false)
          return
        }

        loadedCalendars = [createResult.data as CalendarRow]
      }

      setCalendars(loadedCalendars)
      setCalendarColorDrafts(
        Object.fromEntries(loadedCalendars.map((calendar) => [calendar.id, calendar.color]))
      )

      const eventResult: any = await supabase
        .from('events' as never)
        .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
        .eq('workspace_id', workspaceId)
        .gte('start_at', viewConfig.start.toISOString())
        .lt('start_at', viewConfig.end.toISOString())
        .order('start_at', { ascending: true })

      if (cancelled) return

      if (eventResult.error) {
        if (eventResult.error.code === '42P01') {
          setError('Event tables are missing. Run migration 014 in Supabase first.')
        } else {
          setError(`Could not load events. ${eventResult.error.message}`)
        }
        setIsLoading(false)
        return
      }

      setEvents((eventResult.data ?? []) as EventRow[])

      const reminderResult: any = await supabase
        .from('reminders' as never)
        .select('id, title, remind_at, calendar_id, color, is_done')
        .eq('workspace_id', workspaceId)
        .gte('remind_at', viewConfig.start.toISOString())
        .lt('remind_at', viewConfig.end.toISOString())
        .order('remind_at', { ascending: true })

      if (cancelled) return

      if (reminderResult.error) {
        if (reminderResult.error.code === '42P01') {
          setError('Reminder table is missing. Run migration 020 in Supabase first.')
        } else {
          setError(`Could not load reminders. ${reminderResult.error.message}`)
        }
        setIsLoading(false)
        return
      }

      setReminders((reminderResult.data ?? []) as ReminderRow[])
      setIsLoading(false)
    }

    loadCalendarData()

    return () => {
      cancelled = true
    }
  }, [user?.id, viewConfig.start.toISOString(), viewConfig.end.toISOString()])

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
      const reminderResult: any = await supabase
        .from('reminders' as never)
        .insert({
          calendar_id: selectedCalendar.id,
          workspace_id: selectedCalendar.workspace_id,
          created_by: user.id,
          title: newEventTitle.trim(),
          remind_at: start.toISOString(),
          color: selectedCalendar.color,
          is_done: false,
        } as never)
        .select('id, title, remind_at, calendar_id, color, is_done')
        .single()

      setIsSavingEvent(false)

      if (reminderResult.error || !reminderResult.data) {
        if (reminderResult.error?.code === '42P01') {
          setError('Reminder table is missing. Run migration 020 in Supabase first.')
        } else {
          setError(`Could not create reminder. ${reminderResult.error?.message ?? 'Unknown error.'}`)
        }
        return
      }

      const createdReminder = reminderResult.data as ReminderRow
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

    const result: any = await supabase
      .from('events' as never)
      .insert({
        calendar_id: selectedCalendar.id,
        workspace_id: selectedCalendar.workspace_id,
        created_by: user.id,
        title: newEventTitle.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        color: selectedCalendar.color,
        recurrence_rule: newEventRecurrence,
      } as never)
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
      .single()

    setIsSavingEvent(false)

    if (result.error || !result.data) {
      if (result.error?.code === '42P01') {
        setError('Event tables are missing. Run migration 014 in Supabase first.')
      } else {
        setError(`Could not create event. ${result.error?.message ?? 'Unknown error.'}`)
      }
      return
    }

    setEvents((prev) => [...prev, result.data as EventRow].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()))
    setNewEventTitle('')
    setIsComposerOpen(false)
    setComposerMode('event')
    setNewEventRecurrence('none')
  }

  const toggleReminderDone = async (reminder: ReminderRow) => {
    const result: any = await supabase
      .from('reminders' as never)
      .update({
        is_done: !reminder.is_done,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', reminder.id)
      .select('id, title, remind_at, calendar_id, color, is_done')
      .single()

    if (result.error || !result.data) {
      setError(`Could not update reminder. ${result.error?.message ?? 'Unknown error.'}`)
      return
    }

    const updated = result.data as ReminderRow
    setReminders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
  }

  const quickDeleteReminder = async (reminderId: string) => {
    const result: any = await supabase.from('reminders' as never).delete().eq('id', reminderId)
    if (result.error) {
      setError(`Could not delete reminder. ${result.error.message}`)
      return
    }
    setReminders((prev) => prev.filter((item) => item.id !== reminderId))
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
    const result: any = await supabase
      .from('reminders' as never)
      .update({
        title: reminderEditTitle.trim(),
        remind_at: remindAt.toISOString(),
        color: reminderEditColor,
        is_done: reminderEditDone,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', selectedReminder.id)
      .select('id, title, remind_at, calendar_id, color, is_done')
      .single()

    setIsSavingEdit(false)

    if (result.error || !result.data) {
      setError(`Could not update reminder. ${result.error?.message ?? 'Unknown error.'}`)
      return
    }

    const updated = result.data as ReminderRow
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

    const result: any = await supabase.from('reminders' as never).delete().eq('id', selectedReminder.id)
    setIsDeletingReminder(false)

    if (result.error) {
      setError(`Could not delete reminder. ${result.error.message}`)
      return
    }

    setReminders((prev) => prev.filter((item) => item.id !== selectedReminder.id))
    setSelectedReminder(null)
  }

  const openEventEditor = (event: EventRow) => {
    const source = events.find((row) => row.id === baseEventId(event.id)) ?? event
    const start = new Date(event.start_at)
    setSelectedEvent(source)
    setEditTitle(source.title)
    setEditDate(formatDateKey(start))
    setEditTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`)
    setEditStatus(source.status ?? 'planned')
    setEditColor(source.color ?? '#93C5FD')
    setEditRecurrence(source.recurrence_rule ?? 'none')
    setConfirmDelete(false)
  }

  const saveEventEdits = async () => {
    if (!selectedEvent || !editTitle.trim()) return

    const start = new Date(`${editDate}T${editTime}:00`)
    const end = new Date(start)
    end.setHours(start.getHours() + 1)

    setIsSavingEdit(true)
    setError(null)

    const result: any = await supabase
      .from('events' as never)
      .update({
        title: editTitle.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        color: editColor,
        status: editStatus,
        recurrence_rule: editRecurrence,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', selectedEvent.id)
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
      .single()

    setIsSavingEdit(false)

    if (result.error || !result.data) {
      setError(`Could not update event. ${result.error?.message ?? 'Unknown error.'}`)
      return
    }

    const updated = result.data as EventRow
    setEvents((prev) =>
      prev
        .map((evt) => (evt.id === updated.id ? updated : evt))
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    )
    setSelectedEvent(null)
  }

  const deleteEvent = async () => {
    if (!selectedEvent) return

    setIsDeletingEvent(true)
    setError(null)

    const result: any = await supabase
      .from('events' as never)
      .delete()
      .eq('id', selectedEvent.id)

    setIsDeletingEvent(false)

    if (result.error) {
      setError(`Could not delete event. ${result.error.message}`)
      return
    }

    setEvents((prev) => prev.filter((evt) => evt.id !== selectedEvent.id))
    setSelectedEvent(null)
    setConfirmDelete(false)
  }

  const quickDeleteEvent = async (eventId: string) => {
    const targetId = baseEventId(eventId)
    const result: any = await supabase.from('events' as never).delete().eq('id', targetId)
    if (result.error) {
      setError(`Could not delete event. ${result.error.message}`)
      return
    }
    setEvents((prev) => prev.filter((evt) => evt.id !== targetId))
  }

  const saveCalendarColor = async (calendar: CalendarRow, color: string) => {
    if (calendar.color === color) return

    setIsSavingColorId(calendar.id)
    setError(null)

    const result: any = await supabase
      .from('calendars' as never)
      .update({
        color,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', calendar.id)
      .select('id, name, color, workspace_id, is_personal')
      .single()

    setIsSavingColorId(null)

    if (result.error || !result.data) {
      setError(`Could not update calendar color. ${result.error?.message ?? 'Unknown error.'}`)
      return
    }

    const updated = result.data as CalendarRow
    setCalendars((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
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

    const result: any = await supabase
      .from('events' as never)
      .insert({
        calendar_id: selectedCalendar.id,
        workspace_id: selectedCalendar.workspace_id,
        created_by: user.id,
        title: gridQuickTitle.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        color: selectedCalendar.color,
        recurrence_rule: 'none',
      } as never)
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
      .single()

    setIsSavingEvent(false)

    if (result.error || !result.data) {
      setError(`Could not create event. ${result.error?.message ?? 'Unknown error.'}`)
      return
    }

    setEvents((prev) => [...prev, result.data as EventRow].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()))
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

      const result: any = await supabase
        .from('events' as never)
        .insert(payload as never)
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')

      if (result.error) {
        throw new Error(result.error.message)
      }

      const importedEvents = (result.data ?? []) as EventRow[]
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

  return (
    <div className="h-screen bg-white flex flex-col">
      <div
        className="h-8 bg-white border-b border-gray-100"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />
      <header
        className="h-16 border-b border-gray-200 px-5 flex items-center justify-between bg-white"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
            <CalendarDays size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-[34px] leading-none font-semibold text-gray-900">Calendar</h1>
            <p className="text-xs text-gray-500 mt-1">{viewConfig.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            onClick={() => moveView(-1)}
            className="h-8 w-8 rounded-md hover:bg-white text-gray-600 flex items-center justify-center"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => jumpToToday()}
            className="h-8 px-3 rounded-md bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
          >
            Today
          </button>
          <button
            onClick={() => moveView(1)}
            className="h-8 w-8 rounded-md hover:bg-white text-gray-600 flex items-center justify-center"
          >
            <ChevronRight size={16} />
          </button>
          </div>
          <div className="ml-2 flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
            {(['day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                  viewMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            onClick={() => void syncAppleCalendar()}
            disabled={isSyncingApple}
            className="px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium disabled:opacity-60"
          >
            {isSyncingApple ? 'Syncing...' : 'Sync Apple iCal'}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={isImportingIcs}
            className="px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium disabled:opacity-60"
          >
            {isImportingIcs ? 'Importing...' : 'Import .ics'}
          </button>
          <button
            onClick={() => {
              setComposerMode('event')
              setNewEventRecurrence('none')
              setIsComposerOpen(true)
            }}
            className="px-3 py-2 rounded-md bg-gray-800/90 hover:bg-gray-800 text-white text-xs font-medium flex items-center gap-1.5"
          >
            <Plus size={14} />
            New Event
          </button>
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
        <aside
          className="border-r border-gray-200 p-4 overflow-auto shrink-0 bg-white"
          style={{ width: `${sidebarWidth}px` }}
        >
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
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Upcoming In View</h2>
          <div className="space-y-2 max-h-[42vh] overflow-auto pr-1">
            {events.length === 0 && !isLoading && <p className="text-xs text-gray-500">No events in this view.</p>}
            {events.slice(0, 6).map((event) => (
              <div
                key={event.id}
                className="w-full text-left p-2 rounded-md hover:bg-gray-50"
                onContextMenu={(e) => {
                  e.preventDefault()
                  setListContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    kind: 'event',
                    id: event.id,
                  })
                }}
              >
                <button onClick={() => openEventEditor(event)} className="min-w-0 text-left w-full">
                  <p className="text-xs font-medium text-gray-900 truncate flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: event.color ?? '#93C5FD' }} />
                    {event.title}
                  </p>
                  <p className="text-[11px] text-gray-600 mt-1">{new Date(event.start_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
                </button>
              </div>
            ))}
          </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Reminders</h2>
          <div className="space-y-2 max-h-[28vh] overflow-auto pr-1">
            {reminders.length === 0 && !isLoading && (
              <p className="text-xs text-gray-500">No reminders in this view.</p>
            )}
            {reminders.slice(0, 6).map((reminder) => (
              <div
                key={reminder.id}
                className={`w-full text-left p-2 rounded-md ${
                  reminder.is_done
                    ? 'text-green-700 hover:bg-green-50'
                    : 'text-amber-900 hover:bg-amber-50'
                }`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setListContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    kind: 'reminder',
                    id: reminder.id,
                  })
                }}
              >
                <button onClick={() => void toggleReminderDone(reminder)} className="min-w-0 text-left w-full">
                  <p className="text-xs font-medium truncate flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: reminder.color ?? '#F59E0B' }}
                    />
                    {reminder.title}
                  </p>
                  <p className="text-[11px] mt-1 opacity-80">
                    {new Date(reminder.remind_at).toLocaleString([], {
                      weekday: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {reminder.is_done ? ' · Done' : ' · Tap to mark done'}
                  </p>
                </button>
              </div>
            ))}
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

        <section className="flex-1 overflow-auto">
          {viewMode === 'month' && (
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
                          <div
                            key={event.id}
                            className="text-[10px] rounded px-1.5 py-0.5 truncate"
                            style={{ backgroundColor: `${event.color ?? '#93C5FD'}44`, color: '#1F2937' }}
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
                            {event.title}
                          </div>
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
          )}
          <div
            className={`grid min-w-210 ${viewMode === 'month' ? 'hidden' : ''}`}
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
                            openEventEditor(evt)
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
        </section>
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

      {selectedEvent && (
        <div className="fixed inset-0 z-110 bg-black/20 flex items-start justify-center pt-20">
          <div className="w-110 rounded-xl border border-gray-200 bg-white shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Edit Event</h3>
              <button onClick={() => setSelectedEvent(null)} className="p-1 rounded hover:bg-gray-100">
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
                <button onClick={() => setSelectedEvent(null)} className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">
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
                      onClick={() => openEventEditor(event)}
                      className="w-full text-left rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800"
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
                  void supabase
                    .from('events' as never)
                    .update({ status: nextStatus, updated_at: new Date().toISOString() } as never)
                    .eq('id', event.id)
                  setEvents((prev) =>
                    prev.map((item) =>
                      item.id === event.id ? { ...item, status: nextStatus } : item
                    )
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
