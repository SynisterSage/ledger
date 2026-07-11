import { useEffect, useRef } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSidebar } from '../../context/SidebarContext';
import { useToast } from './ToastProvider';

type NotificationAction = 'open' | 'dismiss' | 'complete' | 'snooze';

type NotificationItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox' | 'workspace_invite';
  sourceId: string;
  notificationType: string;
  title: string | null;
  body: string | null;
  context: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  workspaceId?: string | null;
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

const getToastFallbackTitle = (item: NotificationItem) => {
  const workspacePart = item.workspaceName ? `${item.workspaceName}` : '';
  switch (item.sourceType) {
    case 'reminder':
      return workspacePart ? `Reminder due - ${workspacePart}` : 'Reminder due';
    case 'event':
      return workspacePart ? `Event starting - ${workspacePart}` : 'Event starting';
    case 'task':
      return workspacePart ? `Task due - ${workspacePart}` : 'Task due';
    case 'project':
      return workspacePart ? `Project deadline - ${workspacePart}` : 'Project deadline';
    case 'inbox':
      return workspacePart ? `Intake item - ${workspacePart}` : 'Intake item';
    case 'workspace_invite':
      return workspacePart ? `Workspace invite - ${workspacePart}` : 'Workspace invite';
    default:
      return 'Ledger notification';
  }
};

const isGenericNotificationTitle = (title: string | null | undefined, sourceType: NotificationItem['sourceType']) => {
  const normalized = String(title ?? '').trim().toLowerCase();
  if (!normalized) return true;
  if (sourceType === 'reminder') return /^reminder(?:\s*[:\-]\s*due)?$/.test(normalized);
  if (sourceType === 'event') return /^event(?:\s*(?:soon|starting))?$/.test(normalized);
  if (sourceType === 'task') return /^task(?:\s*due)?$/.test(normalized);
  if (sourceType === 'project') return /^project(?:\s*deadline)?$/.test(normalized);
  if (sourceType === 'inbox') return /^inbox(?:\s*capture)?$|^intake item$/.test(normalized);
  if (sourceType === 'workspace_invite') return /^workspace invite$|^invite accepted$/.test(normalized);
  return false;
};

const joinToastDetail = (parts: Array<string | null | undefined>) =>
  parts.map((part) => part?.trim()).filter(Boolean).join(' · ') || undefined;

export const NotificationMonitor: React.FC = () => {
  const api = useApi();
  const toast = useToast();
  const { state } = useSidebar();
  const seenToastIdsRef = useRef<Set<string>>(new Set());
  const activeToastIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (state === 'expanded') return;

    activeToastIdsRef.current.forEach((toastId) => {
      toast.dismiss(toastId);
    });
    activeToastIdsRef.current.clear();
  }, [state, toast]);

  useEffect(() => {
    const openNotificationTarget = async (item: NotificationItem) => {
      const { kind, focus } = buildModuleLaunch(item);
      await window.desktopWindow?.openModule(kind, focus as any);
    };

    const handleBatch = (_event: unknown, notifications?: NotificationItem[]) => {
      if (!Array.isArray(notifications) || !notifications.length) return;
      if (state !== 'expanded') return;

      const unseenItems = notifications.filter((item) => {
        if (!item?.id) return false;
        if (seenToastIdsRef.current.has(item.id)) return false;
        seenToastIdsRef.current.add(item.id);
        return true;
      });

      unseenItems.forEach((item) => {
        const snoozeMinutes = 10;
        const title =
          item.title && !isGenericNotificationTitle(item.title, item.sourceType)
            ? item.title
            : getToastFallbackTitle(item);
        const detail = item.body?.trim() || joinToastDetail([item.context, item.workspaceName]);
        const toastId = toast.show(title, {
          detail,
          variant: 'info',
          icon: 'alert',
          duration: item.actions?.length ? 8000 : 2500,
          actions: (item.actions ?? []).map((action) => {
            if (action === 'open') {
              return {
                label: 'Open',
                onClick: async () => {
                  await api.updateNotificationAction(item.id, 'open');
                  try {
                    if (item.workspaceId) {
                      await api.setActiveWorkspace(item.workspaceId);
                    }
                  } catch (e) {
                    // ignore workspace switch failures and proceed to open
                  }
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
        activeToastIdsRef.current.add(toastId);
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
  }, [api, state, toast]);

  return null;
};
