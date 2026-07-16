import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  FileText,
  FolderKanban,
  Inbox,
  LayoutList,
  Settings2,
  Users,
  X,
} from 'lucide-react';

type LedgerRoute = {
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};

type NavigationState = {
  currentRoute?: ModuleFocusPayload | null;
  recentRoutes?: ModuleFocusPayload[];
};

const tabKinds = new Set<ModuleWindowKind>([
  'dashboard',
  'notes',
  'projects',
  'calendar',
  'circle',
  'teams',
  'inbox',
  'settings',
]);

const TAB_GAP = 4;
const TAB_FALLBACK_WIDTH = 132;
const OVERFLOW_CONTROL_WIDTH = 42;
const TAB_SESSION_STORAGE_KEY = 'ledger:window-tabs:v1';

const routeKey = (route: LedgerRoute) =>
  [
    route.kind,
    route.focusDate ?? '',
    route.focusProjectId ?? '',
    route.focusNoteId ?? '',
    route.focusTaskId ?? '',
    route.focusContext ?? '',
    route.focusSection ?? '',
  ].join('|');

const routeLabel = (route: LedgerRoute) => {
  switch (route.kind) {
    case 'dashboard':
      return 'Workspace Overview';
    case 'notes':
      return route.focusNoteId ? 'Notes' : 'Notes Home';
    case 'projects':
      return route.focusProjectId ? 'Projects · Project' : 'Projects Roadmap';
    case 'calendar':
      return 'Calendar';
    case 'circle':
      return route.focusContext?.startsWith('ledger-person|') ? 'Circle · Person' : 'Circle';
    case 'teams':
      return route.focusContext?.startsWith('team:') ? 'Teams · Team' : 'Teams';
    case 'inbox':
      return 'Intake';
    case 'settings':
      return 'Settings';
    default:
      return 'Page';
  }
};

const routeIcon = (route: LedgerRoute): ReactNode => {
  const className = 'h-3.5 w-3.5 shrink-0 text-current';
  switch (route.kind) {
    case 'dashboard':
      return <LayoutList className={className} />;
    case 'notes':
      return <FileText className={className} />;
    case 'projects':
      return <FolderKanban className={className} />;
    case 'calendar':
      return <CalendarDays className={className} />;
    case 'circle':
      return <CircleUserRound className={className} />;
    case 'teams':
      return <Users className={className} />;
    case 'inbox':
      return <Inbox className={className} />;
    default:
      return <Settings2 className={className} />;
  }
};

const normalizeRoute = (route?: ModuleFocusPayload | null): LedgerRoute | null => {
  if (!route?.kind || !tabKinds.has(route.kind)) return null;
  return { ...route, kind: route.kind };
};

const sameRoute = (left: LedgerRoute, right: LedgerRoute) => routeKey(left) === routeKey(right);

export const LedgerTab = ({
  route,
  active,
  onSelect,
  onClose,
}: {
  route: LedgerRoute;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) => (
  <div
    data-tab-key={routeKey(route)}
    className={`group flex max-w-[190px] min-w-0 items-center gap-1 border border-b-0 px-1 transition ${
      active
        ? '-mb-px h-7 rounded-t-md border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)]'
        : 'mb-0.5 h-6 rounded-md border-transparent text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
    }`}
  >
    <button
      type="button"
      onClick={onSelect}
      className="flex min-w-0 flex-1 items-center gap-1.5 truncate px-1.5 text-left text-[11px] font-medium"
      aria-current={active ? 'page' : undefined}
      role="tab"
      aria-selected={active}
    >
      {routeIcon(route)}
      <span className="truncate">{routeLabel(route)}</span>
    </button>
    <button
      type="button"
      onClick={onClose}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ledger-text-muted)] opacity-0 transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
      aria-label={`Close ${routeLabel(route)} tab`}
      title="Close tab"
    >
      <X size={12} />
    </button>
  </div>
);

export const LedgerTabStrip = () => {
  const [navigationState, setNavigationState] = useState<NavigationState>({});
  const [tabOrder, setTabOrder] = useState<LedgerRoute[]>([]);
  const [closedTabKeys, setClosedTabKeys] = useState<Set<string>>(new Set());
  const [stripWidth, setStripWidth] = useState(0);
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({});
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const measurementRef = useRef<HTMLDivElement | null>(null);
  const tabOrderRef = useRef<LedgerRoute[]>([]);
  const closedTabKeysRef = useRef<Set<string>>(new Set());
  const pendingCloseKeyRef = useRef<string | null>(null);

  const currentRoute = normalizeRoute(navigationState.currentRoute);
  const incomingRoutes = useMemo(
    () => (currentRoute ? [currentRoute] : []),
    [currentRoute]
  );

  useEffect(() => {
    tabOrderRef.current = tabOrder;
  }, [tabOrder]);

  useEffect(() => {
    closedTabKeysRef.current = closedTabKeys;
  }, [closedTabKeys]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TAB_SESSION_STORAGE_KEY) ?? 'null');
      if (Array.isArray(saved)) {
        const restored: LedgerRoute[] = [];
        const seen = new Set<string>();
        for (const item of saved) {
          const route = normalizeRoute(item as ModuleFocusPayload);
          if (!route || seen.has(routeKey(route))) continue;
          seen.add(routeKey(route));
          restored.push(route);
        }
        tabOrderRef.current = restored;
        setTabOrder(restored);
      }
    } catch {
      // Browser privacy settings can disable sessionStorage; the in-memory session still works.
    }
  }, []);

  useEffect(() => {
    if (tabOrder.length === 0) return;
    try {
      sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(tabOrder));
    } catch {
      // Keep the current window session usable when storage is unavailable.
    }
  }, [tabOrder]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const getNavigationState = window.desktopWindow?.getWorkspaceNavigationState;
      const state = getNavigationState ? await getNavigationState().catch(() => null) : null;
      if (mounted && state) setNavigationState(state);
    };
    void load();

    const handleState = (_event: unknown, state?: NavigationState) => {
      if (state) setNavigationState(state);
    };
    window.ipcRenderer?.on?.('workspace:navigation-state', handleState as any);
    return () => {
      mounted = false;
      window.ipcRenderer?.off?.('workspace:navigation-state', handleState as any);
    };
  }, []);

  useEffect(() => {
    if (incomingRoutes.length === 0) return;

    const currentKey = currentRoute ? routeKey(currentRoute) : null;
    if (pendingCloseKeyRef.current && pendingCloseKeyRef.current !== currentKey) {
      pendingCloseKeyRef.current = null;
    }

    const nextOrder = [...tabOrderRef.current];
    const nextClosed = new Set(closedTabKeysRef.current);

    // The current route is a deliberate reopen/focus of a previously closed tab.
    if (
      currentRoute &&
      nextClosed.has(currentKey ?? '') &&
      pendingCloseKeyRef.current !== currentKey
    ) {
      nextClosed.delete(currentKey ?? '');
      nextOrder.push(currentRoute);
    }

    // Seed an existing session in oldest-to-newest order, then append future routes.
    const routesToAdd = nextOrder.length === 0 ? [...incomingRoutes].reverse() : incomingRoutes;
    for (const route of routesToAdd) {
      const key = routeKey(route);
      if (nextClosed.has(key) || nextOrder.some((item) => routeKey(item) === key)) continue;
      nextOrder.push(route);
    }

    const orderChanged =
      nextOrder.length !== tabOrderRef.current.length ||
      nextOrder.some((route, index) => routeKey(route) !== routeKey(tabOrderRef.current[index]));
    if (orderChanged) {
      tabOrderRef.current = nextOrder;
      setTabOrder(nextOrder);
    }
    if (nextClosed.size !== closedTabKeysRef.current.size) {
      closedTabKeysRef.current = nextClosed;
      setClosedTabKeys(nextClosed);
    }
  }, [currentRoute, incomingRoutes]);

  useEffect(() => {
    const element = stripRef.current;
    if (!element) return;

    const updateWidth = () => setStripWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = measurementRef.current;
    if (!element || tabOrder.length === 0) return;

    const nextWidths: Record<string, number> = {};
    element.querySelectorAll<HTMLElement>('[data-tab-key]').forEach((tab) => {
      const key = tab.dataset.tabKey;
      if (key) nextWidths[key] = Math.ceil(tab.getBoundingClientRect().width);
    });

    setTabWidths((current) => {
      const keys = Object.keys(nextWidths);
      if (
        keys.length === Object.keys(current).length &&
        keys.every((key) => current[key] === nextWidths[key])
      ) {
        return current;
      }
      return nextWidths;
    });
  }, [tabOrder]);

  useEffect(() => {
    if (!isOverflowOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (stripRef.current?.contains(target)) return;
      setIsOverflowOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOverflowOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOverflowOpen]);

  const { visibleTabs, overflowTabs } = useMemo(() => {
    if (tabOrder.length === 0) return { visibleTabs: [], overflowTabs: [] };
    if (stripWidth <= 0) return { visibleTabs: tabOrder, overflowTabs: [] };

    const widthFor = (route: LedgerRoute) => tabWidths[routeKey(route)] ?? TAB_FALLBACK_WIDTH;
    const totalWidth = tabOrder.reduce((total, route) => total + widthFor(route), 0);
    const totalGaps = Math.max(0, tabOrder.length - 1) * TAB_GAP;
    const allFit = totalWidth + totalGaps <= stripWidth;
    const availableWidth = allFit ? stripWidth : Math.max(0, stripWidth - OVERFLOW_CONTROL_WIDTH);
    const visible: LedgerRoute[] = [];
    let usedWidth = 0;

    for (const route of tabOrder) {
      const nextWidth = widthFor(route) + (visible.length > 0 ? TAB_GAP : 0);
      if (usedWidth + nextWidth > availableWidth) break;
      visible.push(route);
      usedWidth += nextWidth;
    }

    const activeIndex = currentRoute
      ? visible.findIndex((route) => sameRoute(route, currentRoute))
      : -1;
    if (currentRoute && activeIndex === -1) {
      if (visible.length === 0) {
        visible.push(currentRoute);
      } else {
        visible[visible.length - 1] = currentRoute;
        while (
          visible.length > 1 &&
          visible.reduce((total, route, index) => total + widthFor(route) + (index ? TAB_GAP : 0), 0) >
            availableWidth
        ) {
          visible.splice(visible.length - 2, 1);
        }
      }
    }

    const visibleKeys = new Set(visible.map(routeKey));
    return {
      visibleTabs: visible,
      overflowTabs: tabOrder.filter((route) => !visibleKeys.has(routeKey(route))),
    };
  }, [currentRoute, stripWidth, tabOrder, tabWidths]);

  if (tabOrder.length === 0) return null;

  const selectTab = (route: LedgerRoute) => {
    setClosedTabKeys((current) => {
      if (!current.has(routeKey(route))) return current;
      const next = new Set(current);
      next.delete(routeKey(route));
      return next;
    });
    setIsOverflowOpen(false);
    void window.desktopWindow?.openModule?.(route.kind, route);
  };

  const closeTab = (route: LedgerRoute) => {
    const key = routeKey(route);
    const index = tabOrder.findIndex((item) => sameRoute(item, route));
    if (index < 0) return;

    const nextOrder = tabOrder.filter((item) => !sameRoute(item, route));
    if (nextOrder.length === 0) return;

    tabOrderRef.current = nextOrder;
    setTabOrder(nextOrder);
    setClosedTabKeys((current) => new Set(current).add(key));
    setIsOverflowOpen(false);

    if (!currentRoute || !sameRoute(route, currentRoute)) return;
    const nextRoute = nextOrder[index - 1] ?? nextOrder[index];
    if (nextRoute) {
      pendingCloseKeyRef.current = key;
      void window.desktopWindow?.openModule?.(nextRoute.kind, nextRoute);
    }
  };

  return (
    <div
      ref={stripRef}
      className="relative flex h-8 min-w-0 items-end border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3"
      role="tablist"
      aria-label="Ledger windows"
    >
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-hidden">
        {visibleTabs.map((route) => (
          <LedgerTab
            key={routeKey(route)}
            route={route}
            active={Boolean(currentRoute && sameRoute(currentRoute, route))}
            onSelect={() => selectTab(route)}
            onClose={() => closeTab(route)}
          />
        ))}
      </div>

      {overflowTabs.length > 0 && (
        <div className="relative ml-1 shrink-0 self-end pb-0.5">
          <button
            type="button"
            onClick={() => setIsOverflowOpen((current) => !current)}
            className="flex h-6 min-w-8 items-center justify-center gap-0.5 rounded-md px-1.5 text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
            aria-label={`Open hidden tabs, ${overflowTabs.length} hidden tab${overflowTabs.length === 1 ? '' : 's'}`}
            aria-expanded={isOverflowOpen}
            aria-haspopup="menu"
            title={`${overflowTabs.length} hidden tab${overflowTabs.length === 1 ? '' : 's'}`}
          >
            <span className="text-[11px] font-medium">+{overflowTabs.length}</span>
            <ChevronDown size={12} />
          </button>

          {isOverflowOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[0_10px_30px_rgba(15,23,42,0.14)]"
              role="menu"
              aria-label="Hidden Ledger tabs"
            >
              {overflowTabs.map((route) => (
                <div key={routeKey(route)} className="group/menu flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => selectTab(route)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                    role="menuitem"
                  >
                    {routeIcon(route)}
                    <span className="min-w-0 flex-1 truncate">{routeLabel(route)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(route)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--ledger-text-muted)] opacity-0 group-hover/menu:opacity-100 focus-visible:opacity-100 hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    aria-label={`Close ${routeLabel(route)} tab`}
                    title="Close tab"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 flex w-max items-end gap-1 opacity-0"
      >
        {tabOrder.map((route) => (
          <LedgerTab
            key={`measure-${routeKey(route)}`}
            route={route}
            active={false}
            onSelect={() => undefined}
            onClose={() => undefined}
          />
        ))}
      </div>
    </div>
  );
};
