import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const STORAGE_KEY = 'ledger-mobile-auth';

const supabaseUrl =
  process.env.VITE_SUPABASE_URL?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
  '';

const supabaseKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  '';

export const supabaseConfigError =
  !supabaseUrl || !supabaseKey
    ? new Error('Missing Supabase configuration for mobile auth.')
    : null;

const memoryStorage = new Map<string, string>();

const authStorage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') {
      return memoryStorage.get(key) ?? null;
    }

    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') {
      memoryStorage.set(key, value);
      return;
    }

    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      memoryStorage.set(key, value);
    }
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') {
      memoryStorage.delete(key);
      return;
    }

    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      memoryStorage.delete(key);
    }
  },
};

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: authStorage,
        storageKey: STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

export function getSupabaseClient() {
  if (supabaseConfigError || !supabase) {
    throw supabaseConfigError ?? new Error('Supabase client is unavailable.');
  }

  return supabase;
}
