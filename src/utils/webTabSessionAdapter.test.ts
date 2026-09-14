import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebTabSessionAdapter } from './webTabSessionAdapter.ts';
import type { TabRoute } from './tabSessionState.ts';

test('web adapter translates selection and navigation into URL writes', () => {
  const writes: Array<{ route: TabRoute; replace: boolean }> = [];
  const adapter = new WebTabSessionAdapter({
    storageKey: 'test-tabs',
    readRoute: () => ({ kind: 'new-tab' }),
    writeRoute: (route, replace) => writes.push({ route, replace }),
  }, 'workspace-1');
  adapter.controller.open({
    id: 'notes-tab',
    destinationKey: 'notes:1',
    route: { kind: 'notes', focusNoteId: '1' },
    title: 'Note',
  });
  adapter.navigate('notes-tab', { kind: 'notes', focusNoteId: '1', focusContext: 'outline' }, true);
  assert.equal(writes.at(-1)?.replace, true);
  assert.equal(writes.at(-1)?.route.focusContext, 'outline');
});

test('popstate replaces the active tab route without adding tab history', () => {
  const adapter = new WebTabSessionAdapter({
    storageKey: 'test-tabs-pop',
    readRoute: () => null,
    writeRoute: () => undefined,
  }, 'workspace-1');
  adapter.controller.open({ id: 'calendar', destinationKey: 'calendar', route: { kind: 'calendar' }, title: 'Calendar' });
  adapter.navigate('calendar', { kind: 'calendar', focusDate: '2026-09-13' });
  assert.equal(adapter.applyPopState({ kind: 'calendar' }), true);
  assert.equal(adapter.controller.getSnapshot().tabs[0].backStack.length, 1);
});
