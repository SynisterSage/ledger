import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGithubAppJwt, createGithubState, hashGithubState, normalizeGithubRepository, verifyGithubWebhookSignature } from './github-app.js';

test('GitHub state is random and only its hash is persisted by callers', () => {
  const state = createGithubState();
  assert.ok(state.length > 32);
  assert.notEqual(state, hashGithubState(state));
  assert.equal(hashGithubState(state), hashGithubState(state));
});

test('GitHub App JWT is RS256 and short lived', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = createGithubAppJwt({ config: { appId: '123', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, now: 1_700_000_000 });
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, '123');
  assert.equal(claims.exp - claims.iat, 9 * 60 + 60);
  assert.equal(crypto.createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'), true);
});

test('repository metadata normalization preserves numeric IDs and visibility', () => {
  const value = normalizeGithubRepository({ id: 99, owner: { login: 'acme' }, name: 'ledger', full_name: 'acme/ledger', html_url: 'https://github.com/acme/ledger', private: true, archived: false, disabled: false, default_branch: 'main' }, 'installation-row');
  assert.equal(value.github_repository_id, '99');
  assert.equal(value.github_installation_id, 'installation-row');
  assert.equal(value.is_private, true);
  assert.equal(value.full_name, 'acme/ledger');
  assert.ok(value.last_synced_at);
});

test('webhook signatures require the raw body and compare in constant time', () => {
  const rawBody = JSON.stringify({ action: 'suspend' });
  const secret = 'test-secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  assert.equal(verifyGithubWebhookSignature({ rawBody, signature, secret }), true);
  assert.equal(verifyGithubWebhookSignature({ rawBody: JSON.stringify({ action: 'other' }), signature, secret }), false);
  assert.equal(verifyGithubWebhookSignature({ rawBody, signature: '', secret }), false);
});
