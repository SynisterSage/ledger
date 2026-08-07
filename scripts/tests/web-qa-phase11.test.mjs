import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

test('web production safety has an error boundary, focus states, and deployment contract', async () => {
  const boundary = await fs.readFile(new URL('../../src/web/WebErrorBoundary.tsx', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  const deployment = await fs.readFile(new URL('../../docs/web/deployment.md', import.meta.url), 'utf8');
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /window\.location\.reload/);
  assert.match(css, /focus-visible/);
  assert.match(css, /web-ledger-sidebar/);
  assert.match(deployment, /VITE_API_URL/);
  assert.match(deployment, /SPA fallback/);
});

test('desktop and browser launch targets remain explicitly separated', async () => {
  const vite = await fs.readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  const web = await fs.readFile(new URL('../../scripts/dev-web.mjs', import.meta.url), 'utf8');
  const desktop = await fs.readFile(new URL('../../scripts/dev-desktop.mjs', import.meta.url), 'utf8');
  assert.match(vite, /isWebDevelopment \? \[\] : \[electron\(/);
  assert.match(web, /LEDGER_DEV_TARGET: 'web'/);
  assert.match(desktop, /LEDGER_DEV_TARGET: 'desktop'/);
});
