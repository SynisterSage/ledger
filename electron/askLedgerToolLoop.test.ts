import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAskLedgerReadToolInstruction,
  runAskLedgerReadToolLoop,
} from './askLedgerToolLoop.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (
  value: Partial<AskLedgerContextItem> &
    Pick<AskLedgerContextItem, 'resourceType' | 'resourceId' | 'title'>
): AskLedgerContextItem => ({ content: '', workspaceId: 'workspace-1', ...value });

test('publishes only read tools for the selected surface', () => {
  const instruction = buildAskLedgerReadToolInstruction('project_lens');
  assert.match(instruction, /get_project_context/);
  assert.doesNotMatch(instruction, /create_task/);
  assert.doesNotMatch(instruction, /compute_daily_plan/);
});

test('executes one model-requested read and regenerates from its result', async () => {
  const prompts: string[] = [];
  let generation = 0;
  const result = await runAskLedgerReadToolLoop({
    surface: 'ask_ledger',
    initialPrompt: 'Answer the question.',
    context: {
      workspaceId: 'workspace-1',
      items: [
        item({
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Ship release',
          content: 'Open task.',
        }),
      ],
    },
    generate: async (prompt) => {
      prompts.push(prompt);
      generation += 1;
      return generation === 1
        ? '[[ledger_tool_call]]{"name":"search_workspace","arguments":{"query":"release","limit":5}}[[/ledger_tool_call]]'
        : 'The release task is still open.';
    },
  });
  assert.equal(result.toolCalls[0].name, 'search_workspace');
  assert.equal(result.toolResults[0].sourceRefs[0].resourceId, 'task-1');
  assert.equal(result.answer, 'The release task is still open.');
  assert.match(prompts[1], /Ship release/);
});

test('rejects write requests and more than the bounded number of calls', async () => {
  await assert.rejects(
    runAskLedgerReadToolLoop({
      surface: 'ask_ledger',
      initialPrompt: 'Answer.',
      context: { workspaceId: 'workspace-1', items: [] },
      generate: async () =>
        '[[ledger_tool_call]]{"name":"create_task","arguments":{}}[[/ledger_tool_call]]',
    }),
    /not approved/
  );
  await assert.rejects(
    runAskLedgerReadToolLoop({
      surface: 'ask_ledger',
      initialPrompt: 'Answer.',
      maxToolCalls: 1,
      context: { workspaceId: 'workspace-1', items: [] },
      generate: async () =>
        '[[ledger_tool_call]]{"name":"search_workspace","arguments":{"query":"x"}}[[/ledger_tool_call]]',
    }),
    /limit reached/
  );
});
