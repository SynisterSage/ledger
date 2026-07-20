export class FigmaProviderError extends Error {
  constructor(accessStatus, message = 'Figma request failed') {
    super(message);
    this.name = 'FigmaProviderError';
    this.accessStatus = accessStatus;
    this.userMessage =
      accessStatus === 'revoked'
        ? 'Figma authorization is no longer valid.'
        : accessStatus === 'inaccessible'
        ? 'The connected Figma account cannot access this file.'
        : accessStatus === 'not_found'
        ? 'The Figma file or node could not be found.'
        : 'Figma is temporarily unavailable. Try again in a moment.';
  }
}

const figmaRequest = async (path, token, fetchImpl = fetch) => {
  let response;
  try {
    response = await fetchImpl(`https://api.figma.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new FigmaProviderError('error');
  }
  if (response.status === 401) throw new FigmaProviderError('revoked');
  if (response.status === 403) throw new FigmaProviderError('inaccessible');
  if (response.status === 404) throw new FigmaProviderError('not_found');
  if (response.status === 429 || response.status >= 500) throw new FigmaProviderError('error');
  if (!response.ok) throw new FigmaProviderError('error');
  try {
    return await response.json();
  } catch {
    throw new FigmaProviderError('error');
  }
};

export const resolveFigmaMetadata = async (
  parsed,
  { accessToken, connectionId, fetchImpl = fetch }
) => {
  if (!accessToken) throw new FigmaProviderError('connection_required');
  const file = await figmaRequest(
    `/files/${encodeURIComponent(parsed.fileKey)}?depth=1`,
    accessToken,
    fetchImpl
  );
  const metadata = {
    fileKey: parsed.fileKey,
    ...(parsed.nodeId ? { nodeId: parsed.nodeId } : {}),
    ...(parsed.branchKey ? { branchKey: parsed.branchKey } : {}),
    ...(file.name ? { fileName: file.name } : {}),
    ...(file.editorType
      ? { editorType: file.editorType }
      : parsed.editorType
      ? { editorType: parsed.editorType }
      : {}),
    ...(file.lastModified ? { lastModifiedAt: file.lastModified } : {}),
    ...(connectionId ? { resolvedWithConnectionId: connectionId } : {}),
  };
  if (!parsed.nodeId) return { metadata, accessStatus: 'accessible' };

  const nodeResponse = await figmaRequest(
    `/files/${encodeURIComponent(parsed.fileKey)}/nodes?ids=${encodeURIComponent(parsed.nodeId)}`,
    accessToken,
    fetchImpl
  );
  const node = nodeResponse.nodes?.[parsed.nodeId]?.document;
  if (!node) throw new FigmaProviderError('not_found');
  return {
    metadata: {
      ...metadata,
      ...(node.name ? { nodeName: node.name } : {}),
      ...(node.type ? { nodeType: node.type } : {}),
    },
    accessStatus: 'accessible',
  };
};

export const fetchFigmaPreviewImage = async (parsed, { accessToken, fetchImpl = fetch }) => {
  if (!parsed.nodeId) return null;
  const response = await fetchImpl(
    `https://api.figma.com/v1/images/${encodeURIComponent(parsed.fileKey)}?ids=${encodeURIComponent(parsed.nodeId)}&format=png&scale=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (response.status === 401) throw new FigmaProviderError('revoked');
  if (response.status === 403) throw new FigmaProviderError('inaccessible');
  if (response.status === 404) throw new FigmaProviderError('not_found');
  if (response.status === 429 || response.status >= 500) throw new FigmaProviderError('error');
  if (!response.ok) throw new FigmaProviderError('error');
  const payload = await response.json().catch(() => null);
  const imageUrl = payload?.images?.[parsed.nodeId];
  if (!imageUrl) throw new FigmaProviderError('not_found');
  try {
    if (new URL(imageUrl).protocol !== 'https:') throw new Error('unsafe preview URL');
  } catch {
    throw new FigmaProviderError('error');
  }
  let imageResponse;
  try { imageResponse = await fetchImpl(imageUrl); } catch { throw new FigmaProviderError('error'); }
  if (!imageResponse.ok) throw new FigmaProviderError('error');
  const contentType = String(imageResponse.headers?.get?.('content-type') ?? '').split(';')[0].toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) throw new FigmaProviderError('error', 'Figma returned an unsupported preview format');
  const contentLength = Number(imageResponse.headers?.get?.('content-length') ?? 0);
  if (contentLength > 10 * 1024 * 1024) throw new FigmaProviderError('error', 'Figma preview is too large');
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new FigmaProviderError('error', 'Figma preview is too large');
  return { buffer, contentType };
};
