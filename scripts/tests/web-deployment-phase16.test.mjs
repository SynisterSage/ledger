import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('browser deployment builds the dedicated dist-web artifact', () => {
  assert.equal(packageJson.scripts['build:web'], 'tsc -p tsconfig.json --noEmit && vite build --mode web');
  assert.equal(vercel.buildCommand, 'npm run build:web');
  assert.equal(vercel.outputDirectory, 'dist-web');
});

test('app roots use the browser SPA entry without catching assets', () => {
  const appRoutes = vercel.rewrites.filter(({ source }) => source === '/app' || source === '/app/:path*');
  assert.deepEqual(appRoutes, [
    { source: '/app', destination: '/index.html' },
    { source: '/app/:path*', destination: '/index.html' },
  ]);
  assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/app/assets/:path*' && destination === '/assets/:path*'));
  assert.equal(vercel.rewrites.some(({ source }) => source === '/:path*'), false);
});

test('browser deployment has safe cache policy', () => {
  const assetHeaders = vercel.headers.find(({ source }) => source === '/assets/:path*');
  const htmlHeaders = vercel.headers.find(({ source }) => source === '/index.html');
  assert.match(assetHeaders.headers[0].value, /immutable/);
  assert.match(htmlHeaders.headers[0].value, /no-cache/);
});

test('browser build does not use the Electron Vite plugin', () => {
  const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.match(viteConfig, /mode === 'web'/);
  assert.match(viteConfig, /isWebDevelopment \|\| isBrowserBuild/);
});
