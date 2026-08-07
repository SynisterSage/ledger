const DEFAULT_RETURN_TO = '/app';
const MAX_RETURN_TO_LENGTH = 2048;

/** Accept only an internal Ledger product path for post-auth restoration. */
export const sanitizeReturnTo = (value: string | null | undefined): string => {
  if (!value || value.length > MAX_RETURN_TO_LENGTH) return DEFAULT_RETURN_TO;

  const candidate = value.trim();
  if (
    !candidate ||
    candidate.includes('\\') ||
    /%5c/i.test(candidate) ||
    !candidate.startsWith('/') ||
    candidate.includes('#')
  ) {
    return DEFAULT_RETURN_TO;
  }
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return DEFAULT_RETURN_TO;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate, 'https://ledgerworkspace.com');
  } catch {
    return DEFAULT_RETURN_TO;
  }

  if (parsed.origin !== 'https://ledgerworkspace.com' || !parsed.pathname.startsWith('/app')) {
    return DEFAULT_RETURN_TO;
  }
  for (const key of parsed.searchParams.keys()) {
    if (/^(access_token|refresh_token|token|invite|code|state|error|error_description)$/i.test(key)) {
      return DEFAULT_RETURN_TO;
    }
  }
  return parsed.pathname === '/app' || parsed.pathname.startsWith('/app/')
    ? `${parsed.pathname}${parsed.search}`
    : DEFAULT_RETURN_TO;
};

export const buildLoginUrl = (returnTo: string | null | undefined): string =>
  `/login?${new URLSearchParams({ returnTo: sanitizeReturnTo(returnTo) }).toString()}`;

export const DEFAULT_AUTH_RETURN_TO = DEFAULT_RETURN_TO;
