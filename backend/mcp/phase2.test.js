import test from 'node:test';
import assert from 'node:assert/strict';
import { mutationLimits } from './server.js';

test('Phase 2 mutation limits stay bounded by tool', () => {
  assert.equal(mutationLimits.send_to_intake, 20);
  assert.equal(mutationLimits.create_task, 20);
  assert.equal(mutationLimits.create_note, 20);
  assert.equal(mutationLimits.append_to_note, 20);
  assert.equal(mutationLimits.create_project, 20);
  assert.equal(mutationLimits.update_task, 60);
  assert.equal(mutationLimits.add_to_focus, 30);
});

test('Phase 2 migration contains separate upgrade and idempotency persistence', async () => {
  const migration = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../migrations/090_mcp_phase2_writes.sql', import.meta.url), 'utf8'));
  assert.match(migration, /mcp_scope_upgrade_sessions/);
  assert.match(migration, /mcp_idempotency_records/);
  assert.match(migration, /request_fingerprint/);
  assert.match(migration, /ALTER TABLE public\.tasks/);
});

test('MCP note search is backed by workspace/date and text indexes', async () => {
  const migration = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../migrations/092_mcp_note_search_indexes.sql', import.meta.url), 'utf8'));
  assert.match(migration, /pg_trgm/);
  assert.match(migration, /idx_notes_workspace_date_search/);
  assert.match(migration, /gin_trgm_ops/);
});
