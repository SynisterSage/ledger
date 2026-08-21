import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAskLedgerOutput } from './askLedgerOutputGuard.ts';

test('removes hidden reasoning and unmistakable internal metadata without changing normal prose', () => {
  const result = sanitizeAskLedgerOutput('<think>private chain</think>\nThe **project** is moving.\nmodel_id: qwen-test\nretrieval_score: 0.91');
  assert.equal(result.answer, 'The **project** is moving.');
  assert.equal(result.diagnostics.hiddenReasoningRemoved, true);
  assert.equal(result.diagnostics.internalMetadataRemoved, true);
});

test('does not expose an incomplete reasoning block during streaming', () => {
  const result = sanitizeAskLedgerOutput('Visible preface\n<think>partial private trace');
  assert.equal(result.answer, 'Visible preface');
  assert.equal(result.diagnostics.hiddenReasoningRemoved, true);
});

test('normalizes only known Ledger values', () => {
  const result = sanitizeAskLedgerOutput('Final Portfolio is due 2026-08-21T15:00:00.', [
    { raw: '2026-08-21T15:00:00', display: 'Friday, Aug 21 at 3:00 PM', kind: 'structured_value' },
  ]);
  assert.equal(result.answer, 'Final Portfolio is due Friday, Aug 21 at 3:00 PM.');
  assert.equal(result.diagnostics.knownStructuredValueNormalized, true);
});

test('does not rewrite unknown technical dates or ordinary identifiers', () => {
  const result = sanitizeAskLedgerOutput('The API accepts 2026-08-21 and request id abc-123.');
  assert.equal(result.answer, 'The API accepts 2026-08-21 and request id abc-123.');
  assert.equal(result.diagnostics.knownStructuredValueNormalized, false);
  assert.equal(result.diagnostics.knownResourceIdNormalized, false);
});

test('replaces a known resource UUID with its user-facing title', () => {
  const result = sanitizeAskLedgerOutput('project 123e4567-e89b-12d3-a456-426614174000 is moving.', [
    { raw: '123e4567-e89b-12d3-a456-426614174000', display: 'Final Portfolio', kind: 'resource_id' },
  ]);
  assert.equal(result.answer, 'project Final Portfolio is moving.');
  assert.equal(result.diagnostics.knownResourceIdNormalized, true);
});
