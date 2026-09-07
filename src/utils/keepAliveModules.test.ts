import assert from 'node:assert/strict';
import test from 'node:test';
import { touchKeepAliveModules } from './keepAliveModules.ts';

test('keep-alive modules retain the active module and evict the oldest inactive module', () => {
  assert.deepEqual(touchKeepAliveModules(['dashboard', 'notes', 'calendar'], 'projects'), [
    'notes',
    'calendar',
    'projects',
  ]);
});

test('revisiting a module moves it to the most-recent position without duplicates', () => {
  assert.deepEqual(touchKeepAliveModules(['dashboard', 'notes', 'calendar'], 'notes'), [
    'dashboard',
    'calendar',
    'notes',
  ]);
});
