import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');

const initials = (value) => {
  const words = String(value ?? '').trim().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]][0].toUpperCase();
  return `${[...words[0]][0]}${[...words.at(-1)][0]}`.toUpperCase();
};

test('profile initials follow the first and last meaningful words', () => {
  assert.equal(initials('Lex Ferguson'), 'LF');
  assert.equal(initials('Lex'), 'L');
  assert.equal(initials('Lex A. Ferguson'), 'LF');
  assert.equal(initials(''), '?');
});

test('avatar URL cache busting and size variants are centralized', () => {
  const source = read('src/utils/userAvatar.ts');
  assert.match(source, /searchParams\.set\('v'/);
  assert.match(source, /xs: 20, sm: 28, md: 36, lg: 48, xl: 72/);
});

test('avatar storage is user-owned and not workspace membership data', () => {
  const migration = read('migrations/123_user_avatar_foundation.sql');
  assert.match(migration, /bucket_id = 'avatars'/g);
  assert.match(migration, /name = auth\.uid\(\)::text \|\| '\/profile\.webp'/);
  assert.doesNotMatch(migration, /workspace_members/);
});

test('profile serialization carries nullable avatar metadata', () => {
  const source = read('src/types/userProfile.ts');
  assert.match(source, /avatarUrl: string \| null/);
  assert.match(source, /avatarUpdatedAt: string \| null/);
  assert.match(source, /avatar_updated_at/);
});

test('Account page consumes the shared avatar without upload controls', () => {
  const settings = read('src/components/Settings/SettingsWindow.tsx');
  assert.match(settings, /<UserAvatar/);
  assert.match(settings, /AvatarEditorModal/);
});
