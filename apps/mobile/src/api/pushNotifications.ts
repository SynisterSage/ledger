import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { mobileRequest } from './client';

type RegisteredPushTokenResponse = {
  id: string | null;
  userId: string | null;
  platform: string;
  pushToken: string | null;
  enabled: boolean;
  lastRegisteredAt: string | null;
  revokedAt: string | null;
};

const getProjectId = () =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;

export async function registerCurrentMobilePushToken() {
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') {
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('Missing EAS project id.');
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const pushToken = String(token.data ?? '').trim();
  if (!pushToken) {
    throw new Error('Could not read Expo push token.');
  }

  return mobileRequest<RegisteredPushTokenResponse>('/api/mobile/push-tokens', {
    method: 'POST',
    body: JSON.stringify({
      pushToken,
      platform: Platform.OS,
    }),
  });
}

export async function revokeCurrentMobilePushToken(pushToken?: string | null) {
  return mobileRequest<{ ok: boolean; revoked: number }>(
    '/api/mobile/push-tokens',
    {
      method: 'DELETE',
      body: pushToken
        ? JSON.stringify({
            pushToken: String(pushToken).trim(),
          })
        : JSON.stringify({}),
    },
  );
}
