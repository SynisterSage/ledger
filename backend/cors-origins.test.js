import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedCorsOrigins, getCorsOptions, isAllowedCorsOrigin } from './cors-origins.js';

test('allows only explicitly configured browser extension origins', () => {
  const allowed = getAllowedCorsOrigins({
    BROWSER_EXTENSION_ORIGINS: 'chrome-extension://abc123/, moz-extension://ledger-addon',
  });

  assert.equal(isAllowedCorsOrigin('chrome-extension://abc123', allowed), true);
  assert.equal(isAllowedCorsOrigin('moz-extension://ledger-addon', allowed), true);
  assert.equal(isAllowedCorsOrigin('chrome-extension://another-extension', allowed), false);
  assert.equal(isAllowedCorsOrigin('https://attacker.example', allowed), false);
});

test('keeps wildcards and malformed extension origins out of the extension configuration', () => {
  const allowed = getAllowedCorsOrigins({
    BROWSER_EXTENSION_ORIGINS: '* , chrome-extension://valid-extension',
  });

  assert.equal(allowed.has('*'), false);
  assert.equal(isAllowedCorsOrigin('chrome-extension://valid-extension', allowed), true);
  assert.equal(isAllowedCorsOrigin('chrome-extension://other-extension', allowed), false);
});

test('production CORS excludes local and null origins', () => {
  const allowed = getAllowedCorsOrigins({ NODE_ENV: 'production' });

  assert.equal(isAllowedCorsOrigin('null', allowed), false);
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', allowed), false);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:4173', allowed), false);
  assert.equal(isAllowedCorsOrigin('https://ledgerworkspace.com', allowed), true);
});

test('production CORS allows the hosted Figma plugin iframe origins', () => {
  const allowed = getAllowedCorsOrigins({ NODE_ENV: 'production' });

  assert.equal(isAllowedCorsOrigin('https://www.figma.com', allowed), true);
  assert.equal(isAllowedCorsOrigin('https://figma.com', allowed), true);
  assert.equal(isAllowedCorsOrigin('https://evil-figma.com', allowed), false);
});

test('null-origin CORS is wildcarded only for Figma plugin routes', () => {
  const allowed = getAllowedCorsOrigins({ NODE_ENV: 'production' });
  const pluginRequest = { path: '/api/figma-plugin/session', get: () => 'null' };
  const otherRequest = { path: '/api/notes', get: () => 'null' };

  assert.deepEqual(getCorsOptions(pluginRequest, allowed), { origin: '*', credentials: false });
  let rejectedError;
  getCorsOptions(otherRequest, allowed).origin('null', (error) => { rejectedError = error; });
  assert.match(rejectedError?.message || '', /CORS origin not allowed: null/);
});
