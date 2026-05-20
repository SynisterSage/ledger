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

export const runtimeConfig: LedgerRuntimeConfig = {
  apiUrl: runtimeFromWindow?.apiUrl?.trim() || runtimeFromEnv.apiUrl,
  ledgerWebUrl: runtimeFromWindow?.ledgerWebUrl?.trim() || runtimeFromEnv.ledgerWebUrl,
  supabaseUrl: runtimeFromWindow?.supabaseUrl?.trim() || runtimeFromEnv.supabaseUrl,
  supabasePublishableKey:
    runtimeFromWindow?.supabasePublishableKey?.trim() ||
    runtimeFromEnv.supabasePublishableKey ||
    runtimeFromEnv.supabaseAnonKey,
};

export const DEFAULT_API_URL = runtimeConfig.apiUrl || 'https://api.ledgerworkspace.com';
