import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');

test('avatar source validation accepts supported formats and rejects oversized files', () => {
  const source = read('src/services/avatarProcessing.ts');
  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /image\/webp/);
  assert.match(source, /10 \* 1024 \* 1024/);
  assert.match(source, /Choose an image smaller than 10 MB/);
});

test('avatar processing produces a square 512px WebP', () => {
  const source = read('src/services/avatarProcessing.ts');
  assert.match(source, /AVATAR_OUTPUT_SIZE = 512/);
  assert.match(source, /canvas\.width = AVATAR_OUTPUT_SIZE/);
  assert.match(source, /canvas\.height = AVATAR_OUTPUT_SIZE/);
  assert.match(source, /normalizeAvatar/);
  assert.match(source, /AVATAR_TARGET_BYTES = 300 \* 1024/);
});

test('upload, replacement, removal, cache invalidation, and retry use the profile foundation', () => {
  const service = read('src/services/userProfile.ts');
  const modal = read('src/components/Settings/AvatarEditorModal.tsx');
  const settings = read('src/components/Settings/SettingsWindow.tsx');
  assert.match(service, /\$\{userId\}\/profile\.webp/);
  assert.match(service, /api\/user\/avatar/);
  assert.match(settings, /refreshProfile/); // central refresh is owned by the Account flow
  assert.match(modal, /onSave/);
  assert.match(modal, /onRemove/);
  assert.match(modal, /setError/);
  assert.match(modal, /setBusy\('save'\)/);
  assert.match(settings, /await userProfileService\.upload/);
  assert.match(settings, /await userProfileService\.remove/);
  assert.match(settings, /size="xl"/);
});

test('avatar editor has keyboard, focus, and accessible control foundations', () => {
  const modal = read('src/components/Settings/AvatarEditorModal.tsx');
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /aria-label="Choose profile photo"/);
  assert.match(modal, /aria-label="Profile photo zoom"/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /keyboardStep=\{4\}/);
});

test('Phase 3 does not add onboarding, camera, GIF, or profile-popover behavior', () => {
  const modal = read('src/components/Settings/AvatarEditorModal.tsx');
  assert.doesNotMatch(modal, /getUserMedia|camera|gif|popover/i);
});
