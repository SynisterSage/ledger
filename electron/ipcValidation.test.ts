import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedOptionalString,
  boundedPerformanceDetails,
  isValidModuleWindowKind,
} from './ipcValidation.ts';

test('IPC validation accepts known module kinds and rejects unknown values', () => {
  assert.equal(isValidModuleWindowKind('notes'), true);
  assert.equal(isValidModuleWindowKind('shell'), false);
  assert.equal(isValidModuleWindowKind({}), false);
});

test('IPC validation bounds route strings and rejects control characters', () => {
  assert.equal(boundedOptionalString('note-1', 100), 'note-1');
  assert.equal(boundedOptionalString('', 100), null);
  assert.equal(boundedOptionalString('bad\nroute', 100), undefined);
  assert.equal(boundedOptionalString('x'.repeat(101), 100), undefined);
});

test('performance details are reduced to bounded primitive fields', () => {
  assert.deepEqual(
    boundedPerformanceDetails({ ok: true, count: 3, text: 'safe', nested: {}, 'bad key': 'drop' }),
    { ok: true, count: 3, text: 'safe' }
  );
});
