import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('browser invite continuation is scoped to session storage and desktop deep links remain', () => {
  const continuation = read('src/web/browserInviteContinuation.ts');
  const app = read('src/App.tsx');
  assert.match(continuation, /ledger:browser-invite:v1/);
  assert.match(continuation, /sessionStorage/);
  assert.match(app, /readBrowserInviteContinuation/);
  assert.match(app, /ledger:open-invite/);
  assert.doesNotMatch(app, /returnTo.*invite/);
});

test('browser invite acceptance reuses the existing API and activates the workspace', () => {
  const app = read('src/App.tsx');
  assert.match(app, /api\.acceptWorkspaceInvitation\(pendingInviteToken\)/);
  assert.match(app, /await refreshWorkspaces\(\)/);
  assert.match(app, /await setActiveWorkspace\(inviteWorkspaceId\)/);
  assert.match(app, /`\/app\/w\/\$\{inviteWorkspaceId\}\/home`/);
  assert.match(app, /completeOnboarding/);
});

test('invalid invite states clear browser continuation without putting tokens in returnTo', () => {
  assert.match(read('src/App.tsx'), /clearBrowserInviteContinuation\(\)/);
  assert.match(read('src/web/returnTo.ts'), /invite/);
  assert.match(read('src/web/returnTo.ts'), /DEFAULT_RETURN_TO/);
});
