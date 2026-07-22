const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const NUMBER = /^[1-9][0-9]{0,8}$/;

export class GithubUrlError extends Error {
  constructor(message = 'Unsupported GitHub URL') { super(message); this.name = 'GithubUrlError'; this.statusCode = 400; }
}

export const parseGithubUrl = (input) => {
  const originalUrl = String(input ?? '').trim();
  if (!originalUrl || originalUrl.length > 2048) throw new GithubUrlError('Invalid GitHub URL');
  let url;
  try { url = new URL(originalUrl); } catch { throw new GithubUrlError('Invalid GitHub URL'); }
  if (url.protocol !== 'https:' || !GITHUB_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) throw new GithubUrlError();
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !SEGMENT.test(parts[0]) || !SEGMENT.test(parts[1])) throw new GithubUrlError('Invalid GitHub repository URL');
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, '');
  if (!SEGMENT.test(repository)) throw new GithubUrlError('Invalid GitHub repository name');
  let resourceKind = 'repository';
  let number = null;
  if (parts.length > 2) {
    if (parts.length < 4 || !['issues', 'pull'].includes(parts[2]) || !NUMBER.test(parts[3]) || (parts[2] === 'issues' && parts.length !== 4) || parts.length > 8) throw new GithubUrlError('Unsupported GitHub route');
    resourceKind = parts[2] === 'pull' ? 'pullRequest' : 'issue';
    number = Number(parts[3]);
  }
  const normalizedUrl = new URL(`https://github.com/${owner}/${repository}`);
  if (resourceKind === 'issue') normalizedUrl.pathname += `/issues/${number}`;
  if (resourceKind === 'pullRequest') normalizedUrl.pathname += `/pull/${number}`;
  return { provider: 'github', originalUrl, normalizedUrl: normalizedUrl.toString(), owner, repository, resourceKind, ...(number ? { number } : {}) };
};

export const getGithubExternalIdentity = (parsed) => `github:url:${parsed.owner.toLowerCase()}/${parsed.repository.toLowerCase()}/${parsed.resourceKind}${parsed.number ? `:${parsed.number}` : ''}`;
export const canParseGithubUrl = (input) => { try { parseGithubUrl(input); return true; } catch { return false; } };
