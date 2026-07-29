const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allDayDate,
  escapeICalText,
  foldICalLine,
  nextAllDayDate,
  recurrenceRuleValue,
  safeTimezone,
  toZonedICalDateTime,
} = require('./ical-format');

test('escapes iCal text and folds long lines', () => {
  assert.equal(escapeICalText('A,B;C\\D\nE'), 'A\\,B\\;C\\\\D\\nE');
  const folded = foldICalLine(`SUMMARY:${'x'.repeat(120)}`);
  assert.ok(folded.every((line) => line.length <= 76));
  assert.equal(folded[1][0], ' ');
});

test('keeps all-day dates date-only with an exclusive end', () => {
  assert.equal(allDayDate('2026-09-10T14:00:00Z'), '20260910');
  assert.equal(nextAllDayDate('2026-09-10'), '20260911');
});

test('maps stored recurrence values to bounded RRULEs', () => {
  assert.equal(recurrenceRuleValue('weekdays'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.equal(recurrenceRuleValue('weekly', '2026-12-31T23:59:59Z'), 'FREQ=WEEKLY;UNTIL=20261231T235959Z');
  assert.equal(recurrenceRuleValue('specific_dates'), null);
});

test('formats timed values in a valid IANA timezone and falls back safely', () => {
  assert.equal(safeTimezone('America/New_York'), 'America/New_York');
  assert.equal(safeTimezone('not/a-timezone'), 'UTC');
  assert.equal(toZonedICalDateTime('2026-09-10T18:00:00Z', 'America/New_York'), '20260910T140000');
});
