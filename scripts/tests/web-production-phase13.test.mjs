import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('returnTo allows only internal app paths', async () => {
  const source = await fs.readFile(new URL('src/web/returnTo.ts', root), 'utf8');
  assert.match(source, /startsWith\('\/app'\)/);
  assert.match(source, /startsWith\('\/\/'\)/);
  assert.match(source, /%5c/);
  assert.match(source, /access_token\|refresh_token/);
  assert.match(source, /DEFAULT_RETURN_TO/);
});

test('returnTo rejects external, custom-scheme, backslash, and credential values', async () => {
  const { sanitizeReturnTo } = await import(new URL('src/web/returnTo.ts', root));
  assert.equal(sanitizeReturnTo('/app/w/workspace/notes/note?view=write'), '/app/w/workspace/notes/note?view=write');
  for (const value of [
    'https://evil.example/',
    '//evil.example/app',
    'javascript:alert(1)',
    '/app\\\\evil',
    '/app%5C%5Cevil',
    '/app?access_token=secret',
    '/invite/secret',
  ]) {
    assert.equal(sanitizeReturnTo(value), '/app', value);
  }
});

test('browser Vite target is separate from Electron production', async () => {
  const vite = await fs.readFile(new URL('vite.config.ts', root), 'utf8');
  const packageJson = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
  assert.match(vite, /mode === 'web'/);
  assert.match(vite, /outDir: isBrowserBuild \? 'dist-web' : 'dist'/);
  assert.match(vite, /isBrowserBuild \? '\/' :/);
  assert.equal(packageJson.scripts['build:web'], 'tsc -p tsconfig.json --noEmit && vite build --mode web');
  assert.match(vite, /isWebDevelopment \|\| isBrowserBuild \? \[\] : \[electron\(/);
});

test('browser artifact and handoff contracts are documented', async () => {
  const deployment = await fs.readFile(new URL('docs/web/deployment.md', root), 'utf8');
  const environment = await fs.readFile(new URL('docs/web/environment-contract.md', root), 'utf8');
  assert.match(deployment, /npm run build:web/);
  assert.match(deployment, /dist-web/);
  assert.match(deployment, /SPA fallback/);
  assert.match(environment, /https:\/\/ledgerworkspace\.com/);
  assert.match(environment, /VITE_SUPABASE_PUBLISHABLE_KEY/);
});
