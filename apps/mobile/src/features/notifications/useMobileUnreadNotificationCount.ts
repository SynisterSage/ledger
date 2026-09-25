import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getCachedMobileNotifications, mobileNotificationsCountCacheKey } from '@/api/notifications';
import { getMobileResource } from '@/lib/mobileResourceCache';

export function useMobileUnreadNotificationCount(workspaceId: string) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setUnreadCount(0);
  }, [workspaceId]);

  const load = useCallback(async () => {
    try {
      const count = await getMobileResource(
        mobileNotificationsCountCacheKey(workspaceId),
        async () => {
          const response = await getCachedMobileNotifications(workspaceId);
          return response.counts.unread ?? 0;
        },
      );
      setUnreadCount(count);
    } catch {
      // Keep the current count if notification hydration is unavailable.
    }
  }, [workspaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return unreadCount;
}
