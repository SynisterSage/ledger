import { useEffect, useRef } from 'react';
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
  const api = useApi();
  const toast = useToast();
  const seenToastIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const openNotificationTarget = async (item: NotificationItem) => {
      const { kind, focus } = buildModuleLaunch(item);
      await window.desktopWindow?.openModule(kind, focus as any);
    };

    const handleBatch = (_event: unknown, notifications?: NotificationItem[]) => {
      if (!Array.isArray(notifications) || !notifications.length) return;

      const unseenItems = notifications.filter((item) => {
        if (!item?.id) return false;
        if (seenToastIdsRef.current.has(item.id)) return false;
        seenToastIdsRef.current.add(item.id);
        return true;
      });

      unseenItems.forEach((item) => {
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
                  window.ipcRenderer?.send('notifications:refresh');
                },
              };
            }

            if (action === 'complete') {
              return {
                label: 'Complete',
                onClick: async () => {
                  await api.updateNotificationAction(item.id, 'complete');
                  window.ipcRenderer?.send('notifications:refresh');
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
                  window.ipcRenderer?.send('notifications:refresh');
                },
              };
            }

            return {
              label: 'Dismiss',
              variant: 'destructive' as const,
              onClick: async () => {
                await api.updateNotificationAction(item.id, 'dismiss');
                window.ipcRenderer?.send('notifications:refresh');
              },
            };
          }),
        });
      });
    };

    const handleSummary = (_event: unknown, payload?: { activeCount?: number }) => {
      window.dispatchEvent(
        new CustomEvent('ledger:notifications-summary', {
          detail: { activeCount: Number(payload?.activeCount ?? 0) },
        })
      );
    };

    const handleRefreshNotifications = () => {
      window.ipcRenderer?.send('notifications:refresh');
    };

    window.addEventListener('ledger:notifications-refresh', handleRefreshNotifications);
    window.ipcRenderer?.on('ledger:notifications-batch', handleBatch);
    window.ipcRenderer?.on('ledger:notifications-summary', handleSummary);
    return () => {
      window.removeEventListener('ledger:notifications-refresh', handleRefreshNotifications);
      window.ipcRenderer?.off('ledger:notifications-batch', handleBatch);
      window.ipcRenderer?.off('ledger:notifications-summary', handleSummary);
    };
  }, [api, toast]);

  return null;
};
