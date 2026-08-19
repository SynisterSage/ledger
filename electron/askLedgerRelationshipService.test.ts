import assert from 'node:assert/strict';
import test from 'node:test';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { expandRelatedContext } from './askLedgerRelationshipService.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a',
  resourceType: 'note',
  resourceId: 'note-default',
  title: 'Resource',
  content: 'Context',
  ...overrides,
});

test('expands project to milestones and tasks through reverse relationships', () => {
  const project = item({ resourceType: 'project', resourceId: 'project-1', title: 'Alfa' });
  const milestone = item({ resourceType: 'milestone', resourceId: 'milestone-1', projectId: 'project-1' });
  const task = item({ resourceType: 'task', resourceId: 'task-1', projectId: 'project-1', milestoneId: 'milestone-1', status: 'Blocked', horizon: 'today', taskHorizon: 'today', priority: 'high', dueAt: '2026-08-20' });
  const result = expandRelatedContext({ workspaceId: 'workspace-a', seeds: [project], corpus: [project, milestone, task], maxDepth: 2 });

  assert.deepEqual(new Set(result.items.map((entry) => entry.resourceId)), new Set(['milestone-1', 'task-1']));
  assert.equal(result.items.find((entry) => entry.resourceId === 'task-1')?.horizon, 'today');
  assert.equal(result.items.find((entry) => entry.resourceId === 'task-1')?.status, 'Blocked');
  assert.equal(result.diagnostics.depthCounts['1']?.milestone, 1);
  assert.equal(result.diagnostics.depthCounts['1']?.task, 1);
});

test('expands a meeting cluster from event to note and transcript, then project', () => {
  const event = item({ resourceType: 'event', resourceId: 'event-1', parentResourceId: 'note-1', projectId: 'project-1' });
  const note = item({ resourceType: 'note', resourceId: 'note-1', projectId: 'project-1' });
  const transcript = item({ resourceType: 'transcript', resourceId: 'transcript-1', parentResourceId: 'note-1' });
  const project = item({ resourceType: 'project', resourceId: 'project-1' });
  const result = expandRelatedContext({ workspaceId: 'workspace-a', seeds: [event], corpus: [event, note, transcript, project], maxDepth: 2 });

  assert.equal(result.items.some((entry) => entry.resourceId === 'note-1'), true);
  assert.equal(result.items.some((entry) => entry.resourceId === 'transcript-1'), true);
  assert.equal(result.items.some((entry) => entry.resourceId === 'project-1'), true);
  assert.ok(result.diagnostics.paths.some((path) => path.path.join(' -> ') === 'event:event-1 -> note:note-1 -> transcript:transcript-1'));
});

test('supports reverse task-to-project traversal and ignores semantic-only matches', () => {
  const task = item({ resourceType: 'task', resourceId: 'task-1', projectId: 'project-1' });
  const project = item({ resourceType: 'project', resourceId: 'project-1' });
  const semanticOnly = item({ resourceType: 'note', resourceId: 'note-unrelated', title: 'Same words', content: 'Same words but no relationship.' });
  const result = expandRelatedContext({ workspaceId: 'workspace-a', seeds: [task], corpus: [task, project, semanticOnly] });

  assert.deepEqual(result.items.map((entry) => entry.resourceId), ['project-1']);
});

test('prevents cycles, enforces depth and bounded expansion', () => {
  const project = item({ resourceType: 'project', resourceId: 'project-1' });
  const note = item({ resourceType: 'note', resourceId: 'note-1', projectId: 'project-1', parentResourceId: 'project-1' });
  const transcript = item({ resourceType: 'transcript', resourceId: 'transcript-1', parentResourceId: 'note-1' });
  const outside = item({ workspaceId: 'workspace-b', resourceType: 'task', resourceId: 'outside', projectId: 'project-1' });
  const result = expandRelatedContext({ workspaceId: 'workspace-a', seeds: [project], corpus: [project, note, transcript, outside], maxDepth: 2, limits: { maxTotal: 1 } });

  assert.equal(result.items.length, 1);
  assert.equal(result.items.some((entry) => entry.resourceId === 'outside'), false);
  assert.ok(result.diagnostics.truncated > 0);
  assert.ok(result.diagnostics.cyclePrevented + result.diagnostics.deduplicated > 0);
  assert.equal(result.diagnostics.paths.every((path) => path.depth <= 2), true);
});

test('expands notifications and activity through explicit task, project, and team links', () => {
  const notification = item({ resourceType: 'notification', resourceId: 'notification-1', read: false, taskId: 'task-1', relationships: [{ relationshipType: 'linked_task', resourceType: 'task', resourceId: 'task-1', direction: 'outbound' }] });
  const task = item({ resourceType: 'task', resourceId: 'task-1', projectId: 'project-1', status: 'In Progress' });
  const project = item({ resourceType: 'project', resourceId: 'project-1' });
  const activity = item({ resourceType: 'activity', resourceId: 'activity-1', teamId: 'team-1', sourceLabel: 'Circle', relationships: [{ relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: 'team-1', direction: 'outbound' }] });
  const team = item({ resourceType: 'team', resourceId: 'team-1', title: 'Design teamspace' });
  const result = expandRelatedContext({ workspaceId: 'workspace-a', seeds: [notification, activity], corpus: [notification, task, project, activity, team], maxDepth: 2 });
  assert.ok(result.items.some((entry) => entry.resourceId === 'task-1'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'project-1'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'team-1'));
});
