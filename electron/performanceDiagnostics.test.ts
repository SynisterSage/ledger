import assert from 'node:assert/strict';
import test from 'node:test';
import { isSlowIpcDuration } from './performanceDiagnostics.ts';

test('performance diagnostics use a clear slow IPC threshold', () => {
  assert.equal(isSlowIpcDuration(49.99), false);
  assert.equal(isSlowIpcDuration(50), true);
  assert.equal(isSlowIpcDuration(250), true);
});
