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

const isGenericTitle = (title: string | null | undefined, sourceType: NotificationCenterItem['sourceType']) => {
  const normalized = String(title ?? '').trim().toLowerCase();
  if (!normalized) return true;

  if (sourceType === 'event') return /^event(?:\s*(?:soon|starting))?$/.test(normalized);
  if (sourceType === 'reminder') return /^reminder(?:\s*due)?$/.test(normalized);
  if (sourceType === 'task') return /^task(?:\s*due)?$/.test(normalized);
  if (sourceType === 'project') return /^project(?:\s*deadline)?$/.test(normalized);
  if (sourceType === 'inbox') return /^inbox(?:\s*capture)?$/.test(normalized);

  return false;
};

const parseNotificationDate = (isoLike: string) => {
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatNotificationDate = (date: Date) =>
  date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

const formatNotificationTime = (date: Date) =>
  date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

const formatNotificationDateTime = (date: Date) => `${formatNotificationDate(date)} at ${formatNotificationTime(date)}`;

const sourceLabel = (item: NotificationCenterItem) => {
  if (item.sourceType === 'event') return 'Event';
  if (item.sourceType === 'reminder') return 'Reminder';
  if (item.sourceType === 'task') return item.notificationType === 'overdue_item' ? 'Overdue task' : 'Task';
  if (item.sourceType === 'project') return item.notificationType === 'overdue_item' ? 'Overdue project' : 'Project';
  return 'Inbox';
};

const defaultTitle = (item: NotificationCenterItem) => {
  if (item.sourceType === 'event') return 'Upcoming event';
  if (item.sourceType === 'reminder') return 'Reminder due';
  if (item.sourceType === 'task') return item.notificationType === 'overdue_item' ? 'Task overdue' : 'Task due';
  if (item.sourceType === 'project') return item.notificationType === 'overdue_item' ? 'Project overdue' : 'Project deadline';
  return 'Inbox capture';
};

const fallbackBody = (item: NotificationCenterItem, scheduledAt: Date | null) => {
  if (!scheduledAt) return null;
  const when = formatNotificationDateTime(scheduledAt);

  if (item.sourceType === 'event') return `Starts ${when}`;
  if (item.sourceType === 'reminder') return `Due ${when}`;
  if (item.sourceType === 'task') return item.notificationType === 'overdue_item' ? `Overdue since ${when}` : `Due ${when}`;
  if (item.sourceType === 'project')
    return item.notificationType === 'overdue_item' ? `Deadline passed ${when}` : `Deadline ${when}`;

  return `Captured ${when}`;
};

const getDisplayData = (item: NotificationCenterItem) => {
  const scheduledAt = parseNotificationDate(item.scheduledFor);
  const title = !isGenericTitle(item.title, item.sourceType) ? String(item.title).trim() : defaultTitle(item);
  const body = item.body?.trim() || fallbackBody(item, scheduledAt);
  const detailParts = [sourceLabel(item), scheduledAt ? formatNotificationDateTime(scheduledAt) : null, item.workspaceName];
  const detail = detailParts.filter(Boolean).join(' · ');
  const time = scheduledAt ? formatNotificationTime(scheduledAt) : 'Now';

  return {
    title,
    body,
    detail,
    time,
  };
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
  const defaultSnoozeMinutes = 10;

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
        // Optimistically remove the notification from the UI immediately
        setActive((prev) => prev.filter((n) => n.id !== item.id));
        setEarlier((prev) => prev.filter((n) => n.id !== item.id));

        // Update the active count optimistically
        setActiveCount((prev) => Math.max(0, prev - 1));
        window.dispatchEvent(
          new CustomEvent('ledger:notifications-summary', {
            detail: { activeCount: Math.max(0, activeCount - 1) },
          })
        );

        // Make the API call
        if (action === 'open') {
          await api.updateNotificationAction(item.id, 'open');
          await openTarget(item);
        } else if (action === 'complete') {
          await api.updateNotificationAction(item.id, 'complete');
        } else if (action === 'snooze') {
          const snoozeUntil = new Date(Date.now() + defaultSnoozeMinutes * 60_000).toISOString();
          await api.updateNotificationAction(item.id, 'snooze', {
            snooze_until: snoozeUntil,
          });
        } else {
          await api.updateNotificationAction(item.id, 'dismiss');
        }

        window.dispatchEvent(new CustomEvent('ledger:notifications-updated'));
      } catch (nextError) {
        // On error, reload notifications to get the correct state
        setError(nextError instanceof Error ? nextError.message : 'Could not update notification');
        await loadNotifications();
      }
    },
    [api, loadNotifications, openTarget, activeCount, defaultSnoozeMinutes]
  );

  const headerSubtitle = useMemo(
    () => (activeCount === 1 ? '1 active' : `${activeCount} active`),
    [activeCount]
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[#E8DDD4] bg-[#FFF8F1] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
      <ModuleWindowHeader
        eyebrow="Notification Center"
        title="Notifications"
        subtitle={headerSubtitle}
        icon={<Bell size={18} className="text-[#FF5F40]" />}
        onClose={() => window.desktopWindow?.closeModule('notifications')}
        onMinimize={() => window.desktopWindow?.minimizeModule('notifications')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('notifications')}
        showWorkspaceNavigation={false}
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
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8DDD4] bg-[#FFFBF7] text-gray-700 transition hover:bg-[#FFF4EA]"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('settings', { kind: 'settings', focusContext: 'notifications' } as any)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8DDD4] bg-[#FFFBF7] text-gray-700 transition hover:bg-[#FFF4EA]"
            >
              <Settings size={12} />
            </button>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto bg-[#FFF8F1] px-5 py-4">
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
                className="h-20 animate-pulse rounded-2xl border border-[#E8DDD4] bg-[#FFF4EA]"
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

              <div className="divide-y divide-[#E8DDD4] rounded-2xl border border-[#E8DDD4] bg-[#FFFBF7]">
                {active.map((item) => {
                  const Icon = iconForItem(item);
                  const display = getDisplayData(item);
                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8DDD4] bg-[#FFF4EA] text-gray-600">
                          <Icon size={14} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {display.title}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {display.detail}
                              </p>
                            </div>
                            <p className="shrink-0 text-[11px] text-gray-400">
                              {display.time}
                            </p>
                          </div>

                          {display.body ? (
                            <p className="text-sm text-gray-600">{display.body}</p>
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

                <div className="divide-y divide-[#E8DDD4] rounded-2xl border border-[#E8DDD4] bg-[#FFFBF7]">
                  {earlier.map((item) => {
                    const Icon = iconForItem(item);
                    const display = getDisplayData(item);
                    return (
                      <div key={item.id} className="px-4 py-3 opacity-80">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8DDD4] bg-[#FFF4EA] text-gray-500">
                            <Icon size={14} />
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-700">
                                  {display.title}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  {display.detail}
                                </p>
                              </div>
                              <p className="shrink-0 text-[11px] text-gray-400">
                                {display.time}
                              </p>
                            </div>

                            {display.body ? <p className="text-sm text-gray-600">{display.body}</p> : null}

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
