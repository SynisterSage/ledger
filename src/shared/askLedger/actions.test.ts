import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAskLedgerActionProposal,
  normalizeAskLedgerActionProposal,
  validateAskLedgerActionProposal,
} from './actions.ts';

test('creates a confirmed, workspace-bound task proposal with idempotency metadata', () => {
  const proposal = createAskLedgerActionProposal({
    type: 'create_task',
    payload: { title: 'Review the draft' },
    sourceMessageId: 'assistant-1',
    initialContext: {
      resourceType: 'project',
      resourceId: 'project-1',
      title: 'Catalog',
      workspaceId: 'workspace-1',
    },
  });
  assert.equal(proposal.risk, 'write');
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.workspaceId, 'workspace-1');
  assert.equal(proposal.idempotencyKey, 'ask-ledger:assistant-1-action-0');
  assert.deepEqual(proposal.sourceRefs, [
    { resourceType: 'project', resourceId: 'project-1', title: 'Catalog' },
  ]);
});

test('normalizes untrusted action metadata into the canonical policy', () => {
  const proposal = normalizeAskLedgerActionProposal(
    {
      type: 'create_task',
      payload: { title: 'Do the thing' },
      risk: 'read',
      requiresConfirmation: false,
      status: 'pending',
    },
    { sourceMessageId: 'assistant-2' }
  );
  assert.equal(proposal?.risk, 'write');
  assert.equal(proposal?.requiresConfirmation, true);
});

test('rejects invalid action arguments before execution', () => {
  const proposal = createAskLedgerActionProposal({
    type: 'update_task_status',
    payload: { task_id: 'task-1', status: 'archived' },
    sourceMessageId: 'assistant-3',
  });
  assert.deepEqual(validateAskLedgerActionProposal(proposal, 'workspace-1'), [
    'The task status update is invalid.',
  ]);
});

test('rejects proposals that bypass the canonical confirmation contract', () => {
  const proposal = createAskLedgerActionProposal({
    type: 'create_task',
    payload: { title: 'Follow up' },
    sourceMessageId: 'message-1',
  });
  assert.deepEqual(validateAskLedgerActionProposal({ ...proposal, toolName: 'update_task', requiresConfirmation: false }, 'workspace-1'), [
    'The action tool does not match its mutation type.',
    'A shared Ledger mutation must require confirmation.',
  ]);
  assert.match(validateAskLedgerActionProposal({ ...proposal, idempotencyKey: '' }, 'workspace-1').join('\n'), /idempotency/);
});
