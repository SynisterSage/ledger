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
  StickyNote,
  Timer,
  Trash2,
  CircleHelp,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useSidebar } from '../../context/SidebarContext'
import { supabase } from '../../services/supabase'

type FocusItem = {
  id: string
  text: string
  done: boolean
}

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

  const deadlines = [
    { title: 'Internship follow-up email', due: 'Today · 4:00 PM' },
    { title: 'Team standup notes', due: 'Tomorrow · 9:30 AM' },
    { title: 'Project milestone review', due: 'Thu · 2:00 PM' },
  ]

  useEffect(() => {
    let cancelled = false

    const loadDaily = async () => {
      if (!user) {
        if (!cancelled) {
          setFocusItems([])
          setCheckin({ finished: '', blocked: '', firstTaskTomorrow: '' })
          setCheckinSaved(false)
          setIsLoadingDaily(false)
        }
        return
      }

      setIsLoadingDaily(true)
      setSaveError(null)

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
      setIsLoadingDaily(false)
    }

    loadDaily()

    return () => {
      cancelled = true
    }
  }, [user?.id])

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
    await saveDaily({ focusItems: next })
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

  const completedCount = focusItems.filter((item) => item.done).length

  return (
    <div className="w-80 h-screen bg-white border-r border-gray-200 flex flex-col py-6 shadow-sm">
      <div className="px-6 pb-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Ledger</h1>
          <button
            onClick={() => setState('minimized')}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
            title="Collapse"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-sm font-semibold text-gray-900">{firstName}</p>
          <p className="text-xs text-gray-600 truncate">{user?.email}</p>
        </div>
      </div>

      <div className="px-6 py-6 space-y-5 flex-1 overflow-auto">
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Today Focus</h2>
              <div className="relative group">
                <button
                  aria-label="Today Focus help"
                  className="text-gray-400 hover:text-gray-600 transition"
                >
                  <CircleHelp size={12} />
                </button>
                <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 w-48 rounded-md bg-gray-900 text-white text-[10px] leading-4 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
                  Add your top priorities for today. Items save to your profile and reset daily.
                </div>
              </div>
            </div>
            <span className="text-[10px] text-gray-500">{completedCount}/{focusItems.length}</span>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
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
                placeholder="Add a focus bullet for today"
                className="flex-1 h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
                disabled={isLoadingDaily}
              />
              <button
                onClick={() => void addFocusItem()}
                className="h-8 w-8 rounded-md bg-gray-900 text-white flex items-center justify-center hover:bg-gray-800 disabled:opacity-60"
                title="Add focus item"
                disabled={isLoadingDaily}
              >
                <Plus size={13} />
              </button>
            </div>

            {isLoadingDaily && <p className="text-[11px] text-gray-500">Loading today focus...</p>}

            {focusItems.map((item) => (
              <div key={item.id} className="w-full flex items-start gap-2">
                <button
                  onClick={() => void toggleFocusDone(item.id)}
                  className="flex-1 text-left flex items-start gap-2"
                >
                  <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${item.done ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'}`}>
                    {item.done && <Check size={11} className="text-white" />}
                  </span>
                  <p className={`text-xs leading-5 ${item.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.text}</p>
                </button>
                <button
                  onClick={() => void removeFocusItem(item.id)}
                  className="mt-0.5 p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
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
          <div className="grid grid-cols-2 gap-2">
            <button className="px-2.5 py-2 text-xs font-medium text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center justify-center gap-1.5">
              <Plus size={13} />
              Task
            </button>
            <button className="px-2.5 py-2 text-xs font-medium text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center justify-center gap-1.5">
              <StickyNote size={13} />
              Note
            </button>
            <button className="px-2.5 py-2 text-xs font-medium text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center justify-center gap-1.5">
              <CalendarDays size={13} />
              Event
            </button>
            <button className="px-2.5 py-2 text-xs font-medium text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center justify-center gap-1.5">
              <Timer size={13} />
              Focus
            </button>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm">
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
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
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
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
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
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
                    disabled={isLoadingDaily}
                  />
                </div>
              </div>

              <button
                onClick={() => void saveCheckin()}
                className="mt-3 w-full h-8 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-md transition disabled:opacity-60"
                disabled={isLoadingDaily}
              >
                Save Check-in
              </button>
            </>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Project Pulse</h2>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-900">Summer Internship Tracker</p>
            <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full w-[62%] bg-green-500 rounded-full" />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-gray-600">62% complete</p>
              <p className="text-[11px] text-green-700 font-medium flex items-center gap-1">
                <CheckCircle2 size={11} />
                On track
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Upcoming</h2>
          <div className="space-y-2">
            {deadlines.map((deadline) => (
              <div key={deadline.title} className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs font-medium text-gray-900">{deadline.title}</p>
                <p className="text-[11px] text-gray-600 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} />
                  {deadline.due}
                </p>
              </div>
            ))}
          </div>
        </section>

        {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
      </div>

      <div className="px-6 space-y-3 border-t border-gray-200 pt-4">
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
