import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedCorsOrigins, isAllowedCorsOrigin } from './cors-origins.js';

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
