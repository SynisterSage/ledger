import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaleNavigationGeneration } from './navigationGeneration.ts';

test('navigation generations reject older route acknowledgements', () => {
  assert.equal(isStaleNavigationGeneration(4, 5), true);
  assert.equal(isStaleNavigationGeneration(5, 5), false);
  assert.equal(isStaleNavigationGeneration(undefined, 5), false);
});
