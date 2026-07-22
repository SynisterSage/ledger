const MAX_LABELS = 25;
const MAX_REPOSITORIES = 100;

export const GITHUB_CAPTURE_EVENT_TYPES = Object.freeze([
  'repository_available',
  'repository_renamed',
  'repository_archived',
  'repository_access_removed',
  'issue_opened',
  'issue_reopened',
  'issue_assigned',
  'issue_closed',
  'pull_request_opened',
  'pull_request_reopened',
  'review_requested',
  'changes_requested',
  'checks_failing',
  'pull_request_merged',
  'pull_request_closed_without_merge',
]);

const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const normalizeGithubCaptureLabels = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((label) => clean(label?.name ?? label, 80).toLowerCase())
    .filter(Boolean)
)).slice(0, MAX_LABELS);

export const normalizeGithubCaptureRule = (input = {}) => ({
  name: clean(input.name, 120) || 'GitHub capture rule',
  event_type: clean(input.event_type, 80),
  enabled: input.enabled === true,
  repository_scope: input.repository_scope === 'selected' ? 'selected' : 'all_approved',
  repository_ids: Array.from(new Set((Array.isArray(input.repository_ids) ? input.repository_ids : []).map(String).filter(Boolean))).slice(0, MAX_REPOSITORIES),
  label_filters: normalizeGithubCaptureLabels(input.label_filters),
  destination_type: input.destination_type === 'team_intake' ? 'team_intake' : 'workspace_intake',
  destination_team_id: input.destination_team_id ? String(input.destination_team_id) : null,
  create_notification: input.create_notification === true,
  create_intake_item: input.create_intake_item === true,
});

export const githubCaptureEventType = ({ event, action, payload = {} }) => {
  const normalizedEvent = String(event ?? '').trim().toLowerCase();
  const normalizedAction = String(action ?? '').trim().toLowerCase();
  if (normalizedEvent === 'installation_repositories' && normalizedAction === 'added') return 'repository_available';
  if (normalizedEvent === 'repository') {
    if (normalizedAction === 'created') return 'repository_available';
    if (normalizedAction === 'renamed' || normalizedAction === 'transferred') return 'repository_renamed';
    if (normalizedAction === 'archived' || normalizedAction === 'unarchived') return 'repository_archived';
    if (normalizedAction === 'deleted') return 'repository_access_removed';
  }
  if (normalizedEvent === 'installation_repositories' && normalizedAction === 'removed') return 'repository_access_removed';
  if (normalizedEvent === 'issues') {
    if (normalizedAction === 'opened') return 'issue_opened';
    if (normalizedAction === 'reopened') return 'issue_reopened';
    if (normalizedAction === 'assigned' || normalizedAction === 'unassigned') return 'issue_assigned';
    if (normalizedAction === 'closed') return 'issue_closed';
  }
  if (normalizedEvent === 'pull_request') {
    if (normalizedAction === 'opened') return 'pull_request_opened';
    if (normalizedAction === 'reopened') return 'pull_request_reopened';
    if (normalizedAction === 'review_requested' || normalizedAction === 'review_request_removed') return 'review_requested';
    if (normalizedAction === 'closed') return payload.pull_request?.merged ? 'pull_request_merged' : 'pull_request_closed_without_merge';
  }
  if (normalizedEvent === 'pull_request_review' && normalizedAction === 'submitted') {
    const state = String(payload.review?.state ?? '').toLowerCase();
    if (state === 'changes_requested') return 'changes_requested';
  }
  if (['check_run', 'check_suite', 'status'].includes(normalizedEvent)) {
    const conclusion = String(payload.check_run?.conclusion ?? payload.check_suite?.conclusion ?? payload.state ?? '').toLowerCase();
    if (['failure', 'failed', 'error', 'action_required', 'startup_failure'].includes(conclusion)) return 'checks_failing';
  }
  return null;
};

export const githubCaptureRuleMatches = ({ rule, eventType, repositoryId, labels = [] }) => {
  if (!rule?.enabled || rule.event_type !== eventType) return false;
  if (rule.repository_scope === 'selected' && !(rule.repository_ids ?? []).map(String).includes(String(repositoryId))) return false;
  const filters = normalizeGithubCaptureLabels(rule.label_filters);
  if (filters.length) {
    const available = new Set(normalizeGithubCaptureLabels(labels));
    if (!filters.every((label) => available.has(label))) return false;
  }
  return Boolean(rule.create_notification || rule.create_intake_item);
};

export const githubCaptureFingerprint = ({ ruleId, repositoryId, objectType, objectId, eventType }) =>
  [ruleId, repositoryId, objectType, objectId, eventType].map((value) => String(value ?? '')).join(':');

const compactPerson = (person) => ({
  login: clean(person?.login, 100),
  avatar_url: clean(person?.avatar_url, 500) || null,
});

const compactLabels = (labels) => (Array.isArray(labels) ? labels : []).slice(0, MAX_LABELS).map((label) => clean(label?.name ?? label, 80)).filter(Boolean);

export const buildGithubIntakePayload = ({ eventType, repository, object }) => {
  const isPullRequest = eventType.startsWith('pull_request') || eventType === 'review_requested' || eventType === 'changes_requested' || eventType === 'checks_failing';
  const number = object?.number ?? null;
  const title = clean(object?.title, 240) || `${isPullRequest ? 'Pull request' : 'Issue'} #${number ?? ''}`.trim();
  const fullName = clean(repository?.full_name, 220);
  const url = clean(object?.html_url, 500) || clean(repository?.html_url, 500);
  const metadata = {
    provider: 'github',
    resourceKind: isPullRequest ? 'pullRequest' : 'issue',
    githubRepositoryId: String(repository?.id ?? ''),
    repositoryFullName: fullName,
    githubId: object?.id ? String(object.id) : null,
    githubNodeId: clean(object?.node_id, 180) || null,
    number,
    title,
    state: clean(object?.state, 40) || null,
    stateReason: clean(object?.state_reason, 80) || null,
    draft: isPullRequest ? Boolean(object?.draft) : null,
    merged: isPullRequest ? Boolean(object?.merged ?? object?.merged_at) : null,
    author: compactPerson(object?.user),
    assignees: (Array.isArray(object?.assignees) ? object.assignees : []).slice(0, 25).map(compactPerson),
    requestedReviewers: (Array.isArray(object?.requested_reviewers) ? object.requested_reviewers : []).slice(0, 25).map(compactPerson),
    labels: compactLabels(object?.labels),
    milestone: clean(object?.milestone?.title, 160) || null,
    baseBranch: clean(object?.base?.ref, 160) || null,
    headBranch: clean(object?.head?.ref, 160) || null,
    bodyPreview: clean(object?.body, 800) || null,
    canonicalUrl: url,
    createdAt: object?.created_at ?? null,
    updatedAt: object?.updated_at ?? null,
  };
  return {
    source: 'github',
    source_provider: 'github',
    source_id: `${repository?.id ?? ''}:${isPullRequest ? 'pull_request' : 'issue'}:${object?.id ?? number ?? ''}`,
    source_url: url,
    title: `GitHub ${isPullRequest ? 'pull request' : 'issue'} · ${title}`.slice(0, 240),
    body: [
      `${fullName} · ${isPullRequest ? `PR #${number}` : `Issue #${number}`} · ${clean(object?.state, 40) || 'unknown'}`,
      metadata.bodyPreview,
    ].filter(Boolean).join('\n\n').slice(0, 1200),
    raw_payload: metadata,
    suggested_type: 'capture',
    status: 'unprocessed',
  };
};

export const githubNotificationCategory = (eventType) => {
  if (eventType === 'repository_available' || eventType === 'repository_renamed' || eventType === 'repository_archived' || eventType === 'repository_access_removed') return 'repository_available';
  if (eventType.startsWith('issue_')) return 'issue_events';
  if (eventType === 'review_requested') return 'review_requests';
  if (eventType === 'checks_failing') return 'checks_failing';
  return 'pull_request_events';
};
