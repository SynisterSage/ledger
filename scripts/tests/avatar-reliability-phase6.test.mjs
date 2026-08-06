import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('avatar URLs use stable versioned cache invalidation', () => {
  const utility = read('src/utils/userAvatar.ts');
  const hook = read('src/hooks/useUserAvatarUrl.ts');
  assert.match(utility, /avatarUpdatedAt \?\? '1'/);
  assert.match(hook, /signedUrlCache/);
  assert.match(hook, /signedUrlPending/);
});

test('avatar loading falls back without a broken image loop and releases local previews', () => {
  const component = read('src/components/Common/UserAvatar.tsx');
  const modal = read('src/components/Settings/AvatarEditorModal.tsx');
  assert.match(component, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(component, /imageFailed \? null/);
  assert.match(modal, /URL\.revokeObjectURL\(imageSrc\)/);
});

test('account deletion removes the private user-owned avatar object', () => {
  const backend = read('backend/server.js');
  assert.match(backend, /storage\.from\('avatars'\)\.remove\(\[`\$\{userId\}\/profile\.webp`\]\)/);
  assert.match(backend, /auth\.admin\.deleteUser\(userId\)/);
});

test('temporary rollout checklist and legacy person helpers are gone', () => {
  assert.equal(fs.existsSync('docs/avatar-rollout-phase5-checklist.md'), false);
  for (const path of [
    'src/components/Circle/CircleWindow.tsx',
    'src/components/Teams/TeamsWindow.tsx',
    'src/components/Teams/TeamSettingsWindow.tsx',
    'src/components/Projects/ProjectsWindow.tsx',
    'src/components/Settings/SettingsWindow.tsx',
    'src/components/Sidebar/PinnedSidebarSection.tsx',
    'src/components/Slack/SlackWindow.tsx',
  ]) assert.doesNotMatch(read(path), /const (getInitials|getMemberInitials|avatarInitial)\s*=/);
});
