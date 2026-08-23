import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingPrepEvalFixtures, prepTrustGate } from '../src/types/meetingPrepEvaluation.ts';

test('prep eval covers continuity, state, matching, and empty cases', () => {
  assert.equal(meetingPrepEvalFixtures.length, 18);
  assert.ok(meetingPrepEvalFixtures.some((item) => item.expected === 'no-match'));
  assert.ok(meetingPrepEvalFixtures.some((item) => item.expected === 'state-aware'));
});

test('prep trust gate rejects stale, incorrect-open, or filler claims', () => {
  assert.equal(prepTrustGate({ useful: 14, staleClaims: 0, incorrectOpenClaims: 0, fillerPoints: 0 }), true);
  assert.equal(prepTrustGate({ useful: 18, staleClaims: 1, incorrectOpenClaims: 0, fillerPoints: 0 }), false);
  assert.equal(prepTrustGate({ useful: 18, staleClaims: 0, incorrectOpenClaims: 1, fillerPoints: 0 }), false);
});
