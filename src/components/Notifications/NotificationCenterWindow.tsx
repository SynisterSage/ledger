import { useEffect, useMemo, useState } from 'react';
import { Bell, RotateCcw, Inbox, CalendarDays, Folder, CheckCircle2, Clock3, MoreHorizontal, ExternalLink, Check, Clock, X } from 'lucide-react';
import {
  ModuleHeaderSegmentedButton,
  ModuleHeaderSegmentedGroup,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { useNotificationCenter, type NotificationCenterItem } from './NotificationCenterContext';
import { useSidebar } from '../../context/SidebarContext';
import { ContextMenu, type ContextMenuGroup } from '../Common/ContextMenu';

const isGenericTitle = (title: string | null | undefined, sourceType: NotificationCenterItem['sourceType']) => {
  const normalized = String(title ?? '').trim().toLowerCase();
  if (!normalized) return true;

  if (sourceType === 'event') return /^event(?:\s*(?:soon|starting))?$/.test(normalized);
  if (sourceType === 'reminder') return /^reminder(?:\s*due)?$/.test(normalized);
  if (sourceType === 'task') return /^task(?:\s*due)?$/.test(normalized);
  if (sourceType === 'project') return /^project(?:\s*deadline)?$/.test(normalized);
  if (sourceType === 'inbox') return /^inbox(?:\s*capture)?$/.test(normalized);
  if (sourceType === 'workspace_invite') return /^workspace invite$|^invite accepted$/.test(normalized);

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
  if (item.sourceType === 'workspace_invite') return 'Workspace invite';
  return 'Inbox';
};

const defaultTitle = (item: NotificationCenterItem) => {
  if (item.sourceType === 'event') return 'Upcoming event';
  if (item.sourceType === 'reminder') return 'Reminder due';
  if (item.sourceType === 'task') return item.notificationType === 'overdue_item' ? 'Task overdue' : 'Task due';
  if (item.sourceType === 'project') return item.notificationType === 'overdue_item' ? 'Project overdue' : 'Project deadline';
  if (item.sourceType === 'workspace_invite') return 'Workspace invite';
  return 'Intake item';
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

const getCompactMetadata = (item: NotificationCenterItem) => {
  const scheduledAt = parseNotificationDate(item.scheduledFor);
  const source =
    item.notificationType === 'overdue_item' && (item.sourceType === 'task' || item.sourceType === 'project')
      ? 'Overdue'
      : sourceLabel(item);
  const workspace = item.workspaceName?.trim() || null;
  const date = scheduledAt
    ? item.notificationType === 'overdue_item'
      ? `Due ${scheduledAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      : item.sourceType === 'inbox'
      ? scheduledAt.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : scheduledAt.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null;

  return [source, workspace, date].filter(Boolean).join(' · ');
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
    case 'workspace_invite':
      return Inbox;
    default:
      return Bell;
  }
};

const actionLabel = (item: NotificationCenterItem, action: NotificationCenterItem['actions'][number]) => {
  if (action === 'open') {
    if (item.sourceType === 'inbox') return 'Open Intake item';
    if (item.sourceType === 'project') return 'Open project';
    if (item.sourceType === 'task') return 'Open task';
    if (item.sourceType === 'event') return 'Open event';
    if (item.sourceType === 'workspace_invite') return 'Open workspace';
    return 'Open related item';
  }
  if (action === 'complete') return 'Complete';
  if (action === 'snooze') return 'Snooze';
  return 'Dismiss';
};

const getNotificationMenuGroups = (
  item: NotificationCenterItem,
  applyAction: (item: NotificationCenterItem, action: NotificationCenterItem['actions'][number]) => Promise<void>
): ContextMenuGroup[] => {
  const groups: ContextMenuGroup[] = [];
  if (item.actions.includes('open')) {
    groups.push({
      items: [
        {
          id: 'open',
          label: actionLabel(item, 'open'),
          icon: <ExternalLink size={13} />,
          onClick: () => void applyAction(item, 'open'),
        },
      ],
    });
  }
  const workflowActions =
    item.status === 'active'
      ? item.actions.filter((action) => action === 'complete' || action === 'snooze')
      : [];
  if (workflowActions.length > 0) {
    groups.push({
      items: workflowActions.map((action) => ({
        id: action,
        label: actionLabel(item, action),
        icon: action === 'complete' ? <Check size={13} /> : <Clock size={13} />,
        onClick: () => void applyAction(item, action),
      })),
    });
  }
  if (item.status === 'active' && item.actions.includes('dismiss')) {
    groups.push({
      items: [
        {
          id: 'dismiss',
          label: 'Dismiss',
          icon: <X size={13} />,
          destructive: true,
          onClick: () => void applyAction(item, 'dismiss'),
        },
      ],
    });
  }
  return groups;
};

const CompactTrayList = ({
  items,
  applyAction,
  onRequestClose,
}: {
  items: NotificationCenterItem[];
  applyAction: (item: NotificationCenterItem, action: NotificationCenterItem['actions'][number]) => Promise<void>;
  onRequestClose?: () => void;
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: NotificationCenterItem } | null>(null);
  const applyTrayAction = async (
    item: NotificationCenterItem,
    action: NotificationCenterItem['actions'][number]
  ) => {
    await applyAction(item, action);
    if (action === 'open') onRequestClose?.();
  };

  return (
    <>
      <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
        {items.map((item) => {
          const Icon = iconForItem(item);
          const display = getDisplayData(item);
          const isEarlier = item.status === 'earlier';
          const isUnread = item.unread === true && !isEarlier;
          const isOpenable = item.actions.includes('open');
          return (
            <div
              key={item.id}
              role={isOpenable ? 'button' : undefined}
              tabIndex={isOpenable ? 0 : undefined}
              onClick={async () => {
                if (!isOpenable) return;
                await applyTrayAction(item, 'open');
              }}
              onKeyDown={(event) => {
                if (!isOpenable || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                void applyTrayAction(item, 'open');
              }}
              className={`group flex min-h-[50px] items-center gap-2.5 px-3 py-2 outline-none transition ${
                isOpenable ? 'cursor-pointer hover:bg-[var(--ledger-surface-hover)] focus-visible:bg-[var(--ledger-surface-hover)]' : ''
              } ${isEarlier ? 'text-[var(--ledger-text-muted)]' : ''}`}
            >
              <div className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] ${isEarlier ? 'text-[var(--ledger-text-muted)]' : 'text-[var(--ledger-text-secondary)]'}`}>
                <Icon size={13} />
                {isUnread && <span className="absolute -left-1 -top-1 h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`max-w-[34ch] truncate text-[13px] ${isEarlier ? 'font-normal' : isUnread ? 'font-semibold' : 'font-medium'} ${isEarlier ? 'text-[var(--ledger-text-secondary)]' : 'text-[var(--ledger-text-primary)]'}`}>
                  {display.title}
                </p>
                <p className="max-w-[42ch] truncate text-[11px] text-[var(--ledger-text-muted)]">
                  {getCompactMetadata(item)}
                </p>
              </div>
              <span className="ml-auto shrink-0 text-right text-[11px] text-[var(--ledger-text-muted)]">
                {display.time}
              </span>
              <button
                type="button"
                aria-label={`More actions for ${display.title}`}
                title="More actions"
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setContextMenu({ item, x: rect.right, y: rect.bottom });
                }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <ContextMenu
        open={Boolean(contextMenu)}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        width={208}
        groups={contextMenu ? getNotificationMenuGroups(contextMenu.item, applyTrayAction) : []}
        onClose={() => setContextMenu(null)}
        ariaLabel="Notification actions"
        groupLabelCase="normal"
      />
    </>
  );
};

const CompactNotificationList = ({
  items,
  sectionLabel,
  applyAction,
}: {
  items: NotificationCenterItem[];
  sectionLabel: 'Active' | 'Earlier';
  applyAction: (item: NotificationCenterItem, action: NotificationCenterItem['actions'][number]) => Promise<void>;
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: NotificationCenterItem;
  } | null>(null);

  const openContextMenu = (item: NotificationCenterItem, x: number, y: number) => {
    setContextMenu({ item, x, y });
  };

  const handleRowOpen = (item: NotificationCenterItem) => {
    if (item.actions.includes('open')) void applyAction(item, 'open');
  };

  return (
    <section aria-label={sectionLabel}>
      <div>
        {items.map((item) => {
          const Icon = iconForItem(item);
          const display = getDisplayData(item);
          const inlineAction = sectionLabel === 'Active' && item.actions.includes('complete')
            ? 'complete'
            : sectionLabel === 'Active' && item.actions.includes('snooze')
            ? 'snooze'
            : sectionLabel === 'Active' && item.actions.includes('open')
            ? 'open'
            : null;
          const isUnread = item.unread === true;

          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => handleRowOpen(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleRowOpen(item);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openContextMenu(item, event.clientX, event.clientY);
              }}
              className={`group relative flex min-h-[46px] items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition hover:bg-[var(--ledger-surface-hover)] focus-visible:bg-[var(--ledger-surface-hover)] ${
                isUnread ? 'bg-[var(--ledger-surface-hover)]' : ''
              }`}
            >
              <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)]">
                <Icon size={13} />
                {isUnread && <span className="absolute -left-1 -top-1 h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`min-w-0 max-w-[42ch] truncate text-[13px] ${isUnread ? 'font-semibold' : 'font-medium'} text-[var(--ledger-text-primary)]`}>
                    {display.title}
                  </span>
                  <span className="hidden min-w-0 truncate text-[11px] text-[var(--ledger-text-muted)] sm:inline">
                    {getCompactMetadata(item)}
                  </span>
                </div>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)] sm:hidden">
                  {getCompactMetadata(item)}
                </span>
              </div>
              {inlineAction ? (
                <span className="relative ml-auto hidden h-7 w-16 shrink-0 items-center justify-end text-right sm:flex">
                  <span className="text-[11px] font-normal leading-4 text-[var(--ledger-text-muted)] transition group-hover:opacity-0">
                    {display.time}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void applyAction(item, inlineAction);
                    }}
                    className="absolute right-0 rounded-md px-2 py-1 text-[11px] font-medium leading-4 text-[var(--ledger-text-secondary)] opacity-0 transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    {inlineAction === 'open' && item.sourceType === 'inbox'
                      ? 'Review'
                      : actionLabel(item, inlineAction)}
                  </button>
                </span>
              ) : (
                <span className="ml-auto hidden shrink-0 text-right text-[11px] text-[var(--ledger-text-muted)] md:inline">
                  {display.time}
                </span>
              )}
              <div className="relative shrink-0" data-notification-menu>
                <button
                  type="button"
                  aria-label={`More actions for ${display.title}`}
                  title="More actions"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openContextMenu(item, rect.right, rect.bottom);
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-card)] hover:text-[var(--ledger-text-primary)]"
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <ContextMenu
        open={Boolean(contextMenu)}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        width={208}
        groups={contextMenu ? getNotificationMenuGroups(contextMenu.item, applyAction) : []}
        onClose={() => setContextMenu(null)}
        ariaLabel="Notification actions"
        groupLabelCase="normal"
      />
    </section>
  );
};

type NotificationCenterWindowProps = {
  mode?: 'window' | 'tray';
  onRequestClose?: () => void;
  onViewAll?: () => void;
};

export const NotificationCenterWindow: React.FC<NotificationCenterWindowProps> = ({
  mode = 'window',
  onRequestClose,
  onViewAll,
}) => {
  const { active, earlier, loading, error, activeCount, loadNotifications, applyAction } =
    useNotificationCenter();
  const { workspaceShellLayout } = useSidebar();
  const inboxCount = 0;
  const [filter, setFilter] = useState<'active' | 'earlier'>('active');

  useEffect(() => {
    const context = new URLSearchParams(window.location.search).get('focusContext') ?? '';
    setFilter(context === 'notifications:filter:earlier' ? 'earlier' : 'active');
  }, []);

  const selectFilter = (nextFilter: 'active' | 'earlier') => {
    setFilter(nextFilter);
    if (mode === 'tray') return;
    void window.desktopWindow?.openModule('notifications', {
      kind: 'notifications',
      focusContext: `notifications:filter:${nextFilter}`,
    });
  };

  const headerSubtitle = useMemo(
    () => (activeCount === 1 ? '1 active' : `${activeCount} active`),
    [activeCount]
  );

  const isTray = mode === 'tray';
  const displayActive = isTray || filter === 'active' ? active : [];
  const displayEarlier = isTray || filter === 'earlier' ? earlier : [];
  const trayItems = filter === 'earlier' ? earlier : active;

  return (
    <div
      style={!isTray ? { scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle } : undefined}
      className={
        isTray
          ? 'relative flex max-h-[min(680px,calc(100vh-56px))] min-h-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]'
          : 'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[var(--ledger-shadow)]'
      }
    >
      {!isTray && <ModuleWindowHeader
        eyebrow="Notification Center"
        title="Notifications"
        subtitle={headerSubtitle}
        icon={<Bell size={18} className="text-[#FF5F40]" />}
        onClose={() => window.desktopWindow?.closeModule('notifications')}
        onMinimize={() => window.desktopWindow?.minimizeModule('notifications')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('notifications')}
        compact
        showBodyHeader={false}
        viewControls={
          !isTray ? (
            <ModuleHeaderSegmentedGroup compact>
              {(['active', 'earlier'] as const).map((option) => (
                <ModuleHeaderSegmentedButton
                  key={option}
                  compact
                  active={filter === option}
                  title={`Show ${option} notifications`}
                  onClick={() => selectFilter(option)}
                >
                  {option === 'active' ? 'Active' : 'Earlier'}
                  <span className="ml-1 text-[10px] text-[var(--ledger-text-muted)]">
                    {option === 'active' ? active.length : earlier.length}
                  </span>
                </ModuleHeaderSegmentedButton>
              ))}
            </ModuleHeaderSegmentedGroup>
          ) : null
        }
        stripActions={
            <ModuleHeaderStripAction
              icon={<Inbox size={12} />}
              count={inboxCount}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => void loadNotifications({ force: true })}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              aria-label="Refresh notifications"
              title="Refresh notifications"
            >
              <RotateCcw size={12} />
            </button>
          </>
        }
      />}

      {isTray && (
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bell size={15} className="shrink-0 text-[var(--ledger-text-secondary)]" />
            <span className="truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
              Notifications
            </span>
            <span className="text-xs text-[var(--ledger-text-muted)]">{headerSubtitle}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void loadNotifications({ force: true })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              aria-label="Refresh notifications"
              title="Refresh notifications"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              onClick={onViewAll}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              aria-label="Open all notifications"
              title="Open all notifications"
            >
              <ExternalLink size={13} />
            </button>
            <button
              type="button"
              onClick={onRequestClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              aria-label="Close notifications"
              title="Close notifications"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      )}

      {isTray && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[color:var(--ledger-border-subtle)] px-3">
          {(['active', 'earlier'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => selectFilter(option)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                filter === option
                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                  : 'text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              {option === 'active' ? 'Active' : 'Earlier'}
              <span className="ml-1 text-[10px] text-[var(--ledger-text-muted)]">
                {option === 'active' ? active.length : earlier.length}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto ${isTray ? 'bg-[var(--ledger-surface-card)] px-0 py-0' : 'bg-[var(--ledger-background)] px-5 py-4'}`}>
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? isTray ? (
          <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex h-[50px] items-center gap-2.5 px-3">
                <div className="h-7 w-7 animate-pulse rounded-lg bg-[var(--ledger-surface-hover)]" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex h-[46px] items-center gap-3 px-2">
                <div className="h-7 w-7 animate-pulse rounded-lg bg-[var(--ledger-surface-hover)]" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--ledger-surface-hover)]" />
              </div>
            ))}
          </div>
        ) : (isTray ? trayItems.length === 0 : displayActive.length === 0 && displayEarlier.length === 0) ? (
          <div className="flex min-h-[280px] items-center justify-center">
            <div className="max-w-sm text-center">
              <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                {filter === 'earlier' ? 'No earlier notifications' : 'You’re all caught up'}
              </p>
              <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                {filter === 'earlier'
                  ? 'Completed and dismissed alerts will appear here.'
                  : 'No active notifications in this workspace.'}
              </p>
            </div>
          </div>
        ) : isTray ? (
          <CompactTrayList
            items={trayItems}
            applyAction={applyAction}
            onRequestClose={onRequestClose}
          />
        ) : (
          <div className="space-y-5">
            <CompactNotificationList
              items={filter === 'earlier' ? displayEarlier : displayActive}
              sectionLabel={filter === 'earlier' ? 'Earlier' : 'Active'}
              applyAction={applyAction}
            />
          </div>
        )}
      </div>
    </div>
  );
};
