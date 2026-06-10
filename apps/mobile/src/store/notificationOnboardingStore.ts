import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  getMobileUserSettings,
  updateMobileUserSettings,
} from '@/api/userSettings';

export type NotificationPermissionChoice = 'enabled' | 'denied' | 'skipped' | null;

type NotificationOnboardingState = {
  isLoading: boolean;
  isHydrated: boolean;
  isComplete: boolean;
  choice: NotificationPermissionChoice;
  userId: string | null;
  error: string | null;
};

const initialState: NotificationOnboardingState = {
  isLoading: false,
  isHydrated: false,
  isComplete: false,
  choice: null,
  userId: null,
  error: null,
};

const STORAGE_PREFIX = 'ledger-mobile-notification-onboarding';
const GLOBAL_STORAGE_KEY = `${STORAGE_PREFIX}:completed`;
let state = initialState;
const listeners = new Set<() => void>();
let bootstrapToken = 0;

function emit() {
  for (const listener of listeners) listener();
}

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

async function persistLocalCompletion(
  userId: string,
  payload: { choice?: NotificationPermissionChoice; isComplete?: boolean },
) {
  const nextValue = JSON.stringify({
    choice: payload.choice ?? null,
    isComplete: Boolean(payload.isComplete ?? true),
    updatedAt: new Date().toISOString(),
  });

  try {
    await SecureStore.setItemAsync(getStorageKey(userId), nextValue);
    await SecureStore.setItemAsync(GLOBAL_STORAGE_KEY, nextValue);
  } catch {
    // Non-fatal. The backend remains the source of truth.
  }
}

function setState(next: Partial<NotificationOnboardingState>) {
  state = { ...state, ...next };
  emit();
}

export function getNotificationOnboardingState() {
  return state;
}

export function subscribeNotificationOnboardingState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationOnboardingState() {
  return useSyncExternalStore(
    subscribeNotificationOnboardingState,
    getNotificationOnboardingState,
    getNotificationOnboardingState,
  );
}

export async function bootstrapNotificationOnboardingState(userId: string | null) {
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
    const [globalRawValue, rawValue] = await Promise.all([
      SecureStore.getItemAsync(GLOBAL_STORAGE_KEY),
      SecureStore.getItemAsync(getStorageKey(userId)),
    ]);
    if (token !== bootstrapToken) {
      return;
    }

    let parsed: { choice?: NotificationPermissionChoice; isComplete?: boolean } | null = null;
    if (globalRawValue) {
      try {
        parsed = JSON.parse(globalRawValue) as { choice?: NotificationPermissionChoice; isComplete?: boolean };
      } catch {
        parsed = null;
      }
    }

    if (!parsed && rawValue) {
      try {
        parsed = JSON.parse(rawValue) as { choice?: NotificationPermissionChoice; isComplete?: boolean };
      } catch {
        parsed = null;
      }
    }

    const choice = parsed?.choice ?? null;
    let completed = Boolean(parsed?.isComplete ?? choice);
    let resolvedChoice = choice ?? null;

    if (!completed) {
      try {
        const settings = await getMobileUserSettings();
        if (token !== bootstrapToken) {
          return;
        }

        completed = Boolean(settings?.onboarding_completed);
        if (completed) {
          try {
            await persistLocalCompletion(userId, { choice: resolvedChoice ?? undefined, isComplete: true });
          } catch {
            // Ignore local cache failures. The server already says the step is complete.
          }
        }
      } catch {
        // Fall back to local cache only. No extra auto-completion heuristics.
      }
    }

    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: completed,
      choice: resolvedChoice ?? null,
      error: null,
      userId,
    });
  } catch {
    if (token !== bootstrapToken) {
      return;
    }

    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: false,
      choice: null,
      error: null,
      userId,
    });
  }
}

export async function setNotificationOnboardingChoice(
  userId: string | null,
  choice: Exclude<NotificationPermissionChoice, null>,
) {
  if (!userId) {
    setState({
      isHydrated: true,
      isLoading: false,
      isComplete: true,
      choice,
      error: null,
      userId: null,
    });
    return;
  }

  const payload = {
    choice,
    isComplete: true,
    updatedAt: new Date().toISOString(),
  };

  setState({
    isHydrated: true,
    isLoading: false,
    isComplete: true,
    choice,
    error: null,
    userId,
  });

  try {
    const serialized = JSON.stringify(payload);
    await SecureStore.setItemAsync(getStorageKey(userId), serialized);
    await SecureStore.setItemAsync(GLOBAL_STORAGE_KEY, serialized);
  } catch {
    // Non-fatal. The user can still continue and the app will keep the in-memory choice.
  }

  try {
    await updateMobileUserSettings({
      onboarding_completed: true,
      preferences: {
        mobileNotificationOnboardingCompleted: true,
        mobileNotificationOnboardingChoice: choice,
      },
    });
  } catch {
    // Non-fatal. The local SecureStore entry still marks onboarding complete.
  }
}

export function resetNotificationOnboardingState() {
  bootstrapToken += 1;
  state = initialState;
  emit();
}
