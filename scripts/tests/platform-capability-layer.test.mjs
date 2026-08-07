import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const routes = read('src/platform/types/routes.ts');
const desktop = read('src/platform/desktop/desktopPlatform.ts');
const web = read('src/platform/web/webPlatform.ts');
const provider = read('src/platform/PlatformProvider.tsx');

test('typed route contract covers durable resource and overlay state', () => {
  for (const token of [
    "page: 'note'",
    "page: 'project'",
    "page: 'team'",
    "page: 'task'",
    "page: 'event'",
    "page: 'calendar'",
    "page: 'circle'",
    "page: 'inbox'",
    "page: 'notifications'",
    "page: 'search'",
    "page: 'capture'",
    'serializeLedgerRoute',
  ]) assert.match(routes, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(routes, /notes\/(\$\{encodeURIComponent\(route\.noteId\)\})/);
  assert.match(routes, /capture\/\$\{route\.action\}/);
});

test('desktop adapter delegates navigation and window operations to existing preload APIs', () => {
  for (const token of [
    'openModule',
    'goBackWorkspaceWindow',
    'goForwardWorkspaceWindow',
    'getDeviceSessionId',
    'openExternal',
    'closeModule',
    'minimizeModule',
    'toggleModuleFullscreen',
  ]) assert.match(desktop, new RegExp(`desktopWindow\\(\\)?.*${token}|${token}`));
  assert.match(desktop, /focusSection: 'today'/);
  assert.match(desktop, /focus-event:/);
  assert.match(desktop, /focus-reminder:/);
});

test('browser adapter is history-backed, safe for external links, and persists device identity', () => {
  assert.match(web, /history\[replace \? 'replaceState' : 'pushState'\]/);
  assert.match(web, /history\.back\(\)/);
  assert.match(web, /history\.forward\(\)/);
  assert.match(web, /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/);
  assert.match(web, /localStorage\.getItem\(DEVICE_ID_KEY\)/);
  assert.match(web, /localStorage\.setItem\(DEVICE_ID_KEY, id\)/);
  assert.match(web, /canMinimizeWindow: false/);
  assert.match(web, /canOpenNativePopout: false/);
  assert.match(web, /async toggleFullscreen\(\) \{ return false; \}/);
});

test('platform provider exposes one capability boundary', () => {
  assert.match(provider, /createDesktopPlatform/);
  assert.match(provider, /createWebPlatform/);
  assert.match(provider, /PlatformContext\.Provider/);
  assert.match(provider, /usePlatform/);
});
