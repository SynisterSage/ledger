import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

test('workspace starter migration marks projects, tasks, and notes idempotently', async () => {
  const migration = await read('migrations/134_workspace_starter_content.sql');

  for (const table of ['projects', 'tasks', 'notes']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*starter_key`));
    assert.match(migration, new RegExp(`idx_${table}_workspace_starter_key`));
  }
});

test('starter provisioning covers personal and team workspaces and keeps actions out of Today', async () => {
  const server = await read('backend/server.js');

  assert.match(server, /Start with Ledger/);
  assert.match(server, /Set up your team in Ledger/);
  assert.match(server, /show_in_today: false/);
  assert.match(server, /is_today_focus: false/);
  assert.match(server, /app\.post\('\/api\/workspaces\/:workspaceId\/starter-content'/);
  assert.match(server, /app\.delete\('\/api\/workspaces\/:workspaceId\/starter-content'/);
});

test('starter project UI exposes guided links, progress, hide, restore, and removal', async () => {
  const projects = await read('src/components/Projects/ProjectsWindow.tsx');

  for (const text of ['Getting started', 'Show it again', 'Remove', 'Calendar', 'Review', 'Members']) {
    assert.match(projects, new RegExp(text));
  }
  assert.match(projects, /openLegacyModule\(platform\.navigation/);
  assert.match(projects, /removeWorkspaceStarterContent/);
});
