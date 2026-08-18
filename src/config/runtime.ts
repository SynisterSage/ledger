type LedgerRuntimeConfig = {
  apiUrl?: string;
  ledgerWebUrl?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

const runtimeFromWindow = typeof window !== 'undefined' ? window.__LEDGER_RUNTIME__ : undefined;

const runtimeFromEnv = {
  apiUrl: import.meta.env.VITE_API_URL?.trim(),
  ledgerWebUrl: import.meta.env.VITE_LEDGER_WEB_URL?.trim(),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim(),
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim(),
};

// Vite development must retain the local proxy target supplied by
// dev-desktop/dev-web. The public runtime-config.js is production-safe and is
// intentionally used by packaged/browser production builds instead.
const preferEnvironmentConfig = Boolean(import.meta.env.DEV);
const resolvedRuntimeValue = (environmentValue?: string, windowValue?: string) =>
  (preferEnvironmentConfig ? environmentValue || windowValue : windowValue || environmentValue)?.trim();

export const runtimeConfig: LedgerRuntimeConfig = {
  apiUrl: resolvedRuntimeValue(runtimeFromEnv.apiUrl, runtimeFromWindow?.apiUrl),
  ledgerWebUrl: resolvedRuntimeValue(runtimeFromEnv.ledgerWebUrl, runtimeFromWindow?.ledgerWebUrl),
  supabaseUrl: resolvedRuntimeValue(runtimeFromEnv.supabaseUrl, runtimeFromWindow?.supabaseUrl),
  supabasePublishableKey:
    runtimeFromEnv.supabaseAnonKey ||
    resolvedRuntimeValue(runtimeFromEnv.supabasePublishableKey, runtimeFromWindow?.supabasePublishableKey),
};

export const DEFAULT_API_URL = runtimeConfig.apiUrl || 'https://api.ledgerworkspace.com';
