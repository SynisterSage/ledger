import { createInstallationToken } from './github-app.js';
import { mapGithubPullRequestContext, mapGithubRepository, mapGithubWorkItem } from './github-reference-mapper.js';

const API_ROOT = 'https://api.github.com';
export class GithubProviderError extends Error {
  constructor(accessStatus, message = 'GitHub request failed') { super(message); this.name = 'GithubProviderError'; this.accessStatus = accessStatus; this.statusCode = accessStatus === 'connection_required' ? 409 : 502; }
}
const request = async (path, token, fetchImpl = fetch) => {
  let response;
  try { response = await fetchImpl(`${API_ROOT}${path}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': process.env.GITHUB_API_VERSION?.trim() || '2022-11-28', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) }); } catch { throw new GithubProviderError('error'); }
  if (response.status === 401) throw new GithubProviderError('revoked');
  if (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0') throw new GithubProviderError('rate_limited');
  if (response.status === 403) throw new GithubProviderError('inaccessible');
  if (response.status === 404) throw new GithubProviderError('not_found');
  if (response.status >= 500) throw new GithubProviderError('error');
  if (!response.ok) throw new GithubProviderError('error');
  return response.json().catch(() => { throw new GithubProviderError('error'); });
};
const repoPath = (owner, repository) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;

export const resolveGithubMetadata = async (parsed, { accessToken, approvedRepository, fetchImpl = fetch }) => {
  if (!accessToken) throw new GithubProviderError('connection_required');
  const repository = await request(repoPath(parsed.owner, parsed.repository), accessToken, fetchImpl);
  if (approvedRepository && String(repository.id) !== String(approvedRepository.github_repository_id)) throw new GithubProviderError('repository_not_approved');
  if (parsed.resourceKind === 'repository') return { metadata: mapGithubRepository(repository), accessStatus: 'accessible' };
  const endpoint = parsed.resourceKind === 'pullRequest' ? `${repoPath(parsed.owner, parsed.repository)}/pulls/${parsed.number}` : `${repoPath(parsed.owner, parsed.repository)}/issues/${parsed.number}`;
  const item = await request(endpoint, accessToken, fetchImpl);
  const metadata = mapGithubWorkItem({ item, repository, resourceKind: parsed.resourceKind });
  if (parsed.resourceKind !== 'pullRequest') return { metadata, accessStatus: 'accessible' };
  const headSha = item.head?.sha;
  const [reviews, requested, checks, statuses] = await Promise.all([
    request(`${endpoint}/reviews?per_page=50`, accessToken, fetchImpl),
    request(`${endpoint}/requested_reviewers`, accessToken, fetchImpl).catch(() => ({ reviewers: [] })),
    headSha ? request(`${repoPath(parsed.owner, parsed.repository)}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=50`, accessToken, fetchImpl).catch(() => ({ check_runs: [] })) : Promise.resolve({ check_runs: [] }),
    headSha ? request(`${repoPath(parsed.owner, parsed.repository)}/commits/${encodeURIComponent(headSha)}/status`, accessToken, fetchImpl).catch(() => ({ statuses: [] })) : Promise.resolve({ statuses: [] }),
  ]);
  const context = mapGithubPullRequestContext({ reviews, requestedReviewers: requested?.users ?? item.requested_reviewers, checkRuns: checks?.check_runs, statuses: statuses?.statuses });
  return { metadata: { ...metadata, ...context }, accessStatus: 'accessible' };
};

export const searchGithubWork = async ({ repository, type, query = '', state = 'open', limit = 20, installationId, fetchImpl = fetch }) => {
  const tokenPayload = await createInstallationToken({ installationId, fetchImpl });
  const endpoint = type === 'pull_request' ? 'pulls' : 'issues';
  const params = new URLSearchParams({ state: ['open', 'closed', 'all'].includes(state) ? state : 'open', per_page: String(Math.min(Math.max(Number(limit) || 20, 1), 50)), ...(query ? { q: query } : {}) });
  let payload;
  if (query) {
    const searchQuery = `repo:${repository.owner_login}/${repository.name} type:${type === 'pull_request' ? 'pr' : 'issue'} ${query}`;
    const searchParams = new URLSearchParams({ q: searchQuery, per_page: params.get('per_page') });
    payload = await request(`/search/issues?${searchParams}`, tokenPayload.token, fetchImpl);
  } else {
    payload = await request(`${repoPath(repository.owner_login, repository.name)}/${endpoint}?${params}`, tokenPayload.token, fetchImpl);
  }
  const items = Array.isArray(payload) ? payload : payload?.items ?? [];
  return items.filter((item) => type !== 'issue' || !item.pull_request).map((item) => mapGithubWorkItem({ item, repository, resourceKind: type === 'pull_request' ? 'pullRequest' : 'issue' }));
};

export const findGithubPullRequestsForCommit = async ({ repository, sha, installationId, fetchImpl = fetch }) => {
  if (!/^[0-9a-f]{7,64}$/i.test(String(sha ?? ''))) return [];
  const tokenPayload = await createInstallationToken({ installationId, fetchImpl });
  const rows = await request(`${repoPath(repository.owner_login, repository.name)}/commits/${encodeURIComponent(sha)}/pulls?per_page=20`, tokenPayload.token, fetchImpl);
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map((pull) => ({ id: pull.id, node_id: pull.node_id, number: pull.number }));
};

export const githubSafeMessage = (error) => ({ connection_required: 'GitHub is not connected.', repository_not_approved: 'This repository is not approved for the workspace.', not_found: 'The GitHub item could not be found.', revoked: 'GitHub access needs to be refreshed.', rate_limited: 'GitHub rate limit reached. Try again later.', inaccessible: 'This GitHub item is not accessible.', error: 'GitHub could not be reached.' }[error?.accessStatus] || 'GitHub could not be reached.');
