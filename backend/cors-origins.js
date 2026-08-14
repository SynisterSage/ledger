const EXTENSION_ORIGIN_PATTERN = /^(?:chrome|moz|safari)-extension:\/\/[^/\s]+$/i;
// Figma plugin UI requests are sent from Figma's hosted plugin iframe.
// Keep this explicit: allowing arbitrary origins here would expose every API
// route to any website that can obtain a Ledger credential.
const FIGMA_PLUGIN_ORIGINS = [
  'https://www.figma.com',
  'https://figma.com',
];

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
  ...FIGMA_PLUGIN_ORIGINS,
  env.FRONTEND_URL?.trim(),
  env.PUBLIC_FRONTEND_URL?.trim(),
  ...(env.NODE_ENV === 'production' ? [] : [env.DEV_FRONTEND_URL?.trim()]),
  ...configuredExtensionOrigins(env),
  ...(env.NODE_ENV === 'production'
    ? []
    : [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
      ]),
].filter((origin) => {
  if (!origin) return false;
  if (/^(?:chrome|moz|safari)-extension:/i.test(origin)) {
    return EXTENSION_ORIGIN_PATTERN.test(origin);
  }
  return true;
}));

export const isAllowedCorsOrigin = (origin, allowedOrigins) => (
  !origin || origin !== 'null' && allowedOrigins.has(origin)
);

/**
 * Figma hosts plugin UIs in a null-origin iframe. That origin cannot use an
 * echoed allowlist value; it requires `*`, and plugin requests authenticate
 * with scoped bearer credentials rather than cookies. Keep this exception
 * limited to the plugin API routes.
 */
export const getCorsOptions = (req, allowedOrigins) => {
  const origin = req.get('origin');
  if (req.path.startsWith('/api/figma-plugin') && origin === 'null') {
    return { origin: '*', credentials: false };
  }

  return {
    origin(requestOrigin, callback) {
      return isAllowedCorsOrigin(requestOrigin, allowedOrigins)
        ? callback(null, true)
        : callback(new Error(`CORS origin not allowed: ${requestOrigin || '(none)'}`));
    },
    credentials: true,
  };
};
