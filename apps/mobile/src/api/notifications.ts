import { mobileRequest } from './client';

import type { MobileNotificationCenterResponse } from '@/types/ledger';

export async function getMobileNotifications(workspaceId?: string) {
  const params = new URLSearchParams();
  if (workspaceId && workspaceId !== 'all') {
    params.set('workspace_id', workspaceId);
  }

  const query = params.toString();
  return mobileRequest<MobileNotificationCenterResponse>(
    query ? `/api/notifications?${query}` : '/api/notifications',
  );
}

export async function performMobileNotificationAction(
  notificationId: string,
  action: 'open' | 'read' | 'unread' | 'dismiss' | 'complete' | 'snooze',
  options: { snoozeUntil?: string | null } = {},
) {
  const body =
    action === 'snooze' && options.snoozeUntil
      ? { action, snooze_until: options.snoozeUntil }
      : { action };

  return mobileRequest<{ ok: boolean; notification?: unknown; source?: unknown }>(
    `/api/notifications/${notificationId}/action`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export async function markAllMobileNotificationsRead(workspaceId?: string) {
  return mobileRequest<{ ok: boolean; count: number }>('/api/notifications/read-all', {
    method: 'POST',
    headers: workspaceId && workspaceId !== 'all' ? { 'x-workspace-id': workspaceId } : undefined,
  });
}
