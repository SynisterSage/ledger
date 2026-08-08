import assert from 'node:assert/strict';
import { test } from 'node:test';

const { parseWebLocation } = await import('../../src/web/webRouteState.ts');
const { serializeLedgerRoute } = await import('../../src/platform/types/routes.ts');

test('capture routes parse as browser overlays with context', () => {
  const cases = [
    ['note', 'quick-note'],
    ['task', 'quick-task'],
    ['event', 'quick-event'],
    ['reminder', 'quick-reminder'],
  ];
  for (const [action] of cases) {
    const parsed = parseWebLocation({
      pathname: `/app/w/ws/capture/${action}`,
      search: `?project=p1&date=2026-08-06&context=ledger-selection%7C%7C%7C%7Cp1`,
    });
    assert.equal(parsed.kind, 'overlay');
    assert.equal(parsed.route.page, 'capture');
    assert.equal(parsed.route.action, action);
    assert.equal(parsed.route.projectId, 'p1');
  }
  const followUp = parseWebLocation({
    pathname: '/app/w/ws/follow-up',
    search: '?entity=ledger-followup%7Ce1',
  });
  assert.equal(followUp.kind, 'overlay');
  assert.equal(followUp.route.page, 'follow-up');
  assert.equal(followUp.route.entityId, 'ledger-followup|e1');
});

test('overlay routes serialize with contextual browser state', () => {
  assert.equal(
    serializeLedgerRoute({
      kind: 'overlay',
      workspaceId: 'ws',
      page: 'capture',
      action: 'task',
      projectId: 'p1',
    }),
    '/app/w/ws/capture/task?project=p1'
  );
  assert.equal(
    serializeLedgerRoute({ kind: 'overlay', workspaceId: 'ws', page: 'follow-up', entityId: 'e1' }),
    '/app/w/ws/follow-up?entity=e1'
  );
});

test('browser overlay history preserves the background and shared capture UI', async () => {
  const platformSource = await (
    await import('node:fs/promises')
  ).readFile(new URL('../../src/platform/web/webPlatform.ts', import.meta.url), 'utf8');
  const shellSource = await (
    await import('node:fs/promises')
  ).readFile(new URL('../../src/web/WebAppShell.tsx', import.meta.url), 'utf8');
  const captureSource = await (
    await import('node:fs/promises')
  ).readFile(
    new URL('../../src/components/Common/QuickCaptureWindow.tsx', import.meta.url),
    'utf8'
  );
  assert.match(platformSource, /backgroundPath/);
  assert.match(platformSource, /closeOverlay\(\)/);
  assert.match(shellSource, /<QuickCaptureWindow[\s\S]*browserMode/);
  assert.match(captureSource, /platform\.navigation\.closeOverlay/);
});

test('malformed capture context remains safe', () => {
  assert.equal(
    parseWebLocation({ pathname: '/app/w/ws/capture/task', search: '?context=%E0%A4%A' }).kind,
    'overlay'
  );
  assert.equal(
    parseWebLocation({ pathname: '/app/w/ws/capture/invalid', search: '' }).kind,
    'unknown'
  );
});
