import { BarChart3, CheckCircle2, Clock3, CalendarDays, LogOut, ChevronRight } from 'lucide-react'
import { useAuthContext } from '../../context/AuthContext'
import { useSidebar } from '../../context/SidebarContext'

export const MinimizedSidebar = () => {
  const { signOut } = useAuthContext()
  const { toggleExpand } = useSidebar()

  return (
    <div className="w-16 h-screen bg-white border-r border-gray-200 flex flex-col items-center justify-between py-6 shadow-sm">
      {/* Logo */}
      <div className="text-2xl font-bold text-gray-900">L</div>

      {/* Navigation Icons */}
      <div className="flex flex-col gap-4">
        <button
          title="Dashboard"
          aria-label="Open dashboard"
          className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-600"
        >
          <BarChart3 size={18} />
        </button>
        <button
          title="Tasks"
          aria-label="Open tasks"
          className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-600"
        >
          <CheckCircle2 size={18} />
        </button>
        <button
          title="Time Tracking"
          aria-label="Open time tracking"
          className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-600"
        >
          <Clock3 size={18} />
        </button>
        <button
          title="Calendar"
          aria-label="Open calendar"
          onClick={() => window.desktopWindow?.toggleModule('calendar')}
          className="w-10 h-10 rounded-lg bg-blue-50 hover:bg-blue-100 transition flex items-center justify-center text-blue-600 ring-1 ring-blue-200"
        >
          <CalendarDays size={18} />
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-3 items-center">
        {/* User Avatar / Expand Button */}
        <button
          onClick={toggleExpand}
          title="Expand"
          className="w-10 h-10 rounded-lg bg-gray-900 hover:bg-gray-800 transition flex items-center justify-center text-white"
        >
          <ChevronRight size={20} />
        </button>

        {/* Sign Out */}
        <button
          onClick={signOut}
          title="Sign Out"
          className="w-10 h-10 rounded-lg bg-red-50 hover:bg-red-100 transition flex items-center justify-center text-red-600"
        >
          <LogOut size={18} />
        </button>
      </div>
    </div>
  )
}
