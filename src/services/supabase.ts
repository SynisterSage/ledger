import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { runtimeConfig } from '../config/runtime'

const supabaseUrl = runtimeConfig.supabaseUrl
const supabaseKey = runtimeConfig.supabasePublishableKey

export const supabaseConfigError =
  !supabaseUrl || !supabaseKey
    ? new Error(
        'Missing Supabase configuration. Please check runtime-config.js or your environment variables.'
      )
    : null

export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl ?? 'https://invalid.invalid',
  supabaseKey ?? 'invalid',
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'ledger-auth',
  },
  }
)

export default supabase
