import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIntelligenceContext } from './projectIntelligenceContext.ts';
import {
  deriveProjectSignals,
  summarizeProjectSignals,
  type ProjectSignalProject,
} from './projectSignals.ts';

const project = (overrides: Partial<ProjectSignalProject> = {}): ProjectSignalProject => ({
  id: 'project-a',
  workspace_id: 'workspace-a',
  name: 'Project A',
  status: 'in_progress',
  completeness: 20,
  updated_at: '2026-08-20T12:00:00Z',
  ...overrides,
});

test('derives overdue active actions and preserves the task source', () => {
  const signals = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project(),
    today: '2026-08-22',
    tasks: [
      { id: 'task-overdue', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Review proof', status: 'todo', due_date: '2026-08-21' },
      { id: 'task-done', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Draft', status: 'completed', due_date: '2026-08-01' },
    ],
  });

  const overdue = signals.find((signal) => signal.kind === 'overdue_action');
  assert.equal(overdue?.resourceType, 'task');
  assert.equal(overdue?.resourceId, 'task-overdue');
  assert.equal(overdue?.count, 1);
});

test('only emits blocker signals for explicitly blocked records', () => {
  const signals = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project(),
    tasks: [{ id: 'task-blocked', project_id: 'project-a', title: 'Waiting on review', status: 'blocked' }],
  });
  const blocked = signals.find((signal) => signal.kind === 'blocked');
  assert.equal(blocked?.resourceType, 'task');
  assert.equal(blocked?.resourceId, 'task-blocked');
});

test('isolates records by workspace and project', () => {
  const signals = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project(),
    today: '2026-08-22',
    tasks: [{ id: 'other-task', workspace_id: 'workspace-b', project_id: 'project-a', title: 'Private task', status: 'todo', due_date: '2026-08-01' }],
    milestones: [{ id: 'other-milestone', workspace_id: 'workspace-a', project_id: 'project-b', title: 'Other milestone', milestone_date: '2026-08-01', completed: false }],
  });

  assert.equal(signals.some((signal) => signal.kind === 'overdue_action'), false);
  assert.equal(signals.some((signal) => signal.kind === 'overdue_milestone'), false);
  assert.equal(signals.some((signal) => signal.kind === 'missing_next_action'), true);
});

test('derives due-soon milestone and does not warn completed sparse projects', () => {
  const dueSoon = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project(),
    today: '2026-08-22',
    milestones: [{ id: 'milestone-a', project_id: 'project-a', title: 'Review', milestone_date: '2026-08-25', completed: false }],
  });
  assert.equal(dueSoon.some((signal) => signal.kind === 'milestone_approaching'), true);

  const completed = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project({ status: 'completed', completeness: 100 }),
    today: '2026-08-22',
  });
  assert.deepEqual(completed.map((signal) => signal.kind), ['project_state']);
});

test('summarizes only meaningful workspace signals', () => {
  const signals = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project(),
    today: '2026-08-22',
    tasks: [{ id: 'task-a', project_id: 'project-a', title: 'Open', status: 'todo', due_date: '2026-08-21' }],
  });
  const summary = summarizeProjectSignals(signals);
  assert.deepEqual(summary.needsActionProjectIds, ['project-a']);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.dueSoonCount, 0);
});

test('healthy active projects do not produce warning summary counts', () => {
  const signals = deriveProjectSignals({
    workspaceId: 'workspace-a',
    project: project({ start_date: '2026-08-01', end_date: '2026-09-01', updated_at: '2026-08-21T12:00:00Z' }),
    today: '2026-08-22',
    tasks: [{ id: 'task-a', project_id: 'project-a', title: 'Open', status: 'todo', due_date: '2026-08-28' }],
  });
  const summary = summarizeProjectSignals(signals);
  assert.deepEqual(summary.needsActionProjectIds, []);
  assert.equal(summary.overdueCount, 0);
  assert.equal(summary.dueSoonCount, 0);
});

test('builds bounded exact context and keeps semantic evidence separate', () => {
  const context = buildProjectIntelligenceContext({
    workspaceId: 'workspace-a',
    project: project(),
    today: '2026-08-22',
    tasks: Array.from({ length: 5 }, (_, index) => ({ id: `task-${index}`, project_id: 'project-a', title: `Task ${index}`, status: 'todo', updated_at: `2026-08-${String(10 + index).padStart(2, '0')}T12:00:00Z` })),
    linkedNotes: [{ workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Project note', content: 'Objective', metadata: { source: 'link-table' } }],
    semanticContext: [
      { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Project note', content: 'Objective', projectId: 'project-a' },
      { workspaceId: 'workspace-b', resourceType: 'note', resourceId: 'private-note', title: 'Private', content: 'Do not include', projectId: 'project-a' },
    ],
    maxTasks: 2,
    maxSemanticContext: 3,
  });

  assert.equal(context.tasks.length, 2);
  assert.equal(context.linkedNotes[0]?.resourceId, 'note-a');
  assert.deepEqual(context.semanticContext.map((item) => item.resourceId), ['note-a']);
  assert.equal(context.signals.some((signal) => signal.kind === 'project_state'), true);
});
