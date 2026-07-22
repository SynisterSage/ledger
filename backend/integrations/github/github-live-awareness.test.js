import test from 'node:test';
import assert from 'node:assert/strict';
import { githubReferenceMatches } from './github-live-awareness.js';

const reference = {
  provider: 'github',
  external_type: 'pullRequest',
  metadata: { githubRepositoryId: '42', githubId: '9001', githubNodeId: 'PR_node', number: 12 },
};

test('matches linked GitHub work by repository and immutable object identity', () => {
  assert.equal(githubReferenceMatches({ reference, repositoryId: '42', githubId: '9001', resourceKind: 'pullRequest' }), true);
  assert.equal(githubReferenceMatches({ reference, repositoryId: '99', githubId: '9001', resourceKind: 'pullRequest' }), false);
  assert.equal(githubReferenceMatches({ reference, repositoryId: '42', nodeId: 'PR_node', resourceKind: 'pullRequest' }), true);
  assert.equal(githubReferenceMatches({ reference, repositoryId: '42', number: 12, resourceKind: 'issue' }), false);
});
