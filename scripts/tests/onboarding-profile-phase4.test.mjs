import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');

test('profile setup is versioned and existing users are backfilled', () => {
  const migration = read('migrations/124_profile_setup_onboarding.sql');
  assert.match(migration, /profile_setup_completed_at/);
  assert.match(migration, /WHERE profile_setup_completed_at IS NULL/);
  assert.match(migration, /COALESCE\(created_at/);
});

test('onboarding places profile setup before workspace setup', () => {
  const app = read('src/App.tsx');
  assert.match(app, /'welcome' \| 'profile' \| 'workspace-type'/);
  assert.match(app, /onStepChange\(profileSetupIncluded \? 'profile' : 'workspace-type'\)/);
  assert.match(app, /Set up your profile/);
  assert.match(app, /Skip for now/);
  assert.match(app, /completeProfileSetup/);
});

test('profile setup reuses Phase 3 avatar management', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<AvatarEditorModal/);
  assert.match(app, /onProfileSaveAvatar/);
  assert.match(app, /onProfileRemoveAvatar/);
  assert.match(app, /userProfileService\.upload/);
  assert.match(app, /userProfileService\.remove/);
});

test('profile setup validates name, refreshes state, and has a completion endpoint', () => {
  const app = read('src/App.tsx');
  const api = read('src/hooks/useApi.ts');
  const backend = read('backend/server.js');
  assert.match(app, /Display name is required/);
  assert.match(app, /await refreshProfile\(\)/);
  assert.match(app, /completeProfileSetup/);
  assert.match(api, /\/api\/user\/profile-setup/);
  assert.match(backend, /app\.patch\('\/api\/user\/profile-setup'/);
});

test('profile setup remains optional and scoped', () => {
  const app = read('src/App.tsx');
  assert.match(app, /profile\.avatarUrl \? 'Change photo' : 'Add photo'/);
  assert.doesNotMatch(app, /getUserMedia|camera capture|job title|biography|pronouns/i);
});
