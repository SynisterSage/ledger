import type React from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { CircleUserRound, Search, BarChart3, CalendarDays, Folder, StickyNote, Funnel, ChevronUp, ChevronDown, LogOut } from 'lucide-react';
import { useSearch } from '../../context/SearchContext';
import { useAuthContext } from '../../context/AuthContext';
import { sidebarTheme } from './sidebarTheme';
import { HoldToQuitLogo } from './HoldToQuitLogo';

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
            <HoldToQuitLogo
              onClick={handleClick}
              className="flex h-9 w-9 items-center justify-center bg-transparent transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
              imageClassName="block h-8 w-8 opacity-100"
              title="Ledger"
            />

            <button
              aria-label="Open search"
              onClick={() => {
                void (async () => {
                  const wasForwarded = await window.desktopWindow?.openSearchInWorkspaceWindow?.();
                  if (wasForwarded) return;
                  restoreSidebarView();
                  window.setTimeout(() => openSearch(), 180);
                })();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Search size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              aria-label="Open overview"
              onClick={() => window.desktopWindow?.toggleModule('dashboard')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <BarChart3 size={18} />
            </button>
            <button
              aria-label="Open circle"
              onClick={() => window.desktopWindow?.toggleModule('circle')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <CircleUserRound size={18} />
            </button>
            <button
              aria-label="Open Intake"
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Funnel size={18} />
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
            <button
              onClick={signOut}
              onMouseDown={(e) => e.stopPropagation()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition-colors duration-150 hover:bg-[color:rgba(255,95,64,0.08)] hover:text-[var(--ledger-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
            >
              <LogOut size={18} />
            </button>
          </div>
        </>
      ) : (
        <HoldToQuitLogo
          onClick={handleClick}
          className="flex h-11 w-11 items-center justify-center bg-transparent transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          imageClassName="block h-8 w-8 opacity-100"
          title="Ledger"
        />
      )}
      
    </div>
  );
};
