import type React from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { Search, BarChart3, CalendarDays, Folder, StickyNote, Inbox, ChevronUp, ChevronDown, LogOut } from 'lucide-react';
import { useSearch } from '../../context/SearchContext';
import { useAuthContext } from '../../context/AuthContext';
import { sidebarTheme } from './sidebarTheme';

export const CollapsedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { restoreSidebarView, position } = useSidebar();
  const { openSearch } = useSearch();
  const { signOut } = useAuthContext();
  const isHorizontal = position === 'top' || position === 'bottom';
  const isTopDock = position === 'top';
  const ExpandChevron = isTopDock ? ChevronDown : ChevronUp;
  const handleClick = () => {
    restoreSidebarView();
  };

  const iconButtonClass = `${sidebarTheme.railIcon} ${sidebarTheme.railIconNeutral}`;

  return (
    <div
      className={`flex h-full w-full ${
        isHorizontal
          ? 'flex-row items-center justify-between px-4 py-3'
          : 'items-center justify-center'
      }`}
      onMouseDown={(e) => {
        if (!onDragHandleMouseDown) return;
        if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]'))
          return;
        onDragHandleMouseDown(e);
      }}
      style={{ cursor: onDragHandleMouseDown ? 'grab' : 'auto' }}
    >
      {isHorizontal ? (
        <>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClick}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Expand sidebar"
              className="flex h-9 w-9 items-center justify-center bg-transparent transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            >
              <img src="./logo-color.svg" alt="Ledger" className="block h-8 w-8 opacity-100" draggable={false} />
            </button>

            <button
              aria-label="Open search"
              onClick={() => {
                restoreSidebarView();
                window.setTimeout(() => {
                  openSearch();
                }, 180);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Search size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              aria-label="Open dashboard"
              onClick={() => window.desktopWindow?.toggleModule('dashboard')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <BarChart3 size={18} />
            </button>
            <button
              aria-label="Open inbox"
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Inbox size={18} />
            </button>
            <button
              aria-label="Open calendar"
              onClick={() => window.desktopWindow?.openModule('calendar')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <CalendarDays size={18} />
            </button>
            <button
              aria-label="Open projects"
              onClick={() => window.desktopWindow?.toggleModule('projects')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Folder size={18} />
            </button>
            <button
              aria-label="Open notes"
              onClick={() => window.desktopWindow?.toggleModule('notes')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <StickyNote size={18} />
            </button>
            
            <button
              onClick={handleClick}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Expand sidebar"
              className={iconButtonClass}
            >
              <ExpandChevron size={18} />
            </button>
            <button onClick={signOut} onMouseDown={(e) => e.stopPropagation()} className={iconButtonClass}>
              <LogOut size={18} />
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Expand sidebar"
          className="flex h-11 w-11 items-center justify-center bg-transparent transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        >
          <img src="./logo-color.svg" alt="Ledger" className="block h-8 w-8 opacity-100" draggable={false} />
        </button>
      )}
      
    </div>
  );
};
