import assert from 'node:assert/strict';
import test from 'node:test';

import { isLedgerEmptyStateKind, LEDGER_EMPTY_STATE_KINDS } from './ledgerEmptyStateContract.ts';

test('defines the supported semantic empty-state kinds', () => {
  assert.deepEqual(LEDGER_EMPTY_STATE_KINDS, [
    'first-use',
    'no-results',
    'completed',
    'permission',
    'error',
    'offline',
  ]);
});

test('rejects loading as an empty state', () => {
  assert.equal(isLedgerEmptyStateKind('loading'), false);
  assert.equal(isLedgerEmptyStateKind('first-use'), true);
  assert.equal(isLedgerEmptyStateKind('error'), true);
});
