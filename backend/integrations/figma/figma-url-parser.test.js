import test from 'node:test';
import assert from 'node:assert/strict';
import { canParseFigmaUrl, getFigmaExternalIdentity, parseFigmaUrl } from './figma-url-parser.js';

test('parses design file URLs and strips unrelated query parameters', () => {
  const parsed = parseFigmaUrl('https://www.figma.com/design/abc12345/My-file?utm_source=test');
  assert.equal(parsed.fileKey, 'abc12345');
  assert.equal(parsed.resourceKind, 'unknown');
  assert.equal(parsed.normalizedUrl, 'https://www.figma.com/design/abc12345');
});

test('supports legacy file and FigJam board URLs', () => {
  assert.equal(
    parseFigmaUrl('https://figma.com/file/abc12345/Old').normalizedUrl,
    'https://www.figma.com/file/abc12345'
  );
  assert.equal(parseFigmaUrl('https://www.figma.com/board/abc12345/Board').editorType, 'figjam');
});

test('normalizes colon, hyphen, and encoded node IDs to one identity', () => {
  const urls = [
    'https://www.figma.com/design/abc12345/a?node-id=12-34',
    'https://www.figma.com/design/abc12345/b?foo=bar&node-id=12%3A34',
    'https://figma.com/design/abc12345/c?node-id=12:34',
  ];
  const parsed = urls.map(parseFigmaUrl);
  assert.deepEqual(
    parsed.map((value) => value.nodeId),
    ['12:34', '12:34', '12:34']
  );
  assert.equal(new Set(parsed.map(getFigmaExternalIdentity)).size, 1);
});

test('rejects lookalike domains, unsafe protocols, unsupported routes, and malformed keys', () => {
  assert.equal(canParseFigmaUrl('https://evilfigma.com/design/abc12345/file'), false);
  assert.equal(canParseFigmaUrl('http://www.figma.com/design/abc12345/file'), false);
  assert.equal(canParseFigmaUrl('https://www.figma.com/proto/abc12345/file'), false);
  assert.equal(canParseFigmaUrl('https://www.figma.com/design/!!!/file'), false);
  assert.equal(canParseFigmaUrl('https://www.figma.com/design/abc12345/file?node-id=bad'), false);
});

test('keeps file-level and node-level identities distinct', () => {
  assert.notEqual(
    getFigmaExternalIdentity(parseFigmaUrl('https://www.figma.com/design/abc12345/file')),
    getFigmaExternalIdentity(
      parseFigmaUrl('https://www.figma.com/design/abc12345/file?node-id=1-2')
    )
  );
});
