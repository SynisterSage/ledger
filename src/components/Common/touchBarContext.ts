import type {
  LedgerTouchBarContext,
  LedgerTouchBarWindowContext,
} from '../../../electron/touchBar/touchBarContext.ts';

export interface TouchBarRouteSnapshot {
  kind?: string | null;
  focusNoteId?: string | null;
  focusProjectId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
}

export interface TouchBarContextResolverInput {
  route: TouchBarRouteSnapshot;
  workspaceId?: string | null;
  authenticated: boolean;
  appReady: boolean;
  windowContext: LedgerTouchBarWindowContext;
}

const noteModeFromContext = (focusContext?: string | null): LedgerTouchBarContext['noteMode'] => {
  const value = focusContext?.match(/^note-view:(write|outline|map|transcribe)$/)?.[1];
  if (value === 'outline' || value === 'map') return 'mind-map';
  if (value === 'write' || value === 'transcribe') return value;
  return undefined;
};

const eventIdFromContext = (focusContext?: string | null) =>
  focusContext?.match(/^focus-event:(.+)$/)?.[1]?.trim() || undefined;

export function resolveTouchBarContext(input: TouchBarContextResolverInput): LedgerTouchBarContext {
  const route = input.route;
  const base: LedgerTouchBarContext = {
    page: 'other',
    surface: 'unknown',
    authenticated: input.authenticated,
    appReady: input.appReady,
    windowContext: input.windowContext,
  };
  if (input.workspaceId?.trim()) base.workspaceId = input.workspaceId.trim();

  if (route.kind === 'notes') {
    base.page = 'notes';
    base.surface = route.focusNoteId ? 'editor' : 'list';
    if (route.focusNoteId) base.resource = { type: 'note', id: route.focusNoteId };
    const noteMode = noteModeFromContext(route.focusContext);
    if (noteMode) base.noteMode = noteMode;
  } else if (route.kind === 'projects') {
    base.page = 'projects';
    base.surface = route.focusProjectId ? 'detail' : 'list';
    if (route.focusProjectId) base.resource = { type: 'project', id: route.focusProjectId };
  } else if (route.kind === 'calendar') {
    base.page = 'calendar';
    base.surface = eventIdFromContext(route.focusContext) ? 'detail' : 'list';
    const eventId = eventIdFromContext(route.focusContext);
    if (eventId) base.resource = { type: 'event', id: eventId };
    if (
      route.focusSection === 'day' ||
      route.focusSection === 'week' ||
      route.focusSection === 'month'
    ) {
      base.calendarView = route.focusSection;
    }
  } else if (route.kind === 'dashboard') {
    base.page = 'dashboard';
    base.surface = 'list';
  } else if (route.kind === 'search') {
    base.page = 'search';
    base.surface = 'list';
  } else if (route.kind === 'settings') {
    base.page = 'settings';
    base.surface = 'list';
  }
  return base;
}
