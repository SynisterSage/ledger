import {
  BarChart3,
  CalendarDays,
  Power,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  StickyNote,
  Folder,
  Search,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { useSearch } from '../../context/SearchContext';
import { sidebarTheme } from './sidebarTheme';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { openLegacyModule, usePlatform, type LegacyModuleFocus, type LegacyModuleKind } from '../../platform';
import { runtimeConfig } from '../../config/runtime';

export const MinimizedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { setState, position } = useSidebar();
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
  const handleExit = () => {
    if (platform.kind === 'web') {
      const publicSiteUrl = (runtimeConfig.ledgerWebUrl || 'https://ledgerworkspace.com').replace(/\/$/, '');
      window.location.assign(`${publicSiteUrl}/`);
      return;
    }
    void window.desktopWindow?.quitApp();
  };
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
          : 'h-full w-full flex-col items-center justify-between bg-transparent px-0 py-3'
      }`}
    >
      <div
        className={`${
          isHorizontal
            ? 'flex w-full flex-row items-center justify-between'
            : 'mx-auto flex h-full w-10 flex-col items-center justify-between'
        } shrink-0`}
      >
        <div className={`flex ${isHorizontal ? 'flex-row gap-3' : 'flex-col gap-3 self-center'}`}>
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
                setState('expanded');
                window.setTimeout(() => openSearch(), 220);
              })();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <Search size={18} />
          </button>
          <button
            aria-label="Open overview"
            onClick={() => {
              toggleModule('dashboard');
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <BarChart3 size={18} />
          </button>
          {platform.kind === 'desktop' && (
            <button
              aria-label="Open Ask Ledger"
              onClick={() => openModule('new-tab')}
              onMouseDown={(e) => e.stopPropagation()}
              className={neutralIcon}
            >
              <Sparkles size={18} />
            </button>
          )}
          <button
            aria-label="Open calendar"
              onClick={() => openModule('calendar')}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <CalendarDays size={18} />
          </button>
          <button
            aria-label="Open projects"
              onClick={() => toggleModule('projects')}
            onMouseDown={(e) => e.stopPropagation()}
            className={neutralIcon}
          >
            <Folder size={18} />
          </button>
          <button
            aria-label="Open notes"
              onClick={() => toggleModule('notes')}
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
            onClick={handleExit}
            onMouseDown={(e) => e.stopPropagation()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 text-[var(--ledger-text-secondary)] hover:bg-[color:rgba(255,95,64,0.08)] hover:text-[var(--ledger-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
            title="Exit Ledger"
            aria-label="Exit Ledger"
          >
            <Power size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
