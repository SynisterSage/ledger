import test from 'node:test';
import assert from 'node:assert/strict';
import { executeReadAskLedgerTool } from './askLedgerReadToolExecutor.ts';
import { runAskLedgerReadToolLoop } from './askLedgerToolLoop.ts';
import { createAskLedgerActionProposal, validateAskLedgerActionProposal } from '../src/shared/askLedger/actions.ts';

const workspaceItem = (workspaceId: string, resourceId: string, title: string) => ({
  workspaceId,
  resourceType: 'task' as const,
  resourceId,
  title,
  content: `${title} context`,
  status: 'todo',
});

test('agent evaluation: read tools cannot cross workspace boundaries', () => {
  const result = executeReadAskLedgerTool(
    { name: 'search_workspace', arguments: { query: 'secret', limit: 50 } },
    { workspaceId: 'workspace-a', items: [workspaceItem('workspace-a', 'task-a', 'Visible task'), workspaceItem('workspace-b', 'task-b', 'Secret task')] },
  );
  assert.equal(result.sourceRefs.length, 0);
});

test('agent evaluation: tool loops are bounded and source-backed', async () => {
  let calls = 0;
  const result = await runAskLedgerReadToolLoop({
    surface: 'ask_ledger',
    initialPrompt: 'Answer from Ledger.',
    context: { workspaceId: 'workspace-a', items: [workspaceItem('workspace-a', 'task-a', 'Visible task')] },
    generate: async (prompt) => {
      calls += 1;
      return calls === 1 ? '[[ledger_tool_call]]{"name":"search_workspace","arguments":{"query":"Visible"}}[[/ledger_tool_call]]' : `Grounded answer using ${prompt.includes('Visible task') ? 'the source' : 'nothing'}.`;
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.toolResults[0]?.sourceRefs[0]?.resourceId, 'task-a');
  assert.doesNotMatch(result.answer, /ledger_tool_call/);
});

test('agent evaluation: write proposals remain confirmation-gated and idempotent', () => {
  const proposal = createAskLedgerActionProposal({ type: 'create_task', payload: { title: 'Follow up' }, sourceMessageId: 'message-a' });
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(validateAskLedgerActionProposal(proposal, 'workspace-a').length, 0);
  assert.match(proposal.idempotencyKey, /^ask-ledger:/);
});
