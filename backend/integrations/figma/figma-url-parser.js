const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com']);
const SUPPORTED_ROUTES = new Set(['design', 'file', 'board']);
const FILE_KEY_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;

export class FigmaUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FigmaUrlError';
    this.statusCode = 400;
  }
}

const normalizeNodeId = (value) => {
  const decoded = decodeURIComponent(String(value ?? '').trim());
  if (!/^\d+[-:]\d+$/.test(decoded)) throw new FigmaUrlError('Invalid Figma node identifier');
  const [page, node] = decoded.split(/[-:]/);
  return `${page}:${node}`;
};

export const parseFigmaUrl = (input) => {
  const originalUrl = String(input ?? '').trim();
  if (!originalUrl || originalUrl.length > 2048) throw new FigmaUrlError('Invalid Figma URL');

  let url;
  try {
    url = new URL(originalUrl);
  } catch {
    throw new FigmaUrlError('Invalid Figma URL');
  }
  if (
    url.protocol !== 'https:' ||
    !FIGMA_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  ) {
    throw new FigmaUrlError('Unsupported Figma URL');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !SUPPORTED_ROUTES.has(parts[0].toLowerCase())) {
    throw new FigmaUrlError('Unsupported Figma route');
  }
  const fileKey = parts[1];
  if (!FILE_KEY_PATTERN.test(fileKey)) throw new FigmaUrlError('Invalid Figma file key');

  const nodeParam = url.searchParams.get('node-id');
  const branchParam = url.searchParams.get('branch-id') || url.searchParams.get('branch_key');
  const nodeId = nodeParam ? normalizeNodeId(nodeParam) : undefined;
  const branchKey = branchParam ? String(branchParam).trim() : undefined;
  if (branchKey && !FILE_KEY_PATTERN.test(branchKey))
    throw new FigmaUrlError('Invalid Figma branch key');

  const normalizedUrl = new URL(`https://www.figma.com/${parts[0].toLowerCase()}/${fileKey}`);
  if (nodeId) normalizedUrl.searchParams.set('node-id', nodeId);
  if (branchKey) normalizedUrl.searchParams.set('branch-id', branchKey);

  return {
    provider: 'figma',
    originalUrl,
    normalizedUrl: normalizedUrl.toString(),
    fileKey,
    ...(nodeId ? { nodeId } : {}),
    ...(branchKey ? { branchKey } : {}),
    resourceKind: 'unknown',
    editorType: parts[0].toLowerCase() === 'board' ? 'figjam' : 'figma',
  };
};

export const getFigmaExternalIdentity = (parsed) =>
  ['figma', parsed.fileKey, parsed.nodeId || 'file', parsed.branchKey || ''].join(':');

export const canParseFigmaUrl = (input) => {
  try {
    parseFigmaUrl(input);
    return true;
  } catch {
    return false;
  }
};
