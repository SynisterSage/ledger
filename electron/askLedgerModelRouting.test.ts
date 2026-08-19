import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAskLedgerModelRoute } from './askLedgerModelRouting.ts';

test('routes narrow lookups to Fast and deeper evidence to Balanced or Powerful', () => {
  assert.equal(resolveAskLedgerModelRoute({ requestedTier: 'fast', installedTiers: ['fast', 'balanced', 'powerful'], signals: { answerDepth: 'quick' } }).recommendedTier, 'fast');
  assert.equal(resolveAskLedgerModelRoute({ requestedTier: 'fast', installedTiers: ['fast', 'balanced', 'powerful'], signals: { answerDepth: 'standard', evidenceCount: 8 } }).recommendedTier, 'balanced');
  assert.equal(resolveAskLedgerModelRoute({ requestedTier: 'balanced', installedTiers: ['fast', 'balanced', 'powerful'], signals: { researchRoute: true, objectiveCount: 4, providerCount: 2 } }).recommendedTier, 'powerful');
});

test('falls back to the strongest installed tier without downloading or failing the request', () => {
  const route = resolveAskLedgerModelRoute({ requestedTier: 'powerful', installedTiers: ['fast', 'balanced'], signals: { researchRoute: true } });
  assert.equal(route.resolvedTier, 'balanced');
  assert.equal(route.fallbackReason, 'requested_unavailable');
  assert.equal(route.shouldSwitch, false);
});

test('does not switch downward from a user-selected stronger installed tier', () => {
  const route = resolveAskLedgerModelRoute({ requestedTier: 'powerful', installedTiers: ['fast', 'powerful'], signals: { answerDepth: 'quick' } });
  assert.equal(route.resolvedTier, 'powerful');
  assert.equal(route.shouldSwitch, false);
});
