import test from 'node:test';
import assert from 'node:assert/strict';
import { githubConnectionHealth, githubSafeErrorCode, githubSafeErrorMessage, isStaleGithubEvent } from './github-health.js';

test('GitHub health maps lifecycle and sync states without exposing provider details', () => {
  assert.equal(githubConnectionHealth({ installationStatus: 'suspended' }).state, 'suspended');
  assert.equal(githubConnectionHealth({ installationStatus: 'active', repositoryCount: 0, lastSyncedAt: new Date().toISOString() }).state, 'access_changed');
  assert.equal(githubConnectionHealth({ installationStatus: 'active', repositoryCount: 2, lastSyncedAt: new Date().toISOString() }).state, 'connected');
  assert.equal(githubConnectionHealth({ installationStatus: 'active', repositoryCount: 2, lastErrorAt: new Date().toISOString() }).state, 'action_required');
});

test('GitHub error normalization is bounded and safe', () => {
  assert.equal(githubSafeErrorCode({ status: 429 }), 'github_rate_limited');
  assert.equal(githubSafeErrorMessage({ status: 500 }), 'GitHub could not be reached. Existing links remain available.');
  assert.doesNotMatch(githubSafeErrorMessage({ message: 'token=secret' }), /secret/);
});

test('older GitHub events cannot overwrite newer metadata', () => {
  assert.equal(isStaleGithubEvent({ eventUpdatedAt: '2026-07-21T10:00:00Z', storedUpdatedAt: '2026-07-21T10:01:00Z' }), true);
  assert.equal(isStaleGithubEvent({ eventUpdatedAt: '2026-07-21T10:02:00Z', storedUpdatedAt: '2026-07-21T10:01:00Z' }), false);
});
