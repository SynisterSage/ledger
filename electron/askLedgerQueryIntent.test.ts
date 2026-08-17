import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAskLedgerQueryIntent, resourceTypesForAskLedgerIntent } from './askLedgerQueryIntent.ts';

test('detects deadline questions', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('when are my project deadlines', new Date('2026-08-16T12:00:00Z')), { kind: 'deadlines' });
  assert.deepEqual(detectAskLedgerQueryIntent('when are my project deadliens', new Date('2026-08-16T12:00:00Z')), { kind: 'deadlines' });
});

test('detects direct greetings', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('hello'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('Hey Ledger!'), { kind: 'greeting' });
});

test('detects authoritative team-member lookups', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('who are my team members'), { kind: 'team_members' });
  assert.deepEqual(detectAskLedgerQueryIntent('show me the members of the team'), { kind: 'team_members' });
});

test('routes entity questions to their authoritative resource types', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('what projects do I have'), { kind: 'projects' });
  assert.deepEqual(detectAskLedgerQueryIntent('show my upcoming meetings'), { kind: 'events' });
  assert.deepEqual(detectAskLedgerQueryIntent('what reminders do I have'), { kind: 'reminders' });
  assert.deepEqual(detectAskLedgerQueryIntent('what are my open tasks'), { kind: 'open_actions' });
  assert.deepEqual(detectAskLedgerQueryIntent('what are my todos'), { kind: 'open_actions' });
  assert.deepEqual(detectAskLedgerQueryIntent('what milestones do I have'), { kind: 'milestones' });
});

test('maps entity intents to narrow resource policies', () => {
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('what projects do I have')), ['project']);
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('what do I need to do')), ['task', 'reminder']);
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('what did we discuss about projects')), null);
});

test('keeps blocker questions as mixed project context', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('what is blocking Local AI'), { kind: 'blockers' });
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('what is blocking Local AI')), ['project', 'task', 'note', 'transcript']);
});

test('resolves current and next week as Sunday-based windows', () => {
  const now = new Date('2026-08-16T12:00:00Z');
  assert.deepEqual(detectAskLedgerQueryIntent('what do I have this week', now), { kind: 'time_window', window: { start: '2026-08-16', end: '2026-08-22' } });
  assert.deepEqual(detectAskLedgerQueryIntent('what is planned next week', now), { kind: 'time_window', window: { start: '2026-08-23', end: '2026-08-29' } });
});
