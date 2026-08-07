import assert from 'node:assert/strict';
import { test } from 'node:test';

const { parseWebLocation } = await import('../../src/web/webRouteState.ts');

test('web shell parses app, workspace-root, home, dashboard, and today locations', () => {
  assert.deepEqual(parseWebLocation({ pathname: '/app', search: '' }), { kind: 'app-root' });
  assert.deepEqual(parseWebLocation({ pathname: '/app/w/workspace-1', search: '' }), {
    kind: 'workspace-root',
    workspaceId: 'workspace-1',
  });
  assert.deepEqual(parseWebLocation({ pathname: '/app/w/workspace-1/home', search: '' }), {
    kind: 'route',
    route: { kind: 'workspace', workspaceId: 'workspace-1', page: 'home' },
  });
  assert.equal(parseWebLocation({ pathname: '/app/w/workspace-1/dashboard', search: '' }).route.page, 'dashboard');
  assert.equal(parseWebLocation({ pathname: '/app/w/workspace-1/today', search: '' }).route.page, 'today');
});

test('unknown browser locations use the shell fallback', () => {
  assert.equal(parseWebLocation({ pathname: '/app/w/workspace-1/projects', search: '' }).route.page, 'projects');
  assert.deepEqual(parseWebLocation({ pathname: '/desktop', search: '?window=module&module=projects' }), { kind: 'unknown' });
});

test('browser navigation port updates history and emits route intent', async () => {
  const events = [];
  const historyCalls = [];
  const storage = new Map();
  globalThis.window = {
    location: { href: 'http://localhost:5173/app' },
    history: {
      pushState: (_state, _title, path) => historyCalls.push(['push', path]),
      replaceState: (_state, _title, path) => historyCalls.push(['replace', path]),
      back: () => historyCalls.push(['back']),
      forward: () => historyCalls.push(['forward']),
    },
    dispatchEvent: (event) => events.push(event),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    open: (...args) => events.push(args),
  };
  const { createWebPlatform } = await import('../../src/platform/web/webPlatform.ts');
  const platform = createWebPlatform();
  platform.navigation.openRoute({ kind: 'workspace', workspaceId: 'ws', page: 'dashboard' });
  platform.navigation.goBack();
  platform.navigation.goForward();
  assert.deepEqual(historyCalls, [
    ['push', '/app/w/ws/dashboard'],
    ['back'],
    ['forward'],
  ]);
  assert.equal(events[0].type, 'ledger:route-intent');
});

test('browser capability flags disable native window behavior', async () => {
  const { createWebPlatform } = await import('../../src/platform/web/webPlatform.ts');
  const platform = createWebPlatform();
  assert.equal(platform.capabilities.canMinimizeWindow, false);
  assert.equal(platform.capabilities.canOpenNativePopout, false);
  assert.equal(await platform.windowShell.toggleFullscreen(), false);
});
