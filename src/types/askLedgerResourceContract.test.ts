import assert from 'node:assert/strict';
import test from 'node:test';
import type { AskLedgerContextItem } from './askLedgerContext.ts';
import { ASK_LEDGER_RESOURCE_INVENTORY, buildAskLedgerDocumentDiagnostics } from './askLedgerResourceContract.ts';

const item = (resourceType: AskLedgerContextItem['resourceType'], resourceId: string, overrides: Partial<AskLedgerContextItem> = {}): AskLedgerContextItem => ({
  resourceType,
  resourceId,
  title: resourceId,
  content: resourceId,
  ...overrides,
});

test('canonical inventory names actual workspace and conversation resources without generic flattening', () => {
  const types = ASK_LEDGER_RESOURCE_INVENTORY.map((entry) => entry.resourceType);
  assert.deepEqual(types.slice(0, 12), ['project', 'milestone', 'task', 'note', 'event', 'reminder', 'transcript', 'intake', 'team', 'person', 'external', 'attachment']);
  assert.equal(ASK_LEDGER_RESOURCE_INVENTORY.find((entry) => entry.resourceType === 'task')?.currentlyIndexed, true);
  assert.equal(ASK_LEDGER_RESOURCE_INVENTORY.find((entry) => entry.resourceType === 'activity')?.currentlyIndexed, true);
  assert.equal(ASK_LEDGER_RESOURCE_INVENTORY.find((entry) => entry.resourceType === 'notification')?.currentlyIndexed, true);
  assert.match(ASK_LEDGER_RESOURCE_INVENTORY.find((entry) => entry.resourceType === 'task')?.notes ?? '', /not separate resource rows/);
});

test('diagnostics distinguish available, indexed, retrieved, and context-dropped resources', () => {
  const diagnostics = buildAskLedgerDocumentDiagnostics({
    available: [
      item('project', 'project-1'),
      item('task', 'task-1', { horizon: 'today', taskHorizon: 'today', status: 'Blocked', milestoneId: 'milestone-1', relationships: [{ relationshipType: 'belongs_to_milestone', resourceType: 'milestone', resourceId: 'milestone-1' }] }),
      item('task', 'task-2'),
      item('note', 'note-1'),
    ],
    indexed: [item('project', 'project-1'), item('task', 'task-1'), item('task', 'task-2')],
    retrieved: [item('task', 'task-1'), item('project', 'project-1')],
    selected: [item('task', 'task-1')],
  });

  assert.deepEqual(diagnostics.available, { project: 1, task: 2, note: 1 });
  assert.deepEqual(diagnostics.notIndexed, { note: 1 });
  assert.deepEqual(diagnostics.notRetrieved, { task: 1 });
  assert.deepEqual(diagnostics.droppedFromContext, { project: 1 });
});

test('task planning semantics and relationship IDs remain typed context', () => {
  const task = item('task', 'task-1', {
    status: 'Completed',
    taskHorizon: 'long_term',
    horizon: 'long_term',
    projectId: 'project-1',
    milestoneId: 'milestone-1',
    dueAt: '2026-08-20',
    relationships: [
      { relationshipType: 'belongs_to_project', resourceType: 'project', resourceId: 'project-1' },
      { relationshipType: 'belongs_to_milestone', resourceType: 'milestone', resourceId: 'milestone-1' },
    ],
  });
  assert.equal(task.horizon, 'long_term');
  assert.deepEqual(task.relationships?.map(({ resourceType, resourceId }) => `${resourceType}:${resourceId}`), ['project:project-1', 'milestone:milestone-1']);
});
