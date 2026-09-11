import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalAskLedgerSessionStore } from './localAskLedgerSessionStore.ts';

const session = (id: string, userId = 'user-1', workspaceId = 'workspace-1') => ({
  id, userId, workspaceId, title: 'Private chat', createdAt: '2026-09-10T10:00:00.000Z', updatedAt: '2026-09-10T10:01:00.000Z', messages: [{ role: 'user', content: 'local file' }], privacyScope: 'device' as const,
});

test('local Ask sessions are scoped to the account and workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-local-ask-'));
  const store = new LocalAskLedgerSessionStore(root);
  await store.save(session('one'));
  assert.equal((await store.list('user-1', 'workspace-1')).length, 1);
  assert.equal((await store.list('user-2', 'workspace-1')).length, 0);
  assert.equal(await store.get('one', 'user-1', 'workspace-2'), null);
  await fs.rm(root, { recursive: true, force: true });
});

test('local Ask sessions can be updated and removed without a cloud dependency', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-local-ask-'));
  const store = new LocalAskLedgerSessionStore(root);
  await store.save(session('one'));
  await store.save({ ...session('one'), title: 'Updated', updatedAt: '2026-09-10T10:02:00.000Z' });
  assert.equal((await store.get('one', 'user-1', 'workspace-1'))?.title, 'Updated');
  assert.equal(await store.remove('one', 'user-1', 'workspace-1'), true);
  assert.equal((await store.list('user-1', 'workspace-1')).length, 0);
  await fs.rm(root, { recursive: true, force: true });
});
