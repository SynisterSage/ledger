import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Settings, RotateCcw, Inbox, CalendarDays, Folder, CheckCircle2, Clock3 } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { ModuleHeaderStripAction, ModuleWindowHeader } from '../Common/ModuleWindowHeader';

type NotificationCenterItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox';
  sourceId: string;
  notificationType: string;
  title: string | null;
  body: string | null;
  context: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  moduleKind: 'calendar' | 'dashboard' | 'projects' | 'inbox' | null;
  focusPayload: Record<string, unknown> | null;
  actions: Array<'open' | 'dismiss' | 'complete' | 'snooze'>;
  scheduledFor: string;
  status: 'active' | 'earlier';
};

const iconForItem = (item: NotificationCenterItem) => {
  switch (item.sourceType) {
    case 'reminder':
      return Clock3;
    case 'event':
      return CalendarDays;
    case 'task':
      return CheckCircle2;
    case 'project':
      return Folder;
    case 'inbox':
      return Inbox;
    default:
      return Bell;
  }
};

const actionLabel = (item: NotificationCenterItem, action: NotificationCenterItem['actions'][number]) => {
  if (action === 'open') {
    if (item.sourceType === 'inbox') return 'Open inbox';
    if (item.sourceType === 'project') return 'Open project';
    if (item.sourceType === 'task') return 'Open task';
    if (item.sourceType === 'event') return 'Open event';
    return 'Open';
  }
  if (action === 'complete') return 'Complete';
  if (action === 'snooze') return 'Snooze';
  return 'Dismiss';
};

export const NotificationCenterWindow: React.FC = () => {
  const { user } = useAuthContext();
  const api = useApi();
  const [active, setActive] = useState<NotificationCenterItem[]>([]);
  const [earlier, setEarlier] = useState<NotificationCenterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const notificationLoadInFlightRef = useRef(false);
  const inboxLoadInFlightRef = useRef(false);
  const notificationLoadAtRef = useRef(0);
  const inboxLoadAtRef = useRef(0);
  const notificationRetryAfterRef = useRef(0);
  const inboxRetryAfterRef = useRef(0);

  const notificationLoadCooldownMs = 15_000;
  const inboxLoadCooldownMs = 30_000;
  const retryAfterMs = 30_000;

  const isTooManyRequests = useCallback((nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : String(nextError ?? '');
    const status = typeof nextError === 'object' && nextError !== null ? (nextError as { status?: number }).status : null;
    return status === 429 || /too many requests|429/i.test(message);
  }, []);

  const loadNotifications = useCallback(async (opts?: { force?: boolean }) => {
    if (!user) {
      setActive([]);
      setEarlier([]);
      setActiveCount(0);
      setLoading(false);
      return;
    }

    const now = Date.now();
    if (!opts?.force) {
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
      setActive(Array.isArray(payload.active) ? payload.active : []);
      setEarlier(Array.isArray(payload.earlier) ? payload.earlier : []);
      setActiveCount(Number(payload.counts?.active ?? 0));
      window.dispatchEvent(
        new CustomEvent('ledger:notifications-summary', {
          detail: { activeCount: Number(payload.counts?.active ?? 0) },
        })
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load notifications');
      if (isTooManyRequests(nextError)) {
        notificationRetryAfterRef.current = Date.now() + retryAfterMs;
      }
      setActive([]);
      setEarlier([]);
      setActiveCount(0);
    } finally {
      setLoading(false);
      notificationLoadInFlightRef.current = false;
    }
  }, [api, isTooManyRequests, notificationLoadCooldownMs, retryAfterMs, user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const loadInboxCount = useCallback(async () => {
    if (!user) {
      setInboxCount(0);
      return;
    }

    try {
      const now = Date.now();
      if (inboxLoadInFlightRef.current) return;
      if (now < inboxRetryAfterRef.current) return;
      if (now - inboxLoadAtRef.current < inboxLoadCooldownMs) return;

      inboxLoadInFlightRef.current = true;
      inboxLoadAtRef.current = now;

      const payload = (await api.getInboxCount()) as { count?: number };
      setInboxCount(Math.max(0, Number(payload?.count ?? 0)));
    } catch (nextError) {
      if (isTooManyRequests(nextError)) {
        inboxRetryAfterRef.current = Date.now() + retryAfterMs;
      }
      setInboxCount(0);
    } finally {
      inboxLoadInFlightRef.current = false;
    }
  }, [api, inboxLoadCooldownMs, isTooManyRequests, retryAfterMs, user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    void loadInboxCount();

    const handleRefreshInboxCount = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (cancelled) return;
      void loadInboxCount();
    };

    const handleInboxItemsUpdated = (_event: unknown, payload?: { delta?: number }) => {
      if (typeof payload?.delta === 'number' && Number.isFinite(payload.delta)) {
        setInboxCount((current) => Math.max(0, current + payload.delta!));
        return;
      }

      void loadInboxCount();
    };

    window.ipcRenderer?.on('inbox:items-updated', handleInboxItemsUpdated);
    window.addEventListener('focus', handleRefreshInboxCount);
    document.addEventListener('visibilitychange', handleRefreshInboxCount);

    const refreshTimer = window.setInterval(() => {
      if (!cancelled) void loadInboxCount();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.ipcRenderer?.off('inbox:items-updated', handleInboxItemsUpdated);
      window.removeEventListener('focus', handleRefreshInboxCount);
      document.removeEventListener('visibilitychange', handleRefreshInboxCount);
    };
  }, [loadInboxCount, user]);

  useEffect(() => {
    const handleNotificationsUpdated = () => {
      void loadNotifications();
    };
    window.addEventListener('ledger:notifications-updated', handleNotificationsUpdated);
    return () => window.removeEventListener('ledger:notifications-updated', handleNotificationsUpdated);
  }, [loadNotifications]);

  const openTarget = useCallback(
    async (item: NotificationCenterItem) => {
      const focus = item.focusPayload ?? undefined;
      const kind = item.moduleKind ?? 'dashboard';
      await window.desktopWindow?.openModule(kind, focus as any);
    },
    []
  );

  const applyAction = useCallback(
    async (item: NotificationCenterItem, action: NotificationCenterItem['actions'][number]) => {
      try {
        if (action === 'open') {
          await api.updateNotificationAction(item.id, 'open');
          await openTarget(item);
        } else if (action === 'complete') {
          await api.updateNotificationAction(item.id, 'complete');
        } else if (action === 'snooze') {
          await api.updateNotificationAction(item.id, 'snooze');
        } else {
          await api.updateNotificationAction(item.id, 'dismiss');
        }

        await loadNotifications();
        window.dispatchEvent(new CustomEvent('ledger:notifications-updated'));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Could not update notification');
      }
    },
    [api, loadNotifications, openTarget]
  );

  const headerSubtitle = useMemo(
    () => (activeCount === 1 ? '1 active' : `${activeCount} active`),
    [activeCount]
  );

  return (
    <div className="flex h-screen flex-col bg-white">
      <ModuleWindowHeader
        eyebrow="Notification Center"
        title="Notifications"
        subtitle={headerSubtitle}
        icon={<Bell size={18} className="text-[#FF5F40]" />}
        onClose={() => window.desktopWindow?.closeModule('notifications')}
        onMinimize={() => window.desktopWindow?.minimizeModule('notifications')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('notifications')}
        stripActions={
          <ModuleHeaderStripAction
            icon={<Inbox size={12} />}
            count={inboxCount}
            onClick={() => window.desktopWindow?.toggleModule('inbox')}
            title="Open inbox"
            ariaLabel="Open inbox"
          />
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => void loadNotifications({ force: true })}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('settings', { kind: 'settings', focusContext: 'notifications' } as any)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
            >
              <Settings size={12} />
            </button>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto bg-white px-5 py-4">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-2xl border border-gray-200 bg-gray-50"
              />
            ))}
          </div>
        ) : active.length === 0 && earlier.length === 0 ? (
          <div className="flex h-[calc(100vh-180px)] items-center justify-center">
            <div className="max-w-sm text-center">
              <p className="text-base font-medium text-gray-900">You’re caught up.</p>
              <p className="mt-1 text-sm text-gray-500">
                Ledger will let you know when something needs attention.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Active</h2>
                <span className="text-xs text-gray-500">{active.length}</span>
              </div>

              <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
                {active.map((item) => {
                  const Icon = iconForItem(item);
                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-600">
                          <Icon size={14} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {item.title || 'Notification'}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {item.context || item.workspaceName || 'Ledger'}
                                {item.workspaceName ? ` · ${item.workspaceName}` : ''}
                              </p>
                            </div>
                            <p className="shrink-0 text-[11px] text-gray-400">
                              {new Date(item.scheduledFor).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>

                          {item.body ? (
                            <p className="text-sm text-gray-600">{item.body}</p>
                          ) : null}

                          <div className="flex flex-wrap gap-2 pt-1">
                            {item.actions.map((action) => (
                              <button
                                key={action}
                                type="button"
                                onClick={() => void applyAction(item, action)}
                                className={`text-xs font-medium transition ${
                                  action === 'dismiss'
                                    ? 'text-gray-500 hover:text-red-600'
                                    : 'text-[#FF5F40] hover:underline'
                                }`}
                              >
                                {actionLabel(item, action)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {earlier.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Earlier</h2>
                  <span className="text-xs text-gray-500">{earlier.length}</span>
                </div>

                <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
                  {earlier.map((item) => {
                    const Icon = iconForItem(item);
                    return (
                      <div key={item.id} className="px-4 py-3 opacity-80">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500">
                            <Icon size={14} />
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-700">
                                  {item.title || 'Notification'}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  {item.context || item.workspaceName || 'Ledger'}
                                  {item.workspaceName ? ` · ${item.workspaceName}` : ''}
                                </p>
                              </div>
                              <p className="shrink-0 text-[11px] text-gray-400">
                                {new Date(item.scheduledFor).toLocaleTimeString([], {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>

                            {item.body ? <p className="text-sm text-gray-600">{item.body}</p> : null}

                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => void applyAction(item, 'open')}
                                className="text-xs font-medium text-[#FF5F40] transition hover:underline"
                              >
                                {item.sourceType === 'inbox' ? 'Open inbox' : 'Open'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void applyAction(item, 'dismiss')}
                                className="text-xs font-medium text-gray-500 transition hover:text-red-600"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
