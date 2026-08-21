import assert from 'node:assert/strict';
import test from 'node:test';
import type { AskLedgerContextItem } from '../types/askLedgerContext.ts';
import { ASK_LEDGER_CHUNKER_VERSION, ASK_LEDGER_NORMALIZATION_VERSION, ASK_LEDGER_DESKTOP_BUDGET, budgetForAskLedgerMode, chunkAskLedgerResource, lexicalMatch, scoreHybridCandidate } from './askLedger/index.ts';

const resource = (overrides: Partial<AskLedgerContextItem> = {}): AskLedgerContextItem => ({ workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Ask Ledger decision', content: '<p>Keep retrieval grounded in Ledger evidence.</p>', ...overrides });

test('shared normalization and chunking are versioned and deterministic', () => {
  const chunks = chunkAskLedgerResource(resource(), { maxCharacters: 200 });
  assert.equal(chunks[0]?.title, 'Ask Ledger decision');
  assert.equal(chunks[0]?.text, 'Keep retrieval grounded in Ledger evidence.');
  assert.equal(chunks[0]?.normalizationVersion, ASK_LEDGER_NORMALIZATION_VERSION);
  assert.equal(chunks[0]?.chunkerVersion, ASK_LEDGER_CHUNKER_VERSION);
  assert.deepEqual(chunks.map((chunk) => chunk.chunkId), ['note:note-a:0']);
});

test('shared hybrid ranking preserves lexical and structured signals', () => {
  const match = lexicalMatch('Ask Ledger decision', resource());
  const score = scoreHybridCandidate({ semanticScore: 0.8, lexicalScore: match.score, exactEntityMatch: true, structuredMatch: true });
  assert.equal(match.phraseMatch, true);
  assert.ok(score.score > 1);
  assert.deepEqual(score.reasons.slice(-2), ['exact-title-match', 'structured-match']);
});

test('desktop budget is configuration rather than ranking policy', () => {
  assert.equal(ASK_LEDGER_DESKTOP_BUDGET.selectedResourceLimit, 12);
  assert.equal(ASK_LEDGER_DESKTOP_BUDGET.evidenceTokenBudget, 2800);
});

test('retrieval modes change budgets without changing ranking policy', () => {
  assert.equal(budgetForAskLedgerMode('quick').selectedResourceLimit, 6);
  assert.equal(budgetForAskLedgerMode('standard').selectedResourceLimit, ASK_LEDGER_DESKTOP_BUDGET.selectedResourceLimit);
  assert.ok(budgetForAskLedgerMode('research').evidenceTokenBudget > budgetForAskLedgerMode('standard').evidenceTokenBudget);
});
