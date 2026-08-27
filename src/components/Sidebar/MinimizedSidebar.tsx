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
import {
  NORMAL_RAIL_ITEM_IDS,
  normalizeNormalRailOrder,
  type NormalRailItemId,
} from '../../config/sidebarRail';
import { useApi } from '../../hooks/useApi';
import { useEffect, useRef, useState } from 'react';

export const MinimizedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { setState, position } = useSidebar();
  const { activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();
  const [normalRailOrder, setNormalRailOrder] = useState<NormalRailItemId[]>([
    ...NORMAL_RAIL_ITEM_IDS,
  ]);
  const [draggedRailItem, setDraggedRailItem] = useState<NormalRailItemId | null>(null);
  const [isRailOrderLoaded, setIsRailOrderLoaded] = useState(false);
  const dragStartOrderRef = useRef<NormalRailItemId[] | null>(null);
  const normalRailOrderRef = useRef(normalRailOrder);
  const draggedRailItemRef = useRef<NormalRailItemId | null>(null);
  const suppressClickRef = useRef(false);
  const railButtonRefs = useRef<Partial<Record<NormalRailItemId, HTMLButtonElement>>>({});
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

  useEffect(() => {
    let cancelled = false;
    setIsRailOrderLoaded(false);
    setNormalRailOrder([...NORMAL_RAIL_ITEM_IDS]);
    if (!activeWorkspaceId) {
      setIsRailOrderLoaded(true);
      return;
    }
    void api.getWorkspaceNavigationSettings(activeWorkspaceId).then((payload) => {
      if (cancelled) return;
      setNormalRailOrder(normalizeNormalRailOrder(payload?.navigation_settings?.normalRailOrder));
      setIsRailOrderLoaded(true);
    }).catch(() => {
      if (!cancelled) setIsRailOrderLoaded(true);
    });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, api]);

  const railItems = {
    search: <Search size={18} />,
    'ask-ledger': <Sparkles size={18} />,
    overview: <BarChart3 size={18} />,
    calendar: <CalendarDays size={18} />,
    projects: <Folder size={18} />,
    notes: <StickyNote size={18} />,
  } satisfies Record<NormalRailItemId, React.ReactNode>;
  const railActions: Record<NormalRailItemId, () => void> = {
    search: () => {
      if (platform.kind === 'web') { openSearch(); return; }
      void (async () => {
        const wasForwarded = await window.desktopWindow?.openSearchInWorkspaceWindow?.();
        if (wasForwarded) return;
        setState('expanded');
        window.setTimeout(() => openSearch(), 220);
      })();
    },
    'ask-ledger': () => openModule('new-tab'),
    overview: () => toggleModule('dashboard'),
    calendar: () => openModule('calendar'),
    projects: () => toggleModule('projects'),
    notes: () => toggleModule('notes'),
  };
  const visibleRailOrder = isHorizontal ? [...NORMAL_RAIL_ITEM_IDS] : normalRailOrder;

  normalRailOrderRef.current = normalRailOrder;

  useEffect(() => {
    if (isHorizontal || !draggedRailItem) return;

    const handlePointerMove = (event: PointerEvent) => {
      const draggedItem = draggedRailItemRef.current;
      if (!draggedItem) return;
      if (Math.abs(event.movementY) > 0) suppressClickRef.current = true;

      const orderWithoutDragged = normalRailOrderRef.current.filter((item) => item !== draggedItem);
      const insertionIndex = orderWithoutDragged.findIndex((item) => {
        const button = railButtonRefs.current[item];
        if (!button) return false;
        const rect = button.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      const next = [...orderWithoutDragged];
      next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, draggedItem);
      if (next.join('|') !== normalRailOrderRef.current.join('|')) {
        normalRailOrderRef.current = next;
        setNormalRailOrder(next);
      }
    };

    const finishPointerDrag = () => {
      const previousOrder = dragStartOrderRef.current;
      const nextOrder = normalRailOrderRef.current;
      const workspaceId = activeWorkspaceId;
      draggedRailItemRef.current = null;
      dragStartOrderRef.current = null;
      setDraggedRailItem(null);
      if (!workspaceId || !previousOrder || nextOrder.join('|') === previousOrder.join('|')) return;
      void api.updateWorkspaceNavigationSettings(workspaceId, { normalRailOrder: nextOrder }).catch(() => {
        normalRailOrderRef.current = previousOrder;
        setNormalRailOrder(previousOrder);
      });
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', finishPointerDrag, { once: true });
    document.addEventListener('pointercancel', finishPointerDrag, { once: true });
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', finishPointerDrag);
      document.removeEventListener('pointercancel', finishPointerDrag);
    };
  }, [activeWorkspaceId, api, draggedRailItem, isHorizontal]);

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
          {visibleRailOrder.map((itemId) => {
            if (itemId === 'ask-ledger' && platform.kind !== 'desktop') return null;
            return (
              <button
                key={itemId}
                type="button"
                aria-label={itemId === 'ask-ledger' ? 'Open Ask Ledger' : `Open ${itemId}`}
                draggable={false}
                ref={(element) => {
                  if (element) railButtonRefs.current[itemId] = element;
                  else delete railButtonRefs.current[itemId];
                }}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  railActions[itemId]();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(event) => {
                  if (isHorizontal || !isRailOrderLoaded || event.button !== 0) return;
                  event.preventDefault();
                  dragStartOrderRef.current = [...normalRailOrder];
                  draggedRailItemRef.current = itemId;
                  suppressClickRef.current = false;
                  setDraggedRailItem(itemId);
                }}
                className={`${neutralIcon} select-none ${draggedRailItem === itemId ? 'opacity-50' : ''}`}
                style={{ touchAction: isHorizontal ? 'auto' : 'none', cursor: isHorizontal ? 'pointer' : 'grab' }}
                title={itemId === 'ask-ledger' ? 'Ask Ledger' : itemId[0].toUpperCase() + itemId.slice(1)}
              >
                {railItems[itemId]}
              </button>
            );
          })}
          
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
