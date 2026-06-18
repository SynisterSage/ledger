import {
  BarChart3,
  CalendarDays,
  LogOut,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  StickyNote,
  Folder,
  Search,
} from 'lucide-react';
import type React from 'react';
import { useAuthContext } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useSearch } from '../../context/SearchContext';
import { sidebarTheme } from './sidebarTheme';

export const MinimizedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { signOut } = useAuthContext();
  const { collapseSidebar, setState, position } = useSidebar();
  const { openSearch } = useSearch();
  const isHorizontal = position === 'top' || position === 'bottom';
  const isTopDock = position === 'top';
  const ExpandChevron = isHorizontal ? (isTopDock ? ChevronDown : ChevronUp) : ChevronRight;
  const iconBase = sidebarTheme.railIcon;
  const neutralIcon = `${iconBase} ${sidebarTheme.railIconNeutral}`;
  const actionIcon = `${iconBase} ${sidebarTheme.railIconNeutral}`;

  return (
    <div
      onMouseDown={(e) => {
        if (!onDragHandleMouseDown) return;
        if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]'))
          return;
        onDragHandleMouseDown(e);
      }}
      style={{ cursor: onDragHandleMouseDown ? 'grab' : 'auto' }}
      className={`flex ${sidebarTheme.shellRail} ${
        isHorizontal
          ? 'h-full w-full flex-row items-center justify-between px-4 bg-transparent'
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
          className="flex h-11 w-11 items-center justify-center bg-transparent transition-opacity duration-150 hover:opacity-80 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        >
          <img src="./logo-color.svg" alt="Ledger" className="h-7 w-7 opacity-100" draggable={false} />
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
            className={neutralIcon}
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
            onClick={() => window.desktopWindow?.openModule('calendar')}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <CalendarDays size={18} />
          </button>
          <button
            aria-label="Open projects"
            onClick={() => window.desktopWindow?.toggleModule('projects')}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <Folder size={18} />
          </button>
          <button
            aria-label="Open notes"
            onClick={() => window.desktopWindow?.toggleModule('notes')}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
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
            <ExpandChevron size={20} />
          </button>

          <button
            onClick={signOut}
            onMouseDown={(e) => e.stopPropagation()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-150 text-[var(--ledger-text-secondary)] hover:bg-[color:rgba(255,95,64,0.08)] hover:text-[var(--ledger-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
