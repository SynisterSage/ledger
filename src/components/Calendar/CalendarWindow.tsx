import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { Fragment, type CSSProperties, useEffect, useMemo, useState } from 'react'
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
}

type GridQuickAddState = {
  dateKey: string
  hour: number
}

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 12 }, (_, i) => `${i + 8}:00`)

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

const formatDateKey = (date: Date) => date.toISOString().slice(0, 10)

export const CalendarWindow = () => {
  const { user } = useAuthContext()
  const [weekAnchor, setWeekAnchor] = useState(() => new Date())
  const [calendars, setCalendars] = useState<CalendarRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventDate, setNewEventDate] = useState(() => formatDateKey(new Date()))
  const [newEventTime, setNewEventTime] = useState('09:00')
  const [isSavingEvent, setIsSavingEvent] = useState(false)
  const [gridQuickAdd, setGridQuickAdd] = useState<GridQuickAddState | null>(null)
  const [gridQuickTitle, setGridQuickTitle] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editStatus, setEditStatus] = useState<'planned' | 'done' | 'missed' | 'cancelled'>('planned')
  const [editColor, setEditColor] = useState('#93C5FD')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEvent, setIsDeletingEvent] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [calendarColorDrafts, setCalendarColorDrafts] = useState<Record<string, string>>({})
  const [isSavingColorId, setIsSavingColorId] = useState<string | null>(null)

  const weekStart = useMemo(() => startOfWeek(weekAnchor), [weekAnchor])
  const weekEnd = useMemo(() => endOfWeek(weekAnchor), [weekAnchor])

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    }),
    [weekStart]
  )

  const eventsByDay = useMemo(() => {
    const grouped: Record<string, EventRow[]> = {}
    for (const date of weekDates) grouped[formatDateKey(date)] = []

    for (const evt of events) {
      const key = formatDateKey(new Date(evt.start_at))
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(evt)
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    }

    return grouped
  }, [events, weekDates])

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
        .select('id, title, start_at, end_at, calendar_id, color, status')
        .eq('workspace_id', workspaceId)
        .gte('start_at', weekStart.toISOString())
        .lt('start_at', weekEnd.toISOString())
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
      setIsLoading(false)
    }

    loadCalendarData()

    return () => {
      cancelled = true
    }
  }, [user?.id, weekStart.toISOString(), weekEnd.toISOString()])

  const createQuickEvent = async () => {
    if (!user || !newEventTitle.trim() || calendars.length === 0) return

    const selectedCalendar = calendars[0]
    const start = new Date(`${newEventDate}T${newEventTime}:00`)
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
        title: newEventTitle.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        color: selectedCalendar.color,
      } as never)
      .select('id, title, start_at, end_at, calendar_id, color, status')
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
  }

  const openEventEditor = (event: EventRow) => {
    const start = new Date(event.start_at)
    setSelectedEvent(event)
    setEditTitle(event.title)
    setEditDate(formatDateKey(start))
    setEditTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`)
    setEditStatus(event.status ?? 'planned')
    setEditColor(event.color ?? '#93C5FD')
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
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', selectedEvent.id)
      .select('id, title, start_at, end_at, calendar_id, color, status')
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
      } as never)
      .select('id, title, start_at, end_at, calendar_id, color, status')
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

  return (
    <div className="h-screen bg-white flex flex-col">
      <div
        className="h-8 bg-white border-b border-gray-100"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />
      <header
        className="h-14 border-b border-gray-200 px-5 flex items-center justify-between"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-3">
          <CalendarDays size={18} className="text-blue-600" />
          <h1 className="text-sm font-semibold text-gray-900">Calendar</h1>
          <span className="text-xs text-gray-500">Week View</span>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button
            onClick={() => setWeekAnchor((prev) => {
              const d = new Date(prev)
              d.setDate(prev.getDate() - 7)
              return d
            })}
            className="p-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekAnchor((prev) => {
              const d = new Date(prev)
              d.setDate(prev.getDate() + 7)
              return d
            })}
            className="p-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setIsComposerOpen(true)}
            className="px-3 py-2 rounded-md bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium flex items-center gap-1.5"
          >
            <Plus size={14} />
            New Event
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-gray-200 p-4 overflow-auto">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Calendars</h2>
          <div className="space-y-2 mb-5">
            {calendars.map((calendar) => (
              <div key={calendar.id} className="flex items-center justify-between gap-2 text-sm text-gray-800">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: calendar.color }} />
                  <span className="truncate">{calendar.name}</span>
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

          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">This Week</h2>
          <div className="space-y-2">
            {events.length === 0 && !isLoading && <p className="text-xs text-gray-500">No events this week.</p>}
            {events.slice(0, 8).map((event) => (
              <button
                key={event.id}
                onClick={() => openEventEditor(event)}
                className="w-full text-left p-2 rounded-md bg-gray-50 border border-gray-100 hover:bg-gray-100"
              >
                <p className="text-xs font-medium text-gray-900 truncate flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: event.color ?? '#93C5FD' }} />
                  {event.title}
                </p>
                <p className="text-[11px] text-gray-600 mt-1">{new Date(event.start_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
              </button>
            ))}
          </div>

          {error && <p className="text-xs text-red-600 mt-4">{error}</p>}
        </aside>

        <section className="flex-1 overflow-auto">
          <div className="grid grid-cols-8 min-w-[840px]">
            <div className="sticky top-0 z-10 h-12 bg-white border-b border-gray-200" />
            {weekDates.map((dayDate, idx) => (
              <div
                key={dayDate.toISOString()}
                className="sticky top-0 z-10 h-12 bg-white border-b border-l border-gray-200 flex flex-col items-center justify-center"
              >
                <span className="text-xs font-semibold text-gray-600">{days[idx]}</span>
                <span className="text-[10px] text-gray-400">{dayDate.getMonth() + 1}/{dayDate.getDate()}</span>
              </div>
            ))}

            {hours.map((hour) => (
              <Fragment key={hour}>
                <div className="h-16 border-b border-gray-100 pr-3 text-[11px] text-gray-400 flex items-start justify-end pt-1.5">
                  {hour}
                </div>
                {weekDates.map((dayDate) => {
                  const key = formatDateKey(dayDate)
                  const hourInt = Number.parseInt(hour.split(':')[0], 10)
                  const items = (eventsByDay[key] ?? []).filter((evt) => new Date(evt.start_at).getHours() === hourInt)
                  const visibleItems = items.slice(0, 2)
                  const hiddenCount = items.length - visibleItems.length
                  const isQuickAddOpen =
                    gridQuickAdd?.dateKey === key && gridQuickAdd?.hour === hourInt

                  return (
                    <div
                      key={`${hour}-${key}`}
                      className="h-16 border-b border-l border-gray-100 relative px-1 py-1 hover:bg-blue-50/40 cursor-pointer"
                      onClick={() => {
                        setGridQuickAdd({ dateKey: key, hour: hourInt })
                        setGridQuickTitle('')
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
                      {visibleItems.map((evt) => (
                        <button
                          key={evt.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            openEventEditor(evt)
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
                            openEventEditor(items[0])
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
        <div className="fixed inset-0 z-[100] bg-black/20 flex items-start justify-center pt-20">
          <div className="w-[420px] rounded-xl border border-gray-200 bg-white shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">New Event</h3>
              <button onClick={() => setIsComposerOpen(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={14} className="text-gray-600" />
              </button>
            </div>
            <div className="space-y-2.5">
              <input
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
                placeholder="Event title"
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
                {isSavingEvent ? 'Saving...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 z-[110] bg-black/20 flex items-start justify-center pt-20">
          <div className="w-[440px] rounded-xl border border-gray-200 bg-white shadow-xl p-4">
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
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as 'planned' | 'done' | 'missed' | 'cancelled')}
                className="w-full h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
              >
                <option value="planned">Planned</option>
                <option value="done">Done</option>
                <option value="missed">Missed</option>
                <option value="cancelled">Cancelled</option>
              </select>
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
    </div>
  )
}

export default CalendarWindow
