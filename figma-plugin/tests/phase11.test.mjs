import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/ui/main.tsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/api/client.ts', import.meta.url), 'utf8');
const server = await readFile(new URL('../../backend/server.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../migrations/087_figma_change_awareness.sql', import.meta.url), 'utf8');

test('Phase 11 exposes server-side change checks and manual preview refresh', () => {
  assert.match(main, /VERSION_SCOPES/);
  assert.match(main, /checkPluginChangeState/);
  assert.match(main, /refreshPluginPreview/);
  assert.match(main, /Design updated/);
  assert.match(client, /figma-plugin\/change-state/);
  assert.match(client, /figma-plugin\/preview\/refresh/);
  assert.match(server, /external-reference:check-version/);
  assert.match(server, /external-reference:refresh-preview/);
  assert.match(server, /figma-plugin\/change-state/);
  assert.match(server, /figma-plugin\/preview\/refresh/);
});

test('Phase 11 persists provider-neutral state and safe automation defaults', () => {
  assert.match(migration, /external_reference_change_states/);
  assert.match(migration, /change_state IN/);
  assert.match(migration, /automatically_refresh_previews BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /integration_webhook_events/);
  assert.match(main, /schemaVersion/);
  assert.doesNotMatch(main, /set\(.*version/);
});
