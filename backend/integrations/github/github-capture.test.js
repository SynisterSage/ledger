import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGithubIntakePayload,
  githubCaptureEventType,
  githubCaptureFingerprint,
  githubCaptureRuleMatches,
  normalizeGithubCaptureRule,
} from './github-capture.js';

test('capture rules are opt-in and normalize bounded repository and label filters', () => {
  const rule = normalizeGithubCaptureRule({
    name: ' New issues ',
    event_type: 'issue_opened',
    repository_scope: 'selected',
    repository_ids: ['repo-1', 'repo-1'],
    label_filters: ['Bug', 'bug'],
  });
  assert.equal(rule.enabled, false);
  assert.deepEqual(rule.repository_ids, ['repo-1']);
  assert.deepEqual(rule.label_filters, ['bug']);
  assert.equal(githubCaptureRuleMatches({ rule, eventType: 'issue_opened', repositoryId: 'repo-1', labels: ['bug'] }), false);
  const enabledRule = { ...rule, enabled: true, create_intake_item: true };
  assert.equal(githubCaptureRuleMatches({ rule: enabledRule, eventType: 'issue_opened', repositoryId: 'repo-1', labels: [{ name: 'Bug' }] }), true);
  assert.equal(githubCaptureRuleMatches({ rule: enabledRule, eventType: 'issue_opened', repositoryId: 'repo-2', labels: ['bug'] }), false);
});

test('supported webhook actions map to focused capture event types', () => {
  assert.equal(githubCaptureEventType({ event: 'issues', action: 'opened' }), 'issue_opened');
  assert.equal(githubCaptureEventType({ event: 'pull_request', action: 'closed', payload: { pull_request: { merged: true } } }), 'pull_request_merged');
  assert.equal(githubCaptureEventType({ event: 'pull_request', action: 'closed', payload: { pull_request: { merged: false } } }), 'pull_request_closed_without_merge');
  assert.equal(githubCaptureEventType({ event: 'pull_request_review', action: 'submitted', payload: { review: { state: 'changes_requested' } } }), 'changes_requested');
  assert.equal(githubCaptureEventType({ event: 'issues', action: 'edited' }), null);
});

test('capture fingerprints are stable for webhook retries', () => {
  const input = { ruleId: 'rule', repositoryId: '42', objectType: 'issue', objectId: '214', eventType: 'issue_opened' };
  assert.equal(githubCaptureFingerprint(input), githubCaptureFingerprint(input));
});

test('GitHub Intake payload is compact and keeps canonical metadata', () => {
  const payload = buildGithubIntakePayload({
    eventType: 'issue_opened',
    repository: { id: 42, full_name: 'synistersage/ledger', html_url: 'https://github.com/synistersage/ledger' },
    object: { id: 214, number: 214, node_id: 'I_node', title: 'Fix MCP workspace switching', state: 'open', html_url: 'https://github.com/synistersage/ledger/issues/214', body: '# body', user: { login: 'lex' }, labels: [{ name: 'bug' }] },
  });
  assert.equal(payload.source, 'github');
  assert.equal(payload.source_id, '42:issue:214');
  assert.equal(payload.raw_payload.githubRepositoryId, '42');
  assert.equal(payload.raw_payload.labels[0], 'bug');
  assert.equal(payload.source_url, 'https://github.com/synistersage/ledger/issues/214');
});
