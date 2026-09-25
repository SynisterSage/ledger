import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeDeterministicAskLedgerTool,
  resolveDeterministicAskLedgerToolCall,
} from './askLedgerToolExecutor.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (
  value: Partial<AskLedgerContextItem> &
    Pick<AskLedgerContextItem, 'resourceType' | 'resourceId' | 'title'>
): AskLedgerContextItem => ({
  content: '',
  workspaceId: 'workspace-1',
  ...value,
});

test('computes a bounded daily plan from structured Ledger evidence', () => {
  const result = executeDeterministicAskLedgerTool(
    { name: 'compute_daily_plan', arguments: { date: '2026-09-13', maxFocusItems: 2 } },
    {
      workspaceId: 'workspace-1',
      now: new Date('2026-09-13T12:00:00.000Z'),
      items: [
        item({
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Overdue task',
          status: 'todo',
          dueAt: '2026-09-12',
        }),
        item({ resourceType: 'task', resourceId: 'task-2', title: 'Open task', status: 'todo' }),
        item({
          resourceType: 'task',
          resourceId: 'task-3',
          title: 'Completed task',
          status: 'completed',
          dueAt: '2026-09-11',
        }),
      ],
    }
  );
  assert.deepEqual(result.data.focus, [
    {
      resourceType: 'task',
      resourceId: 'task-1',
      title: 'Overdue task',
      projectId: undefined,
      dueAt: '2026-09-12',
      reason: 'overdue',
    },
    {
      resourceType: 'task',
      resourceId: 'task-2',
      title: 'Open task',
      projectId: undefined,
      dueAt: undefined,
      reason: 'open work',
    },
  ]);
  assert.equal(result.sourceRefs.length, 2);
});

test('finds only evidence-backed project blockers and missing next actions', () => {
  const result = executeDeterministicAskLedgerTool(
    { name: 'find_project_blockers', arguments: { projectId: 'project-1' } },
    {
      workspaceId: 'workspace-1',
      items: [
        item({ resourceType: 'project', resourceId: 'project-1', title: 'Catalog' }),
        item({
          resourceType: 'task',
          resourceId: 'task-1',
          projectId: 'project-1',
          title: 'Waiting on review',
          status: 'blocked',
          content: 'Waiting on review.',
        }),
      ],
    }
  );
  assert.equal((result.data.blockers as unknown[]).length, 1);
  assert.equal(result.data.missingNextAction, false);
});

test('computes requested uninterrupted weekly availability around calendar events', () => {
  const result = executeDeterministicAskLedgerTool(
    { name: 'find_weekly_availability', arguments: { durationMinutes: 120, days: 3 } },
    {
      workspaceId: 'workspace-1',
      now: new Date('2026-09-21T08:00:00.000Z'),
      timeZone: 'America/New_York',
      items: [
        item({ resourceType: 'event', resourceId: 'event-1', title: 'Standup', timestamp: '2026-09-21T14:00:00.000Z', endAt: '2026-09-21T15:00:00.000Z' }),
        item({ resourceType: 'event', resourceId: 'event-2', title: 'Review', timestamp: '2026-09-22T16:00:00.000Z', endAt: '2026-09-22T18:00:00.000Z' }),
      ],
    }
  );
  assert.deepEqual(result.data.slots, [
    { date: '2026-09-21', day: 'Monday', start: '11:00 AM', end: '1:00 PM', durationMinutes: 120 },
    { date: '2026-09-22', day: 'Tuesday', start: '9:00 AM', end: '11:00 AM', durationMinutes: 120 },
    { date: '2026-09-23', day: 'Wednesday', start: '9:00 AM', end: '11:00 AM', durationMinutes: 120 },
  ]);
  assert.equal(result.data.foundRequestedDays, true);
});

test('does not execute read or write tools through the compute executor', () => {
  assert.throws(
    () =>
      executeDeterministicAskLedgerTool(
        { name: 'create_task', arguments: { title: 'Nope' } },
        { workspaceId: 'workspace-1', items: [] }
      ),
    /not available/
  );
});

test('resolves only explicit daily-plan and project-blocker intents', () => {
  assert.equal(
    resolveDeterministicAskLedgerToolCall('What should I do today?')?.name,
    'compute_daily_plan'
  );
  assert.equal(
    resolveDeterministicAskLedgerToolCall('What is blocking this project?', {
      resourceType: 'project',
      resourceId: 'project-1',
      title: 'Launch',
      aiSurface: 'project_lens',
    })?.name,
    'find_project_blockers'
  );
  assert.equal(resolveDeterministicAskLedgerToolCall('Tell me something interesting'), undefined);
  assert.deepEqual(resolveDeterministicAskLedgerToolCall('I need two hours of free time three days this week.'), {
    name: 'find_weekly_availability',
    arguments: { durationMinutes: 120, days: 3 },
  });
});
