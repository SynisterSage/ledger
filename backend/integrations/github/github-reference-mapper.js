const MAX_BODY = 700;
const bounded = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const bodyPreview = (value) => bounded(String(value ?? '').replace(/[`*_>#-]/g, ' '), MAX_BODY);
const people = (items, max = 8) => (Array.isArray(items) ? items : []).slice(0, max).map((person) => ({ login: bounded(person?.login, 80), avatar_url: String(person?.avatar_url ?? '').startsWith('https://avatars.githubusercontent.com/') ? person.avatar_url : null })).filter((person) => person.login);
const labels = (items) => (Array.isArray(items) ? items : []).slice(0, 12).map((label) => bounded(label?.name, 60)).filter(Boolean);

export const mapGithubRepository = (repository) => ({ githubRepositoryId: String(repository.id), ownerLogin: bounded(repository.owner?.login, 100), name: bounded(repository.name, 100), fullName: bounded(repository.full_name, 220), canonicalUrl: String(repository.html_url ?? ''), isPrivate: Boolean(repository.private), isArchived: Boolean(repository.archived), isDisabled: Boolean(repository.disabled), defaultBranch: bounded(repository.default_branch, 120), description: bodyPreview(repository.description), lastGithubUpdatedAt: repository.updated_at ?? null });
export const mapGithubWorkItem = ({ item, repository, resourceKind }) => ({ githubId: String(item.id), githubNodeId: item.node_id ? String(item.node_id) : null, githubRepositoryId: String(repository.id ?? repository.github_repository_id), repositoryFullName: bounded(repository.full_name, 220), number: Number(item.number), title: bounded(item.title, 240), state: resourceKind === 'pullRequest' ? (item.merged_at ? 'merged' : item.draft ? 'draft' : bounded(item.state, 40)) : bounded(item.state, 40), author: item.user ? { login: bounded(item.user.login, 100), avatar_url: String(item.user.avatar_url ?? '').startsWith('https://avatars.githubusercontent.com/') ? item.user.avatar_url : null } : null, assignees: people(item.assignees), requestedReviewers: people(item.requested_reviewers), labels: labels(item.labels), milestoneTitle: bounded(item.milestone?.title, 160) || null, commentCount: Math.min(Math.max(Number(item.comments) || 0, 0), 100000), bodyPreview: bodyPreview(item.body), baseBranch: resourceKind === 'pullRequest' ? bounded(item.base?.ref, 160) || null : null, headBranch: resourceKind === 'pullRequest' ? bounded(item.head?.ref, 160) || null : null, createdAt: item.created_at ?? null, updatedAt: item.updated_at ?? null, closedAt: item.closed_at ?? null, mergedAt: item.merged_at ?? null, canonicalUrl: String(item.html_url ?? ''), resourceKind });

export const mapGithubPullRequestContext = ({ reviews = [], checkRuns = [], statuses = [], requestedReviewers = [] }) => {
  const reviewRows = (Array.isArray(reviews) ? reviews : []).filter((review) => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(String(review?.state ?? '').toUpperCase()));
  const latestByReviewer = new Map();
  reviewRows.slice().sort((a, b) => String(a.submitted_at ?? a.updated_at ?? '').localeCompare(String(b.submitted_at ?? b.updated_at ?? ''))).forEach((review, index) => latestByReviewer.set(String(review.user?.id ?? review.user?.login ?? `review-${index}`), review));
  const currentReviews = [...latestByReviewer.values()];
  const approvedCount = currentReviews.filter((review) => String(review.state).toUpperCase() === 'APPROVED').length;
  const changesRequestedCount = currentReviews.filter((review) => String(review.state).toUpperCase() === 'CHANGES_REQUESTED').length;
  const latestReview = reviewRows.slice().sort((a, b) => String(b.submitted_at ?? b.submittedAt ?? '').localeCompare(String(a.submitted_at ?? a.submittedAt ?? '')))[0];
  const reviewActivity = reviewRows.map((review) => review.submitted_at ?? review.updated_at).filter(Boolean).sort().pop() ?? null;
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const statusRows = Array.isArray(statuses) ? statuses : [];
  const failingRuns = runs.filter((run) => ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(String(run.conclusion ?? '').toLowerCase())).length;
  const successfulRuns = runs.filter((run) => String(run.conclusion ?? '').toLowerCase() === 'success').length;
  const pendingRuns = runs.filter((run) => !run.completed_at || ['queued', 'in_progress', 'pending'].includes(String(run.status ?? '').toLowerCase())).length;
  const failingStatuses = statusRows.filter((status) => ['error', 'failure'].includes(String(status.state ?? '').toLowerCase())).length;
  const successfulStatuses = statusRows.filter((status) => String(status.state ?? '').toLowerCase() === 'success').length;
  const pendingStatuses = statusRows.filter((status) => ['pending'].includes(String(status.state ?? '').toLowerCase())).length;
  const failing = failingRuns + failingStatuses;
  const successful = successfulRuns + successfulStatuses;
  const pending = pendingRuns + pendingStatuses;
  const total = runs.length + statusRows.length;
  return {
    reviewSummary: {
      reviewRequestedCount: Math.min((Array.isArray(requestedReviewers) ? requestedReviewers : []).length, 20),
      requestedReviewerLogins: (Array.isArray(requestedReviewers) ? requestedReviewers : []).slice(0, 20).map((reviewer) => bounded(reviewer?.login, 100)).filter(Boolean),
      approvedCount: Math.min(approvedCount, 50),
      changesRequestedCount: Math.min(changesRequestedCount, 50),
      latestMeaningfulState: latestReview ? String(latestReview.state).toLowerCase() : null,
      lastActivityAt: reviewActivity,
    },
    checksSummary: {
      total: Math.min(total, 100),
      successful: Math.min(successful, 100),
      failing: Math.min(failing, 100),
      pending: Math.min(pending, 100),
      neutral: Math.min(Math.max(total - successful - failing - pending, 0), 100),
      overallState: failing > 0 ? 'failing' : pending > 0 ? 'pending' : total > 0 && successful === total ? 'passing' : 'none',
      lastUpdatedAt: runs.concat(statusRows).map((row) => row.completed_at ?? row.updated_at ?? row.created_at).filter(Boolean).sort().pop() ?? null,
    },
  };
};
