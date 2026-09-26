import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeMacWidgetSnapshot } from './macWidgetSnapshot.ts';

test('writes a bounded workspace-scoped widget snapshot atomically', async () => {
  const homePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-mac-widget-'));
  try {
    const result = await writeMacWidgetSnapshot(homePath, {
      workspaceId: 'workspace-1',
      workspaceName: 'Personal',
      focusTitle: `  ${'Focus '.repeat(100)} `,
      nextTitle: 'Review the plan',
      nextMeta: 'Today',
      todayCount: 3,
      upcomingCount: 2,
      hasData: true,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.snapshot.workspaceId, 'workspace-1');
    assert.equal(result.snapshot.hasData, true);
    assert.ok(result.snapshot.focusTitle);
    assert.ok(result.snapshot.focusTitle.length <= 240);

    const contents = JSON.parse(await fs.readFile(result.path, 'utf8')) as Record<string, unknown>;
    assert.equal(contents.workspaceId, 'workspace-1');
    assert.equal(contents.workspaceName, 'Personal');
    assert.equal(contents.hasData, true);
  } finally {
    await fs.rm(homePath, { recursive: true, force: true });
  }
});

test('clears data when there is no active workspace', async () => {
  const homePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-mac-widget-'));
  try {
    const result = await writeMacWidgetSnapshot(homePath, { workspaceId: null, hasData: false });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.snapshot.workspaceId, null);
    assert.equal(result.snapshot.hasData, false);
  } finally {
    await fs.rm(homePath, { recursive: true, force: true });
  }
});
