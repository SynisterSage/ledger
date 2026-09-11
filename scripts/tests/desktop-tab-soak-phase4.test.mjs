import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const { touchKeepAliveModules } = await import('../../src/utils/keepAliveModules.ts');
const { isStaleNavigationGeneration } = await import('../../src/utils/navigationGeneration.ts');
const { workspaceTabRouteKey } = await import('../../src/utils/workspaceTabIdentity.ts');

const routeKey = (route) =>
  route.kind === 'notes'
    ? `notes|${route.noteId ?? 'home'}`
    : route.kind === 'projects'
    ? `projects|${route.projectId ?? 'home'}`
    : route.kind;

test('persisted tab state is workspace-scoped', () => {
  const source = fs.readFileSync(new URL('../../src/components/Common/LedgerTabStrip.tsx', import.meta.url), 'utf8');
  assert.match(source, /TAB_SESSION_STORAGE_KEY_PREFIX = 'ledger:window-tabs:v2'/);
  assert.match(source, /getTabStorageKey\(activeWorkspaceId\)/);
  assert.match(source, /hydratedTabStorageKeyRef\.current !== tabStorageKey/);
  assert.match(source, /routeTransitionIdRef\.current !== transitionId/);
  assert.match(source, /ledger:tab-detach-requested/);
});

test('tab identity ignores view state but separates resources', () => {
  assert.equal(workspaceTabRouteKey({ kind: 'calendar', focusDate: '2026-09-11' }), 'calendar');
  assert.equal(workspaceTabRouteKey({ kind: 'calendar', focusDate: '2026-09-12' }), 'calendar');
  assert.equal(
    workspaceTabRouteKey({ kind: 'notes', focusNoteId: 'note-1', focusSection: 'outline' }),
    'notes|note|note-1'
  );
  assert.notEqual(
    workspaceTabRouteKey({ kind: 'notes', focusNoteId: 'note-1' }),
    workspaceTabRouteKey({ kind: 'notes', focusNoteId: 'note-2' })
  );
});

test('detached transfers clean up their lifecycle timer', () => {
  const source = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  assert.match(source, /pendingTransfer\.timeout = setTimeout/);
  assert.match(source, /if \(pending\.timeout\) clearTimeout\(pending\.timeout\)/);
});

test('desktop tab/view soak keeps route identity, generations, and keep-alive bounded', () => {
  const routes = Array.from({ length: 250 }, (_, index) =>
    index % 2 === 0
      ? { kind: 'notes', noteId: `note-${index}` }
      : { kind: 'projects', projectId: `project-${index}` }
  );
  let tabOrder = [];
  let keepAlive = [];
  let latestGeneration = 0;
  let staleRejected = 0;

  for (let index = 0; index < 2_000; index += 1) {
    const route = routes[(index * 37) % routes.length];
    const key = routeKey(route);
    tabOrder = [...tabOrder.filter((candidate) => routeKey(candidate) !== key), route];
    keepAlive = touchKeepAliveModules(keepAlive, route.kind);

    const generation = index + 1;
    latestGeneration = generation;
    for (const delayedGeneration of [generation - 2, generation, generation - 1]) {
      if (isStaleNavigationGeneration(delayedGeneration, latestGeneration)) staleRejected += 1;
    }

    assert.equal(new Set(tabOrder.map(routeKey)).size, tabOrder.length);
    assert.ok(keepAlive.length <= 3);
    assert.equal(routeKey(tabOrder.at(-1)), key);
  }

  assert.equal(tabOrder.length, routes.length);
  assert.equal(keepAlive.length, 2);
  assert.equal(staleRejected, 4_000);
});

test('closing and reopening a resource does not duplicate its tab identity', () => {
  const note = { kind: 'notes', noteId: 'note-reopen' };
  let tabOrder = [note, { kind: 'projects', projectId: 'project-1' }];
  tabOrder = tabOrder.filter((route) => routeKey(route) !== routeKey(note));
  tabOrder = [...tabOrder, note, note];
  const deduped = tabOrder.filter(
    (route, index, all) =>
      all.findIndex((candidate) => routeKey(candidate) === routeKey(route)) === index
  );
  assert.deepEqual(deduped.map(routeKey), ['projects|project-1', 'notes|note-reopen']);
});
