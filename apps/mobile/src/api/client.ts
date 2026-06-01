import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const STORAGE_KEY = 'ledger-mobile-auth';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  ledgerApiUrl?: string;
  ledgerSupabaseUrl?: string;
  ledgerSupabaseAnonKey?: string;
};

const apiUrl =
  extra.ledgerApiUrl?.trim() ||
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  '';

const supabaseUrl =
  extra.ledgerSupabaseUrl?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
  '';

const supabaseKey =
  extra.ledgerSupabaseAnonKey?.trim() ||
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

export const mobileApiConfigError = !apiUrl
  ? new Error('Missing API configuration for mobile.')
  : null;

export function getSupabaseClient() {
  if (supabaseConfigError || !supabase) {
    throw supabaseConfigError ?? new Error('Supabase client is unavailable.');
  }

  return supabase;
}

export function getMobileApiBaseUrl() {
  if (mobileApiConfigError) {
    throw mobileApiConfigError;
  }

  return apiUrl.replace(/\/$/, '');
}

export async function getMobileAccessToken() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) throw error;
  const token = data.session?.access_token?.trim();
  if (!token) {
    throw new Error('Not authenticated.');
  }

  return token;
}

export async function mobileRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = getMobileApiBaseUrl();
  const accessToken = await getMobileAccessToken();
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text ? (() => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  })() : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
        ? String((payload as { error: string }).error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return (payload ?? (null as T)) as T;
}
