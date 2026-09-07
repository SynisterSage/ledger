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
  assert.match(server, /Example: First weekly review/);
  assert.match(server, /Example: Weekly Ledger review/);
  assert.match(server, /syncWorkspaceStarterProjectProgress/);
  assert.match(server, /app\.post\('\/api\/workspaces\/:workspaceId\/starter-content'/);
  assert.match(server, /app\.delete\('\/api\/workspaces\/:workspaceId\/starter-content'/);
});

test('starter project UI exposes guided links, progress, hide, restore, and removal', async () => {
  const projects = await read('src/components/Projects/ProjectsWindow.tsx');
  const quickCapture = await read('src/components/Common/QuickCaptureWindow.tsx');
  const sidebar = await read('src/components/Sidebar/ExpandedSidebar.tsx');
  const handoff = await read('src/utils/starterOnboarding.ts');
  const app = await read('src/App.tsx');

  for (const text of ['Getting started', 'Remove', 'Calendar', 'Review', 'Members']) {
    assert.match(projects, new RegExp(text));
  }
  assert.match(projects, /openLegacyModule\(platform\.navigation/);
  assert.match(projects, /'notes'/);
  assert.match(projects, /'projects'/);
  for (const step of ['capture', 'context', 'next-action', 'follow-through', 'review', 'invite', 'project']) {
    assert.match(projects, new RegExp(`['"]${step}['"]`));
  }
  assert.match(projects, /Explore the Ledger workspace at your own pace/);
  assert.match(projects, /starter-calendar/);
  assert.doesNotMatch(projects, /'quick-note'/);
  assert.doesNotMatch(projects, /'quick-task'/);
  assert.match(projects, /removeWorkspaceStarterContent/);
  assert.match(projects, /rememberStarterOnboardingReturn/);
  assert.match(quickCapture, /completePendingStarterStep/);
  for (const step of ['capture', 'context', 'next-action', 'follow-through']) {
    assert.match(quickCapture, new RegExp(`['"]${step}['"]`));
  }
  assert.match(sidebar, /readStarterOnboardingReturn/);
  assert.match(sidebar, /routeForProject\(activeWorkspaceId, pending\.projectId\)/);
  assert.match(app, /showStarterGuideEntry/);
  assert.match(app, /Open check-in/);
  assert.match(handoff, /createdAt/);
  assert.match(handoff, /2 \* 60 \* 60 \* 1000/);
});
