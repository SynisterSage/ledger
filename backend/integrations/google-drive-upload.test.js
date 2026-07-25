import assert from 'node:assert/strict';
import test from 'node:test';
import { GOOGLE_DRIVE_MAX_UPLOAD_BYTES, boundedBase64 } from './google-drive-upload.js';

test('accepts the exact upload boundary', () => {
  const bytes = Buffer.alloc(GOOGLE_DRIVE_MAX_UPLOAD_BYTES, 7);
  assert.equal(boundedBase64(bytes.toString('base64')).length, GOOGLE_DRIVE_MAX_UPLOAD_BYTES);
});

test('rejects oversized payload before decoding', () => {
  const bytes = Buffer.alloc(GOOGLE_DRIVE_MAX_UPLOAD_BYTES + 1, 7);
  assert.throws(() => boundedBase64(bytes.toString('base64')), (error) => error.code === 'file_too_large' && error.statusCode === 413);
});

test('rejects malformed payloads', () => {
  assert.throws(() => boundedBase64('not base64?'), (error) => error.code === 'invalid_upload_payload');
});

test('retries accept the same payload deterministically', () => {
  const payload = Buffer.from('same request').toString('base64');
  assert.deepEqual(boundedBase64(payload), boundedBase64(payload));
});
