import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeActivityItems,
  isMeaningfulActivityAction,
  normalizeActivityItem,
} from './activity-contract.js';

test('activity contract excludes routine technical signals', () => {
  assert.equal(isMeaningfulActivityAction('external_reference_resolved'), false);
  assert.equal(isMeaningfulActivityAction('github_repository_linked_to_project'), true);
});

test('activity contract normalizes and deterministically orders items', () => {
  const items = dedupeActivityItems([
    { id: 'older', type: 'task_completed', primary: { type: 'task', id: 'task-1' }, at: '2026-08-15T10:00:00Z' },
    { id: 'duplicate', type: 'task_completed', primary: { type: 'task', id: 'task-1' }, at: '2026-08-15T10:00:00Z' },
    { id: 'newer', type: 'note_updated', primary: { type: 'note', id: 'note-1' }, at: '2026-08-16T10:00:00Z' },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'newer');
  assert.equal(normalizeActivityItem({ id: 'x', label: 'Created', at: null }).provider, null);
});
