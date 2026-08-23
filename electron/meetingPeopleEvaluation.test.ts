import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMeetingIdentityPredictions, meetingIdentityEvalFixtures } from '../src/types/meetingPeopleEvaluation.ts';

test('meeting identity eval set has broad conservative coverage', () => {
  assert.equal(meetingIdentityEvalFixtures.length, 18);
  assert.ok(meetingIdentityEvalFixtures.some((item) => item.expectedLabel === 'unknown'));
  assert.ok(meetingIdentityEvalFixtures.some((item) => item.expectedLabel === 'known'));
});

test('semantic evaluation tracks false confident identity separately', () => {
  const predictions = Object.fromEntries(meetingIdentityEvalFixtures.map((fixture) => [fixture.id, {
    label: fixture.expectedLabel,
    person: fixture.expectedPerson,
    confidence: fixture.expectedLabel === 'unknown' ? 0.2 : 0.9,
    actionOwner: fixture.actionOwner,
  }]));
  const result = evaluateMeetingIdentityPredictions(predictions);
  assert.equal(result.accuracy, 1);
  assert.equal(result.falseConfidentAssignments, 0);
  assert.equal(result.actionOwnerAccuracy, 1);
  assert.equal(result.passes, true);
});

test('a confident name on an unknown case fails the trust gate', () => {
  const result = evaluateMeetingIdentityPredictions({
    'group-system-audio': { label: 'suggested', person: 'Samantha', confidence: 0.95 },
  });
  assert.equal(result.falseConfidentAssignments, 1);
  assert.equal(result.passes, false);
});
