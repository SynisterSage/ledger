import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseAskLedgerStructuredOutput, formatAskLedgerStructuredValues, structuredValueLinesFor } from './askLedgerStructuredValues.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { LedgerContextBuilder } from './askLedgerContext.ts';
import { compileAskLedgerEvidence } from './askLedgerEvidencePipeline.ts';

const now = new Date('2026-08-21T12:00:00Z');
const item = (fields: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({ resourceType: 'task', resourceId: 'task-1', title: 'Example task', content: '', ...fields });

test('formats today, tomorrow, future, and overdue dates deterministically', () => {
  const today = formatAskLedgerStructuredValues(item({ dueAt: '2026-08-21' }), { timeZone: 'America/New_York', now });
  const tomorrow = formatAskLedgerStructuredValues(item({ dueAt: '2026-08-22' }), { timeZone: 'America/New_York', now });
  const future = formatAskLedgerStructuredValues(item({ dueAt: '2026-08-28' }), { timeZone: 'America/New_York', now });
  const overdue = formatAskLedgerStructuredValues(item({ dueAt: '2026-08-15', status: 'open' }), { timeZone: 'America/New_York', now });
  assert.equal(today.dueStatus, 'due_today');
  assert.equal(today.relativeDueDate, 'today');
  assert.match(today.displayDueDate ?? '', /Friday, Aug 21/);
  assert.equal(tomorrow.dueStatus, 'due_tomorrow');
  assert.equal(tomorrow.relativeDueDate, 'tomorrow');
  assert.match(future.displayDueDate ?? '', /Friday, Aug 28/);
  assert.equal(overdue.dueStatus, 'overdue');
  assert.equal(overdue.dueStateLabel, '6 days overdue');
  assert.match(formatAskLedgerStructuredValues(item({ dueAt: '2026-08-21' }), { timeZone: 'Pacific/Kiritimati', now }).displayDueDate ?? '', /Friday, Aug 21/);
});

test('formats local wall-clock event times using the resolved timezone', () => {
  const display = formatAskLedgerStructuredValues(item({ resourceType: 'event', timestamp: '2026-08-21T15:00:00' }), { timeZone: 'America/New_York', now });
  assert.equal(display.displayTimestamp, 'Friday, Aug 21 at 3:00 PM');
  assert.equal(display.dueStatus, 'no_due_date');
  assert.equal(display.diagnostics.raw24HourTimeObserved, true);
});

test('completed old work is not currently overdue and missing due dates stay missing', () => {
  const completed = formatAskLedgerStructuredValues(item({ dueAt: '2026-08-15', status: 'completed' }), { timeZone: 'America/New_York', now });
  const missing = formatAskLedgerStructuredValues(item({ status: 'in_progress' }), { timeZone: 'America/New_York', now });
  assert.equal(completed.dueStatus, 'completed');
  assert.equal(completed.dueStateLabel, undefined);
  assert.equal(missing.dueStatus, 'no_due_date');
  assert.equal(missing.displayDueDate, undefined);
});

test('invalid dates are omitted and diagnosed rather than repaired', () => {
  const invalid = formatAskLedgerStructuredValues(item({ dueAt: '2024-01-32' }), { timeZone: 'America/New_York', now });
  const invalidTime = formatAskLedgerStructuredValues(item({ resourceType: 'event', timestamp: '2026-08-21T25:00:00' }), { timeZone: 'America/New_York', now });
  assert.equal(invalid.displayDueDate, undefined);
  assert.equal(invalid.dueStatus, 'no_due_date');
  assert.equal(invalid.diagnostics.invalidDateDetected, true);
  assert.equal(invalidTime.displayTimestamp, undefined);
  assert.equal(invalidTime.diagnostics.invalidTimeDetected, true);
});

test('different years retain the year and structured evidence contains no raw ISO fields', () => {
  const display = formatAskLedgerStructuredValues(item({ dueAt: '2027-01-04', priority: 'medium', status: 'in_progress', metadata: { durationSeconds: 5400 } }), { timeZone: 'America/New_York', now });
  assert.match(display.displayDueDate ?? '', /Jan 4, 2027/);
  assert.equal(display.displayStatus, 'In progress');
  assert.equal(display.displayPriority, 'Medium priority');
  assert.equal(display.displayDuration, '1 hr 30 min');
  const lines = structuredValueLinesFor(item({ dueAt: '2026-08-21', timestamp: '2026-08-21T15:00:00' }), { timeZone: 'America/New_York', now }).lines.join('\n');
  assert.match(lines, /Friday, Aug 21/);
  assert.match(lines, /3:00 PM/);
  assert.doesNotMatch(lines, /2026-08-21|15:00/);
});

test('both prompt context and compiled evidence expose display values instead of raw date fields', () => {
  const task = item({ dueAt: '2026-08-21', timestamp: '2026-08-21T15:00:00', status: 'open' });
  const context = new LedgerContextBuilder().normalize([task], { timeZone: 'America/New_York', now, maxContextTokens: 500 });
  assert.match(context.text, /Friday, Aug 21/);
  assert.doesNotMatch(context.text, /2026-08-21|15:00/);
  const evidence = compileAskLedgerEvidence({ question: 'What is due?', result: { items: [task], debug: [], mode: 'quick' } as never, items: [task], timeZone: 'America/New_York', now });
  assert.match(evidence.package.text, /Due: Friday, Aug 21/);
  assert.doesNotMatch(evidence.package.text, /2026-08-21|15:00/);
});

test('output diagnostics detect raw dates, raw times, unused relative labels, and due-state mismatches', () => {
  const task = item({ title: 'Final Portfolio', dueAt: '2026-08-15', status: 'completed' });
  const diagnostics = diagnoseAskLedgerStructuredOutput('Final Portfolio is overdue and scheduled for 2026-08-15 at 15:00.', [task], { timeZone: 'America/New_York', now });
  assert.equal(diagnostics.rawIsoDateObserved, true);
  assert.equal(diagnostics.raw24HourTimeObserved, true);
  assert.equal(diagnostics.dueStateMismatchDetected, true);
  const relative = diagnoseAskLedgerStructuredOutput('Final Portfolio is still open.', [item({ title: 'Final Portfolio', dueAt: '2026-08-22', status: 'open' })], { timeZone: 'America/New_York', now });
  assert.equal(relative.relativeDateAvailableButUnused, true);
});
