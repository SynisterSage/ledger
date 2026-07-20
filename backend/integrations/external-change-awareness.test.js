import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_STATES, sourceIsNewer } from './external-change-awareness.js';

test('change awareness compares source evidence with the saved preview', () => {
  assert.equal(sourceIsNewer({ sourceLastModifiedAt: '2026-07-21T00:00:00Z', preview: { captured_at: '2026-07-20T00:00:00Z' } }), true);
  assert.equal(sourceIsNewer({ sourceLastModifiedAt: '2026-07-19T00:00:00Z', preview: { captured_at: '2026-07-20T00:00:00Z' } }), false);
  assert.equal(sourceIsNewer({ sourceVersion: '2', preview: { source_version: '1' } }), true);
  assert.equal(sourceIsNewer({ sourceVersion: '1', preview: { source_version: '1' } }), false);
});

test('change state vocabulary remains provider-neutral and bounded', () => {
  assert.deepEqual([...CHANGE_STATES].sort(), ['checking', 'current', 'error', 'unavailable', 'unknown', 'updated']);
});
