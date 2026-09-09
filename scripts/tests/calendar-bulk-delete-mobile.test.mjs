import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const editor = await readFile(
  new URL('../../apps/mobile/src/features/calendar/CalendarItemEditor.tsx', import.meta.url),
  'utf8'
);
const api = await readFile(
  new URL('../../apps/mobile/src/api/calendar.ts', import.meta.url),
  'utf8'
);
const normalizer = await readFile(
  new URL('../../apps/mobile/src/features/calendar/calendarItemNormalizer.ts', import.meta.url),
  'utf8'
);

test('mobile calendar editor exposes reviewed matching-event deletion', () => {
  assert.ok(editor.includes('Delete matching events…'));
  assert.ok(editor.includes('AppBottomSheet visible={Boolean(matchPreview)}'));
  assert.ok(editor.includes('Future events'));
  assert.ok(editor.includes('All events'));
  assert.ok(editor.includes('selectedMatchIds'));
  assert.ok(editor.includes('bulkDeleteMobileEvents'));
});

test('mobile preserves provenance needed to decide whether the action is available', () => {
  assert.ok(normalizer.includes('seriesId: stringValue(event.series_id)'));
  assert.ok(normalizer.includes('importSeriesKey: stringValue(event.import_series_key)'));
  assert.ok(editor.includes("first(params.sourcePlatform) === 'ics'"));
  assert.ok(api.includes("'/api/events/match-preview'"));
  assert.ok(api.includes("'/api/events/bulk-delete'"));
});
