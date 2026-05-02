import { BarChart3, CheckCircle2, Clock3, CalendarDays, LogOut, ChevronRight, StickyNote, Folder } from 'lucide-react'
import { useAuthContext } from '../../context/AuthContext'
import { useSidebar } from '../../context/SidebarContext'

export const MinimizedSidebar = () => {
  const { signOut } = useAuthContext()
  const { toggleExpand } = useSidebar()
  const iconBase =
    'w-10 h-10 rounded-lg border transition-all duration-150 flex items-center justify-center active:scale-95'
  const neutralIcon = `${iconBase} bg-white/30 border-white/30 hover:bg-white/55 hover:border-white/50 text-gray-700`
  const accentIcon = neutralIcon
  const actionIcon = `${iconBase} bg-gray-900/60 border-gray-900/10 hover:bg-gray-900/80 hover:border-gray-900/20 text-white`
  const dangerIcon = `${iconBase} bg-red-400/30 border-red-400/20 hover:bg-red-400/45 hover:border-red-400/30 text-red-700`

  return (
    <div className="w-16 h-screen bg-white border-r border-gray-200 flex flex-col items-center justify-between py-6">
      {/* Logo */}
      <div className="text-2xl font-bold text-gray-900">L</div>

      {/* Navigation Icons */}
      <div className="flex flex-col gap-4">
        <button
          title="Dashboard"
          aria-label="Open dashboard"
          className={neutralIcon}
        >
          <BarChart3 size={18} />
        </button>
        <button
          title="Tasks"
          aria-label="Open tasks"
          className={neutralIcon}
        >
          <CheckCircle2 size={18} />
        </button>
        <button
          title="Time Tracking"
          aria-label="Open time tracking"
          className={neutralIcon}
        >
          <Clock3 size={18} />
        </button>
        <button
          title="Calendar"
          aria-label="Open calendar"
          onClick={() => window.desktopWindow?.toggleModule('calendar')}
          className={accentIcon}
        >
          <CalendarDays size={18} />
        </button>
        <button
          title="Projects"
          aria-label="Open projects"
          onClick={() => window.desktopWindow?.toggleModule('projects')}
          className={accentIcon}
        >
          <Folder size={18} />
        </button>
        <button
          title="Notes"
          aria-label="Open notes"
          onClick={() => window.desktopWindow?.toggleModule('notes')}
          className={accentIcon}
        >
          <StickyNote size={18} />
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-3 items-center">
        {/* User Avatar / Expand Button */}
        <button
          onClick={toggleExpand}
          title="Expand"
          className={actionIcon}
        >
          <ChevronRight size={20} />
        </button>

        {/* Sign Out */}
        <button
          onClick={signOut}
          title="Sign Out"
          className={dangerIcon}
        >
          <LogOut size={18} />
        </button>
      </div>
    </div>
  )
}
