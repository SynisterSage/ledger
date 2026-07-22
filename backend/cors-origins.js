const EXTENSION_ORIGIN_PATTERN = /^(?:chrome|moz|safari)-extension:\/\/[^/\s]+$/i;

const splitOrigins = (value) => String(value ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const configuredExtensionOrigins = (env) => [
  ...splitOrigins(env.BROWSER_EXTENSION_ORIGINS),
  ...splitOrigins(env.BROWSER_EXTENSION_ORIGIN),
].filter((origin) => EXTENSION_ORIGIN_PATTERN.test(origin));

/**
 * Build the server-side CORS allowlist. Browser extension origins must be
 * explicitly configured; a wildcard extension origin would allow unrelated
 * extensions to call the API.
 */
export const getAllowedCorsOrigins = (env = process.env) => new Set([
  'https://ledgerworkspace.com',
  'https://www.ledgerworkspace.com',
  env.FRONTEND_URL?.trim(),
  env.PUBLIC_FRONTEND_URL?.trim(),
  env.DEV_FRONTEND_URL?.trim(),
  ...configuredExtensionOrigins(env),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
].filter((origin) => {
  if (!origin) return false;
  if (/^(?:chrome|moz|safari)-extension:/i.test(origin)) {
    return EXTENSION_ORIGIN_PATTERN.test(origin);
  }
  return true;
}));

export const isAllowedCorsOrigin = (origin, allowedOrigins) => (
  !origin || origin === 'null' || allowedOrigins.has(origin)
);
