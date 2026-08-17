import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarSubscriptionToken, hashCalendarSubscriptionToken } from './calendar-subscription-security.js';

test('subscription tokens are random, high-entropy values and only hashes are stable', () => {
  const first = createCalendarSubscriptionToken();
  const second = createCalendarSubscriptionToken();
  assert.equal(first.length, 64);
  assert.equal(second.length, 64);
  assert.notEqual(first, second);
  assert.notEqual(hashCalendarSubscriptionToken(first), first);
  assert.equal(hashCalendarSubscriptionToken(first), hashCalendarSubscriptionToken(first));
});

test('subscription management migration preserves lifecycle fields', async () => {
  const migration = await (await import('node:fs/promises')).readFile(
    new URL('../migrations/117_calendar_subscription_management.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /last_accessed_at/);
  assert.match(migration, /last_generated_at/);
  assert.match(migration, /last_error_at/);
});
