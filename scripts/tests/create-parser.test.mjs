import assert from 'node:assert/strict';
import test from 'node:test';

const loadParser = async () => import('../../src/utils/createParser/parseCreateInput.ts');

test('deterministically parses event scheduling language', async () => {
  const { parseCreateInput } = await loadParser();
  const result = parseCreateInput('Dinner with Jacob Friday at 7 for 2 hours', new Date(2026, 7, 26));
  assert.equal(result.title, 'Dinner with Jacob');
  assert.equal(result.date, '2026-08-28');
  assert.equal(result.time, '19:00');
  assert.equal(result.durationMinutes, 120);
});

test('cleans reminder prefixes and parses recurrence', async () => {
  const { parseCreateInput } = await loadParser();
  const result = parseCreateInput('Remind me to call Mom tomorrow morning every Thursday', new Date(2026, 7, 26));
  assert.equal(result.title, 'call Mom');
  assert.equal(result.date, '2026-08-27');
  assert.equal(result.time, '09:00');
  assert.equal(result.recurrence, 'weekly');
});

test('leaves ambiguous language conservative', async () => {
  const { parseCreateInput } = await loadParser();
  const result = parseCreateInput('Meet Sarah later', new Date(2026, 7, 26));
  assert.equal(result.title, 'Meet Sarah later');
  assert.equal(result.date, undefined);
  assert.equal(result.time, undefined);
});

test('handles time ranges and rejects invalid calendar dates', async () => {
  const { parseCreateInput } = await loadParser();
  const range = parseCreateInput('Design review Thursday from 3 to 4 PM', new Date(2026, 7, 26));
  assert.equal(range.time, '15:00');
  assert.equal(range.durationMinutes, 60);
  const invalid = parseCreateInput('Launch February 31', new Date(2026, 1, 1));
  assert.equal(invalid.date, undefined);
});

test('resolves local relative dates across month and year boundaries', async () => {
  const { parseCreateInput } = await loadParser();
  assert.equal(parseCreateInput('Call tomorrow', new Date(2026, 11, 31)).date, '2027-01-01');
  assert.equal(parseCreateInput('Meet next Monday', new Date(2026, 11, 31)).date, '2027-01-04');
  assert.equal(parseCreateInput('Conference all day Tuesday', new Date(2026, 7, 26)).allDay, true);
});

test('does not invent unsupported recurrence semantics', async () => {
  const { parseCreateInput } = await loadParser();
  assert.equal(parseCreateInput('Payroll every third business day', new Date(2026, 7, 26)).recurrence, undefined);
});
