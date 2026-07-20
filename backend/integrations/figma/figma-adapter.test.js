import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFigmaUrl } from './figma-url-parser.js';
import { FigmaProviderError, fetchFigmaPreviewImage, resolveFigmaMetadata } from './figma-adapter.js';

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test('resolves file and node metadata without requesting images', async () => {
  const calls = [];
  const result = await resolveFigmaMetadata(
    parseFigmaUrl('https://www.figma.com/design/abc12345/file?node-id=1-2'),
    {
      accessToken: 'server-only-token',
      connectionId: 'connection-id',
      fetchImpl: async (url) => {
        calls.push(url);
        return url.includes('/nodes?')
          ? response(200, { nodes: { '1:2': { document: { name: 'Frame', type: 'FRAME' } } } })
          : response(200, {
              name: 'Design',
              editorType: 'figma',
              lastModified: '2026-07-20T00:00:00Z',
            });
      },
    }
  );
  assert.equal(result.accessStatus, 'accessible');
  assert.deepEqual(result.metadata, {
    fileKey: 'abc12345',
    nodeId: '1:2',
    fileName: 'Design',
    editorType: 'figma',
    lastModifiedAt: '2026-07-20T00:00:00Z',
    resolvedWithConnectionId: 'connection-id',
    nodeName: 'Frame',
    nodeType: 'FRAME',
  });
  assert.equal(
    calls.some((url) => url.includes('/images')),
    false
  );
});

test('maps revoked and missing Figma responses to safe provider states', async () => {
  await assert.rejects(
    () =>
      resolveFigmaMetadata(parseFigmaUrl('https://www.figma.com/design/abc12345/file'), {
        accessToken: 'token',
        fetchImpl: async () => response(401, {}),
      }),
    (error) => error instanceof FigmaProviderError && error.accessStatus === 'revoked'
  );
  await assert.rejects(
    () =>
      resolveFigmaMetadata(parseFigmaUrl('https://www.figma.com/design/abc12345/file'), {
        accessToken: 'token',
        fetchImpl: async () => response(404, {}),
      }),
    (error) => error instanceof FigmaProviderError && error.accessStatus === 'not_found'
  );
});

test('downloads only validated image previews', async () => {
  const image = await fetchFigmaPreviewImage(parseFigmaUrl('https://www.figma.com/design/abc12345/file?node-id=1-2'), {
    accessToken: 'token',
    fetchImpl: async (url) => url.includes('/images/')
      ? response(200, { images: { '1:2': 'https://cdn.figma.com/preview.png' } })
      : { status: 200, ok: true, headers: new Headers({ 'content-type': 'image/png', 'content-length': '4' }), arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer },
  });
  assert.equal(image.contentType, 'image/png');
  assert.equal(image.buffer.length, 4);
  await assert.rejects(() => fetchFigmaPreviewImage(parseFigmaUrl('https://www.figma.com/design/abc12345/file?node-id=1-2'), { accessToken: 'token', fetchImpl: async (url) => url.includes('/images/') ? response(200, { images: { '1:2': 'https://cdn.figma.com/preview.svg' } }) : { status: 200, ok: true, headers: new Headers({ 'content-type': 'image/svg+xml' }), arrayBuffer: async () => new ArrayBuffer(1) } }), (error) => error instanceof FigmaProviderError && error.accessStatus === 'error');
});
