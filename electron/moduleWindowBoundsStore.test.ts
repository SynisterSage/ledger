import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ModuleWindowBoundsStore } from './moduleWindowBoundsStore.ts';

test('persists and reloads valid module bounds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-window-bounds-'));
  try {
    const first = new ModuleWindowBoundsStore(directory);
    first.set('notes', {
      bounds: { x: 120, y: 80, width: 1280, height: 820 },
      sidebarPosition: 'left',
    });
    first.flush();

    const second = new ModuleWindowBoundsStore(directory);
    second.load();
    assert.deepEqual(second.get('notes'), {
      bounds: { x: 120, y: 80, width: 1280, height: 820 },
      sidebarPosition: 'left',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ignores malformed and invalid saved bounds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-window-bounds-'));
  try {
    fs.writeFileSync(
      path.join(directory, 'module-window-bounds.json'),
      JSON.stringify({
        version: 1,
        windows: {
          notes: { bounds: { x: 0, y: 0, width: -1, height: 800 }, sidebarPosition: 'left' },
          projects: { bounds: { x: 0, y: 0, width: 1200, height: 760 }, sidebarPosition: 'right' },
        },
      })
    );

    const store = new ModuleWindowBoundsStore(directory);
    store.load();
    assert.equal(store.get('notes'), null);
    assert.deepEqual(store.get('projects')?.bounds, { x: 0, y: 0, width: 1200, height: 760 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
