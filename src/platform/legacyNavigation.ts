import type { NavigationPort } from './types/capabilities';
import type { LedgerWorkspaceRoute } from './types/routes';
import { routeForCalendar, routeForCircle, routeForDashboard, routeForInboxItem, routeForNote, routeForNotification, routeForProject, routeForTeam } from './routes';

export type LegacyModuleKind =
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
  | 'slack'
  | 'quick-follow-up'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event'
  | 'quick-reminder';

export type LegacyModuleFocus = {
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusInboxId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};

export const openLegacyModule = (
  navigation: NavigationPort,
  workspaceId: string | null | undefined,
  kind: LegacyModuleKind,
  focus: LegacyModuleFocus = {}
) => {
  if (!workspaceId) return;
  const base = { kind: 'workspace' as const, workspaceId };

  if (kind === 'quick-follow-up') {
    navigation.openOverlay({ kind: 'overlay', workspaceId, page: 'follow-up', entityId: focus.focusContext ?? undefined });
    return;
  }
  if (kind === 'quick-note' || kind === 'quick-task' || kind === 'quick-event' || kind === 'quick-reminder') {
    navigation.openOverlay({
      kind: 'overlay',
      workspaceId,
      page: 'capture',
      action: kind.slice('quick-'.length) as 'note' | 'task' | 'event' | 'reminder',
      projectId: focus.focusProjectId ?? undefined,
      date: focus.focusDate ?? undefined,
    });
    return;
  }

  let route: LedgerWorkspaceRoute;
  switch (kind) {
    case 'new-tab': route = { ...base, page: 'home' }; break;
    case 'dashboard': route = routeForDashboard(workspaceId, focus.focusSection as 'today' | 'assigned' | 'focus' | 'review' | undefined); break;
    case 'circle': route = routeForCircle(workspaceId, undefined, focus.focusContext ?? undefined); break;
    case 'calendar': route = routeForCalendar(workspaceId, { date: focus.focusDate ?? undefined, event: focus.focusContext?.startsWith('focus-event:') ? focus.focusContext.slice(12) : undefined, reminder: focus.focusContext?.startsWith('focus-reminder:') ? focus.focusContext.slice(15) : undefined }); break;
    case 'notes': route = routeForNote(workspaceId, focus.focusNoteId ?? undefined); break;
    case 'projects': route = routeForProject(workspaceId, focus.focusProjectId ?? undefined, focus.focusTaskId ?? undefined); break;
    case 'teams': route = focus.focusContext?.startsWith('team:') ? routeForTeam(workspaceId, focus.focusContext.slice(5)) : routeForTeam(workspaceId); break;
    case 'inbox': route = routeForInboxItem(workspaceId, focus.focusInboxId ?? undefined, focus.focusSection as 'unprocessed' | 'converted' | 'snoozed' | 'archived' | undefined); break;
    case 'slack': route = { ...base, page: 'slack' }; break;
    case 'notifications': route = routeForNotification(workspaceId, focus.focusContext ?? undefined, focus.focusSection as 'active' | 'unread' | 'earlier' | undefined); break;
    case 'settings': route = { ...base, page: 'settings', scope: 'workspace', section: focus.focusContext === 'integrations' ? 'integrations' : focus.focusContext === 'shortcuts' ? 'sidebar' : 'workspace' }; break;
  }
  navigation.openRoute(route);
};
