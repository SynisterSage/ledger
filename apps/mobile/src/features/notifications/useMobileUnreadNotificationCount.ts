import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getMobileNotifications } from '@/api/notifications';
import { getMobileResource } from '@/lib/mobileResourceCache';

const notificationCountCacheKey = (workspaceId: string) => `mobile:notifications-count:${workspaceId}`;

export function useMobileUnreadNotificationCount(workspaceId: string) {
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const count = await getMobileResource(
        notificationCountCacheKey(workspaceId),
        async () => {
          const response = await getMobileNotifications(workspaceId);
          return response.counts.unread ?? 0;
        },
        { ttlMs: 10_000 },
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
