import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectTimelineSpan,
  getProjectTimelineVisibility,
  parseProjectTimelineDate,
  projectOverlapsTimelineRange,
} from './projectTimeline.ts';

const range = (start: string, end: string) => ({
  start: parseProjectTimelineDate(start)!,
  end: parseProjectTimelineDate(end)!,
});

test('normalizes date-only values in local calendar time', () => {
  const parsed = parseProjectTimelineDate('2026-09-08');
  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 8);
  assert.equal(parsed.getHours(), 0);
});

test('supports start-only and end-only projects', () => {
  assert.deepEqual(
    getProjectTimelineSpan({ start_date: '2026-09-08', end_date: null }),
    getProjectTimelineSpan({ start_date: null, end_date: '2026-09-08' })
  );
});

test('normalizes reversed dates into one span', () => {
  const span = getProjectTimelineSpan({ start_date: '2026-12-22', end_date: '2026-09-08' });
  assert.ok(span);
  assert.equal(span.start.getDate(), 8);
  assert.equal(span.end.getDate(), 22);
});

test('includes projects touching the beginning of a range', () => {
  assert.equal(
    projectOverlapsTimelineRange(
      { start_date: '2026-08-20', end_date: '2026-09-01' },
      range('2026-09-01', '2026-10-01')
    ),
    true
  );
});

test('treats the range end as exclusive', () => {
  assert.equal(
    projectOverlapsTimelineRange(
      { start_date: '2026-10-01', end_date: '2026-10-15' },
      range('2026-09-01', '2026-10-01')
    ),
    false
  );
});

test('keeps a valid endpoint and rejects projects with no valid dates', () => {
  assert.equal(
    projectOverlapsTimelineRange(
      { start_date: 'not-a-date', end_date: '2026-09-08' },
      range('2026-09-01', '2026-10-01')
    ),
    true
  );
  assert.equal(
    projectOverlapsTimelineRange(
      { start_date: 'not-a-date', end_date: 'also-not-a-date' },
      range('2026-09-01', '2026-10-01')
    ),
    false
  );
});

test('reports why a project is absent from a bounded range', () => {
  assert.equal(
    getProjectTimelineVisibility(
      { start_date: '2026-12-08', end_date: '2026-12-22' },
      range('2026-09-01', '2026-12-01')
    ),
    'outside_range'
  );
  assert.equal(
    getProjectTimelineVisibility(
      { start_date: 'not-a-date', end_date: null },
      range('2026-09-01', '2026-12-01')
    ),
    'invalid_dates'
  );
});
