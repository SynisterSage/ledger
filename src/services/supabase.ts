import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabaseConfigError = !supabaseUrl || !supabaseKey
  ? new Error(
      'Missing Supabase credentials. Please check your .env.local file and add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
    )
  : null

export const supabase: SupabaseClient<Database> | null = supabaseConfigError
  ? null
  : createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'ledger-auth',
  },
  })

export default supabase
