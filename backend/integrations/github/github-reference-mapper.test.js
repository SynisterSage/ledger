import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGithubPullRequestContext, mapGithubWorkItem } from './github-reference-mapper.js';

test('preserves GitHub issue lifecycle reason for downstream Ledger surfaces', () => {
  const metadata = mapGithubWorkItem({
    resourceKind: 'issue',
    repository: { id: 1226102933, full_name: 'SynisterSage/ledger' },
    item: { id: 4950575541, number: 5, title: 'lifecycle', state: 'closed', state_reason: 'completed', html_url: 'https://github.com/SynisterSage/ledger/issues/5' },
  });
  assert.equal(metadata.state, 'closed');
  assert.equal(metadata.stateReason, 'completed');
});

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

test('keeps pending and non-failing terminal conclusions distinct from failures', () => {
  const summary = mapGithubPullRequestContext({
    checkRuns: [
      { status: 'completed', conclusion: 'cancelled', completed_at: '2026-07-22T10:00:00Z' },
      { status: 'completed', conclusion: 'timed_out', completed_at: '2026-07-22T10:01:00Z' },
      { status: 'completed', conclusion: 'neutral', completed_at: '2026-07-22T10:02:00Z' },
      { status: 'queued', conclusion: null },
    ],
    statuses: [{ state: 'pending', updated_at: '2026-07-22T10:03:00Z' }],
  });
  assert.equal(summary.checksSummary.failing, 0);
  assert.equal(summary.checksSummary.pending, 2);
  assert.equal(summary.checksSummary.overallState, 'pending');
});

test('one current failing check keeps the pull request failing even when another check passes', () => {
  const summary = mapGithubPullRequestContext({
    checkRuns: [
      { status: 'completed', conclusion: 'success', completed_at: '2026-07-22T10:00:00Z' },
      { status: 'completed', conclusion: 'failure', completed_at: '2026-07-22T10:01:00Z' },
    ],
  });
  assert.equal(summary.checksSummary.failing, 1);
  assert.equal(summary.checksSummary.successful, 1);
  assert.equal(summary.checksSummary.overallState, 'failing');
});
