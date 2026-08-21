import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAskLedgerModelRoute } from './askLedgerModelRouting.ts';

const installed = ['fast', 'balanced'] as const;

test('routes quick lookups to Fast and ordinary evidence work to Balanced', () => {
  assert.equal(resolveAskLedgerModelRoute({ requestedTier: 'fast', installedTiers: [...installed], signals: { answerDepth: 'quick' } }).recommendedTier, 'fast');
  const route = resolveAskLedgerModelRoute({ requestedTier: 'fast', installedTiers: [...installed], signals: { answerDepth: 'standard', evidenceCount: 8 } });
  assert.equal(route.recommendedTier, 'balanced');
  assert.equal(route.reasoningMode, 'off');
});

test('research does not imply Thinking', () => {
  const route = resolveAskLedgerModelRoute({ requestedTier: 'balanced', installedTiers: [...installed], signals: { researchRoute: true, objectiveCount: 7, providerCount: 2, question: 'Summarize my last meetings.' } });
  assert.equal(route.resolvedTier, 'balanced');
  assert.equal(route.reasoningMode, 'off');
});

test('complex questions select Thinking on the same Balanced model', () => {
  const route = resolveAskLedgerModelRoute({ requestedTier: 'balanced', installedTiers: [...installed], signals: { question: 'Think deeply about why Atlas keeps slipping.', researchRoute: true } });
  assert.equal(route.resolvedTier, 'balanced');
  assert.equal(route.reasoningMode, 'thinking');
});

test('legacy Powerful requests resolve to Balanced without a separate model', () => {
  const route = resolveAskLedgerModelRoute({ requestedTier: 'powerful', installedTiers: [...installed], signals: { researchRoute: true } });
  assert.equal(route.resolvedTier, 'balanced');
  assert.equal(route.recommendedTier, 'balanced');
  assert.equal(route.fallbackReason, 'requested_unavailable');
});
