import { useCallback, useEffect, useState } from 'react';
import type { LedgerRoute, LedgerOverlayRoute } from '../platform';

export type ParsedWebLocation =
  | { kind: 'route'; route: LedgerRoute }
  | { kind: 'app-root' }
  | { kind: 'app-page'; page: 'onboarding' | 'workspaces' }
  | { kind: 'app-settings'; section: 'account' | 'sessions' | 'accessibility' | 'shortcuts' | 'browser-extension' }
  | { kind: 'overlay'; route: LedgerOverlayRoute; backgroundPath?: string }
  | { kind: 'invite'; token: string }
  | { kind: 'workspace-root'; workspaceId: string }
  | { kind: 'unknown' };

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const parseWebLocation = (location: Pick<Location, 'pathname' | 'search'>, historyState?: unknown): ParsedWebLocation => {
  const pathname = location.pathname.replace(/\/$/, '') || '/';
  // The standalone browser deployment can be opened at its root hostname
  // before the public /app rewrite is connected. Treat it as the product
  // entry instead of rendering the route fallback.
  if (pathname === '/' || pathname === '/app' || pathname === '/login') return { kind: 'app-root' };
  const personalSettings = pathname.match(/^\/app\/settings\/([^/]+)$/);
  if (personalSettings && ['account', 'sessions', 'accessibility', 'shortcuts', 'browser-extension'].includes(personalSettings[1])) {
    return { kind: 'app-settings', section: personalSettings[1] as 'account' | 'sessions' | 'accessibility' | 'shortcuts' | 'browser-extension' };
  }
  const inviteMatch = pathname.match(/^\/invite\/([^/]+)$/);
  if (inviteMatch) {
    const token = safeDecode(inviteMatch[1]);
    return token ? { kind: 'invite', token } : { kind: 'unknown' };
  }
  if (pathname === '/app/onboarding') return { kind: 'app-page', page: 'onboarding' };
  if (pathname === '/app/workspaces') return { kind: 'app-page', page: 'workspaces' };
  const workspaceMatch = pathname.match(/^\/app\/w\/([^/]+)(?:\/(.*))?$/);
  if (!workspaceMatch) return { kind: 'unknown' };
  const workspaceId = safeDecode(workspaceMatch[1]);
  if (!workspaceId) return { kind: 'unknown' };
  const remainder = workspaceMatch[2] ?? '';
  if (!remainder) return { kind: 'workspace-root', workspaceId };
  const params = new URLSearchParams(location.search);
  const enumParam = <T extends string>(key: string, values: readonly T[]) => {
    const value = params.get(key);
    return value && values.includes(value as T) ? value as T : undefined;
  };
  const backgroundPath = typeof historyState === 'object' && historyState !== null && 'backgroundPath' in historyState && typeof historyState.backgroundPath === 'string'
    ? historyState.backgroundPath
    : undefined;
  const capture = remainder.match(/^capture\/(note|task|event|reminder)$/);
  if (capture) {
    return { kind: 'overlay', route: { kind: 'overlay', workspaceId, page: 'capture', action: capture[1] as 'note' | 'task' | 'event' | 'reminder', projectId: params.get('project') ?? undefined, date: params.get('date') ?? undefined, context: params.get('context') ?? undefined }, backgroundPath };
  }
  if (remainder === 'follow-up') {
    return { kind: 'overlay', route: { kind: 'overlay', workspaceId, page: 'follow-up', entityId: params.get('entity') ?? undefined }, backgroundPath };
  }
  switch (remainder) {
    case 'home': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'home' } };
    case 'dashboard': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'dashboard', query: { section: enumParam('section', ['today', 'assigned', 'focus', 'review']) as 'today' | 'assigned' | 'focus' | 'review' | undefined } } };
    case 'today': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'today' } };
    case 'circle': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'circle', query: { person: params.get('person') ?? undefined, context: params.get('context') ?? undefined } } };
    case 'calendar': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'calendar', query: { view: enumParam('view', ['month', 'week', 'day', 'agenda']) as 'month' | 'week' | 'day' | 'agenda' | undefined, date: params.get('date') ?? undefined, event: params.get('event') ?? undefined, reminder: params.get('reminder') ?? undefined } } };
    case 'notes': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'notes' } };
    case 'projects': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'projects' } };
    case 'teams': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'teams' } };
    case 'inbox': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'inbox', query: { item: params.get('item') ?? undefined, section: enumParam('section', ['unprocessed', 'converted', 'snoozed', 'archived']) as 'unprocessed' | 'converted' | 'snoozed' | 'archived' | undefined } } };
    case 'slack': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'slack', query: { capture: params.get('capture') ?? undefined } } };
    case 'notifications': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'notifications', query: { filter: enumParam('filter', ['active', 'earlier']) as 'active' | 'earlier' | undefined, item: params.get('item') ?? undefined } } };
    case 'search': return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'search', query: { q: params.get('q') ?? '' } } };
    default: {
      const note = remainder.match(/^notes\/([^/]+)$/);
      if (note) {
        const noteId = safeDecode(note[1]);
        return noteId ? { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'note', noteId, query: { view: enumParam('view', ['write', 'outline', 'map', 'transcribe']) as 'write' | 'outline' | 'map' | 'transcribe' | undefined } } } : { kind: 'unknown' };
      }
      const project = remainder.match(/^projects\/([^/]+)$/);
      if (project) {
        const projectId = safeDecode(project[1]);
        return projectId ? { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'project', projectId, taskId: params.get('task') ?? undefined } } : { kind: 'unknown' };
      }
      const task = remainder.match(/^tasks\/([^/]+)$/);
      if (task) {
        const taskId = safeDecode(task[1]);
        return taskId ? { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'task', taskId } } : { kind: 'unknown' };
      }
      const event = remainder.match(/^events\/([^/]+)$/);
      if (event) {
        const eventId = safeDecode(event[1]);
        return eventId ? { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'event', eventId } } : { kind: 'unknown' };
      }
      const team = remainder.match(/^teams\/([^/]+)(?:\/settings)?$/);
      if (team) {
        const teamId = safeDecode(team[1]);
        return teamId ? { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'team', teamId, settings: remainder.endsWith('/settings') } } : { kind: 'unknown' };
      }
      const settings = remainder.match(/^settings\/(workspace|members|calendar|notifications|sidebar|meeting-notes|integrations)(?:\/(google-drive|github|slack|figma))?$/);
      if (settings) {
        const section = settings[2] ?? settings[1];
        return { kind: 'route', route: { kind: 'workspace', workspaceId, page: 'settings', scope: 'workspace', section: section === 'meeting-notes' ? 'meeting-notes' : section as 'workspace' | 'members' | 'calendar' | 'notifications' | 'sidebar' | 'integrations' | 'google-drive' | 'github' | 'slack' | 'figma' } };
      }
      return { kind: 'unknown' };
    }
  }
};

export const useWebRouteState = () => {
  const [locationState, setLocationState] = useState<ParsedWebLocation>(() => parseWebLocation(window.location, window.history.state));
  const refresh = useCallback(() => setLocationState(parseWebLocation(window.location, window.history.state)), []);

  useEffect(() => {
    const handleIntent = (event: Event) => {
      const detail = (event as CustomEvent<{ route?: LedgerRoute | LedgerOverlayRoute }>).detail;
      if (detail?.route?.kind === 'overlay') setLocationState(parseWebLocation(window.location, window.history.state));
      else if (detail?.route) setLocationState({ kind: 'route', route: detail.route });
      else refresh();
    };
    window.addEventListener('ledger:route-intent', handleIntent);
    window.addEventListener('popstate', refresh);
    return () => {
      window.removeEventListener('ledger:route-intent', handleIntent);
      window.removeEventListener('popstate', refresh);
    };
  }, [refresh]);

  return locationState;
};
