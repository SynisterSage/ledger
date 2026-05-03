type LedgerRuntimeConfig = {
  apiUrl?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
}

const runtimeFromWindow = typeof window !== 'undefined' ? window.__LEDGER_RUNTIME__ : undefined

const runtimeFromEnv = {
  apiUrl: import.meta.env.VITE_API_URL?.trim(),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim(),
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
}

export const runtimeConfig: LedgerRuntimeConfig = {
  apiUrl: runtimeFromWindow?.apiUrl?.trim() || runtimeFromEnv.apiUrl,
  supabaseUrl: runtimeFromWindow?.supabaseUrl?.trim() || runtimeFromEnv.supabaseUrl,
  supabasePublishableKey:
    runtimeFromWindow?.supabasePublishableKey?.trim() || runtimeFromEnv.supabasePublishableKey,
}

export const DEFAULT_API_URL = runtimeConfig.apiUrl || 'https://ledger-backend-buq8.onrender.com'
