import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/ui/main.tsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/api/client.ts', import.meta.url), 'utf8');
const server = await readFile(new URL('../../backend/server.js', import.meta.url), 'utf8');

test('Phase 10 exposes constrained property editing with scoped upgrades', () => {
  assert.match(main, /UPDATE_SCOPES/);
  assert.match(main, /updatePluginWorkProperty/);
  assert.match(main, /expected_updated_at/);
  assert.match(client, /edit-options/);
  assert.match(client, /work\/.*PATCH/);
  assert.match(server, /work:update:status/);
  assert.match(server, /Unsupported property/);
  assert.match(server, /expected_updated_at/);
});

test('property updates never write property values into Figma node metadata', () => {
  assert.match(main, /buildNodeReferenceCache/);
  assert.doesNotMatch(main, /targetIds:.*status/);
  assert.doesNotMatch(main, /targetIds:.*priority/);
  assert.doesNotMatch(main, /targetIds:.*dueDate/);
});
