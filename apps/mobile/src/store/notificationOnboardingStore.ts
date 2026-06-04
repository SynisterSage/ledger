import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { getMobileUserSettings, updateMobileUserSettings } from '@/api/userSettings';

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

let state = initialState;
const listeners = new Set<() => void>();
let bootstrapToken = 0;

function emit() {
  for (const listener of listeners) listener();
}

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
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
    const rawValue = await SecureStore.getItemAsync(getStorageKey(userId));
    if (token !== bootstrapToken) {
      return;
    }

    let parsed: { choice?: NotificationPermissionChoice; isComplete?: boolean } | null = null;
    if (rawValue) {
      try {
        parsed = JSON.parse(rawValue) as { choice?: NotificationPermissionChoice; isComplete?: boolean };
      } catch {
        parsed = null;
      }
    }

    const choice = parsed?.choice ?? null;
    let completed = Boolean(parsed?.isComplete ?? choice);

    if (!completed) {
      try {
        const settings = await getMobileUserSettings();
        const backendCompleted = Boolean(
          (settings?.preferences as { mobileNotificationOnboardingCompleted?: unknown } | null)
            ?.mobileNotificationOnboardingCompleted,
        );
        completed = backendCompleted;
      } catch {
        // Ignore backend fallback errors and continue with local state.
      }
    }

    if (!completed) {
      try {
        const permission = await Notifications.getPermissionsAsync();
        if (permission.status !== 'undetermined') {
          completed = true;
          try {
            await updateMobileUserSettings({
              preferences: {
                mobileNotificationOnboardingCompleted: true,
              },
            });
          } catch {
            // Ignore persistence failures; local state is still enough to bypass onboarding.
          }
        }
      } catch {
        // Ignore permission lookup failures and continue with local state.
      }
    }

    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: completed,
      choice,
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
    await SecureStore.setItemAsync(getStorageKey(userId), JSON.stringify(payload));
  } catch {
    // Non-fatal. The user can still continue and the app will keep the in-memory choice.
  }

  try {
    await updateMobileUserSettings({
      preferences: {
        mobileNotificationOnboardingCompleted: true,
        mobileNotificationOnboardingChoice: choice,
      },
    });
  } catch {
    // Non-fatal. SecureStore remains the local fallback.
  }
}

export function resetNotificationOnboardingState() {
  bootstrapToken += 1;
  state = initialState;
  emit();
}
