import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../src/components/Calendar/CalendarWindow.tsx', import.meta.url),
  'utf8'
);

test('desktop event editor exposes reviewed matching-event deletion', () => {
  assert.ok(source.includes('Delete matching events…'));
  assert.ok(source.includes('loadEventMatchPreview'));
  assert.ok(source.includes('Future events'));
  assert.ok(source.includes('All events'));
  assert.ok(source.includes('selectedEventMatchIds'));
  assert.ok(source.includes('bulkDeleteSelectedEvents'));
});

test('desktop matching deletion stays unavailable for Apple provider events', () => {
  assert.match(
    source,
    /eventEditorEvent\.provider !== 'apple'[\s\S]{0,260}source_platform === 'ics'/
  );
});
