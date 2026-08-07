import type { LedgerWorkspaceRoute, NoteView, CalendarView, DashboardSection } from './types/routes';

export type NotificationTarget =
  | { type: 'note'; id: string; view?: NoteView }
  | { type: 'project'; id: string; taskId?: string }
  | { type: 'task'; id: string }
  | { type: 'event'; id: string }
  | { type: 'reminder'; id: string }
  | { type: 'inbox'; id: string }
  | { type: 'team'; id: string }
  | { type: 'person'; id: string };

export const routeForHome = (workspaceId: string): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'home' });
export const routeForDashboard = (workspaceId: string, section?: DashboardSection): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'dashboard', query: section ? { section } : undefined });
export const routeForNote = (workspaceId: string, noteId?: string, view?: NoteView): LedgerWorkspaceRoute => noteId
  ? { kind: 'workspace', workspaceId, page: 'note', noteId, query: view ? { view } : undefined }
  : { kind: 'workspace', workspaceId, page: 'notes' };
export const routeForProject = (workspaceId: string, projectId?: string, taskId?: string): LedgerWorkspaceRoute => projectId
  ? { kind: 'workspace', workspaceId, page: 'project', projectId, taskId }
  : { kind: 'workspace', workspaceId, page: 'projects' };
export const routeForTask = (workspaceId: string, taskId: string): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'task', taskId });
export const routeForCalendar = (workspaceId: string, query: { view?: CalendarView; date?: string; event?: string; reminder?: string } = {}): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'calendar', query });
export const routeForCalendarEvent = (workspaceId: string, eventId: string, date?: string): LedgerWorkspaceRoute => routeForCalendar(workspaceId, { event: eventId, date });
export const routeForCalendarReminder = (workspaceId: string, reminderId: string, date?: string): LedgerWorkspaceRoute => routeForCalendar(workspaceId, { reminder: reminderId, date });
export const routeForCircle = (workspaceId: string, personId?: string, contextId?: string): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'circle', query: { person: personId, context: contextId } });
export const routeForTeam = (workspaceId: string, teamId?: string, settings = false): LedgerWorkspaceRoute => teamId
  ? { kind: 'workspace', workspaceId, page: 'team', teamId, settings }
  : { kind: 'workspace', workspaceId, page: 'teams' };
export const routeForInboxItem = (workspaceId: string, itemId?: string, section?: 'unprocessed' | 'converted' | 'snoozed' | 'archived'): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'inbox', query: { item: itemId, section } });
export const routeForSlackCapture = (workspaceId: string, captureId?: string): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'slack', query: { capture: captureId } });
export const routeForNotification = (workspaceId: string, itemId?: string, filter?: 'active' | 'earlier'): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'notifications', query: { item: itemId, filter } });
export const routeForSearch = (workspaceId: string, query: string): LedgerWorkspaceRoute => ({ kind: 'workspace', workspaceId, page: 'search', query: { q: query } });
export const routeForNotificationTarget = (workspaceId: string, target: NotificationTarget): LedgerWorkspaceRoute => {
  switch (target.type) {
    case 'note': return routeForNote(workspaceId, target.id, target.view);
    case 'project': return routeForProject(workspaceId, target.id, target.taskId);
    case 'task': return routeForTask(workspaceId, target.id);
    case 'event': return routeForCalendarEvent(workspaceId, target.id);
    case 'reminder': return routeForCalendarReminder(workspaceId, target.id);
    case 'inbox': return routeForInboxItem(workspaceId, target.id);
    case 'team': return routeForTeam(workspaceId, target.id);
    case 'person': return routeForCircle(workspaceId, target.id);
  }
};

export const routeForLegacyWorkspaceState = (workspaceId: string, route: {
  kind: string;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusInboxId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
}): LedgerWorkspaceRoute => {
  switch (route.kind) {
    case 'dashboard': return routeForDashboard(workspaceId, route.focusSection as DashboardSection | undefined);
    case 'circle': {
      const context = route.focusContext ?? '';
      const person = context.startsWith('ledger-person|') ? context.split('|')[1] : undefined;
      return routeForCircle(workspaceId, person, person ? undefined : context || undefined);
    }
    case 'calendar': return routeForCalendar(workspaceId, { view: route.focusSection as CalendarView | undefined, date: route.focusDate ?? undefined, event: route.focusContext?.startsWith('focus-event:') ? route.focusContext.slice('focus-event:'.length) : undefined, reminder: route.focusContext?.startsWith('focus-reminder:') ? route.focusContext.slice('focus-reminder:'.length) : undefined });
    case 'notes': return routeForNote(workspaceId, route.focusNoteId ?? undefined, route.focusContext?.startsWith('note-view:') ? route.focusContext.slice('note-view:'.length) as NoteView : undefined);
    case 'projects': return routeForProject(workspaceId, route.focusProjectId ?? undefined, route.focusTaskId ?? undefined);
    case 'teams': return route.focusContext?.startsWith('team:') ? routeForTeam(workspaceId, route.focusContext.slice('team:'.length)) : routeForTeam(workspaceId);
    case 'inbox': return routeForInboxItem(workspaceId, route.focusInboxId ?? (route.focusContext?.startsWith('inbox:') ? route.focusContext.slice('inbox:'.length) : undefined), route.focusSection as 'unprocessed' | 'converted' | 'snoozed' | 'archived' | undefined);
    case 'notifications': return routeForNotification(workspaceId, route.focusContext ?? undefined, route.focusSection as 'active' | 'earlier' | undefined);
    case 'slack': return routeForSlackCapture(workspaceId, route.focusContext ?? undefined);
    case 'settings': {
      type WorkspaceSettingsSection = Extract<LedgerWorkspaceRoute, { page: 'settings' }>['section'];
      const section = route.focusSection as WorkspaceSettingsSection;
      const validSections: WorkspaceSettingsSection[] = [
        'workspace',
        'members',
        'calendar',
        'notifications',
        'sidebar',
        'meeting-notes',
        'integrations',
        'google-drive',
        'github',
        'slack',
        'figma',
      ];
      return {
        kind: 'workspace',
        workspaceId,
        page: 'settings',
        scope: 'workspace',
        section: validSections.includes(section) ? section : 'workspace',
      };
    }
    default: return routeForHome(workspaceId);
  }
};
