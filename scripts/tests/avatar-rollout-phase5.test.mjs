import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('major identity surfaces use the canonical avatar component', () => {
  for (const path of [
    'src/components/Circle/CircleWindow.tsx',
    'src/components/Teams/TeamsWindow.tsx',
    'src/components/Teams/TeamSettingsWindow.tsx',
    'src/components/Projects/ProjectsWindow.tsx',
    'src/components/Settings/SettingsWindow.tsx',
    'src/components/Sidebar/PinnedSidebarSection.tsx',
  ]) assert.match(read(path), /UserAvatar/);
});

test('avatar groups preserve bounded overflow and shared rendering', () => {
  const source = read('src/components/Common/AvatarGroup.tsx');
  assert.match(source, /maxVisible/);
  assert.match(source, /UserAvatar/);
  assert.match(source, /more people/);
});

test('legacy person initials helpers are not used by migrated UI surfaces', () => {
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

test('profile queries carry cache invalidation without membership avatar columns', () => {
  const backend = read('backend/server.js');
  assert.match(backend, /avatar_url, avatar_updated_at/);
  assert.match(backend, /avatar_updated_at: user\?\.avatar_updated_at/);
  assert.doesNotMatch(backend, /workspace_members[^\n]*avatar_url/);
});
