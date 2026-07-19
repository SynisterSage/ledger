import { useEffect, useRef } from 'react';

type WorkspaceRoute = {
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};

const buildWorkspaceRouteKey = (route: WorkspaceRoute) =>
  [
    route.kind,
    route.focusDate ?? '',
    route.focusProjectId ?? '',
    route.focusNoteId ?? '',
    route.focusTaskId ?? '',
    route.focusContext ?? '',
    route.focusSection ?? '',
  ].join('|');

const buildWorkspaceRouteSearch = (route: WorkspaceRoute) => {
  const searchParams = new URLSearchParams();
  searchParams.set('window', 'module');
  searchParams.set('module', route.kind);
  if (route.focusDate) searchParams.set('focusDate', route.focusDate);
  if (route.focusProjectId) searchParams.set('focusProjectId', route.focusProjectId);
  if (route.focusNoteId) searchParams.set('focusNoteId', route.focusNoteId);
  if (route.focusTaskId) searchParams.set('focusTaskId', route.focusTaskId);
  if (route.focusContext) searchParams.set('focusContext', route.focusContext);
  if (route.focusSection) searchParams.set('section', route.focusSection);
  return searchParams.toString();
};

export const useWorkspaceRouteHistory = (route: WorkspaceRoute | null, enabled = true) => {
  const didMountRef = useRef(false);
  const lastRouteKeyRef = useRef('');
  const routeRef = useRef(route);
  const pendingExternalRouteKeyRef = useRef<string | null>(null);
  const activeModuleKindRef = useRef<ModuleWindowKind | null>(
    new URLSearchParams(window.location.search).get('module') as ModuleWindowKind | null
  );

  routeRef.current = route;

  useEffect(() => {
    const handleWorkspaceRouteChanged = (
      _event: unknown,
      nextRoute?: Partial<WorkspaceRoute> | null
    ) => {
      if (!nextRoute?.kind) return;
      activeModuleKindRef.current = nextRoute.kind;
    };

    const handleWorkspaceRouteRequested = (
      _event: unknown,
      nextRoute?: Partial<WorkspaceRoute> | null
    ) => {
      if (!nextRoute?.kind) return;
      activeModuleKindRef.current = nextRoute.kind;

      const currentRoute = routeRef.current;
      if (!currentRoute || currentRoute.kind !== nextRoute.kind) return;

      // A launcher/tab selection may omit focus fields to preserve the page's
      // current view. Only replace fields that were explicitly supplied.
      const mergedRoute: WorkspaceRoute = { ...currentRoute };
      for (const key of [
        'focusDate',
        'focusProjectId',
        'focusNoteId',
        'focusTaskId',
        'focusContext',
        'focusSection',
      ] as const) {
        if (nextRoute[key] != null) mergedRoute[key] = nextRoute[key];
      }
      pendingExternalRouteKeyRef.current = buildWorkspaceRouteKey(mergedRoute);
    };

    window.ipcRenderer?.on?.('workspace:route-changed', handleWorkspaceRouteChanged as any);
    window.ipcRenderer?.on?.('workspace:route-requested', handleWorkspaceRouteRequested as any);
    return () => {
      window.ipcRenderer?.off?.('workspace:route-changed', handleWorkspaceRouteChanged as any);
      window.ipcRenderer?.off?.('workspace:route-requested', handleWorkspaceRouteRequested as any);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !route?.kind) return;
    if (activeModuleKindRef.current && activeModuleKindRef.current !== route.kind) return;

    const nextKey = buildWorkspaceRouteKey(route);
    if (!didMountRef.current) {
      didMountRef.current = true;
      lastRouteKeyRef.current = nextKey;
      return;
    }

    // A route selected by another tab or by the native module launcher must
    // win over the kept-alive page's previous local state. The page may apply
    // the incoming focus shortly after this effect runs, so consume the first
    // mismatch without publishing it back as a new history entry.
    if (pendingExternalRouteKeyRef.current) {
      lastRouteKeyRef.current = pendingExternalRouteKeyRef.current;
      pendingExternalRouteKeyRef.current = null;
      return;
    }

    if (lastRouteKeyRef.current === nextKey) return;

    lastRouteKeyRef.current = nextKey;

    const nextSearch = buildWorkspaceRouteSearch(route);
    const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
    void window.desktopWindow?.updateWorkspaceRoute?.(route);
  }, [enabled, route?.kind, route?.focusContext, route?.focusDate, route?.focusNoteId, route?.focusProjectId, route?.focusSection, route?.focusTaskId]);
};
