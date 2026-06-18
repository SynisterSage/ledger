import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

import {
  defaultMobileAppPreferences,
  getMobileUserSettings,
  readMobileAppPreferences,
  updateMobileUserSettings,
} from '@/api/userSettings';

export type AppPreferencesState = {
  isLoading: boolean;
  isHydrated: boolean;
  userId: string | null;
  hapticsEnabled: boolean;
  reduceMotionEnabled: boolean;
  themeMode: 'system' | 'light' | 'dark';
  error: string | null;
};

const initialState: AppPreferencesState = {
  isLoading: false,
  isHydrated: false,
  userId: null,
  hapticsEnabled: defaultMobileAppPreferences.hapticsEnabled,
  reduceMotionEnabled: defaultMobileAppPreferences.reduceMotionEnabled,
  themeMode: defaultMobileAppPreferences.themeMode,
  error: null,
};

const STORAGE_PREFIX = 'ledger-mobile-app-preferences';

let state = initialState;
const listeners = new Set<() => void>();
let bootstrapToken = 0;

function emit() {
  for (const listener of listeners) listener();
}

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function setState(next: Partial<AppPreferencesState>) {
  state = { ...state, ...next };
  emit();
}

async function persistPreferences(userId: string | null, payload: AppPreferencesState) {
  if (!userId) return;

  const storagePayload = JSON.stringify({
    hapticsEnabled: payload.hapticsEnabled,
    reduceMotionEnabled: payload.reduceMotionEnabled,
    themeMode: payload.themeMode,
    updatedAt: new Date().toISOString(),
  });

  try {
    await SecureStore.setItemAsync(getStorageKey(userId), storagePayload);
  } catch {
    // Ignore local cache failures.
  }

  try {
    await updateMobileUserSettings({
        preferences: {
          mobileAppPreferences: {
            hapticsEnabled: payload.hapticsEnabled,
            reduceMotionEnabled: payload.reduceMotionEnabled,
            themeMode: payload.themeMode,
          },
        },
      });
  } catch {
    // Ignore sync failures; local state remains updated and the cache is best-effort.
  }
}

export function getAppPreferencesState() {
  return state;
}

export function subscribeAppPreferencesState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppPreferencesState() {
  return useSyncExternalStore(subscribeAppPreferencesState, getAppPreferencesState, getAppPreferencesState);
}

export async function bootstrapAppPreferencesState(userId: string | null) {
  const token = ++bootstrapToken;

  if (!userId) {
    setState({
      ...initialState,
      isLoading: false,
      isHydrated: true,
      userId: null,
    });
    return;
  }

  if (state.isHydrated && state.userId === userId && !state.isLoading) {
    return;
  }

  setState({
    isLoading: true,
    error: null,
    userId,
  });

  try {
    let resolved = defaultMobileAppPreferences;

    try {
      const settings = await getMobileUserSettings();
      if (token !== bootstrapToken) return;
      resolved = readMobileAppPreferences(settings);
    } catch {
      try {
        const rawValue = await SecureStore.getItemAsync(getStorageKey(userId));
        if (token !== bootstrapToken) return;

        if (rawValue) {
          const parsed = JSON.parse(rawValue) as Partial<AppPreferencesState> | null;
          resolved = {
            hapticsEnabled:
              typeof parsed?.hapticsEnabled === 'boolean'
                ? parsed.hapticsEnabled
                : defaultMobileAppPreferences.hapticsEnabled,
            reduceMotionEnabled:
              typeof parsed?.reduceMotionEnabled === 'boolean'
                ? parsed.reduceMotionEnabled
                : defaultMobileAppPreferences.reduceMotionEnabled,
            themeMode:
              parsed?.themeMode === 'light' || parsed?.themeMode === 'dark'
                ? parsed.themeMode
                : defaultMobileAppPreferences.themeMode,
          };
        }
      } catch {
        resolved = defaultMobileAppPreferences;
      }
    }

    setState({
      isLoading: false,
      isHydrated: true,
      userId,
      error: null,
      ...resolved,
    });
  } catch {
    if (token !== bootstrapToken) return;

    setState({
      isLoading: false,
      isHydrated: true,
      userId,
      error: null,
      ...defaultMobileAppPreferences,
    });
  }
}

export function setHapticsEnabled(enabled: boolean) {
  const next = { ...state, hapticsEnabled: enabled };
  setState(next);
  void persistPreferences(state.userId, next);
}

export function setReduceMotionEnabled(enabled: boolean) {
  const next = { ...state, reduceMotionEnabled: enabled };
  setState(next);
  void persistPreferences(state.userId, next);
}

export function setThemeMode(themeMode: 'system' | 'light' | 'dark') {
  const next = { ...state, themeMode };
  setState(next);
  void persistPreferences(state.userId, next);
}

export function resetAppPreferencesState() {
  bootstrapToken += 1;
  state = initialState;
  emit();
}
