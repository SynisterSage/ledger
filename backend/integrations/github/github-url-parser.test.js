import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubUrl } from './github-url-parser.js';

test('parses and normalizes GitHub repositories, issues, and pull requests', () => {
  assert.equal(parseGithubUrl('https://github.com/acme/ledger?tab=readme#readme').normalizedUrl, 'https://github.com/acme/ledger');
  assert.equal(parseGithubUrl('https://www.github.com/acme/ledger/issues/42#comment-1').resourceKind, 'issue');
  assert.equal(parseGithubUrl('https://github.com/acme/ledger/pull/205/files').normalizedUrl, 'https://github.com/acme/ledger/pull/205');
});

test('rejects unsupported GitHub hosts, routes, and malformed identifiers', () => {
  for (const value of ['https://gitlab.com/acme/ledger', 'https://github.com/acme/ledger/actions', 'https://github.com/acme/ledger/issues/nope', 'https://github.com/acme/ledger/commits/main', 'http://github.com/acme/ledger']) {
    assert.throws(() => parseGithubUrl(value));
  }
});
