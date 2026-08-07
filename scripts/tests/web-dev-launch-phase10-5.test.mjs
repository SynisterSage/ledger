import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

test('web development target excludes Electron while desktop target keeps it', async () => {
  const vite = await fs.readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  const web = await fs.readFile(new URL('../../scripts/dev-web.mjs', import.meta.url), 'utf8');
  const desktop = await fs.readFile(new URL('../../scripts/dev-desktop.mjs', import.meta.url), 'utf8');

  assert.match(vite, /LEDGER_DEV_TARGET === 'web'/);
  assert.match(vite, /isWebDevelopment \? \[\] : \[electron\(/);
  assert.match(web, /LEDGER_DEV_TARGET: 'web'/);
  assert.match(desktop, /LEDGER_DEV_TARGET: 'desktop'/);
});

test('renderer selects WebAppShell without an Electron preload bridge', async () => {
  const main = await fs.readFile(new URL('../../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /window\.desktopWindow \? <App \/> : <WebErrorBoundary><WebAppShell \/><\/WebErrorBoundary>/);
});
