import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGithubPullRequestContext } from './github-reference-mapper.js';

test('maps bounded review and check summaries without provider payloads', () => {
  const summary = mapGithubPullRequestContext({
    requestedReviewers: [{ login: 'lex' }, { login: 'reviewer' }],
    reviews: [{ state: 'APPROVED', submitted_at: '2026-07-21T10:00:00Z' }, { state: 'CHANGES_REQUESTED', submitted_at: '2026-07-21T11:00:00Z' }],
    checkRuns: [{ status: 'completed', conclusion: 'success', completed_at: '2026-07-21T11:00:00Z' }, { status: 'completed', conclusion: 'failure', completed_at: '2026-07-21T11:01:00Z' }],
    statuses: [{ state: 'pending', updated_at: '2026-07-21T11:02:00Z' }],
  });
  assert.deepEqual(summary.reviewSummary.requestedReviewerLogins, ['lex', 'reviewer']);
  assert.equal(summary.reviewSummary.approvedCount, 1);
  assert.equal(summary.reviewSummary.changesRequestedCount, 1);
  assert.equal(summary.checksSummary.total, 3);
  assert.equal(summary.checksSummary.failing, 1);
  assert.equal(summary.checksSummary.pending, 1);
  assert.equal(summary.checksSummary.overallState, 'failing');
  assert.equal('body' in summary, false);
});
