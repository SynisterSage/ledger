import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DATE_RANGE_DAYS, MAX_LIMIT, MAX_NOTE_CONTENT, decodeCursor, encodeCursor, plainText } from './server.js';

test('MCP output helpers strip unsafe markup and cap constants', () => {
  assert.equal(plainText('<script>alert(1)</script><p>Hello&nbsp;<strong>Ledger</strong></p>'), 'Hello Ledger');
  assert.equal(decodeCursor(encodeCursor(25)), 25);
  assert.equal(MAX_LIMIT, 100);
  assert.equal(MAX_NOTE_CONTENT, 20_000);
  assert.equal(MAX_DATE_RANGE_DAYS, 90);
});

test('invalid MCP cursors are rejected before database queries', () => {
  assert.equal(decodeCursor('not-a-cursor'), null);
  assert.equal(decodeCursor('-1'), null);
});
