import {
  BarChart3,
  CalendarDays,
  LogOut,
  ChevronRight,
  StickyNote,
  Folder,
  Search,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useSearch } from '../../context/SearchContext';

export const MinimizedSidebar = ({
}: {
}) => {
  const { signOut } = useAuthContext();
  const { collapseSidebar, setState, position } = useSidebar();
  const { openSearch } = useSearch();
  const isHorizontal = position === 'top' || position === 'bottom';
  const iconBase =
    'w-10 h-10 rounded-xl transition-colors duration-150 flex items-center justify-center active:scale-95';
  const neutralIcon = `${iconBase} bg-transparent hover:bg-white/45 text-gray-700`;
  const accentIcon = neutralIcon;
  const actionIcon = `${iconBase} bg-transparent hover:bg-white/45 text-gray-700`;
  const dangerIcon = `${iconBase} bg-transparent hover:bg-red-50 text-red-600`;

  return (
    <div
      className={`border-gray-200 flex ${
        isHorizontal
          ? 'h-16 w-full flex-row items-center justify-between px-4 bg-transparent'
          : 'h-full w-full flex-col items-center justify-between bg-transparent px-0 py-4'
      }`}
    >
      <div
        className={`${
          isHorizontal
            ? 'flex w-full flex-row items-center justify-between'
            : 'mx-auto flex h-full w-11 flex-col items-center justify-between'
        } shrink-0`}
      >
        <button
          type="button"
          onClick={() => {
            collapseSidebar();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Collapse sidebar"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-transparent transition-colors duration-150 hover:bg-white/45"
        >
          <img src="./logo-color.svg" alt="Ledger" className="h-7 w-7" draggable={false} />
        </button>

        <div className={`flex ${isHorizontal ? 'flex-row gap-3' : 'flex-col gap-4 self-center'}`}>
          <button
            aria-label="Open search"
            onClick={() => {
              setState('expanded');
              window.setTimeout(() => {
                openSearch();
              }, 220);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={accentIcon}
          >
            <Search size={18} />
          </button>
          <button
            aria-label="Open dashboard"
            onClick={() => {
              window.desktopWindow?.toggleModule('dashboard');
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <BarChart3 size={18} />
          </button>
          <button
            aria-label="Open calendar"
            onClick={() => window.desktopWindow?.toggleModule('calendar')}
            onMouseDown={(e) => e.stopPropagation()}
            className={accentIcon}
          >
            <CalendarDays size={18} />
          </button>
          <button
            aria-label="Open projects"
            onClick={() => window.desktopWindow?.toggleModule('projects')}
            onMouseDown={(e) => e.stopPropagation()}
            className={accentIcon}
          >
            <Folder size={18} />
          </button>
          <button
            aria-label="Open notes"
            onClick={() => window.desktopWindow?.toggleModule('notes')}
            onMouseDown={(e) => e.stopPropagation()}
            className={accentIcon}
          >
            <StickyNote size={18} />
          </button>
        </div>

        <div className={`flex items-center ${isHorizontal ? 'flex-row gap-3' : 'flex-col gap-3'}`}>
          <button
            onClick={() => setState('expanded')}
            onMouseDown={(e) => e.stopPropagation()}
            className={actionIcon}
          >
            <ChevronRight size={20} />
          </button>

          <button onClick={signOut} onMouseDown={(e) => e.stopPropagation()} className={dangerIcon}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
