import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TabSessionController } from './tabSessionController.ts';

const controller = () =>
  new TabSessionController({
    workspaceId: 'workspace-1',
    revision: 0,
    activeTabId: null,
    tabs: [],
  });

const tab = (id: string, destinationKey = id) => ({
  id,
  destinationKey,
  route: { kind: destinationKey },
  title: id,
});

test('controller serializes commands and publishes immutable snapshots', () => {
  const tabs = controller();
  const revisions: number[] = [];
  tabs.subscribe((state) => revisions.push(state.revision));
  const opened = tabs.open(tab('one'));
  assert.equal(opened.accepted, true);
  assert.equal(tabs.getSnapshot().activeTabId, 'one');
  assert.deepEqual(revisions, [1]);

  const snapshot = tabs.getSnapshot();
  snapshot.tabs[0].title = 'mutated outside controller';
  assert.equal(tabs.getSnapshot().tabs[0].title, 'one');
});

test('stale external command cannot overwrite a newer transition', () => {
  const tabs = controller();
  tabs.open(tab('one'));
  const stale = tabs.dispatch({
    type: 'close',
    tabId: 'one',
    expectedRevision: 0,
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale-revision');
  assert.equal(tabs.getSnapshot().tabs.length, 1);
});

test('duplicate destination opens select the existing tab without creating a second tab', () => {
  const tabs = controller();
  tabs.open(tab('first', 'notes:1'));
  tabs.open(tab('second', 'notes:2'));
  tabs.open(tab('new-id', 'notes:1'));
  const state = tabs.getSnapshot();
  assert.deepEqual(state.tabs.map((item) => item.id), ['first', 'second']);
  assert.equal(state.activeTabId, 'first');
});

test('listener errors do not mutate state after a committed command', () => {
  const tabs = controller();
  let calls = 0;
  tabs.subscribe(() => {
    calls += 1;
    throw new Error('listener failure');
  });
  tabs.open(tab('one'));
  assert.equal(calls, 1);
  assert.equal(tabs.getSnapshot().activeTabId, 'one');
});

test('serialized sessions restore with active tab and history intact', () => {
  const tabs = controller();
  tabs.open(tab('note', 'notes:1'));
  tabs.navigate('note', { kind: 'notes', focusNoteId: '1' });
  tabs.rename('note', 'Meeting notes');
  const restored = TabSessionController.restore(tabs.serialize());
  const snapshot = restored.getSnapshot();
  assert.equal(snapshot.activeTabId, 'note');
  assert.equal(snapshot.tabs[0].title, 'Meeting notes');
  assert.equal(snapshot.tabs[0].backStack.length, 1);
});
