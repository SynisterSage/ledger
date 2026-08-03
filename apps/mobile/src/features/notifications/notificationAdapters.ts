import type { ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import type { AppDetailSheetAction, AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import type { MobileNotificationAction, MobileNotificationCenterItem } from '@/types/ledger';

export type NotificationIconName = ComponentProps<typeof SymbolView>['name'];
export type NotificationColorTone = 'accent' | 'accentHover' | 'warning' | 'success' | 'danger' | 'textSecondary';

export type NotificationPresentation = {
  title: string;
  summary?: string;
  icon: NotificationIconName;
  sourceColor: string;
  colorTone: NotificationColorTone;
  relativeTime: string;
  accessibilityTime: string;
};

export type NotificationDisplayState = 'unread' | 'read' | 'resolved';

export type PresentedNotification = {
  notification: MobileNotificationCenterItem;
  presentation: NotificationPresentation;
  displayState: NotificationDisplayState;
};

export type NotificationSection = {
  key: 'new' | 'earlier';
  title: string;
  count?: number;
  data: PresentedNotification[];
};

function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function notificationTimestamp(item: MobileNotificationCenterItem) {
  return item.deliveredInAppAt ?? item.deliveredDesktopAt ?? item.scheduledFor;
}

function notificationCreatedAt(item: MobileNotificationCenterItem) {
  return item.createdAt ?? notificationTimestamp(item);
}

export function getNotificationDisplayState(item: MobileNotificationCenterItem): NotificationDisplayState {
  const action = String(item.actionTaken ?? '').trim().toLowerCase();
  const resolvedByAction = Boolean(item.dismissedAt) || ['complete', 'completed', 'dismiss', 'archive', 'archived'].includes(action);
  const resolvedEvent = item.sourceType === 'event' && item.status === 'earlier' && item.unread !== true && item.readAt != null;
  if (resolvedByAction || resolvedEvent) return 'resolved';
  if (item.unread === true || item.readAt == null) return 'unread';
  return 'read';
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(date);
}

function formatRelativeTime(value: string | null | undefined, now = new Date()) {
  if (!value) return { relative: '', absolute: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { relative: '', absolute: value };
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  const absolute = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  if (diffMinutes < 1) return { relative: 'now', absolute };
  if (diffMinutes < 60) return { relative: `${diffMinutes}m`, absolute };
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return { relative: `${diffHours}h`, absolute };
  if (diffHours < 48) return { relative: 'Yesterday', absolute };
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return { relative: `${diffDays}d`, absolute };
  return { relative: formatShortDate(value) ?? '', absolute };
}

function cleanTitle(value: string, typeLabel: string) {
  const title = value.trim() || typeLabel;
  const prefixes = [
    'capture waiting',
    'event starting',
    'task overdue',
    'task due',
    'reminder overdue',
    'reminder due',
    'project deadline',
    'notification',
  ];
  const prefixPattern = new RegExp(`^(?:${prefixes.join('|')})\\s*[·:–-]\\s*`, 'i');
  return title.replace(prefixPattern, '').trim() || title;
}

function cleanSummary(value: string | null | undefined, title: string) {
  const summary = value?.trim();
  if (!summary || summary.toLowerCase() === title.trim().toLowerCase()) return null;
  return summary.replace(/^\s*[·:–-]\s*/, '').trim() || null;
}

function notificationIcon(item: MobileNotificationCenterItem): NotificationIconName {
  if (item.sourceType === 'event' || item.notificationType === 'event_starting') return { ios: 'calendar', android: 'event', web: 'event' };
  if (item.sourceType === 'reminder' || item.notificationType === 'reminder_due') return { ios: 'bell', android: 'notifications_none', web: 'notifications_none' };
  if (item.sourceType === 'task' || item.notificationType === 'task_due') return { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' };
  if (item.sourceType === 'inbox' || item.notificationType === 'inbox_capture') return { ios: 'tray.and.arrow.down', android: 'inbox', web: 'inbox' };
  if (item.sourceType === 'project' || item.notificationType === 'project_deadline') return { ios: 'folder', android: 'folder_open', web: 'folder_open' };
  if (item.sourceType === 'workspace_invite' || item.notificationType === 'invite.accepted') return { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' };
  return { ios: 'bell', android: 'notifications_none', web: 'notifications_none' };
}

function notificationColorTone(item: MobileNotificationCenterItem): NotificationColorTone {
  if (item.sourceType === 'event' || item.notificationType === 'event_starting') return 'accent';
  if (item.sourceType === 'reminder') return item.notificationType === 'overdue_item' ? 'danger' : 'warning';
  if (item.sourceType === 'task') return item.notificationType === 'overdue_item' ? 'danger' : 'success';
  if (item.sourceType === 'inbox') return 'accentHover';
  if (item.sourceType === 'project') return 'warning';
  return 'textSecondary';
}

export function getNotificationPresentation(item: MobileNotificationCenterItem, showWorkspaceName = false, displayState: NotificationDisplayState = getNotificationDisplayState(item)): NotificationPresentation {
  const typeLabel = getNotificationTypeLabel(item);
  const title = cleanTitle(item.title, typeLabel);
  const timestamp = formatRelativeTime(notificationTimestamp(item));
  const workspace = showWorkspaceName ? item.workspaceName : null;
  let summary = cleanSummary(item.body || item.context, title);

  if (item.notificationType === 'event_starting' && item.scheduledFor) {
    const start = new Date(item.scheduledFor);
    summary = Number.isNaN(start.getTime()) ? summary : `Starts at ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(start)}${workspace ? ` · ${workspace}` : ''}`;
  } else if (item.notificationType === 'overdue_item' && item.scheduledFor) {
    summary = `Due ${formatShortDate(item.scheduledFor) ?? 'earlier'}${workspace ? ` · ${workspace}` : ''}`;
  } else if (workspace && summary && !summary.includes(workspace)) {
    summary = `${summary} · ${workspace}`;
  } else if (workspace && !summary) {
    summary = workspace;
  }

  if (displayState === 'resolved') {
    summary = summary && !/\bresolved\b/i.test(summary) ? `${summary} · Resolved` : summary || 'Resolved';
  }

  return {
    title,
    summary: summary || undefined,
    icon: notificationIcon(item),
    sourceColor: item.workspaceColor || '',
    colorTone: notificationColorTone(item),
    relativeTime: timestamp.relative,
    accessibilityTime: timestamp.absolute,
  };
}

export function sortNotificationsNewestFirst(left: MobileNotificationCenterItem, right: MobileNotificationCenterItem) {
  const leftTime = new Date(notificationCreatedAt(left) ?? 0).getTime();
  const rightTime = new Date(notificationCreatedAt(right) ?? 0).getTime();
  return rightTime - leftTime || String(right.id).localeCompare(String(left.id));
}

export function buildPresentedNotifications(items: MobileNotificationCenterItem[], showWorkspaceName = false): PresentedNotification[] {
  return items
    .map((notification) => {
      const displayState = getNotificationDisplayState(notification);
      return {
        notification,
        displayState,
        presentation: getNotificationPresentation(notification, showWorkspaceName, displayState),
      };
    })
    .sort((left, right) => sortNotificationsNewestFirst(left.notification, right.notification));
}

export function buildNotificationSections(items: PresentedNotification[]): NotificationSection[] {
  const unread = items.filter((item) => item.displayState === 'unread');
  const earlier = items.filter((item) => item.displayState !== 'unread');
  return [
    unread.length ? { key: 'new' as const, title: 'New', count: unread.length, data: unread } : null,
    earlier.length ? { key: 'earlier' as const, title: 'Earlier', data: earlier } : null,
  ].filter(Boolean) as NotificationSection[];
}

export function getNotificationTypeLabel(item: MobileNotificationCenterItem) {
  switch (item.notificationType) {
    case 'reminder_due':
      return 'Reminder due';
    case 'event_starting':
      return 'Event starting';
    case 'task_due':
      return 'Task due';
    case 'overdue_item':
      if (item.sourceType === 'task') return 'Task overdue';
      if (item.sourceType === 'project') return 'Project deadline';
      if (item.sourceType === 'reminder') return 'Reminder overdue';
      return 'Overdue';
    case 'project_deadline':
      return 'Project deadline';
    case 'inbox_capture':
      return 'Capture waiting';
    case 'invite.accepted':
      return 'Workspace invite';
    default:
      return 'Notification';
  }
}

export function getNotificationSubtitle(item: MobileNotificationCenterItem, showWorkspaceName: boolean) {
  const parts: string[] = [];

  if (showWorkspaceName && item.workspaceName) {
    parts.push(item.workspaceName);
  }

  parts.push(getNotificationTypeLabel(item));

  const timeLabel = formatDateTimeLabel(item.scheduledFor ?? item.deliveredInAppAt ?? item.deliveredDesktopAt);
  if (timeLabel) {
    parts.push(timeLabel);
  }

  return parts.join(' · ');
}

export function getNotificationDetailBody(item: MobileNotificationCenterItem) {
  return item.body?.trim() || item.context?.trim() || null;
}

export function getNotificationDetailMetaRows(item: MobileNotificationCenterItem): AppDetailSheetMetaRow[] {
  const rows: AppDetailSheetMetaRow[] = [
    { label: 'Workspace', value: item.workspaceName ?? 'Unknown workspace' },
    { label: 'Type', value: getNotificationTypeLabel(item) },
    { label: 'Status', value: item.status === 'active' ? 'Active' : 'Earlier' },
  ];

  const timeLabel = formatDateTimeLabel(item.scheduledFor ?? item.deliveredInAppAt ?? item.deliveredDesktopAt);
  if (timeLabel) {
    rows.push({ label: 'Time', value: timeLabel });
  }

  if (!item.body?.trim() && item.context && item.context.trim() && item.context.trim() !== getNotificationTypeLabel(item)) {
    rows.push({ label: 'Context', value: item.context.trim() });
  }

  return rows;
}

export function getNotificationActions(item: MobileNotificationCenterItem): AppDetailSheetAction[] {
  switch (item.sourceType) {
    case 'reminder':
      return [
        { id: 'mark_done', label: 'Mark as done', variant: 'primary' },
        { id: 'snooze_10', label: 'Snooze 10 minutes' },
        { id: 'snooze_1_hour', label: 'Snooze 1 hour' },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'dismiss', label: 'Dismiss', variant: 'danger' },
      ];
    case 'task':
      return [
        { id: 'mark_done', label: 'Mark as done', variant: 'primary' },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'add_to_focus', label: 'Add to focus' },
        { id: 'dismiss', label: 'Dismiss', variant: 'danger' },
      ];
    case 'event':
      return [
        { id: 'add_note', label: 'Add note', variant: 'primary' },
        { id: 'create_follow_up', label: 'Create follow-up' },
        { id: 'dismiss', label: 'Dismiss', variant: 'danger' },
      ];
    case 'project':
      return [
        { id: 'create_follow_up', label: 'Create follow-up', variant: 'primary' },
        { id: 'add_note', label: 'Add note' },
        { id: 'dismiss', label: 'Dismiss', variant: 'danger' },
      ];
    case 'inbox':
      return [
        { id: 'convert_task', label: 'Convert to task', variant: 'primary' },
        { id: 'convert_reminder', label: 'Convert to reminder' },
        { id: 'convert_note', label: 'Convert to note' },
        { id: 'convert_event', label: 'Convert to event' },
        { id: 'archive', label: 'Archive' },
        { id: 'dismiss', label: 'Dismiss', variant: 'danger' },
      ];
    case 'workspace_invite':
      return [{ id: 'dismiss', label: 'Dismiss', variant: 'danger' }];
    default:
      return [{ id: 'dismiss', label: 'Dismiss', variant: 'danger' }];
  }
}

export function mapNotificationSourceTypeToFollowUpSourceType(
  sourceType: MobileNotificationCenterItem['sourceType'],
) {
  switch (sourceType) {
    case 'event':
      return 'calendar_event';
    case 'task':
      return 'task';
    case 'project':
      return 'project';
    case 'reminder':
      return 'reminder';
    default:
      return null;
  }
}

export function getNotificationSourceLabel(item: MobileNotificationCenterItem) {
  switch (item.sourceType) {
    case 'event':
      return `From event · ${item.title}`;
    case 'task':
      return `From task · ${item.title}`;
    case 'project':
      return `From project · ${item.title}`;
    case 'reminder':
      return `From reminder · ${item.title}`;
    case 'inbox':
      return `From capture · ${item.title}`;
    default:
      return `From Ledger · ${item.title}`;
  }
}

export function getNotificationQuickActionIds(item: MobileNotificationCenterItem): MobileNotificationAction[] {
  return getNotificationActions(item).map((action) => action.id as MobileNotificationAction);
}
