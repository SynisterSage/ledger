import assert from 'node:assert/strict';
import { test } from 'node:test';

const { parseWebLocation } = await import('../../src/web/webRouteState.ts');

const parse = (path, search = '') => parseWebLocation({ pathname: path, search });

test('all Phase 6 primary module routes map to shared workspace pages', () => {
  const cases = [
    ['/app/w/ws/circle', 'circle'],
    ['/app/w/ws/calendar', 'calendar'],
    ['/app/w/ws/notes', 'notes'],
    ['/app/w/ws/notes/note-1', 'note'],
    ['/app/w/ws/projects', 'projects'],
    ['/app/w/ws/projects/project-1', 'project'],
    ['/app/w/ws/teams', 'teams'],
    ['/app/w/ws/teams/team-1', 'team'],
    ['/app/w/ws/inbox', 'inbox'],
    ['/app/w/ws/slack', 'slack'],
    ['/app/w/ws/notifications', 'notifications'],
    ['/app/w/ws/search', 'search'],
    ['/app/w/ws/settings/sidebar', 'settings'],
  ];
  for (const [pathname, page] of cases) assert.equal(parse(pathname).route.page, page, pathname);
  assert.equal(parse('/app/settings/account').kind, 'app-settings');
});

test('canonical module query state is parsed without desktop focus URLs', () => {
  assert.deepEqual(parse('/app/w/ws/notes/note-1', '?view=map').route.query, { view: 'map' });
  assert.deepEqual(parse('/app/w/ws/calendar', '?view=day&date=2026-08-06&event=event-1').route.query, { view: 'day', date: '2026-08-06', event: 'event-1', reminder: undefined });
  assert.deepEqual(parse('/app/w/ws/projects/project-1', '?task=task-1').route, { kind: 'workspace', workspaceId: 'ws', page: 'project', projectId: 'project-1', taskId: 'task-1' });
  assert.deepEqual(parse('/app/w/ws/inbox', '?item=item-1&section=converted').route.query, { item: 'item-1', section: 'converted' });
  assert.deepEqual(parse('/app/w/ws/search', '?q=next%20action').route.query, { q: 'next action' });
});

test('team-only routes remain identifiable for access checks', () => {
  assert.equal(parse('/app/w/ws/circle', '?person=person-1').route.query.person, 'person-1');
  assert.equal(parse('/app/w/ws/teams/team-1/settings').route.settings, true);
});

test('invalid IDs and legacy Electron URLs fail safely', () => {
  assert.equal(parse('/app/w/ws/notes').kind, 'route');
  assert.equal(parse('/app/w/ws/not-a-module').kind, 'unknown');
  assert.equal(parse('/app/w/%E0%A4%A/notes/%E0%A4%A').kind, 'unknown');
  assert.equal(parse('/app/w/ws/projects', '?window=module&module=projects').kind, 'route');
  assert.equal(parse('/desktop', '?window=module&module=projects').kind, 'unknown');
});
