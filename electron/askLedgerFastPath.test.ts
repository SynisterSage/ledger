import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolveAskLedgerFastPath } from './askLedgerFastPath.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (fields: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({ resourceType: 'task', resourceId: randomUUID(), title: 'Untitled', content: '', ...fields });
const now = new Date('2026-08-20T10:00:00');

test('answers structured due-today and overdue-count questions without language reasoning', () => {
  const result = resolveAskLedgerFastPath('What is due today?', [
    item({ resourceId: 'today', title: 'Send invoice', dueAt: '2026-08-20', status: 'open' }),
    item({ resourceId: 'overdue', title: 'Review contract', dueAt: '2026-08-19', status: 'open' }),
  ], now);
  assert.equal(result?.kind, 'due_today');
  assert.equal(result?.resolution, 'resolved');
  assert.match(result?.answer ?? '', /Send invoice/);
  const count = resolveAskLedgerFastPath('How many overdue tasks?', [
    item({ resourceId: 'overdue', title: 'Review contract', dueAt: '2026-08-19', status: 'open' }),
    item({ resourceId: 'done', title: 'Done task', dueAt: '2026-08-19', status: 'completed' }),
  ], now);
  assert.equal(count?.answer, '1 overdue task.');
  assert.equal(count?.resolution, 'resolved');
});

test('answers meetings, project due dates, owners, and recent notes deterministically', () => {
  const documents = [
    item({ resourceType: 'event', resourceId: 'event-1', title: 'Design sync', timestamp: '2026-08-20T14:00:00' }),
    item({ resourceType: 'project', resourceId: 'project-1', title: 'Website launch', metadata: { end_date: '2026-08-28' } }),
    item({ resourceType: 'task', resourceId: 'task-1', title: 'Review homepage', metadata: { assigned_to_user_name: 'Lex' } }),
    item({ resourceType: 'note', resourceId: 'note-1', title: 'Newest note', updatedAt: '2026-08-20T09:00:00' }),
  ];
  assert.equal(resolveAskLedgerFastPath('What meetings do I have?', documents, now)?.kind, 'meetings');
  assert.match(resolveAskLedgerFastPath('When is Project Website launch due?', documents, now)?.answer ?? '', /Aug 28/);
  assert.match(resolveAskLedgerFastPath('Who owns task Review homepage?', documents, now)?.answer ?? '', /Lex/);
  assert.match(resolveAskLedgerFastPath('Show my last 3 notes', documents, now)?.answer ?? '', /Newest note/);
});

test('does not turn ambiguous or incomplete lookups into confident answers', () => {
  const ambiguousProjects = resolveAskLedgerFastPath('When is Project Atlas due?', [
    item({ resourceType: 'project', resourceId: 'atlas-1', title: 'Atlas', metadata: { end_date: '2026-08-28' } }),
    item({ resourceType: 'project', resourceId: 'atlas-2', title: 'Atlas rollout', metadata: { end_date: '2026-09-04' } }),
  ], now);
  assert.equal(ambiguousProjects?.resolution, 'ambiguous');

  const missingOwner = resolveAskLedgerFastPath('Who owns task Database migration?', [
    item({ resourceType: 'task', resourceId: 'db', title: 'Database migration' }),
  ], now);
  assert.equal(missingOwner?.resolution, 'insufficient_data');

  const missingDueDate = resolveAskLedgerFastPath('When is Project Atlas due?', [
    item({ resourceType: 'project', resourceId: 'atlas', title: 'Atlas' }),
  ], now);
  assert.equal(missingDueDate?.resolution, 'insufficient_data');
});
