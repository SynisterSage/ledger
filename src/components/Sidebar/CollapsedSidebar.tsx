import type React from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { CircleUserRound, Search, BarChart3, CalendarDays, Folder, StickyNote, Funnel, ChevronUp, ChevronDown, Power } from 'lucide-react';
import { useSearch } from '../../context/SearchContext';
import { sidebarTheme } from './sidebarTheme';
import { HoldToQuitLogo } from './HoldToQuitLogo';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { openLegacyModule, usePlatform, type LegacyModuleFocus, type LegacyModuleKind } from '../../platform';

export const CollapsedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { restoreSidebarView, position } = useSidebar();
  const { activeWorkspaceId } = useWorkspaceContext();
  const platform = usePlatform();
  const toggleModule = (kind: LegacyModuleKind, focus: LegacyModuleFocus = {}) => {
    if (platform.kind === 'web') return openLegacyModule(platform.navigation, activeWorkspaceId, kind, focus);
    return window.desktopWindow?.toggleModule(kind, focus as any);
  };
  const openModule = (kind: LegacyModuleKind, focus: LegacyModuleFocus = {}) => {
    if (platform.kind === 'web') return openLegacyModule(platform.navigation, activeWorkspaceId, kind, focus);
    return window.desktopWindow?.openModule(kind, focus as any);
  };
  const { openSearch } = useSearch();
  const isHorizontal = position === 'top' || position === 'bottom';
  const isTopDock = position === 'top';
  const ExpandChevron = isTopDock ? ChevronDown : ChevronUp;
  const handleClick = () => {
    if (platform.kind === 'web') {
      openLegacyModule(platform.navigation, activeWorkspaceId, 'new-tab');
      return;
    }
    restoreSidebarView();
  };

  const iconButtonClass = `${sidebarTheme.railIcon} ${sidebarTheme.railIconNeutral}`;

  return (
    <div
      className={`flex h-full w-full ${
        isHorizontal
          ? 'flex-row items-center justify-between px-3 py-2'
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
                if (platform.kind === 'web') {
                  openSearch();
                  return;
                }
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
              onClick={() => toggleModule('dashboard')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <BarChart3 size={18} />
            </button>
            <button
              aria-label="Open circle"
              onClick={() => toggleModule('circle')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <CircleUserRound size={18} />
            </button>
            <button
              aria-label="Open Intake"
              onClick={() => toggleModule('inbox')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Funnel size={18} />
            </button>
            <button
              aria-label="Open calendar"
              onClick={() => openModule('calendar')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <CalendarDays size={18} />
            </button>
            <button
              aria-label="Open projects"
              onClick={() => toggleModule('projects')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Folder size={18} />
            </button>
            <button
              aria-label="Open notes"
              onClick={() => toggleModule('notes')}
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
              onClick={() => void window.desktopWindow?.quitApp()}
              onMouseDown={(e) => e.stopPropagation()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition-colors duration-150 hover:bg-[color:rgba(255,95,64,0.08)] hover:text-[var(--ledger-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
              title="Exit Ledger"
              aria-label="Exit Ledger"
            >
              <Power size={18} />
            </button>
          </div>
        </>
      ) : (
        <HoldToQuitLogo
          onClick={handleClick}
          className="flex h-10 w-10 items-center justify-center bg-transparent transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          imageClassName="block h-7 w-7 opacity-100"
          title="Ledger"
        />
      )}
      
    </div>
  );
};
