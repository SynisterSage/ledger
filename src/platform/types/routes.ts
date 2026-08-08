export type LedgerModule =
  | 'new-tab'
  | 'circle'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'slack';
export type LedgerQuickModule = 'quick-follow-up' | 'quick-task' | 'quick-note' | 'quick-event' | 'quick-reminder';

export type NoteView = 'write' | 'outline' | 'map' | 'transcribe';
export type DashboardSection = 'today' | 'assigned' | 'focus' | 'review';
export type CalendarView = 'month' | 'week' | 'day' | 'agenda';
export type CaptureAction = 'note' | 'task' | 'event' | 'reminder';

export type DashboardQuery = { section?: DashboardSection };
export type CalendarQuery = {
  view?: CalendarView;
  date?: string;
  event?: string;
  reminder?: string;
};
export type NoteQuery = { view?: NoteView };
export type CircleQuery = { person?: string; context?: string };
export type InboxQuery = {
  item?: string;
  section?: 'unprocessed' | 'converted' | 'snoozed' | 'archived';
};
export type NotificationsQuery = {
  filter?: 'active' | 'unread' | 'earlier';
  item?: string;
};
export type SlackQuery = { capture?: string };
export type SearchQuery = { q: string };

export type LedgerWorkspaceRoute =
  | { kind: 'workspace'; workspaceId: string; page: 'home' }
  | { kind: 'workspace'; workspaceId: string; page: 'dashboard'; query?: DashboardQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'today' }
  | { kind: 'workspace'; workspaceId: string; page: 'circle'; query?: CircleQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'calendar'; query?: CalendarQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'notes'; query?: NoteQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'note'; noteId: string; query?: NoteQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'projects' }
  | { kind: 'workspace'; workspaceId: string; page: 'project'; projectId: string; taskId?: string }
  | { kind: 'workspace'; workspaceId: string; page: 'task'; taskId: string }
  | { kind: 'workspace'; workspaceId: string; page: 'event'; eventId: string }
  | { kind: 'workspace'; workspaceId: string; page: 'teams' }
  | { kind: 'workspace'; workspaceId: string; page: 'team'; teamId: string; settings?: boolean }
  | { kind: 'workspace'; workspaceId: string; page: 'inbox'; query?: InboxQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'slack'; query?: SlackQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'notifications'; query?: NotificationsQuery }
  | { kind: 'workspace'; workspaceId: string; page: 'search'; query: SearchQuery }
  | {
      kind: 'workspace';
      workspaceId: string;
      page: 'settings';
      scope: 'workspace';
      section:
        | 'workspace'
        | 'members'
        | 'calendar'
        | 'notifications'
        | 'sidebar'
        | 'meeting-notes'
        | 'integrations'
        | 'google-drive'
        | 'github'
        | 'slack'
        | 'figma';
    };

export type LedgerAppRoute =
  | { kind: 'app'; page: 'onboarding' | 'workspaces' }
  | { kind: 'app'; page: 'settings'; section: 'account' | 'sessions' | 'accessibility' | 'shortcuts' | 'browser-extension' };

export type LedgerRoute = LedgerAppRoute | LedgerWorkspaceRoute;

export type LedgerOverlayRoute =
  | { kind: 'overlay'; workspaceId: string; page: 'capture'; action: CaptureAction; projectId?: string; date?: string; context?: string }
  | { kind: 'overlay'; workspaceId: string; page: 'follow-up'; entityId?: string };

const addParam = (params: URLSearchParams, key: string, value: string | undefined) => {
  if (value) params.set(key, value);
};

export const serializeLedgerRoute = (route: LedgerRoute | LedgerOverlayRoute): string => {
  if (route.kind === 'app') return `/app/${route.page === 'settings' ? `settings/${route.section}` : route.page}`;

  const base = `/app/w/${encodeURIComponent(route.workspaceId)}`;
  if (route.kind === 'overlay') {
    const path = route.page === 'capture' ? `capture/${route.action}` : 'follow-up';
    const params = new URLSearchParams();
    addParam(params, 'project', route.page === 'capture' ? route.projectId : undefined);
    addParam(params, 'date', route.page === 'capture' ? route.date : undefined);
    addParam(params, 'context', route.page === 'capture' ? route.context : undefined);
    addParam(params, 'entity', route.page === 'follow-up' ? route.entityId : undefined);
    return `${base}/${path}${params.toString() ? `?${params}` : ''}`;
  }

  let path: string;
  const params = new URLSearchParams();
  switch (route.page) {
    case 'note': path = `notes/${encodeURIComponent(route.noteId)}`; addParam(params, 'view', route.query?.view); break;
    case 'project': path = `projects/${encodeURIComponent(route.projectId)}`; addParam(params, 'task', route.taskId); break;
    case 'task': path = `tasks/${encodeURIComponent(route.taskId)}`; break;
    case 'event': path = `events/${encodeURIComponent(route.eventId)}`; break;
    case 'team': path = `teams/${encodeURIComponent(route.teamId)}${route.settings ? '/settings' : ''}`; break;
    case 'settings': path = `settings/${route.scope}/${route.section}`; break;
    case 'dashboard': path = 'dashboard'; addParam(params, 'section', route.query?.section); break;
    case 'today': path = 'today'; break;
    case 'calendar': path = 'calendar'; Object.entries(route.query ?? {}).forEach(([key, value]) => addParam(params, key, value)); break;
    case 'circle': path = 'circle'; Object.entries(route.query ?? {}).forEach(([key, value]) => addParam(params, key, value)); break;
    case 'inbox': path = 'inbox'; Object.entries(route.query ?? {}).forEach(([key, value]) => addParam(params, key, value)); break;
    case 'notifications': path = 'notifications'; Object.entries(route.query ?? {}).forEach(([key, value]) => addParam(params, key, value)); break;
    case 'slack': path = 'slack'; addParam(params, 'capture', route.query?.capture); break;
    case 'search': path = 'search'; addParam(params, 'q', route.query.q); break;
    default: path = route.page;
  }
  return `${base}/${path}${params.toString() ? `?${params}` : ''}`;
};
