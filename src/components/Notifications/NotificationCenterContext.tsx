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
  loadNotifications: (options?: { force?: boolean }) => Promise<void>;
  applyAction: (item: NotificationCenterItem, action: NotificationAction) => Promise<void>;
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

  const loadNotifications = useCallback(async (options?: { force?: boolean }) => {
    if (!user || !activeWorkspaceId) {
      setActive([]);
      setEarlier([]);
      setActiveCount(0);
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
    setLoading(true);
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
      window.dispatchEvent(new CustomEvent('ledger:notifications-summary', { detail: { activeCount: nextActiveCount } }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load notifications');
      if (isTooManyRequests(nextError)) notificationRetryAfterRef.current = Date.now() + retryAfterMs;
      setActive([]);
      setEarlier([]);
      setActiveCount(0);
    } finally {
      setLoading(false);
      notificationLoadInFlightRef.current = false;
    }
  }, [activeWorkspaceId, api, isTooManyRequests, notificationLoadCooldownMs, retryAfterMs, user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handleNotificationsUpdated = () => void loadNotifications();
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
        const nextCount = Math.max(0, activeCount - 1);
        setActiveCount(nextCount);
        window.dispatchEvent(new CustomEvent('ledger:notifications-summary', { detail: { activeCount: nextCount } }));
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
      await loadNotifications({ force: true });
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
      await loadNotifications({ force: true });
    }
  }, [activeCount, api, defaultSnoozeMinutes, loadNotifications, openTarget, toast]);

  const value = useMemo(
    () => ({ active, earlier, loading, error, activeCount, loadNotifications, applyAction }),
    [active, earlier, loading, error, activeCount, loadNotifications, applyAction]
  );

  return <NotificationCenterContext.Provider value={value}>{children}</NotificationCenterContext.Provider>;
};

export const useNotificationCenter = () => {
  const context = useContext(NotificationCenterContext);
  if (!context) throw new Error('useNotificationCenter must be used within NotificationCenterProvider');
  return context;
};
