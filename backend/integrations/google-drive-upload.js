export const GOOGLE_DRIVE_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export function assertBase64Size(value, maxBytes = GOOGLE_DRIVE_MAX_UPLOAD_BYTES) {
  const normalized = String(value || '').replace(/\s/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    const error = new Error('Provide a valid file payload.');
    error.code = 'invalid_upload_payload';
    error.statusCode = 400;
    throw error;
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
  if (estimatedBytes > maxBytes) {
    const error = new Error(`Uploads are limited to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    error.code = 'file_too_large';
    error.statusCode = 413;
    error.maxBytes = maxBytes;
    throw error;
  }
  return normalized;
}

export function boundedBase64(value, maxBytes = GOOGLE_DRIVE_MAX_UPLOAD_BYTES) {
  const normalized = assertBase64Size(value, maxBytes);
  const bytes = Buffer.from(normalized, 'base64');
  if (!bytes.length) {
    const error = new Error('Provide a non-empty file.');
    error.code = 'invalid_upload_payload';
    error.statusCode = 400;
    throw error;
  }
  if (bytes.length > maxBytes) {
    const error = new Error(`Uploads are limited to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    error.code = 'file_too_large';
    error.statusCode = 413;
    error.maxBytes = maxBytes;
    throw error;
  }
  return bytes;
}
