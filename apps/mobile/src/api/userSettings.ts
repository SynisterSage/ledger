import { mobileRequest } from './client';

import type { CaptureType } from '@/types/ledger';

export type MobileUserSettings = {
  full_name: string | null;
  email: string | null;
  active_workspace_id: string | null;
  onboarding_completed: boolean;
  preferences: Record<string, unknown>;
  updated_at: string | null;
};

export type MobileNotificationPreferences = {
  pushNotifications: boolean;
  remindersEnabled: boolean;
  eventsEnabled: boolean;
  projectActionsEnabled: boolean;
  overdueItemsEnabled: boolean;
};

export type MobileCapturePreferences = {
  sharedItemsDestination: 'inbox' | 'notes';
  defaultCaptureType: CaptureType;
};

export type MobileSiriPreferences = {
  defaultWorkspaceId: string | null;
  askEveryTime: boolean;
};

export type MobileAppPreferences = {
  hapticsEnabled: boolean;
  reduceMotionEnabled: boolean;
};

export const defaultMobileNotificationPreferences: MobileNotificationPreferences = {
  pushNotifications: false,
  remindersEnabled: true,
  eventsEnabled: true,
  projectActionsEnabled: true,
  overdueItemsEnabled: true,
};

export const defaultMobileCapturePreferences: MobileCapturePreferences = {
  sharedItemsDestination: 'inbox',
  defaultCaptureType: 'reminder',
};

export const defaultMobileSiriPreferences: MobileSiriPreferences = {
  defaultWorkspaceId: null,
  askEveryTime: false,
};

export const defaultMobileAppPreferences: MobileAppPreferences = {
  hapticsEnabled: true,
  reduceMotionEnabled: false,
};

type MobileUserSettingsPatch = {
  full_name?: string | null;
  active_workspace_id?: string | null;
  preferences?: Record<string, unknown>;
};

export async function getMobileUserSettings() {
  return mobileRequest<MobileUserSettings>('/api/user/settings');
}

export async function updateMobileUserSettings(payload: MobileUserSettingsPatch) {
  return mobileRequest<MobileUserSettings>('/api/user/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getMobileOnboardingStatus() {
  return mobileRequest<{ onboarding_completed: boolean }>('/api/user/onboarding');
}

export async function completeMobileOnboarding(choice?: 'enabled' | 'denied' | 'skipped') {
  return mobileRequest<{ onboarding_completed: boolean }>('/api/user/onboarding', {
    method: 'PATCH',
    body: JSON.stringify(choice ? { choice } : {}),
  });
}

export function readMobileNotificationPreferences(settings: MobileUserSettings | null | undefined) {
  const preferences = settings?.preferences;
  const mobilePreferences =
    preferences && typeof preferences === 'object' && 'mobileNotificationPreferences' in preferences
      ? (preferences as { mobileNotificationPreferences?: Record<string, unknown> }).mobileNotificationPreferences
      : null;

  return {
    pushNotifications:
      typeof mobilePreferences?.pushNotifications === 'boolean'
        ? mobilePreferences.pushNotifications
        : defaultMobileNotificationPreferences.pushNotifications,
    remindersEnabled:
      typeof mobilePreferences?.remindersEnabled === 'boolean'
        ? mobilePreferences.remindersEnabled
        : defaultMobileNotificationPreferences.remindersEnabled,
    eventsEnabled:
      typeof mobilePreferences?.eventsEnabled === 'boolean'
        ? mobilePreferences.eventsEnabled
        : defaultMobileNotificationPreferences.eventsEnabled,
    projectActionsEnabled:
      typeof mobilePreferences?.projectActionsEnabled === 'boolean'
        ? mobilePreferences.projectActionsEnabled
        : defaultMobileNotificationPreferences.projectActionsEnabled,
    overdueItemsEnabled:
      typeof mobilePreferences?.overdueItemsEnabled === 'boolean'
        ? mobilePreferences.overdueItemsEnabled
        : defaultMobileNotificationPreferences.overdueItemsEnabled,
  } satisfies MobileNotificationPreferences;
}

export function readMobileCapturePreferences(settings: MobileUserSettings | null | undefined) {
  const preferences = settings?.preferences;
  const mobilePreferences =
    preferences && typeof preferences === 'object' && 'mobileCapturePreferences' in preferences
      ? (preferences as { mobileCapturePreferences?: Record<string, unknown> }).mobileCapturePreferences
      : null;

  const sharedItemsDestination =
    mobilePreferences?.sharedItemsDestination === 'notes' ? 'notes' : defaultMobileCapturePreferences.sharedItemsDestination;

  const defaultCaptureType =
    typeof mobilePreferences?.defaultCaptureType === 'string' &&
    ['reminder', 'task', 'event', 'note', 'project-action'].includes(mobilePreferences.defaultCaptureType)
      ? (mobilePreferences.defaultCaptureType as CaptureType)
      : defaultMobileCapturePreferences.defaultCaptureType;

  return {
    sharedItemsDestination,
    defaultCaptureType,
  } satisfies MobileCapturePreferences;
}

export function readMobileSiriPreferences(settings: MobileUserSettings | null | undefined) {
  const preferences = settings?.preferences;
  const mobilePreferences =
    preferences && typeof preferences === 'object' && 'mobileSiriPreferences' in preferences
      ? (preferences as { mobileSiriPreferences?: Record<string, unknown> }).mobileSiriPreferences
      : null;

  return {
    defaultWorkspaceId:
      typeof mobilePreferences?.defaultWorkspaceId === 'string' && mobilePreferences.defaultWorkspaceId.trim()
        ? mobilePreferences.defaultWorkspaceId.trim()
        : defaultMobileSiriPreferences.defaultWorkspaceId,
    askEveryTime:
      typeof mobilePreferences?.askEveryTime === 'boolean'
        ? mobilePreferences.askEveryTime
        : defaultMobileSiriPreferences.askEveryTime,
  } satisfies MobileSiriPreferences;
}

export function readMobileAppPreferences(settings: MobileUserSettings | null | undefined) {
  const preferences = settings?.preferences;
  const mobilePreferences =
    preferences && typeof preferences === 'object' && 'mobileAppPreferences' in preferences
      ? (preferences as { mobileAppPreferences?: Record<string, unknown> }).mobileAppPreferences
      : null;

  return {
    hapticsEnabled:
      typeof mobilePreferences?.hapticsEnabled === 'boolean'
        ? mobilePreferences.hapticsEnabled
        : defaultMobileAppPreferences.hapticsEnabled,
    reduceMotionEnabled:
      typeof mobilePreferences?.reduceMotionEnabled === 'boolean'
        ? mobilePreferences.reduceMotionEnabled
        : defaultMobileAppPreferences.reduceMotionEnabled,
  } satisfies MobileAppPreferences;
}
