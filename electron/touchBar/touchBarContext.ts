export type LedgerTouchBarPage =
  | 'notes'
  | 'projects'
  | 'calendar'
  | 'dashboard'
  | 'search'
  | 'settings'
  | 'other';

export type LedgerTouchBarSurface = 'list' | 'detail' | 'editor' | 'unknown';
export type LedgerTouchBarWindowContext = 'sidebar' | 'workspace' | 'module' | 'unknown';

export interface LedgerTouchBarMeetingContext {
  active: boolean;
  state: 'recording' | 'paused' | 'processing' | 'completed';
  eventId?: string;
  noteId?: string;
  workspaceId?: string;
  canPause?: boolean;
  canResume?: boolean;
  canStop?: boolean;
  transcriptAvailable?: boolean;
}

export interface LedgerTouchBarContext {
  page: LedgerTouchBarPage;
  surface: LedgerTouchBarSurface;
  authenticated: boolean;
  appReady: boolean;
  workspaceId?: string;
  resource?: { type: 'note' | 'project' | 'event' | 'task'; id: string };
  noteMode?: 'write' | 'mind-map' | 'transcribe';
  calendarView?: 'day' | 'week' | 'month';
  meeting?: LedgerTouchBarMeetingContext;
  windowContext: LedgerTouchBarWindowContext;
}

export const DEFAULT_TOUCH_BAR_CONTEXT: LedgerTouchBarContext = {
  page: 'other',
  surface: 'unknown',
  authenticated: false,
  appReady: false,
  windowContext: 'unknown',
};

const MAX_CONTEXT_STRING_LENGTH = 200;
const pages = new Set<LedgerTouchBarPage>([
  'notes',
  'projects',
  'calendar',
  'dashboard',
  'search',
  'settings',
  'other',
]);
const surfaces = new Set<LedgerTouchBarSurface>(['list', 'detail', 'editor', 'unknown']);
const windowContexts = new Set<LedgerTouchBarWindowContext>([
  'sidebar',
  'workspace',
  'module',
  'unknown',
]);
const resourceTypes = new Set(['note', 'project', 'event', 'task']);

const boundedString = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_CONTEXT_STRING_LENGTH ? trimmed : undefined;
};

export function normalizeLedgerTouchBarContext(value: unknown): LedgerTouchBarContext {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TOUCH_BAR_CONTEXT };
  const input = value as Record<string, unknown>;
  const page = pages.has(input.page as LedgerTouchBarPage)
    ? (input.page as LedgerTouchBarPage)
    : 'other';
  const surface = surfaces.has(input.surface as LedgerTouchBarSurface)
    ? (input.surface as LedgerTouchBarSurface)
    : 'unknown';
  const context: LedgerTouchBarContext = {
    page,
    surface,
    authenticated: input.authenticated === true,
    appReady: input.appReady === true,
    windowContext: windowContexts.has(input.windowContext as LedgerTouchBarWindowContext)
      ? (input.windowContext as LedgerTouchBarWindowContext)
      : 'unknown',
  };
  const workspaceId = boundedString(input.workspaceId);
  if (workspaceId) context.workspaceId = workspaceId;

  if (input.resource && typeof input.resource === 'object') {
    const resource = input.resource as Record<string, unknown>;
    const id = boundedString(resource.id);
    if (id && resourceTypes.has(resource.type as string)) {
      context.resource = { type: resource.type as 'note' | 'project' | 'event' | 'task', id };
    }
  }
  if (
    input.noteMode === 'write' ||
    input.noteMode === 'mind-map' ||
    input.noteMode === 'transcribe'
  )
    context.noteMode = input.noteMode;
  if (
    input.calendarView === 'day' ||
    input.calendarView === 'week' ||
    input.calendarView === 'month'
  )
    context.calendarView = input.calendarView;
  if (input.meeting && typeof input.meeting === 'object') {
    const meeting = input.meeting as Record<string, unknown>;
    if (typeof meeting.active === 'boolean') {
      if (typeof meeting.active === 'boolean') {
        const state = meeting.state === 'recording' || meeting.state === 'paused' || meeting.state === 'processing' || meeting.state === 'completed'
          ? meeting.state
          : meeting.active ? 'recording' : 'completed';
        context.meeting = { active: meeting.active, state };
        for (const key of ['eventId', 'noteId', 'workspaceId'] as const) {
          const value = boundedString(meeting[key]);
          if (value) context.meeting[key] = value;
        }
        for (const key of ['canPause', 'canResume', 'canStop', 'transcriptAvailable'] as const) {
          if (typeof meeting[key] === 'boolean') context.meeting[key] = meeting[key];
        }
      }
    }
  }
  return context;
}

export function touchBarContextsEqual(left: LedgerTouchBarContext, right: LedgerTouchBarContext) {
  return JSON.stringify(left) === JSON.stringify(right);
}
