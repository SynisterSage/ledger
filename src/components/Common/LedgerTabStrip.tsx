import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  CalendarDays,
  Bell,
  ChevronDown,
  CircleUserRound,
  FileText,
  FolderKanban,
  Inbox,
  LayoutList,
  Plus,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useToast } from './ToastProvider';

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
  currentModule?: ModuleWindowKind | null;
  currentRoute?: ModuleFocusPayload | null;
  recentRoutes?: ModuleFocusPayload[];
};

const tabKinds = new Set<ModuleWindowKind>([
  'new-tab',
  'dashboard',
  'notes',
  'projects',
  'calendar',
  'circle',
  'teams',
  'inbox',
  'notifications',
  'settings',
]);

const TAB_GAP = 4;
const TAB_FALLBACK_WIDTH = 132;
const OVERFLOW_CONTROL_WIDTH = 42;
const TAB_SESSION_STORAGE_KEY = 'ledger:window-tabs:v1';
const TAB_TRANSFER_ID = new URLSearchParams(window.location.search).get('tabTransferId');

const routeKey = (route: LedgerRoute) => {
  if (route.kind === 'new-tab') return `new-tab|${route.focusContext ?? 'default'}`;

  // View state belongs to the existing tab. Only document/resource identity
  // creates a distinct tab (for example, separate notes or projects).
  switch (route.kind) {
    case 'notes':
      return route.focusNoteId ? `notes|note|${route.focusNoteId}` : 'notes|home';
    case 'projects':
      return route.focusProjectId ? `projects|project|${route.focusProjectId}` : 'projects|home';
    case 'circle':
      return 'circle';
    case 'teams':
      return route.focusContext?.startsWith('team:')
        ? `teams|team|${route.focusContext.slice('team:'.length)}`
        : 'teams';
    case 'calendar':
    case 'dashboard':
    case 'inbox':
    case 'notifications':
    case 'settings':
      return route.kind;
    default:
      return route.kind;
  }
};

const getCirclePersonId = (route: LedgerRoute) => {
  if (!route.focusContext?.startsWith('ledger-person|')) return null;
  return route.focusContext.split('|')[1] || null;
};

const isEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const routeLabel = (
  route: LedgerRoute,
  projectTitle?: string,
  noteTitle?: string,
  circlePersonTitle?: string
) => {
  switch (route.kind) {
    case 'new-tab':
      return 'New Tab';
    case 'dashboard':
      return 'Workspace Overview';
    case 'notes':
      return route.focusNoteId ? noteTitle || 'Untitled note' : 'Notes Home';
    case 'projects':
      return route.focusProjectId ? projectTitle || 'Projects · Project' : 'Projects Roadmap';
    case 'calendar':
      return 'Calendar';
    case 'circle':
      return getCirclePersonId(route)
        ? circlePersonTitle && !isEmailAddress(circlePersonTitle)
          ? circlePersonTitle
          : 'Circle'
        : 'Circle';
    case 'teams':
      return route.focusContext?.startsWith('team:') ? 'Teams · Team' : 'Teams';
    case 'inbox':
      return 'Intake';
    case 'notifications':
      return 'Notifications';
    case 'settings':
      return 'Settings';
    default:
      return 'Page';
  }
};

const routeIcon = (route: LedgerRoute): ReactNode => {
  const className = 'h-3.5 w-3.5 shrink-0 text-current';
  switch (route.kind) {
    case 'new-tab':
      return <Plus className={className} />;
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
    case 'notifications':
      return <Bell className={className} />;
    default:
      return <Settings2 className={className} />;
  }
};

const normalizeRoute = (route?: ModuleFocusPayload | null): LedgerRoute | null => {
  if (!route?.kind || !tabKinds.has(route.kind)) return null;
  return { ...route, kind: route.kind };
};

const sameRoute = (left: LedgerRoute, right: LedgerRoute) => routeKey(left) === routeKey(right);
const sameRouteState = (left: LedgerRoute, right: LedgerRoute) =>
  left.kind === right.kind &&
  (left.focusDate ?? null) === (right.focusDate ?? null) &&
  (left.focusProjectId ?? null) === (right.focusProjectId ?? null) &&
  (left.focusNoteId ?? null) === (right.focusNoteId ?? null) &&
  (left.focusTaskId ?? null) === (right.focusTaskId ?? null) &&
  (left.focusContext ?? null) === (right.focusContext ?? null) &&
  (left.focusSection ?? null) === (right.focusSection ?? null);
const isNewTabRoute = (route: LedgerRoute | null | undefined) => route?.kind === 'new-tab';
const createNewTabRoute = (): LedgerRoute => ({
  kind: 'new-tab',
  focusContext: `new-tab:${crypto.randomUUID()}`,
});

export const LedgerTab = ({
  route,
  active,
  isDragging = false,
  title,
  onSelect,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  route: LedgerRoute;
  active: boolean;
  isDragging?: boolean;
  title?: string;
  onSelect: () => void;
  onClose: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) => (
  <div
    data-tab-key={routeKey(route)}
    onClick={(event) => {
      if (event.target === event.currentTarget) onSelect();
    }}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerCancel}
    className={`group flex max-w-[190px] min-w-0 items-center gap-1 border border-b-0 px-1 transition ${
      isDragging
        ? 'relative z-20 -translate-y-0.5 cursor-grabbing rounded-t-md border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)]'
        : active
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
      draggable={false}
    >
      {routeIcon(route)}
      <span className="truncate" title={title ?? routeLabel(route)}>
        {title ?? routeLabel(route)}
      </span>
    </button>
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ledger-text-muted)] opacity-0 transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
      aria-label={`Close ${title ?? routeLabel(route)} tab`}
      title="Close tab"
    >
      <X size={12} />
    </button>
  </div>
);

export const LedgerTabStrip = () => {
  const { activeWorkspaceId } = useWorkspaceContext();
  const { getNotes, getPerson, getProjects } = useApi();
  const toast = useToast();
  const [navigationState, setNavigationState] = useState<NavigationState>({});
  const [tabOrder, setTabOrder] = useState<LedgerRoute[]>([]);
  const [visualRouteOverride, setVisualRouteOverride] = useState<LedgerRoute | null>(null);
  const [closedTabKeys, setClosedTabKeys] = useState<Set<string>>(new Set());
  const [stripWidth, setStripWidth] = useState(0);
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({});
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const measurementRef = useRef<HTMLDivElement | null>(null);
  const tabOrderRef = useRef<LedgerRoute[]>([]);
  const currentRouteRef = useRef<LedgerRoute | null>(null);
  const closedTabKeysRef = useRef<Set<string>>(new Set());
  const pendingCloseKeyRef = useRef<string | null>(null);
  const suppressInitialRouteRef = useRef(false);
  const tabDragRef = useRef<{
    route: LedgerRoute;
    pointerId: number;
    startX: number;
    startY: number;
    movedOutsideStrip: boolean;
  } | null>(null);
  const suppressTabClickRef = useRef(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [draggingTabKey, setDraggingTabKey] = useState<string | null>(null);
  const [projectTitles, setProjectTitles] = useState<Record<string, string>>({});
  const [noteTitles, setNoteTitles] = useState<Record<string, string>>({});
  const [circlePersonTitles, setCirclePersonTitles] = useState<Record<string, string>>({});

  const currentRoute = normalizeRoute(navigationState.currentRoute);
  const visualCurrentRoute = visualRouteOverride ?? currentRoute;
  const incomingRoutes = useMemo(() => (currentRoute ? [currentRoute] : []), [currentRoute]);
  const projectIds = useMemo(
    () =>
      Array.from(
        new Set(
          tabOrder
            .filter((route) => route.kind === 'projects' && route.focusProjectId)
            .map((route) => route.focusProjectId as string)
        )
      ),
    [tabOrder]
  );
  const noteIds = useMemo(
    () =>
      Array.from(
        new Set(
          tabOrder
            .filter((route) => route.kind === 'notes' && route.focusNoteId)
            .map((route) => route.focusNoteId as string)
        )
      ),
    [tabOrder]
  );
  const circlePersonIds = useMemo(
    () =>
      Array.from(
        new Set(
          tabOrder
            .map(getCirclePersonId)
            .filter((personId): personId is string => Boolean(personId))
        )
      ),
    [tabOrder]
  );

  useEffect(() => {
    if (projectIds.length === 0) {
      setProjectTitles({});
      return;
    }

    let cancelled = false;
    void getProjects({ includeCompleted: true })
      .then((projects) => {
        if (cancelled || !Array.isArray(projects)) return;
        const titles: Record<string, string> = {};
        for (const project of projects as Array<{ id?: string; name?: string }>) {
          if (project.id && project.name?.trim()) titles[project.id] = project.name.trim();
        }
        if (!cancelled) setProjectTitles(titles);
      })
      .catch(() => {
        // Keep the generic project label if project metadata is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [getProjects, projectIds, activeWorkspaceId]);

  useEffect(() => {
    if (noteIds.length === 0) {
      setNoteTitles({});
      return;
    }

    let cancelled = false;
    void getNotes()
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { notes?: unknown[] })?.notes)
          ? (payload as { notes: unknown[] }).notes
          : [];
        const titles: Record<string, string> = {};
        for (const note of rows as Array<{ id?: string; title?: string }>) {
          if (note.id && note.title?.trim()) titles[note.id] = note.title.trim();
        }
        if (!cancelled) setNoteTitles(titles);
      })
      .catch(() => {
        // Keep the fallback note label if metadata is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, getNotes, noteIds]);

  useEffect(() => {
    if (circlePersonIds.length === 0) {
      setCirclePersonTitles({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      circlePersonIds.map(async (personId) => {
        try {
          const payload = (await getPerson(personId)) as {
            person?: {
              name?: string | null;
              display_name?: string | null;
              full_name?: string | null;
              email?: string | null;
            };
            name?: string | null;
            display_name?: string | null;
            full_name?: string | null;
            email?: string | null;
          };
          const person = payload?.person ?? payload;
          const email = person?.email?.trim().toLowerCase() ?? '';
          const emailLocalPart = email.split('@')[0] ?? '';
          const name = [person?.name, person?.display_name, person?.full_name]
            .map((value) => value?.trim())
            .find((value) => {
              const normalized = value?.toLowerCase() ?? '';
              return Boolean(value) &&
                !isEmailAddress(value as string) &&
                normalized !== email &&
                normalized !== emailLocalPart;
            });
          return name ? ([personId, name] as const) : null;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      const titles: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) titles[entry[0]] = entry[1];
      }
      setCirclePersonTitles(titles);
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, circlePersonIds, getPerson]);

  const getTabTitle = (route: LedgerRoute) =>
    routeLabel(
      route,
      route.focusProjectId ? projectTitles[route.focusProjectId] : undefined,
      route.focusNoteId ? noteTitles[route.focusNoteId] : undefined,
      getCirclePersonId(route)
        ? circlePersonTitles[getCirclePersonId(route) as string]
        : undefined
    );

  useEffect(() => {
    tabOrderRef.current = tabOrder;
  }, [tabOrder]);

  useEffect(() => {
    currentRouteRef.current = currentRoute;
  }, [currentRoute]);

  useEffect(() => {
    if (!visualRouteOverride || !currentRoute) return;
    if (sameRouteState(visualRouteOverride, currentRoute)) {
      setVisualRouteOverride(null);
    }
  }, [currentRoute, visualRouteOverride]);

  useEffect(() => {
    closedTabKeysRef.current = closedTabKeys;
  }, [closedTabKeys]);

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      let restored: LedgerRoute[] = [];
      try {
        const saved = JSON.parse(sessionStorage.getItem(TAB_SESSION_STORAGE_KEY) ?? 'null');
        if (Array.isArray(saved)) {
          const seen = new Set<string>();
          restored = saved.flatMap((item) => {
            const route = normalizeRoute(item as ModuleFocusPayload);
            if (!route) return [];
            const key = isNewTabRoute(route) ? 'new-tab' : routeKey(route);
            if (seen.has(key)) return [];
            seen.add(key);
            return [route];
          });
        }
      } catch {
        // Browser privacy settings can disable sessionStorage; the in-memory session still works.
      }

      const state = await window.desktopWindow?.getWorkspaceNavigationState?.().catch(() => null);
      if (!mounted) return;
      if (state) setNavigationState(state);
      if (restored.length === 0) {
        const current = normalizeRoute(state?.currentRoute);
        const hasExplicitModuleRoute = Boolean(
          state?.currentModule && current && state.currentModule === current.kind
        );
        if (hasExplicitModuleRoute && current) {
          restored = [current];
        } else {
          restored = [createNewTabRoute()];
          suppressInitialRouteRef.current = true;
          void window.desktopWindow?.openModule?.('new-tab', restored[0]);
        }
      }
      tabOrderRef.current = restored;
      setTabOrder(restored);
    };
    void initialize();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!TAB_TRANSFER_ID) return;
    let cancelled = false;
    const retryDelays = [0, 150, 500, 1000];
    const pullSession = async (attempt: number) => {
      const getSession = window.desktopWindow?.getTabDetachSession;
      const session = getSession ? await getSession(TAB_TRANSFER_ID).catch(() => null) : null;
      if (cancelled) return;
      if (session) {
        const route = normalizeRoute(session.route);
        if (!route) return;
        const restored = [route];
        tabOrderRef.current = restored;
        setTabOrder(restored);
        setClosedTabKeys(new Set());
        try {
          sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(restored));
        } catch {
          // The in-memory target session remains usable.
        }
        void window.desktopWindow?.confirmTabDetach?.(TAB_TRANSFER_ID);
        return;
      }
      if (attempt + 1 < retryDelays.length) {
        window.setTimeout(() => void pullSession(attempt + 1), retryDelays[attempt + 1]);
      }
    };
    void pullSession(0);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleHydrateSession = (
      _event: unknown,
      payload?: { transferId?: string; session?: LedgerTabSession }
    ) => {
      const session = payload?.session;
      const route = normalizeRoute(session?.route);
      if (!session || !route) return;

      const restored = [route];
      tabOrderRef.current = restored;
      setTabOrder(restored);
      setClosedTabKeys(new Set());
      try {
        sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(restored));
      } catch {
        // The in-memory target session remains usable.
      }
      if (payload.transferId) {
        void window.desktopWindow?.confirmTabDetach?.(payload.transferId);
      }
    };

    window.ipcRenderer?.on?.('tab:hydrate-session', handleHydrateSession as any);
    return () => {
      window.ipcRenderer?.off?.('tab:hydrate-session', handleHydrateSession as any);
    };
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
    const handleState = (_event: unknown, state?: NavigationState) => {
      if (state) setNavigationState(state);
    };
    window.ipcRenderer?.on?.('workspace:navigation-state', handleState as any);
    return () => {
      window.ipcRenderer?.off?.('workspace:navigation-state', handleState as any);
    };
  }, []);

  useEffect(() => {
    if (incomingRoutes.length === 0) return;

    if (suppressInitialRouteRef.current && currentRoute && !isNewTabRoute(currentRoute)) {
      return;
    }
    if (suppressInitialRouteRef.current && isNewTabRoute(currentRoute)) {
      suppressInitialRouteRef.current = false;
    }

    const currentKey = currentRoute ? routeKey(currentRoute) : null;
    if (
      pendingCloseKeyRef.current &&
      pendingCloseKeyRef.current !== currentKey &&
      !isNewTabRoute(currentRoute)
    ) {
      pendingCloseKeyRef.current = null;
    }

    const nextOrder = tabOrderRef.current.filter((route, index, routes) => {
      if (!isNewTabRoute(route)) return true;
      return routes.findIndex((candidate) => isNewTabRoute(candidate)) === index;
    });
    const nextClosed = new Set(closedTabKeysRef.current);

    // A route can arrive here more than once while Electron finishes switching
    // the shared workspace window. Once a tab is closed, ignore any late route
    // broadcast for it so it cannot be resurrected by navigation history.
    // Explicit tab selection clears the closed key before opening the route.
    if (currentRoute && nextClosed.has(currentKey ?? '')) {
      const prunedOrder = nextOrder.filter((route) => !nextClosed.has(routeKey(route)));
      if (prunedOrder.length !== nextOrder.length) {
        tabOrderRef.current = prunedOrder;
        setTabOrder(prunedOrder);
        try {
          sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(prunedOrder));
        } catch {
          // Keep the in-memory tab state authoritative when storage is unavailable.
        }
      }
      return;
    }

    const existingNewTabIndex = nextOrder.findIndex((route) => isNewTabRoute(route));
    if (currentRoute && isNewTabRoute(currentRoute) && existingNewTabIndex >= 0) {
      const existingNewTab = nextOrder[existingNewTabIndex];
      nextOrder[existingNewTabIndex] = currentRoute;
      const newTabOrderChanged =
        nextOrder.length !== tabOrderRef.current.length ||
        !sameRoute(existingNewTab, currentRoute);
      if (newTabOrderChanged) {
        tabOrderRef.current = nextOrder;
        setTabOrder(nextOrder);
      }
      suppressInitialRouteRef.current = false;
      return;
    }

    const existingRouteIndex = currentRoute
      ? nextOrder.findIndex((route) => sameRoute(route, currentRoute))
      : -1;
    if (currentRoute && existingRouteIndex >= 0) {
      // Calendar/view changes and module focus metadata update the existing
      // tab instead of creating another tab with the same workspace surface.
      if (!sameRouteState(nextOrder[existingRouteIndex], currentRoute)) {
        nextOrder[existingRouteIndex] = currentRoute;
        tabOrderRef.current = nextOrder;
        setTabOrder(nextOrder);
      }
      return;
    }

    const newTabIndex = nextOrder.findIndex((route) => isNewTabRoute(route));
    if (currentRoute && !isNewTabRoute(currentRoute) && newTabIndex >= 0) {
      // An existing tab was selected. Its route is already represented in the
      // stable tab order, so this is not a New Tab destination replacement.
      if (nextOrder.some((route) => sameRoute(route, currentRoute))) {
        return;
      }
      nextOrder[newTabIndex] = currentRoute;
      nextClosed.delete(currentKey ?? '');
      tabOrderRef.current = nextOrder;
      setTabOrder(nextOrder);
      setClosedTabKeys(nextClosed);
      return;
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

    const activeIndex = visualCurrentRoute
      ? visible.findIndex((route) => sameRoute(route, visualCurrentRoute))
      : -1;
    if (visualCurrentRoute && activeIndex === -1) {
      if (visible.length === 0) {
        visible.push(visualCurrentRoute);
      } else {
        visible[visible.length - 1] = visualCurrentRoute;
        while (
          visible.length > 1 &&
          visible.reduce(
            (total, route, index) => total + widthFor(route) + (index ? TAB_GAP : 0),
            0
          ) > availableWidth
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
  }, [stripWidth, tabOrder, tabWidths, visualCurrentRoute]);

  const closeTab = useCallback((route: LedgerRoute) => {
      const key = routeKey(route);
      const currentTabOrder = tabOrderRef.current;
      const index = currentTabOrder.findIndex((item) => sameRoute(item, route));
      if (index < 0) return;

      const nextOrder = currentTabOrder.filter((item) => !sameRoute(item, route));
      tabOrderRef.current = nextOrder;
      setTabOrder(nextOrder);
      const nextClosed = new Set(closedTabKeysRef.current);
      nextClosed.add(key);
      closedTabKeysRef.current = nextClosed;
      setClosedTabKeys(nextClosed);
      setIsOverflowOpen(false);
      try {
        sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(nextOrder));
      } catch {
        // The in-memory tab state remains authoritative when storage is unavailable.
      }

      if (nextOrder.length === 0) {
        if (isNewTabRoute(route)) {
          try {
            sessionStorage.removeItem(TAB_SESSION_STORAGE_KEY);
          } catch {
            // Keep the sidebar-only state usable when storage is unavailable.
          }
          void window.desktopWindow?.closeModule?.(route.kind);
          return;
        }

        const newTab = createNewTabRoute();
        tabOrderRef.current = [newTab];
        setTabOrder([newTab]);
        setVisualRouteOverride(newTab);
        closedTabKeysRef.current = new Set();
        setClosedTabKeys(closedTabKeysRef.current);
        try {
          sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify([newTab]));
        } catch {
          // Keep the in-memory tab usable when storage is unavailable.
        }
        void window.desktopWindow?.openModule?.('new-tab', newTab);
        return;
      }

      const currentRoute = currentRouteRef.current;
      if (!currentRoute) return;
      if (!sameRoute(route, currentRoute)) {
        // Closing an inactive tab must still re-assert the visible route.
        // Hidden keep-alive modules can otherwise publish their stale route
        // after the close and resurrect the tab that was just removed.
        void window.desktopWindow?.openModule?.(currentRoute.kind, currentRoute);
        return;
      }
      const nextRoute = nextOrder[index - 1] ?? nextOrder[index];
      if (nextRoute) {
        pendingCloseKeyRef.current = key;
        setVisualRouteOverride(nextRoute);
        void window.desktopWindow?.openModule?.(nextRoute.kind, nextRoute);
      }
    }, []);

  const finishTabDrag = useCallback(
    async (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = tabDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      tabDragRef.current = null;
      setDraggingTabKey(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (drag.movedOutsideStrip) {
        suppressTabClickRef.current = true;
        window.setTimeout(() => {
          suppressTabClickRef.current = false;
        }, 0);
      }

      const getWindowBounds = window.desktopWindow?.getWindowBounds;
      const bounds = getWindowBounds ? await getWindowBounds().catch(() => null) : null;
      const screenX = event.screenX;
      const screenY = event.screenY;
      const outsideWindow = Boolean(
        bounds &&
          (screenX < bounds.x ||
            screenY < bounds.y ||
            screenX > bounds.x + bounds.width ||
            screenY > bounds.y + bounds.height)
      );
      if (!drag.movedOutsideStrip || !outsideWindow || isDetaching) return;

      setIsDetaching(true);
      const route = drag.route;
      const session: LedgerTabSession = {
        tabId: routeKey(route),
        workspaceId: activeWorkspaceId ?? null,
        module: route.kind,
        route: { ...route, kind: route.kind },
        selectedResourceId: route.focusNoteId ?? route.focusProjectId ?? route.focusTaskId ?? null,
        routeState: {},
        tabHistory: [{ ...route, kind: route.kind }],
        historyIndex: 0,
        title: getTabTitle(route),
        icon: route.kind,
      };

      try {
        const result = await window.desktopWindow?.detachTab?.(session, {
          x: screenX,
          y: screenY,
        });
        if (result?.success) {
          if (tabOrder.length > 1) {
            closeTab(route);
          } else {
            tabOrderRef.current = [];
            setTabOrder([]);
            try {
              sessionStorage.removeItem(TAB_SESSION_STORAGE_KEY);
            } catch {
              // The source window can still close when storage is unavailable.
            }
            void window.desktopWindow?.closeModule?.(route.kind);
          }
        } else {
          toast.show('Could not move tab to a new window.', { variant: 'error' });
        }
      } catch {
        toast.show('Could not move tab to a new window.', { variant: 'error' });
      } finally {
        setIsDetaching(false);
      }
    },
    [activeWorkspaceId, closeTab, isDetaching, tabOrder.length, toast]
  );

  const handleTabPointerDown =
    (route: LedgerRoute) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isDetaching) return;
      tabDragRef.current = {
        route,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        movedOutsideStrip: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const handleTabPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tabDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < 8) return;
    setDraggingTabKey(routeKey(drag.route));
    const stripBounds = stripRef.current?.getBoundingClientRect();
    if (!stripBounds) return;
    drag.movedOutsideStrip ||=
      event.clientX < stripBounds.left - 12 ||
      event.clientX > stripBounds.right + 12 ||
      event.clientY < stripBounds.top - 12 ||
      event.clientY > stripBounds.bottom + 12;
    if (drag.movedOutsideStrip) {
      suppressTabClickRef.current = true;
      event.preventDefault();
    }
  };

  const handleTabPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tabDragRef.current?.pointerId !== event.pointerId) return;
    tabDragRef.current = null;
    setDraggingTabKey(null);
    suppressTabClickRef.current = false;
  };

  const handleTabSelect = (route: LedgerRoute) => {
    if (suppressTabClickRef.current) return;
    selectTab(route);
  };

  useEffect(() => {
    const handleCloseTabShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'w') return;
      if (!currentRoute) return;

      event.preventDefault();
      event.stopPropagation();

      if (tabOrder.length > 1 && tabOrder.some((route) => sameRoute(route, currentRoute))) {
        closeTab(currentRoute);
        return;
      }
      closeTab(currentRoute);
    };

    window.addEventListener('keydown', handleCloseTabShortcut);
    return () => window.removeEventListener('keydown', handleCloseTabShortcut);
  }, [closeTab, currentRoute, tabOrder.length]);

  useEffect(() => {
    const cancelTabDrag = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      tabDragRef.current = null;
      setDraggingTabKey(null);
      setIsDetaching(false);
    };
    window.addEventListener('keydown', cancelTabDrag);
    return () => window.removeEventListener('keydown', cancelTabDrag);
  }, []);

  useEffect(() => {
    const handleTabNavigation = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      if (event.key === 'Tab') {
        if (tabOrderRef.current.length < 2) return;
        event.preventDefault();
        event.stopPropagation();
        const activeIndex = currentRoute
          ? tabOrderRef.current.findIndex((route) => sameRoute(route, currentRoute))
          : 0;
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (activeIndex + direction + tabOrderRef.current.length) % tabOrderRef.current.length;
        selectTab(tabOrderRef.current[nextIndex]);
        return;
      }

      if (event.shiftKey) return;
      const digitMatch = /^Digit([1-9])$/.exec(event.code);
      const index = digitMatch ? Number.parseInt(digitMatch[1], 10) - 1 : -1;
      if (!Number.isInteger(index) || index < 0 || index >= tabOrderRef.current.length) return;

      event.preventDefault();
      event.stopPropagation();
      selectTab(tabOrderRef.current[index]);
    };

    window.addEventListener('keydown', handleTabNavigation);
    return () => window.removeEventListener('keydown', handleTabNavigation);
  }, [currentRoute]);

  if (tabOrder.length === 0) return null;

  const selectTab = (route: LedgerRoute) => {
    const key = routeKey(route);
    if (closedTabKeysRef.current.has(key)) {
      const next = new Set(closedTabKeysRef.current);
      next.delete(key);
      closedTabKeysRef.current = next;
      setClosedTabKeys(next);
    }
    setIsOverflowOpen(false);
    setVisualRouteOverride(route);
    void window.desktopWindow?.openModule?.(route.kind, route);
  };

  const openNewTab = () => {
    if (currentRoute && isNewTabRoute(currentRoute)) {
      selectTab(currentRoute);
      return;
    }
    const newTab = tabOrder.find((route) => isNewTabRoute(route));
    if (newTab) {
      selectTab(newTab);
      return;
    }
    const created = createNewTabRoute();
    const nextOrder = [...tabOrder, created];
    tabOrderRef.current = nextOrder;
    setTabOrder(nextOrder);
    setVisualRouteOverride(created);
    void window.desktopWindow?.openModule?.('new-tab', created);
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
            title={getTabTitle(route)}
            active={Boolean(visualCurrentRoute && sameRoute(visualCurrentRoute, route))}
            isDragging={draggingTabKey === routeKey(route)}
            onSelect={() => handleTabSelect(route)}
            onClose={() => closeTab(route)}
            onPointerDown={handleTabPointerDown(route)}
            onPointerMove={handleTabPointerMove}
            onPointerUp={finishTabDrag}
            onPointerCancel={handleTabPointerCancel}
          />
        ))}
        {!visualCurrentRoute || !isNewTabRoute(visualCurrentRoute) ? (
          <>
            <div
              aria-hidden="true"
              className="mx-1 h-4 shrink-0 self-center border-l border-[color:var(--ledger-border-strong)]"
            />
            <button
              type="button"
              onClick={openNewTab}
              className="flex h-6 w-6 shrink-0 -translate-y-px items-center justify-center text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
              aria-label="Open new tab"
              title="New tab"
            >
              <Plus size={14} />
            </button>
          </>
        ) : null}
      </div>

      {overflowTabs.length > 0 && (
        <div className="relative ml-1 shrink-0 self-end pb-0.5">
          <button
            type="button"
            onClick={() => setIsOverflowOpen((current) => !current)}
            className="flex h-6 min-w-8 items-center justify-center gap-0.5 rounded-md px-1.5 text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
            aria-label={`Open hidden tabs, ${overflowTabs.length} hidden tab${
              overflowTabs.length === 1 ? '' : 's'
            }`}
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
                    <span className="min-w-0 flex-1 truncate">{getTabTitle(route)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(route)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--ledger-text-muted)] opacity-0 group-hover/menu:opacity-100 focus-visible:opacity-100 hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    aria-label={`Close ${getTabTitle(route)} tab`}
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
            title={getTabTitle(route)}
            active={false}
            isDragging={false}
            onSelect={() => undefined}
            onClose={() => undefined}
          />
        ))}
      </div>
    </div>
  );
};
