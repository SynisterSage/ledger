import { useSyncExternalStore } from 'react';

import {
  getMobileUserSettings,
  readMobileNotificationOnboardingState,
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

let state = initialState;
const listeners = new Set<() => void>();
let bootstrapToken = 0;

function emit() {
  for (const listener of listeners) listener();
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
      isHydrated: true,
      isLoading: false,
      userId: null,
    });
    return;
  }

  if (state.userId === userId && state.isHydrated && !state.isLoading) {
    return;
  }

  setState({
    isLoading: true,
    isHydrated: false,
    error: null,
    userId,
  });

  try {
    const settings = await getMobileUserSettings();
    if (token !== bootstrapToken) {
      return;
    }

    const onboarding = readMobileNotificationOnboardingState(settings);

    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: onboarding.isComplete,
      choice: onboarding.choice,
      error: null,
      userId,
    });
  } catch (error) {
    if (token !== bootstrapToken) {
      return;
    }

    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: false,
      choice: null,
      error: error instanceof Error ? error.message : 'Unable to load notification onboarding.',
      userId,
    });
  }
}

export async function setNotificationOnboardingChoice(
  userId: string | null,
  choice: Exclude<NotificationPermissionChoice, null>,
) {
  if (!userId) {
    throw new Error('Missing user account.');
  }

  setState({
    isLoading: true,
    error: null,
    userId,
  });

  try {
    const settings = await updateMobileUserSettings({
      onboarding_completed: true,
      preferences: {
        mobileNotificationOnboardingChoice: choice,
      },
    });

    const onboarding = readMobileNotificationOnboardingState(settings);
    if (!onboarding.isComplete) {
      throw new Error('The server did not persist notification onboarding completion.');
    }

    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: true,
      choice: onboarding.choice ?? choice,
      error: null,
      userId,
    });

    return onboarding;
  } catch (error) {
    setState({
      isLoading: false,
      isHydrated: true,
      isComplete: false,
      choice: null,
      error: error instanceof Error ? error.message : 'Unable to save notification onboarding.',
      userId,
    });
    throw error;
  }
}

export function resetNotificationOnboardingState() {
  bootstrapToken += 1;
  state = initialState;
  emit();
}
