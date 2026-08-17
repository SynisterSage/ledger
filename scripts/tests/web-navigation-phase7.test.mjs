import assert from 'node:assert/strict';
import { test } from 'node:test';

const routes = await import('../../src/platform/routes.ts');
const { serializeLedgerRoute } = await import('../../src/platform/types/routes.ts');
const { parseWebLocation } = await import('../../src/web/webRouteState.ts');

test('canonical resource route helpers serialize durable URLs', () => {
  assert.equal(serializeLedgerRoute(routes.routeForNote('ws', 'note-1', 'map')), '/app/w/ws/notes/note-1?view=map');
  assert.equal(serializeLedgerRoute(routes.routeForProject('ws', 'project-1', 'task-1')), '/app/w/ws/projects/project-1?task=task-1');
  assert.equal(serializeLedgerRoute(routes.routeForTask('ws', 'task-1')), '/app/w/ws/tasks/task-1');
  assert.equal(serializeLedgerRoute(routes.routeForCalendarEvent('ws', 'event-1')), '/app/w/ws/calendar?event=event-1');
  assert.equal(serializeLedgerRoute(routes.routeForCalendarReminder('ws', 'reminder-1', '2026-08-16')), '/app/w/ws/calendar?reminder=reminder-1&date=2026-08-16');
  assert.equal(serializeLedgerRoute(routes.routeForInboxItem('ws', 'item-1')), '/app/w/ws/inbox?item=item-1');
  assert.equal(serializeLedgerRoute(routes.routeForWorkspaceSettings('ws', 'integrations')), '/app/w/ws/settings/workspace/integrations');
});

test('notification targets resolve to canonical resource routes', () => {
  assert.deepEqual(routes.routeForNotificationTarget('ws', { type: 'project', id: 'p', taskId: 't' }), routes.routeForProject('ws', 'p', 't'));
  assert.deepEqual(routes.routeForNotificationTarget('ws', { type: 'event', id: 'e' }), routes.routeForCalendarEvent('ws', 'e'));
  assert.deepEqual(routes.routeForNotificationTarget('ws', { type: 'task', id: 't' }), routes.routeForTask('ws', 't'));
  assert.deepEqual(routes.routeForNotificationTarget('ws', { type: 'inbox', id: 'i' }), routes.routeForInboxItem('ws', 'i'));
});

test('task and event deep links restore typed focus routes', () => {
  assert.deepEqual(parseWebLocation({ pathname: '/app/w/ws/tasks/task-1', search: '' }).route, { kind: 'workspace', workspaceId: 'ws', page: 'task', taskId: 'task-1' });
  assert.deepEqual(parseWebLocation({ pathname: '/app/w/ws/events/event-1', search: '' }).route, { kind: 'workspace', workspaceId: 'ws', page: 'event', eventId: 'event-1' });
});

test('legacy web focus state converts without Electron URL parameters', () => {
  const route = routes.routeForLegacyWorkspaceState('ws', { kind: 'calendar', focusContext: 'focus-event:event-1', focusDate: '2026-08-06' });
  assert.equal(serializeLedgerRoute(route), '/app/w/ws/calendar?date=2026-08-06&event=event-1');
  assert.equal(serializeLedgerRoute(routes.routeForLegacyWorkspaceState('ws', { kind: 'notes', focusNoteId: 'n1' })), '/app/w/ws/notes/n1');
});

test('web synchronization has explicit equality/replace guards', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../../src/hooks/useWorkspaceRouteHistory.ts', import.meta.url), 'utf8');
  assert.match(source, /lastRouteKeyRef\.current === nextKey/);
  assert.match(source, /platform\.kind === 'web'/);
  assert.match(source, /replace/);
});
