import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatchingEventTimeUpdate,
  buildReviewedMatchingEventUpdates,
} from './calendarEventBulkEdit.ts';

test('applies the edited clock time and duration to every matching event date', () => {
  const update = buildMatchingEventTimeUpdate({
    matchStartAt: new Date(2026, 8, 22, 18, 0).toISOString(),
    originalAnchorStartAt: new Date(2026, 8, 15, 18, 0).toISOString(),
    editedAnchorStartAt: new Date(2026, 8, 15, 19, 0),
    durationMinutes: 120,
  });

  const start = new Date(update.start_at);
  const end = new Date(update.end_at);
  assert.equal(start.getDate(), 22);
  assert.equal(start.getHours(), 19);
  assert.equal(start.getMinutes(), 0);
  assert.equal(end.getHours(), 21);
  assert.equal(end.getTime() - start.getTime(), 120 * 60 * 1000);
});

test('carries an edited date shift across matching events', () => {
  const update = buildMatchingEventTimeUpdate({
    matchStartAt: new Date(2026, 8, 22, 18, 0).toISOString(),
    originalAnchorStartAt: new Date(2026, 8, 15, 18, 0).toISOString(),
    editedAnchorStartAt: new Date(2026, 8, 16, 7, 0),
    durationMinutes: 120,
  });

  const start = new Date(update.start_at);
  assert.equal(start.getDate(), 23);
  assert.equal(start.getHours(), 7);
});

test('builds an update for every reviewed imported event, including off-screen dates', () => {
  const matches = Array.from({ length: 29 }, (_, index) => ({
    id: `event-${index + 1}`,
    start_at: new Date(2026, 8, 16 + index, 18, 0).toISOString(),
  }));
  const updates = buildReviewedMatchingEventUpdates({
    matches,
    originalAnchorStartAt: new Date(2026, 8, 15, 18, 0).toISOString(),
    editedAnchorStartAt: new Date(2026, 8, 15, 19, 0),
    durationMinutes: 120,
  });

  assert.equal(updates.length, 29);
  assert.deepEqual(updates.map((update) => update.id), matches.map((match) => match.id));
  for (const update of updates) {
    const start = new Date(update.start_at);
    const end = new Date(update.end_at);
    assert.equal(start.getHours(), 19);
    assert.equal(end.getHours(), 21);
  }
});
