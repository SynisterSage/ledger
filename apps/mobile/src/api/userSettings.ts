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
