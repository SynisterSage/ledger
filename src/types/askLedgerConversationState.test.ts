import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAskLedgerConversationState, resolveAskLedgerConversation } from './askLedgerConversationState.ts';

const sources = [
  { resourceType: 'project' as const, resourceId: 'project-alfa', title: 'Alfa 2026 Catalog', projectId: 'project-alfa' },
  { resourceType: 'task' as const, resourceId: 'task-long-term', title: 'Archive Final Assets', projectId: 'project-alfa' },
  { resourceType: 'event' as const, resourceId: 'event-workday', title: 'Workday Meeting', projectId: 'project-alfa' },
  { resourceType: 'external' as const, resourceId: 'github-alfa', title: 'GitHub PR 142', projectId: 'project-alfa', integrationProvider: 'github' },
];

const state = deriveAskLedgerConversationState('workspace-a', 'What is going on with Alfa?', sources as never);

test('tracks bounded grounded entities by stable resource IDs', () => {
  assert.equal(state.workspaceId, 'workspace-a');
  assert.ok(state.activeEntities.some((entity) => entity.resourceId === 'project-alfa'));
  assert.ok(state.previousEvidenceSourceIds.includes('project:project-alfa'));
  assert.ok(state.activeResources.length <= 16);
});

test('resolves project follow-ups and requests fresh mutable state', () => {
  const resolved = resolveAskLedgerConversation('What about its long-term tasks?', state, 'workspace-a');
  assert.equal(resolved.isFollowUp, true);
  assert.equal(resolved.mode, 'refresh_state');
  assert.deepEqual(resolved.projectIds, ['project-alfa']);
  assert.equal(resolved.resolvedReferences.it, 'project:project-alfa');
});

test('switches provider while retaining the grounded project', () => {
  const slackState = { ...state, activeEntities: state.activeEntities.map((entity) => entity.resourceType === 'external' ? { ...entity, integrationProvider: 'slack' } : entity) };
  const resolved = resolveAskLedgerConversation('What about GitHub?', slackState, 'workspace-a');
  assert.equal(resolved.mode, 'switch_provider');
  assert.equal(resolved.provider, 'github');
  assert.deepEqual(resolved.projectIds, ['project-alfa']);
});

test('does not cross workspace boundaries or guess an unresolved referent', () => {
  assert.equal(resolveAskLedgerConversation('What about it?', state, 'workspace-b').contextReset, true);
  const unresolved = resolveAskLedgerConversation('What about that?', { ...state, activeEntities: [], activeResources: [] }, 'workspace-a');
  assert.deepEqual(unresolved.unresolvedReferences, ['referent']);
  assert.deepEqual(unresolved.resourceKeys, []);
});

test('treats an explicitly named active project as a context switch', () => {
  const watercolor = { ...state, activeEntities: [...state.activeEntities, { resourceType: 'project' as const, resourceId: 'project-watercolor', title: 'Watercolor Exhibition' }] };
  const resolved = resolveAskLedgerConversation('And Watercolor?', watercolor, 'workspace-a');
  assert.equal(resolved.mode, 'switch_entity');
  assert.deepEqual(resolved.projectIds, ['project-watercolor']);
});
