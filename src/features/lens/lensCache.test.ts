import test from 'node:test';
import assert from 'node:assert/strict';
import { LensCache } from './lensCache.ts';
import { LensRequestRegistry } from './lensRequestRegistry.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('Lens cache persists across instances and invalidates changed fingerprints', () => {
  const storage = new MemoryStorage();
  const first = new LensCache<{ summary: string }>({ storageKey: 'lens', storage, now: () => 1000 });
  first.set('workspace-a:overview', 'state-a', { summary: 'Cached.' });

  const second = new LensCache<{ summary: string }>({ storageKey: 'lens', storage, now: () => 1000 });
  assert.deepEqual(second.get('workspace-a:overview', 'state-a'), { summary: 'Cached.' });
  assert.equal(second.get('workspace-a:overview', 'state-b'), null);
});

test('Lens cache expires old results instead of prompting forever from stale state', () => {
  const storage = new MemoryStorage();
  let now = 1000;
  const cache = new LensCache<{ summary: string }>({ storageKey: 'lens', storage, maxAgeMs: 100, now: () => now });
  cache.set('workspace-a:project-a', 'state-a', { summary: 'Cached.' });
  now = 1101;
  assert.equal(cache.get('workspace-a:project-a', 'state-a'), null);
});

test('Lens request registry reuses the same in-flight generation', async () => {
  const registry = new LensRequestRegistry<string>();
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return 'ready';
  };
  const first = registry.getOrCreate('same-context', factory);
  const second = registry.getOrCreate('same-context', factory);
  assert.equal(await first, 'ready');
  assert.equal(await second, 'ready');
  assert.equal(calls, 1);
  assert.equal(registry.size, 0);
});
