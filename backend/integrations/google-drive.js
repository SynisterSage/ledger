const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com', 'forms.google.com', 'drawings.google.com']);

const safeText = (value, fallback = '') => String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 2000);

export class GoogleDriveProviderError extends Error {
  constructor(message, accessStatus = 'error', statusCode = 502) {
    super(message); this.name = 'GoogleDriveProviderError'; this.accessStatus = accessStatus; this.statusCode = statusCode;
  }
}

export const parseGoogleDriveUrl = (value) => {
  let parsed;
  try { parsed = new URL(String(value ?? '').trim()); } catch { throw new Error('That is not a supported Google Drive link.'); }
  if (!GOOGLE_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error('That is not a supported Google Drive link.');
  const candidates = [parsed.searchParams.get('id'), parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1], parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]];
  const fileId = candidates.find((candidate) => /^[a-zA-Z0-9_-]{10,}$/.test(String(candidate ?? '')));
  if (!fileId) throw new Error('Google Drive file ID is missing from this link.');
  const normalizedUrl = `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
  return { provider: 'google_drive', fileId, resourceKind: 'file', normalizedUrl, originalUrl: parsed.toString() };
};

export const getGoogleDriveExternalIdentity = (parsed) => `google_drive:file:${parsed.fileId}`;

const fileTypeLabel = (mimeType = '') => ({
  'application/vnd.google-apps.document': 'Google Docs', 'application/vnd.google-apps.spreadsheet': 'Google Sheets', 'application/vnd.google-apps.presentation': 'Google Slides', 'application/vnd.google-apps.form': 'Google Forms', 'application/vnd.google-apps.drawing': 'Google Drawing', 'application/pdf': 'PDF',
}[mimeType] || (mimeType.startsWith('image/') ? 'Image' : mimeType.startsWith('video/') ? 'Video' : mimeType.split('/').pop()?.replace(/[+_-]/g, ' ') || 'File'));

export const resolveGoogleDriveMetadata = async (parsed, { accessToken, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parsed.fileId)}?${new URLSearchParams({ fields: 'id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,owners(displayName,emailAddress),driveId,trashed,parents,capabilities,shortcutDetails,appProperties', supportsAllDrives: 'true' })}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) throw new GoogleDriveProviderError('Google Drive connection expired.', 'revoked', 401);
  if (response.status === 403) throw new GoogleDriveProviderError('This Google Drive file is no longer accessible.', 'inaccessible', 403);
  if (response.status === 404) throw new GoogleDriveProviderError('This file is no longer available in Google Drive.', 'not_found', 404);
  if (!response.ok) throw new GoogleDriveProviderError('Google Drive could not load this file right now.', 'error', 502);
  const file = await response.json();
  if (file.trashed) throw new GoogleDriveProviderError('This file is no longer available in Google Drive.', 'not_found', 404);
  return { accessStatus: 'accessible', metadata: { provider: 'google_drive', providerResourceId: safeText(file.id), name: safeText(file.name, 'Untitled Drive file'), mimeType: safeText(file.mimeType), fileType: fileTypeLabel(file.mimeType), canonicalUrl: parsed.normalizedUrl, webViewUrl: safeText(file.webViewLink, parsed.originalUrl), iconUrl: safeText(file.iconLink) || null, thumbnailUrl: safeText(file.thumbnailLink) || null, modifiedAtExternal: file.modifiedTime || null, sizeBytes: file.size ? Number(file.size) : null, owner: file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || null, sharedDriveId: file.driveId || null, parents: file.parents || [], capabilities: file.capabilities || {}, shortcutDetails: file.shortcutDetails || null, appProperties: file.appProperties || {} } };
};

const writeDriveRequest = async (url, { method = 'POST', accessToken, body, fetchImpl = fetch, headers = {} } = {}) => {
  const response = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
  if (response.status === 401) throw new GoogleDriveProviderError('Google Drive connection expired.', 'revoked', 401);
  if (response.status === 403) throw new GoogleDriveProviderError('Google Drive denied this action.', 'inaccessible', 403);
  if (response.status === 404) throw new GoogleDriveProviderError('The Google Drive item or destination is no longer available.', 'not_found', 404);
  if (!response.ok) throw new GoogleDriveProviderError('Google Drive could not complete this action.', 'error', 502);
  return response.status === 204 ? {} : response.json();
};

export const createGoogleDriveFolder = async ({ name, parentId, appProperties, accessToken, fetchImpl = fetch } = {}) => writeDriveRequest('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', { accessToken, fetchImpl, body: { name: safeText(name, 'New folder'), mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [String(parentId)] } : {}), ...(appProperties ? { appProperties } : {}) } });
export const createGoogleDriveNativeFile = async ({ name, mimeType, parentId, appProperties, accessToken, fetchImpl = fetch } = {}) => writeDriveRequest('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', { accessToken, fetchImpl, body: { name: safeText(name, 'Untitled'), mimeType, ...(parentId ? { parents: [String(parentId)] } : {}), ...(appProperties ? { appProperties } : {}) } });
export const updateGoogleDriveItem = async ({ fileId, body, addParents, removeParents, accessToken, fetchImpl = fetch } = {}) => { const params = new URLSearchParams({ supportsAllDrives: 'true' }); if (addParents) params.set('addParents', String(addParents)); if (removeParents) params.set('removeParents', String(removeParents)); return writeDriveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, { method: 'PATCH', accessToken, fetchImpl, body }); };
export const copyGoogleDriveFile = async ({ fileId, name, parentId, accessToken, fetchImpl = fetch } = {}) => writeDriveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true`, { accessToken, fetchImpl, body: { ...(name ? { name: safeText(name) } : {}), ...(parentId ? { parents: [String(parentId)] } : {}) } });
export const uploadGoogleDriveBytes = async ({ name, mimeType, parentId, bytes, accessToken, fetchImpl = fetch } = {}) => { const metadata = JSON.stringify({ name: safeText(name, 'Uploaded file'), mimeType: safeText(mimeType, 'application/octet-stream'), ...(parentId ? { parents: [String(parentId)] } : {}) }); const boundary = `ledger_${Math.random().toString(16).slice(2)}`; const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`); const suffix = Buffer.from(`\r\n--${boundary}--`); return writeDriveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', { accessToken, fetchImpl, body: Buffer.concat([prefix, Buffer.from(bytes), suffix]), headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } }); };

const driveFields = 'id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,owners(displayName,emailAddress),driveId,trashed,parents,capabilities,shortcutDetails,appProperties';
const driveRequest = async (url, accessToken, fetchImpl = fetch) => {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) throw new GoogleDriveProviderError('Google Drive connection expired.', 'revoked', 401);
  if (response.status === 403) throw new GoogleDriveProviderError('This Google Drive item is no longer accessible.', 'inaccessible', 403);
  if (response.status === 404) throw new GoogleDriveProviderError('This Google Drive item is no longer available.', 'not_found', 404);
  if (!response.ok) throw new GoogleDriveProviderError('Google Drive could not load this folder right now.', 'error', 502);
  return response.json();
};
export const resolveGoogleDriveFolder = async (folderId, { accessToken, fetchImpl = fetch } = {}) => {
  const file = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${new URLSearchParams({ fields: driveFields, supportsAllDrives: 'true' })}`, accessToken, fetchImpl);
  if (file.trashed) throw new GoogleDriveProviderError('This folder is no longer available in Google Drive.', 'not_found', 404);
  if (file.mimeType !== 'application/vnd.google-apps.folder') throw new GoogleDriveProviderError('Select a Google Drive folder.', 'error', 400);
  return file;
};
export const listGoogleDriveChildren = async (parentId, { accessToken, pageToken = '', pageSize = 50, includeTrashed = false, fetchImpl = fetch } = {}) => {
  const params = new URLSearchParams({ q: `'${String(parentId).replace(/'/g, "\\'")}' in parents${includeTrashed ? '' : ' and trashed = false'}`, fields: `nextPageToken,files(${driveFields})`, pageSize: String(Math.min(Math.max(Number(pageSize) || 50, 1), 100)), orderBy: 'folder,name', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', spaces: 'drive' });
  if (pageToken) params.set('pageToken', pageToken);
  return driveRequest(`https://www.googleapis.com/drive/v3/files?${params}`, accessToken, fetchImpl);
};
export const googleDriveItemIsWithinRoot = async (itemId, rootId, { accessToken, fetchImpl = fetch } = {}) => {
  let current = String(itemId);
  for (let depth = 0; depth < 30; depth += 1) {
    if (current === String(rootId)) return true;
    const item = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(current)}?${new URLSearchParams({ fields: 'id,parents,mimeType,trashed', supportsAllDrives: 'true' })}`, accessToken, fetchImpl);
    if (depth === 0 && item.mimeType !== 'application/vnd.google-apps.folder') return false;
    if (item.trashed || !item.parents?.length) return false;
    current = item.parents[0];
  }
  return false;
};

export const getGoogleDriveStartPageToken = async ({ accessToken, fetchImpl = fetch } = {}) => {
  return driveRequest('https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true', accessToken, fetchImpl);
};

export const listGoogleDriveChanges = async (pageToken, { accessToken, fetchImpl = fetch } = {}) => {
  const params = new URLSearchParams({ pageToken: String(pageToken), spaces: 'drive', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', pageSize: '100', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,driveId,trashed,parents,capabilities,shortcutDetails,appProperties,owners(displayName,emailAddress)))` });
  return driveRequest(`https://www.googleapis.com/drive/v3/changes?${params}`, accessToken, fetchImpl);
};

export const watchGoogleDriveChanges = async ({ pageToken, address, channelId, token, expiration, accessToken, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl('https://www.googleapis.com/drive/v3/changes/watch', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: channelId, type: 'web_hook', address, token, expiration: String(expiration), pageToken: String(pageToken), includeItemsFromAllDrives: true, supportsAllDrives: true }) });
  if (response.status === 401) throw new GoogleDriveProviderError('Google Drive connection expired.', 'revoked', 401);
  if (response.status === 403) throw new GoogleDriveProviderError('Google Drive monitoring is not authorized.', 'inaccessible', 403);
  if (!response.ok) throw new GoogleDriveProviderError('Google Drive monitoring could not be started.', 'error', 502);
  return response.json();
};

export const stopGoogleDriveChanges = async ({ resourceId, channelId, accessToken, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl('https://www.googleapis.com/drive/v3/channels/stop', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: channelId, resourceId }) });
  if (response.status === 404) return { stopped: true };
  if (response.status === 401) throw new GoogleDriveProviderError('Google Drive connection expired.', 'revoked', 401);
  if (!response.ok) throw new GoogleDriveProviderError('Google Drive monitoring could not be stopped.', 'error', 502);
  return { stopped: true };
};

export { DRIVE_SCOPE };
