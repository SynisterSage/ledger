import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { parseWebLocation } = await import('../../src/web/webRouteState.ts');
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../src/web/WebAppShell.tsx', import.meta.url), 'utf8');

test('browser startup preserves login, invite, onboarding, and workspace entry routes', () => {
  assert.deepEqual(parseWebLocation({ pathname: '/login', search: '' }), { kind: 'app-root' });
  assert.deepEqual(parseWebLocation({ pathname: '/app/onboarding', search: '' }), { kind: 'app-page', page: 'onboarding' });
  assert.deepEqual(parseWebLocation({ pathname: '/app/workspaces', search: '' }), { kind: 'app-page', page: 'workspaces' });
  assert.deepEqual(parseWebLocation({ pathname: '/invite/invite-token', search: '' }), { kind: 'invite', token: 'invite-token' });
});

test('browser startup reuses the existing auth and onboarding state machine', () => {
  assert.match(appSource, /export function AppShell\(/);
  assert.match(appSource, /browserMode = false/);
  assert.match(appSource, /browserContent\?: ReactNode/);
  assert.match(appSource, /getOnboardingStatus/);
  assert.match(appSource, /acceptWorkspaceInvitation/);
  assert.match(appSource, /browserMode \? 'left'/);
});

test('web shell resolves workspace access and preserves deep-link workspace IDs', () => {
  assert.match(shellSource, /Choose a workspace/);
  assert.match(shellSource, /You do not have access to this workspace/);
  assert.match(shellSource, /requestedWorkspaceId/);
  assert.match(shellSource, /setActiveWorkspace\(requestedWorkspace\.id\)/);
  assert.match(shellSource, /AppShell browserMode/);
});

test('logout and refresh continue to use AuthProvider ownership', () => {
  assert.match(shellSource, /<AppShell browserMode/);
  assert.match(appSource, /useAuthContext\(\)/);
  assert.match(appSource, /LoginForm/);
  assert.doesNotMatch(shellSource, /localStorage.*access_token|sessionStorage.*access_token/);
});
