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

  useEffect(() => {
    if (!enabled || !route?.kind) return;

    const nextKey = buildWorkspaceRouteKey(route);
    if (!didMountRef.current) {
      didMountRef.current = true;
      lastRouteKeyRef.current = nextKey;
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
