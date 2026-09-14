import test from 'node:test';
import assert from 'node:assert/strict';
import { getAskLedgerTool, listAskLedgerTools, toolNameForAskLedgerAction } from './tools.ts';

test('exposes read, compute, and write tools with strict input boundaries', () => {
  const tools = listAskLedgerTools({ surface: 'project_lens', includeWrites: true });
  assert.ok(tools.some((tool) => tool.kind === 'read'));
  assert.ok(tools.some((tool) => tool.kind === 'compute'));
  assert.ok(tools.some((tool) => tool.kind === 'write'));
  tools.forEach((tool) => {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.requiredScopes.length > 0);
  });
});

test('keeps writes out of the default model catalog', () => {
  assert.ok(listAskLedgerTools().every((tool) => tool.kind !== 'write'));
  assert.equal(getAskLedgerTool('create_task')?.requiresConfirmation, true);
});

test('maps existing UI actions to canonical tool names', () => {
  assert.equal(toolNameForAskLedgerAction('update_task_status'), 'update_task');
  assert.equal(toolNameForAskLedgerAction('create_task'), 'create_task');
});

test('uses the live action payload naming convention in write schemas', () => {
  assert.deepEqual(getAskLedgerTool('create_task')?.inputSchema.required, ['title', 'idempotency_key']);
  assert.deepEqual(getAskLedgerTool('create_note')?.inputSchema.required, ['title', 'idempotency_key']);
  assert.ok(getAskLedgerTool('create_note')?.inputSchema.properties.project_id);
  assert.deepEqual(getAskLedgerTool('update_task')?.inputSchema.required, ['task_id', 'idempotency_key']);
  assert.ok(getAskLedgerTool('update_task')?.inputSchema.properties.expected_updated_at);
});
