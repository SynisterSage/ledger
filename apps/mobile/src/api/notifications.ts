import { mobileRequest } from './client';

import type { MobileNotificationCenterResponse } from '@/types/ledger';

export async function getMobileNotifications() {
  return mobileRequest<MobileNotificationCenterResponse>('/api/notifications');
}
