import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const controller = await readFile(new URL('../src/code.ts', import.meta.url), 'utf8');

test('manifest restricts domains and uses separate controller and UI bundles', () => {
  assert.equal(manifest.main, 'dist/code.js');
  assert.equal(manifest.ui, 'dist/ui.html');
  assert.ok(manifest.networkAccess.allowedDomains.length > 0);
  assert.ok(!manifest.networkAccess.allowedDomains.includes('*'));
});

test('controller sends only sanitized selection fields and owns client storage', () => {
  assert.match(controller, /clientStorage/);
  assert.match(controller, /fileKeyAvailable/);
  assert.match(controller, /node\.id/);
  assert.doesNotMatch(controller, /node\.characters/);
  assert.doesNotMatch(controller, /node\.reactions/);
});
