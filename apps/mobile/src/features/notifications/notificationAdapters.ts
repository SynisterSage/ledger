import type { AppDetailSheetAction, AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import type { MobileNotificationAction, MobileNotificationCenterItem } from '@/types/ledger';

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
