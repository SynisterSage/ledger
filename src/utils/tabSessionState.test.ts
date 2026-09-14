import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceTabSession, type TabSession, type TabSessionState } from './tabSessionState.ts';

const tab = (id: string, destinationKey = id): TabSession => ({
  id,
  destinationKey,
  route: { kind: destinationKey },
  title: id,
  backStack: [],
  forwardStack: [],
});

const initial = (): TabSessionState => ({
  workspaceId: 'workspace-1',
  revision: 0,
  activeTabId: null,
  tabs: [],
});

test('open selects a destination and duplicate opens select the existing tab', () => {
  let state = initial();
  state = reduceTabSession(state, { type: 'open', tab: tab('note-tab', 'notes:note-1') }).state;
  const result = reduceTabSession(state, {
    type: 'open',
    tab: tab('new-tab-id', 'notes:note-1'),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.tabs.length, 1);
  assert.equal(result.state.activeTabId, 'note-tab');
});

test('navigation history belongs to the tab and stale commands are rejected', () => {
  let state = reduceTabSession(initial(), {
    type: 'open',
    tab: tab('calendar-tab', 'calendar'),
  }).state;
  state = reduceTabSession(state, {
    type: 'navigate',
    tabId: 'calendar-tab',
    route: { kind: 'calendar', focusDate: '2026-09-13' },
    expectedRevision: state.revision,
  }).state;
  assert.deepEqual(state.tabs[0].backStack, [{ kind: 'calendar' }]);
  const stale = reduceTabSession(state, {
    type: 'close',
    tabId: 'calendar-tab',
    expectedRevision: state.revision - 1,
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale-revision');
  assert.equal(stale.state, state);
});

test('closing an inactive tab preserves the active tab and is idempotently rejectable', () => {
  let state = initial();
  state = reduceTabSession(state, { type: 'open', tab: tab('one') }).state;
  state = reduceTabSession(state, { type: 'open', tab: tab('two') }).state;
  state = reduceTabSession(state, { type: 'select', tabId: 'two' }).state;
  state = reduceTabSession(state, { type: 'close', tabId: 'one' }).state;
  assert.deepEqual(state.tabs.map((item) => item.id), ['two']);
  assert.equal(state.activeTabId, 'two');
  const secondClose = reduceTabSession(state, { type: 'close', tabId: 'one' });
  assert.equal(secondClose.accepted, false);
  assert.equal(secondClose.reason, 'missing-tab');
});

test('reorder changes order without changing active identity', () => {
  let state = initial();
  for (const id of ['one', 'two', 'three']) {
    state = reduceTabSession(state, { type: 'open', tab: tab(id) }).state;
  }
  state = reduceTabSession(state, { type: 'select', tabId: 'two' }).state;
  state = reduceTabSession(state, { type: 'reorder', tabId: 'two', toIndex: 0 }).state;
  assert.deepEqual(state.tabs.map((item) => item.id), ['two', 'one', 'three']);
  assert.equal(state.activeTabId, 'two');
});

test('back and forward stay inside the selected tab', () => {
  let state = reduceTabSession(initial(), { type: 'open', tab: tab('one') }).state;
  state = reduceTabSession(state, { type: 'navigate', tabId: 'one', route: { kind: 'one', focusContext: 'detail' } }).state;
  state = reduceTabSession(state, { type: 'back', tabId: 'one' }).state;
  assert.equal(state.tabs[0].route.focusContext ?? null, null);
  state = reduceTabSession(state, { type: 'forward', tabId: 'one' }).state;
  assert.equal(state.tabs[0].route.focusContext, 'detail');
});

test('tab titles and complete per-tab history survive serialization', () => {
  let state = reduceTabSession(initial(), { type: 'open', tab: tab('note', 'notes:1') }).state;
  state = reduceTabSession(state, { type: 'navigate', tabId: 'note', route: { kind: 'notes', focusNoteId: '1' } }).state;
  state = reduceTabSession(state, { type: 'rename', tabId: 'note', title: 'Meeting notes' }).state;
  assert.equal(state.tabs[0].title, 'Meeting notes');
  assert.equal(state.tabs[0].backStack.length, 1);
  assert.equal(state.tabs[0].backStack[0].kind, 'notes:1');
});
