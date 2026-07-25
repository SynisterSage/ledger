import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleDriveFolder, createGoogleDriveNativeFile, getGoogleDriveExternalIdentity, parseGoogleDriveUrl, resolveGoogleDriveFolder } from './google-drive.js';

test('normalizes common Google Drive file URLs to one identity', () => {
  const ids = [
    parseGoogleDriveUrl('https://drive.google.com/file/d/1abc_DEF-1234567890/view').fileId,
    parseGoogleDriveUrl('https://docs.google.com/document/d/1abc_DEF-1234567890/edit').fileId,
    parseGoogleDriveUrl('https://drive.google.com/open?id=1abc_DEF-1234567890').fileId,
  ];
  assert.deepEqual(new Set(ids).size, 1);
  assert.equal(getGoogleDriveExternalIdentity(parseGoogleDriveUrl('https://drive.google.com/open?id=1abc_DEF-1234567890')), 'google_drive:file:1abc_DEF-1234567890');
});

test('verifies the selected picker item is a folder', async () => {
  const response = { status: 200, ok: true, json: async () => ({ id: 'folder-id', mimeType: 'application/vnd.google-apps.folder', name: 'Catalog' }) };
  const folder = await resolveGoogleDriveFolder('folder-id', { accessToken: 'token', fetchImpl: async () => response });
  assert.equal(folder.name, 'Catalog');
  await assert.rejects(() => resolveGoogleDriveFolder('file-id', { accessToken: 'token', fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ id: 'file-id', mimeType: 'application/pdf' }) }) }), /Select a Google Drive folder/);
});

test('creates Drive folders and native files with explicit parents', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, options }); return { status: 200, ok: true, json: async () => ({ id: 'created-id', name: 'Brief' }) }; };
  await createGoogleDriveFolder({ name: 'Planning', parentId: 'root-folder', accessToken: 'token', fetchImpl });
  await createGoogleDriveNativeFile({ name: 'Brief', mimeType: 'application/vnd.google-apps.document', parentId: 'root-folder', accessToken: 'token', fetchImpl });
  assert.equal(requests.length, 2);
  assert.match(requests[0].options.body, /"mimeType":"application\/vnd.google-apps.folder"/);
  assert.match(requests[1].options.body, /application\/vnd.google-apps.document/);
  assert.match(requests[0].options.body, /root-folder/);
});
