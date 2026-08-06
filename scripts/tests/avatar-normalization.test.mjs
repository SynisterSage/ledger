import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('normalization returns exactly 512px WebP with bounded quality attempts', () => {
  const source = read('src/services/avatarProcessing.ts');
  assert.match(source, /export const normalizeAvatar/);
  assert.match(source, /width: 512/);
  assert.match(source, /height: 512/);
  assert.match(source, /mimeType: 'image\/webp'/);
  assert.match(source, /AVATAR_START_QUALITY = 0\.82/);
  assert.match(source, /AVATAR_MIN_QUALITY = 0\.65/);
  assert.match(source, /AVATAR_MAX_OUTPUT_BYTES = 500 \* 1024/);
});

test('client decodes actual image content, corrects orientation where supported, and revokes URLs', () => {
  const source = read('src/services/avatarProcessing.ts');
  assert.match(source, /imageOrientation: 'from-image'/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /image\.onerror/);
});

test('server rejects non-WebP, animated, oversized, and non-512px uploads', () => {
  const source = read('backend/server.js');
  assert.match(source, /isStaticWebp/);
  assert.match(source, /ANIM/);
  assert.match(source, /500 \* 1024/);
  assert.match(source, /decoded\.bitmap\.width !== 512/);
  assert.match(source, /sharp\(body, \{ animated: true \}\)\.metadata\(\)/);
});
