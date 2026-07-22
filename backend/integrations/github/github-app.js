import crypto from 'node:crypto';

const API_ROOT = 'https://api.github.com';
const apiVersion = () => process.env.GITHUB_API_VERSION?.trim() || '2022-11-28';

export const githubConfig = () => ({
  appId: process.env.GITHUB_APP_ID?.trim(),
  slug: process.env.GITHUB_APP_SLUG?.trim(),
  clientId: process.env.GITHUB_APP_CLIENT_ID?.trim(),
  clientSecret: process.env.GITHUB_APP_CLIENT_SECRET?.trim(),
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
  webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET?.trim(),
});

export const hashGithubState = (state) => crypto.createHash('sha256').update(String(state)).digest('hex');
export const createGithubState = () => crypto.randomBytes(32).toString('base64url');

const base64url = (value) => Buffer.from(value).toString('base64url');
export const createGithubAppJwt = ({ now = Math.floor(Date.now() / 1000), config = githubConfig() } = {}) => {
  if (!config.appId || !config.privateKey) throw Object.assign(new Error('GitHub App is not configured.'), { statusCode: 503 });
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: config.appId }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(config.privateKey, 'base64url');
  return `${unsigned}.${signature}`;
};

const githubRequest = async (path, { method = 'GET', token, body, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': apiVersion(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('GitHub request failed.');
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : 502;
    error.githubStatus = response.status;
    error.githubMessage = String(payload.message ?? '');
    throw error;
  }
  return payload;
};

export const exchangeGithubCode = async ({ code, fetchImpl = fetch, config = githubConfig() }) => {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw Object.assign(new Error('GitHub authorization could not be completed.'), { statusCode: 400 });
  return payload;
};

export const getAccessibleInstallations = ({ token, fetchImpl = fetch }) => githubRequest('/user/installations', { token, fetchImpl });
export const getGithubUser = ({ token, fetchImpl = fetch }) => githubRequest('/user', { token, fetchImpl });
export const getCanonicalInstallation = ({ installationId, fetchImpl = fetch, config = githubConfig() }) => githubRequest(`/app/installations/${encodeURIComponent(installationId)}`, { token: createGithubAppJwt({ config }), fetchImpl });
export const createInstallationToken = ({ installationId, fetchImpl = fetch, config = githubConfig() }) => githubRequest(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: 'POST', token: createGithubAppJwt({ config }), fetchImpl });
export const listInstallationRepositories = ({ token, fetchImpl = fetch }) => githubRequest('/installation/repositories?per_page=100', { token, fetchImpl });
export const getGithubApiRequest = githubRequest;

export const revokeGithubUserToken = async ({ token, fetchImpl = fetch, config = githubConfig() }) => {
  if (!token || !config.clientId) return;
  await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`, {
    method: 'DELETE', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': apiVersion(), Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => null);
};

export const verifyGithubWebhookSignature = ({ rawBody, signature, secret }) => {
  if (!rawBody || !signature || !secret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

export const normalizeGithubRepository = (repository, installationId) => ({
  github_installation_id: installationId, github_repository_id: String(repository.id), owner_login: String(repository.owner?.login ?? ''), name: String(repository.name ?? ''), full_name: String(repository.full_name ?? ''), html_url: String(repository.html_url ?? ''), is_private: Boolean(repository.private), is_archived: Boolean(repository.archived), is_disabled: Boolean(repository.disabled), default_branch: repository.default_branch ? String(repository.default_branch) : null, last_synced_at: new Date().toISOString(),
});

export const normalizeGithubError = (error) => error?.githubMessage ? `GitHub request failed (${error.githubStatus}).` : (error?.message || 'GitHub integration failed.');
