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
  assert.deepEqual(detectAskLedgerQueryIntent('hello mr ledger'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('Good morning, Mr. Ledger!'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('what’s up Ledger'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('hey, what’s up?'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('hello, how are you?'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('thanks Ledger'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('nothing much ur whats up with u \\'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('what\'s up with you?'), { kind: 'greeting' });
  assert.deepEqual(detectAskLedgerQueryIntent('whats on ur mind'), { kind: 'greeting' });
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

test('detects project review questions as mixed project context', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('Review my projects. See what is moving, blocked, or needs attention.'), { kind: 'project_review' });
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('Review my projects. See what is moving, blocked, or needs attention.')), ['project', 'task', 'milestone', 'note', 'event', 'reminder']);
});

test('detects recent workspace updates', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('What changed recently? Find important updates across my workspace.'), { kind: 'recent_updates' });
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('What changed recently? Find important updates across my workspace.')), ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake']);
});

test('detects meeting preparation as mixed context', () => {
  assert.deepEqual(detectAskLedgerQueryIntent('Prepare me for a meeting. Pull together relevant notes, tasks, and context.'), { kind: 'meeting_prep' });
  assert.deepEqual(resourceTypesForAskLedgerIntent(detectAskLedgerQueryIntent('Prepare me for a meeting. Pull together relevant notes, tasks, and context.')), ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake']);
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
