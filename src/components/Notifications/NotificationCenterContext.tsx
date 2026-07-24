import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useToast } from '../Common/ToastProvider';

export type NotificationAction = 'open' | 'dismiss' | 'complete' | 'snooze';
export type NotificationFilter = 'active' | 'unread' | 'dismissed';

export type NotificationCenterItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox' | 'workspace_invite';
  sourceId: string;
  notificationType: string;
  title: string | null;
  body: string | null;
  context: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  moduleKind: 'calendar' | 'dashboard' | 'projects' | 'inbox' | null;
  focusPayload: Record<string, unknown> | null;
  actions: NotificationAction[];
  scheduledFor: string;
  status: 'active' | 'earlier';
  unread?: boolean;
  readAt?: string | null;
};

type NotificationCenterContextValue = {
  active: NotificationCenterItem[];
  earlier: NotificationCenterItem[];
  loading: boolean;
  error: string | null;
  activeCount: number;
  unreadCount: number;
  loadNotifications: (options?: { force?: boolean; background?: boolean }) => Promise<void>;
  applyAction: (item: NotificationCenterItem, action: NotificationAction) => Promise<void>;
  markAsRead: (item: NotificationCenterItem) => Promise<void>;
  markAllAsRead: () => Promise<void>;
};

const NotificationCenterContext = createContext<NotificationCenterContextValue | null>(null);

export const NotificationCenterProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const toast = useToast();
  const api = useApi();
  const [active, setActive] = useState<NotificationCenterItem[]>([]);
  const [earlier, setEarlier] = useState<NotificationCenterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationLoadInFlightRef = useRef(false);
  const notificationLoadAtRef = useRef(0);
  const notificationRetryAfterRef = useRef(0);
  const notificationLoadCooldownMs = 15_000;
  const retryAfterMs = 30_000;
  const defaultSnoozeMinutes = 10;

  const isTooManyRequests = useCallback((nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : String(nextError ?? '');
    const status = typeof nextError === 'object' && nextError !== null ? (nextError as { status?: number }).status : null;
    return status === 429 || /too many requests|429/i.test(message);
  }, []);

  const loadNotifications = useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    if (!user || !activeWorkspaceId) {
      setActive([]);
      setEarlier([]);
      setActiveCount(0);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    const now = Date.now();
    if (!options?.force) {
      if (notificationLoadInFlightRef.current) return;
      if (now < notificationRetryAfterRef.current) return;
      if (now - notificationLoadAtRef.current < notificationLoadCooldownMs) return;
    }

    notificationLoadInFlightRef.current = true;
    notificationLoadAtRef.current = now;
    if (!options?.background) setLoading(true);
    setError(null);

    try {
      const payload = (await api.getNotificationCenter()) as {
        active?: NotificationCenterItem[];
        earlier?: NotificationCenterItem[];
        counts?: { active?: number };
      };
      const nextActive = Array.isArray(payload.active) ? payload.active : [];
      const nextEarlier = Array.isArray(payload.earlier) ? payload.earlier : [];
      const nextActiveCount = Number(payload.counts?.active ?? 0);
      setActive(nextActive);
      setEarlier(nextEarlier);
      setActiveCount(nextActiveCount);
      const nextUnreadCount = Number((payload.counts as { unread?: number } | undefined)?.unread ?? nextActive.filter((item) => item.unread).length);
      setUnreadCount(nextUnreadCount);
      window.dispatchEvent(new CustomEvent('ledger:notifications-summary', { detail: { activeCount: nextUnreadCount } }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load notifications');
      if (isTooManyRequests(nextError)) notificationRetryAfterRef.current = Date.now() + retryAfterMs;
      setActive([]);
      setEarlier([]);
      setActiveCount(0);
      setUnreadCount(0);
    } finally {
      if (!options?.background) setLoading(false);
      notificationLoadInFlightRef.current = false;
    }
  }, [activeWorkspaceId, api, isTooManyRequests, notificationLoadCooldownMs, retryAfterMs, user]);

  const markAllAsRead = useCallback(async () => {
    if (unreadCount === 0) return;
    try {
      await api.markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setActive((previous) => previous.map((item) => ({ ...item, unread: false, readAt })));
      setEarlier((previous) => previous.map((item) => ({ ...item, unread: false, readAt })));
      setUnreadCount(0);
      window.dispatchEvent(new CustomEvent('ledger:notifications-summary', { detail: { activeCount: 0 } }));
      window.dispatchEvent(new CustomEvent('ledger:notifications-updated'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not mark notifications as read');
      toast.show('Could not mark notifications as read.', { variant: 'error' });
    }
  }, [api, toast, unreadCount]);

  const markAsRead = useCallback(async (item: NotificationCenterItem) => {
    if (item.unread !== true) return;
    try {
      await api.updateNotificationAction(item.id, 'open');
      const readAt = new Date().toISOString();
      setActive((previous) =>
        previous.map((notification) =>
          notification.id === item.id ? { ...notification, unread: false, readAt } : notification
        )
      );
      setEarlier((previous) =>
        previous.map((notification) =>
          notification.id === item.id ? { ...notification, unread: false, readAt } : notification
        )
      );
      setUnreadCount((previous) => Math.max(0, previous - 1));
      window.dispatchEvent(new CustomEvent('ledger:notifications-summary', { detail: { activeCount: Math.max(0, unreadCount - 1) } }));
      window.dispatchEvent(new CustomEvent('ledger:notifications-updated'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not mark notification as read');
      toast.show('Could not mark notification as read.', { variant: 'error' });
    }
  }, [api, toast, unreadCount]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handleNotificationsUpdated = () => void loadNotifications({ background: true });
    window.addEventListener('ledger:notifications-updated', handleNotificationsUpdated);
    return () => window.removeEventListener('ledger:notifications-updated', handleNotificationsUpdated);
  }, [loadNotifications]);

  const openTarget = useCallback(async (item: NotificationCenterItem) => {
    const focus = item.focusPayload ?? undefined;
    const kind = item.moduleKind ?? 'dashboard';
    await window.desktopWindow?.openModule(kind, focus as any);
  }, []);

  const applyAction = useCallback(async (item: NotificationCenterItem, action: NotificationAction) => {
    try {
      if (action !== 'open') {
        setActive((previous) => previous.filter((notification) => notification.id !== item.id));
        setEarlier((previous) => previous.filter((notification) => notification.id !== item.id));
        const nextActiveCount = Math.max(0, activeCount - 1);
        const nextUnreadCount = Math.max(0, unreadCount - (item.unread ? 1 : 0));
        setActiveCount(nextActiveCount);
        setUnreadCount(nextUnreadCount);
        window.dispatchEvent(new CustomEvent('ledger:notifications-summary', { detail: { activeCount: nextUnreadCount } }));
      }

      if (action === 'open') {
        await api.updateNotificationAction(item.id, 'open');
        await openTarget(item);
      } else if (action === 'complete') {
        await api.updateNotificationAction(item.id, 'complete');
      } else if (action === 'snooze') {
        await api.updateNotificationAction(item.id, 'snooze', {
          snooze_until: new Date(Date.now() + defaultSnoozeMinutes * 60_000).toISOString(),
        });
      } else {
        await api.updateNotificationAction(item.id, 'dismiss');
      }

      window.dispatchEvent(new CustomEvent('ledger:notifications-updated'));
      await loadNotifications({ force: true, background: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not update notification');
      toast.show(
        action === 'open'
          ? 'Could not open notification.'
          : action === 'complete'
          ? 'Could not complete notification.'
          : action === 'snooze'
          ? 'Could not snooze notification.'
          : 'Could not dismiss notification.',
        { variant: 'error' }
      );
      await loadNotifications({ force: true, background: true });
    }
  }, [activeCount, api, defaultSnoozeMinutes, loadNotifications, openTarget, toast, unreadCount]);

  const value = useMemo(
    () => ({ active, earlier, loading, error, activeCount, unreadCount, loadNotifications, applyAction, markAsRead, markAllAsRead }),
    [active, earlier, loading, error, activeCount, unreadCount, loadNotifications, applyAction, markAsRead, markAllAsRead]
  );

  return <NotificationCenterContext.Provider value={value}>{children}</NotificationCenterContext.Provider>;
};

export const useNotificationCenter = () => {
  const context = useContext(NotificationCenterContext);
  if (!context) throw new Error('useNotificationCenter must be used within NotificationCenterProvider');
  return context;
};
