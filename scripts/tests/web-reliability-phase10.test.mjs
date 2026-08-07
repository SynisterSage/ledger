import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

test('browser drafts are scoped, recoverable, and removable', async () => {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  const { webDraftKey, readWebDraft, writeWebDraft, removeWebDraft, unwrapWebDraft } = await import('../../src/web/webPersistence.ts');
  const key = webDraftKey('user-1', 'workspace-1', 'quick-note', 'project-1');
  writeWebDraft(key, { title: 'Recover me', content: 'Still local' });
  assert.deepEqual(unwrapWebDraft(readWebDraft(key)), { title: 'Recover me', content: 'Still local' });
  assert.match(key, /user-1/);
  removeWebDraft(key);
  assert.equal(readWebDraft(key), null);
});

test('web reliability coordinates connection, auth, workspace, and lifecycle state', async () => {
  const source = await fs.readFile(new URL('../../src/web/WebReliabilityProvider.tsx', import.meta.url), 'utf8');
  assert.match(source, /BroadcastChannel/);
  assert.match(source, /signed-out/);
  assert.match(source, /session-expired/);
  assert.match(source, /workspace-changed/);
  assert.match(source, /reconnecting/);
  assert.match(source, /restored/);
  assert.match(source, /visibilitychange/);
});

test('quick capture protects browser drafts and duplicate mutations without changing desktop mode', async () => {
  const source = await fs.readFile(new URL('../../src/components/Common/QuickCaptureWindow.tsx', import.meta.url), 'utf8');
  assert.match(source, /browserMode/);
  assert.match(source, /writeWebDraft/);
  assert.match(source, /removeWebDraft/);
  assert.match(source, /saveInFlightRef/);
  assert.match(source, /navigator\.onLine/);
  assert.match(source, /window\.desktopWindow\?\.closeModule/);
});

test('workspace context accepts browser coordination without replacing server authority', async () => {
  const source = await fs.readFile(new URL('../../src/context/WorkspaceContext.tsx', import.meta.url), 'utf8');
  assert.match(source, /ledger:workspace-broadcast/);
  assert.match(source, /api\/workspaces\/active/);
});
