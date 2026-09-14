import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TabSessionController } from './tabSessionController.ts';

test('long mixed command soak preserves tab invariants under stale revisions', () => {
  const controller = new TabSessionController({
    workspaceId: 'soak-workspace',
    revision: 0,
    activeTabId: null,
    tabs: [],
  });
  for (let index = 0; index < 5000; index += 1) {
    const id = `tab-${index % 40}`;
    const destinationKey = `notes:${index % 40}`;
    if (index % 5 === 0) {
      controller.open({ id, destinationKey, route: { kind: 'notes', focusNoteId: String(index % 40) }, title: id });
    } else if (index % 5 === 1) {
      controller.navigate(id, { kind: 'notes', focusNoteId: String(index % 40), focusContext: `view:${index % 3}` });
    } else if (index % 5 === 2) {
      controller.rename(id, `Note ${index % 40}`);
    } else if (index % 5 === 3) {
      controller.select(id);
    } else {
      const revision = controller.getSnapshot().revision;
      controller.dispatch({ type: 'select', tabId: id, expectedRevision: revision - 1 });
    }

    const snapshot = controller.getSnapshot();
    assert.equal(new Set(snapshot.tabs.map((tab) => tab.id)).size, snapshot.tabs.length);
    assert.equal(new Set(snapshot.tabs.map((tab) => tab.destinationKey)).size, snapshot.tabs.length);
    assert.ok(snapshot.activeTabId === null || snapshot.tabs.some((tab) => tab.id === snapshot.activeTabId));
  }
});

