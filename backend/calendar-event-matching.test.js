import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarEventPreviewAnchor,
  getCalendarEventMatches,
  isBulkDeleteEligibleCalendarEvent,
  isBulkDeletableCalendarEvent,
  normalizeBulkEventIds,
} from './calendar-event-matching.js';

const event = (overrides = {}) => ({
  id: `event-${Math.random()}`,
  workspace_id: 'workspace-1',
  calendar_id: 'calendar-1',
  title: 'BIO 101',
  start_at: '2026-09-14T14:00:00.000Z',
  end_at: '2026-09-14T15:00:00.000Z',
  source_platform: 'ics',
  ...overrides,
});

test('matches imported occurrences by exact series identity', () => {
  const anchor = event({ id: 'anchor', import_series_key: 'class-uid' });
  const matches = getCalendarEventMatches({
    anchor,
    candidates: [
      anchor,
      event({
        id: 'future',
        start_at: '2026-09-16T14:00:00.000Z',
        end_at: '2026-09-16T15:00:00.000Z',
        import_series_key: 'class-uid',
      }),
    ],
    scope: 'all',
    now: new Date('2026-09-01T00:00:00.000Z'),
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].reason, 'imported series');
});

test('legacy imports match across weekdays and daylight saving changes', () => {
  const anchor = event({ id: 'anchor', import_series_key: null });
  const matches = getCalendarEventMatches({
    anchor,
    candidates: [
      anchor,
      event({
        id: 'same-pattern',
        start_at: '2026-09-21T14:10:00.000Z',
        end_at: '2026-09-21T15:10:00.000Z',
        import_series_key: null,
      }),
      event({
        id: 'wednesday-after-dst',
        start_at: '2026-11-04T15:00:00.000Z',
        end_at: '2026-11-04T16:00:00.000Z',
        import_series_key: null,
      }),
      event({ id: 'other-calendar', calendar_id: 'calendar-2', import_series_key: null }),
      event({ id: 'other-workspace', workspace_id: 'workspace-2' }),
      event({ id: 'other-title', title: 'BIO 102' }),
      event({ id: 'all-day', all_day: true }),
      event({ id: 'longer', end_at: '2026-09-14T17:00:00.000Z' }),
      event({ id: 'provider', source_platform: 'google' }),
    ],
    scope: 'all',
    now: new Date('2026-09-01T00:00:00.000Z'),
  });
  assert.deepEqual(
    matches.map((match) => match.id),
    ['same-pattern', 'wednesday-after-dst']
  );
  assert.equal(matches[0].reason, 'same imported title and duration');
});

test('future scope excludes past matches and preserves chronological order', () => {
  const anchor = event({ id: 'anchor', import_series_key: 'uid' });
  const matches = getCalendarEventMatches({
    anchor,
    candidates: [
      event({
        id: 'past',
        start_at: '2026-09-01T14:00:00.000Z',
        end_at: '2026-09-01T15:00:00.000Z',
        import_series_key: 'uid',
      }),
      event({
        id: 'later',
        start_at: '2026-09-22T14:00:00.000Z',
        end_at: '2026-09-22T15:00:00.000Z',
        import_series_key: 'uid',
      }),
      event({
        id: 'soon',
        start_at: '2026-09-15T14:00:00.000Z',
        end_at: '2026-09-15T15:00:00.000Z',
        import_series_key: 'uid',
      }),
    ],
    now: new Date('2026-09-10T00:00:00.000Z'),
  });
  assert.deepEqual(
    matches.map((match) => match.id),
    ['soon', 'later']
  );
});

test('provenance-backed imports match even when source platform is missing', () => {
  const anchor = event({ id: 'anchor', source_platform: null, import_series_key: 'class-uid' });
  assert.equal(isBulkDeleteEligibleCalendarEvent(anchor), true);
  const matches = getCalendarEventMatches({
    anchor,
    candidates: [
      anchor,
      event({ id: 'same-series', source_platform: null, import_series_key: 'class-uid', start_at: '2026-09-16T14:00:00.000Z', end_at: '2026-09-16T15:00:00.000Z' }),
    ],
    scope: 'all',
  });
  assert.deepEqual(matches.map((match) => match.id), ['same-series']);
});

test('same imported batch matches by title without a source platform', () => {
  const batch = '11111111-1111-4111-8111-111111111111';
  const anchor = event({ id: 'anchor', source_platform: null, import_batch_id: batch });
  const matches = getCalendarEventMatches({
    anchor,
    candidates: [
      anchor,
      event({ id: 'same-batch', source_platform: null, import_batch_id: batch, start_at: '2026-09-30T18:00:00.000Z', end_at: '2026-09-30T19:00:00.000Z' }),
    ],
    scope: 'all',
  });
  assert.deepEqual(matches.map((match) => match.id), ['same-batch']);
});

test('preview anchor exposes no notes or private fields', () => {
  const preview = calendarEventPreviewAnchor(event({ notes: 'private' }));
  assert.equal(preview.title, 'BIO 101');
  assert.equal('notes' in preview, false);
});

test('provider-backed events never produce bulk-delete matches', () => {
  const anchor = event({ id: 'apple-anchor', source_platform: 'apple', series_id: 'series-1' });
  assert.equal(isBulkDeletableCalendarEvent(anchor), false);
  assert.deepEqual(
    getCalendarEventMatches({
      anchor,
      candidates: [event({ id: 'apple-match', source_platform: 'apple', series_id: 'series-1' })],
      scope: 'all',
    }),
    []
  );
});

test('ordinary Ledger events are not eligible for bulk deletion', () => {
  assert.equal(
    isBulkDeleteEligibleCalendarEvent(event({ source_platform: 'workspace', series_id: null })),
    false
  );
  assert.deepEqual(
    getCalendarEventMatches({
      anchor: event({ id: 'ordinary', source_platform: 'workspace', series_id: null }),
      candidates: [event({ id: 'other', source_platform: 'workspace', series_id: null })],
      scope: 'all',
    }),
    []
  );
});

test('bulk deletion IDs are deduplicated and bounded', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(normalizeBulkEventIds([id, id]), [id]);
  assert.equal(normalizeBulkEventIds([]), null);
  assert.equal(normalizeBulkEventIds(['not-an-id']), null);
});
