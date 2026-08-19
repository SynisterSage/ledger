import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOverviewFocusSignals, validateOverviewFocusResult } from './overviewFocus.ts';
import { OVERVIEW_FOCUS_FIXTURES, OVERVIEW_FOCUS_FIXTURE_NOW } from './overviewFocusFixtures.ts';

test(`evaluates ${OVERVIEW_FOCUS_FIXTURES.length} deterministic Overview Focus fixtures`, () => {
  for (const fixture of OVERVIEW_FOCUS_FIXTURES) {
    const signalKinds = new Set(deriveOverviewFocusSignals(fixture.snapshot, OVERVIEW_FOCUS_FIXTURE_NOW).map((signal) => signal.kind));
    fixture.acceptableSignalKinds.forEach((kind) => assert.equal(signalKinds.has(kind), true, `${fixture.id} should surface ${kind}`));
    fixture.forbiddenSignalKinds.forEach((kind) => assert.equal(signalKinds.has(kind), false, `${fixture.id} should suppress ${kind}`));
    const result = validateOverviewFocusResult(fixture.modelOutput, fixture.snapshot);
    assert.equal(result.insights.length, fixture.expectedAcceptedCount, `${fixture.id} relevance result`);
  }
});
