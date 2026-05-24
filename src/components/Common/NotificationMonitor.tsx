import { useEffect, useRef, useState } from 'react';
import { useAuthContext } from '../../context/AuthContext';
import { useApi } from '../../hooks/useApi';
import { useToast } from './ToastProvider';

type NotificationAction = 'open' | 'dismiss' | 'complete' | 'snooze';

type NotificationItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox';
  sourceId: string;
  notificationType: string;
  title: string | null;
  body: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  moduleKind: 'calendar' | 'dashboard' | 'projects' | 'inbox' | null;
  focusPayload: Record<string, unknown> | null;
  actions: NotificationAction[];
};

const buildModuleLaunch = (item: NotificationItem) => {
  const focusPayload = item.focusPayload ?? undefined;
  switch (item.moduleKind ?? item.sourceType) {
    case 'calendar':
    case 'reminder':
    case 'event':
      return { kind: 'calendar' as const, focus: focusPayload };
    case 'dashboard':
    case 'task':
      return { kind: 'dashboard' as const, focus: focusPayload };
    case 'projects':
    case 'project':
      return { kind: 'projects' as const, focus: focusPayload };
    case 'inbox':
      return { kind: 'inbox' as const, focus: focusPayload };
    default:
      return { kind: 'dashboard' as const, focus: focusPayload };
  }
};

export const NotificationMonitor: React.FC = () => {
  const { session, user } = useAuthContext();
  const api = useApi();
  const toast = useToast();
  const pollingRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const permissionRequestRef = useRef(false);
  const [prefs, setPrefs] = useState<{
    desktopEnabled: boolean;
    inAppEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;

    const syncPrefs = async () => {
      if (!session?.access_token || !user) {
        if (active) setPrefs(null);
        return;
      }

      try {
        const nextPrefs = (await api.getNotificationPreferences()) as {
          desktopEnabled?: boolean;
          inAppEnabled?: boolean;
        };
        if (!active) return;
        setPrefs({
          desktopEnabled: Boolean(nextPrefs.desktopEnabled),
          inAppEnabled: Boolean(nextPrefs.inAppEnabled),
        });
      } catch {
        if (active) setPrefs({ desktopEnabled: false, inAppEnabled: false });
      }
    };

    void syncPrefs();
    const timer = window.setInterval(syncPrefs, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, session?.access_token, user]);

  useEffect(() => {
    if (!prefs) return;
    if (!prefs.desktopEnabled || typeof window.Notification === 'undefined') return;
    if (
      window.Notification.permission === 'default' &&
      !permissionRequestRef.current
    ) {
      permissionRequestRef.current = true;
      void window.Notification.requestPermission().catch(() => null);
    }
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;

    const openNotificationTarget = async (item: NotificationItem) => {
      const { kind, focus } = buildModuleLaunch(item);
      await window.desktopWindow?.openModule(kind, focus as any);
    };

    const deliverDesktopNotification = (item: NotificationItem) => {
      if (
        !prefs?.desktopEnabled ||
        typeof window.Notification === 'undefined' ||
        window.Notification.permission !== 'granted'
      ) {
        return;
      }

      try {
        const notification = new window.Notification(item.title ?? 'Ledger', {
          body: item.body ?? '',
          silent: true,
        });
        notification.onclick = () => {
          notification.close();
          void openNotificationTarget(item);
        };
      } catch {
        // Desktop notifications are best-effort.
      }
    };

    const runPoll = async () => {
      if (cancelled || inFlightRef.current || !session?.access_token || !user) return;
      if (!prefs?.inAppEnabled && !prefs?.desktopEnabled) return;

      inFlightRef.current = true;
      try {
        const notifications = (await api.checkNotifications()) as NotificationItem[];
        if (!Array.isArray(notifications) || !notifications.length) return;

        notifications.forEach((item) => {
          deliverDesktopNotification(item);

          if (!prefs?.inAppEnabled) return;

          const snoozeMinutes = 10;
          toast.show(item.title ?? 'Ledger notification', {
            detail: item.body ?? undefined,
            variant: 'info',
            duration: item.actions?.length ? 8000 : 2500,
            actions: (item.actions ?? []).map((action) => {
              if (action === 'open') {
                return {
                  label: 'Open',
                  onClick: async () => {
                    await api.updateNotificationAction(item.id, 'open');
                    await openNotificationTarget(item);
                  },
                };
              }

              if (action === 'complete') {
                return {
                  label: 'Complete',
                  onClick: async () => {
                    await api.updateNotificationAction(item.id, 'complete');
                  },
                };
              }

              if (action === 'snooze') {
                return {
                  label: 'Snooze',
                  onClick: async () => {
                    const until = new Date(Date.now() + snoozeMinutes * 60_000).toISOString();
                    await api.updateNotificationAction(item.id, 'snooze', {
                      snooze_until: until,
                    });
                  },
                };
              }

              return {
                label: 'Dismiss',
                variant: 'destructive' as const,
                onClick: async () => {
                  await api.updateNotificationAction(item.id, 'dismiss');
                },
              };
            }),
          });
        });
      } finally {
        inFlightRef.current = false;
      }
    };

    const schedule = () => {
      void runPoll();
      pollingRef.current = window.setInterval(() => {
        void runPoll();
      }, 45_000);
    };

    schedule();
    return () => {
      cancelled = true;
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [api, prefs, session?.access_token, toast, user]);

  return null;
};
