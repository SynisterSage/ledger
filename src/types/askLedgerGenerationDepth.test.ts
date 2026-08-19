import assert from 'node:assert/strict';
import test from 'node:test';
import { inferAskLedgerGenerationDepth } from './askLedgerGenerationDepth.ts';

test('maps narrow, standard, and research requests to generation depth', () => {
  assert.equal(inferAskLedgerGenerationDepth({ question: 'When is Alfa due?', routeDepth: 'brief', retrievalMode: 'quick' }).depth, 'quick');
  assert.equal(inferAskLedgerGenerationDepth({ question: "What's going on with Alfa?", routeDepth: 'standard', retrievalMode: 'research' }).depth, 'deep');
  assert.equal(inferAskLedgerGenerationDepth({ question: 'Summarize Alfa.', routeDepth: 'standard', retrievalMode: 'quick' }).depth, 'standard');
});

test('explicit depth language overrides automatic routing', () => {
  assert.equal(inferAskLedgerGenerationDepth({ question: 'Give me the full picture of Alfa.', routeDepth: 'standard', retrievalMode: 'quick' }).depth, 'deep');
  assert.equal(inferAskLedgerGenerationDepth({ question: 'Briefly, when is Alfa due?', routeDepth: 'detailed', retrievalMode: 'research' }).depth, 'quick');
});
