import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerContextBuilder } from './askLedgerContext.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  resourceType: 'note',
  resourceId: 'note-default',
  title: 'Note',
  content: 'Context content.',
  ...overrides,
});

test('normalizes Ledger resources into useful labeled context and preserves identity', () => {
  const result = new LedgerContextBuilder().normalize([
    item({ resourceType: 'project', resourceId: 'project-1', title: 'Local AI', status: 'Planning', content: '<p>Build the runtime.</p>', route: 'project:project-1' }),
  ]);

  assert.equal(result.items[0]?.resourceId, 'project-1');
  assert.equal(result.items[0]?.route, 'project:project-1');
  assert.match(result.text, /\[PROJECT\]/);
  assert.match(result.text, /Status: Planning/);
  assert.match(result.text, /Build the runtime\./);
  assert.doesNotMatch(result.text, /<p>/);
});

test('orders dated context newest first so current state is represented before older state', () => {
  const result = new LedgerContextBuilder().normalize([
    item({ resourceId: 'old', title: 'Older decision', content: 'LFM2.5 is leading.', updatedAt: '2026-08-15T10:00:00Z' }),
    item({ resourceId: 'new', title: 'Current decision', content: 'LFM2.5 was rejected. Qwen3 1.7B is currently leading.', updatedAt: '2026-08-16T10:00:00Z' }),
  ]);

  assert.deepEqual(result.items.map(({ resourceId }) => resourceId), ['new', 'old']);
  assert.ok(result.text.indexOf('Qwen3 1.7B is currently leading.') < result.text.indexOf('LFM2.5 is leading.'));
});

test('trims lower-priority resources within the configured context budget', () => {
  const result = new LedgerContextBuilder().normalize([
    item({ resourceId: 'new', title: 'Newest', content: 'A'.repeat(500), updatedAt: '2026-08-16T10:00:00Z' }),
    item({ resourceId: 'old', title: 'Older', content: 'B'.repeat(500), updatedAt: '2026-08-15T10:00:00Z' }),
  ], { maxContextTokens: 150, maxItemTokens: 100 });

  assert.equal(result.items[0]?.resourceId, 'new');
  assert.equal(result.items.some(({ resourceId }) => resourceId === 'old'), false);
  assert.equal(result.truncated, true);
  assert.ok(result.estimatedTokens <= 150);
});
