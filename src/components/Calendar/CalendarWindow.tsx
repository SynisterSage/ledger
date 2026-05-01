import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Fragment, type CSSProperties } from 'react'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 12 }, (_, i) => `${i + 8}:00`)

export const CalendarWindow = () => {
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
          <button className="p-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600">
            <ChevronLeft size={16} />
          </button>
          <button className="p-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600">
            <ChevronRight size={16} />
          </button>
          <button className="px-3 py-2 rounded-md bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium flex items-center gap-1.5">
            <Plus size={14} />
            New Event
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Calendars</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-800">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              Personal
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-800">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              Team
            </div>
          </div>
        </aside>

        <section className="flex-1 overflow-auto">
          <div className="grid grid-cols-8 min-w-[840px]">
            <div className="sticky top-0 z-10 h-12 bg-white border-b border-gray-200" />
            {days.map((day) => (
              <div
                key={day}
                className="sticky top-0 z-10 h-12 bg-white border-b border-l border-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600"
              >
                {day}
              </div>
            ))}

            {hours.map((hour) => (
              <Fragment key={hour}>
                <div
                  className="h-16 border-b border-gray-100 pr-3 text-[11px] text-gray-400 flex items-start justify-end pt-1.5"
                >
                  {hour}
                </div>
                {days.map((day) => (
                  <div key={`${hour}-${day}`} className="h-16 border-b border-l border-gray-100 relative" />
                ))}
              </Fragment>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default CalendarWindow
