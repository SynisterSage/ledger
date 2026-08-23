import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingAiEvalCases, meetingAiEvalTrustGate } from '../src/types/meetingAiEvaluation.ts';

test('permanent meeting AI eval set covers the full v1 trust surface', () => {
  assert.equal(meetingAiEvalCases.length, 32);
  assert.ok(new Set(meetingAiEvalCases.map((item) => item.category)).size >= 8);
});

test('meeting AI trust gate rejects unsupported, stale, false-speaker, and cross-workspace claims', () => {
  assert.equal(meetingAiEvalTrustGate({ answerCorrectness: 0.9, citationCorrectness: 0.95, unsupportedClaims: 0, falseSpeakerAttribution: 0, staleStateClaims: 0, crossWorkspaceLeakage: 0, usefulUncertainty: 0.9 }), true);
  assert.equal(meetingAiEvalTrustGate({ answerCorrectness: 1, citationCorrectness: 1, unsupportedClaims: 0, falseSpeakerAttribution: 1, staleStateClaims: 0, crossWorkspaceLeakage: 0, usefulUncertainty: 1 }), false);
});
