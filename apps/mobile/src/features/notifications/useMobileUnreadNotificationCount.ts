import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getMobileNotifications } from '@/api/notifications';

export function useMobileUnreadNotificationCount(workspaceId: string) {
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await getMobileNotifications(workspaceId);
      setUnreadCount(response.counts.unread ?? 0);
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
