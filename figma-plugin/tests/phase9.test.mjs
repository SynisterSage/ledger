import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/ui/main.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../../backend/server.js', import.meta.url), 'utf8');

test('Phase 9 uses canonical linked-work lookup and provenance-aware unlinking', () => {
  assert.match(main, /getPluginLinkedWork/);
  assert.match(main, /unlinkPluginWork/);
  assert.match(main, /node-reference-get/);
  assert.match(server, /figma-plugin\/linked-work/);
  assert.match(server, /figma-plugin\/unlink/);
  assert.match(server, /source: 'integration'/);
});

test('plugin linked rows do not persist complete target payloads in node data', () => {
  assert.match(main, /buildNodeReferenceCache/);
  assert.doesNotMatch(main, /JSON\.stringify\(.*title/);
  assert.doesNotMatch(main, /JSON\.stringify\(.*assignee/);
});
