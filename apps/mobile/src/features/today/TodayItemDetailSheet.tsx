import { AppDetailSheet, type AppDetailSheetAction, type AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import type { MobileTodayInteractionItem } from '@/types/ledger';

export type TodayDetailSheetMode = 'detail' | 'actions' | 'edit' | 'reschedule';

export type TodayDetailSheetItem = MobileTodayInteractionItem;

type TodayItemDetailSheetProps = {
  visible: boolean;
  item: TodayDetailSheetItem | null;
  mode: TodayDetailSheetMode;
  onClose: () => void;
  onAction: (actionId: string, item: TodayDetailSheetItem) => void;
};

function formatDateTimeLabel(dateLike: string | null | undefined) {
  if (!dateLike) return null;

  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getItemTypeLabel(item: TodayDetailSheetItem) {
  if ('source' in item) {
    return 'Capture';
  }

  if (item.type === 'note') {
    return 'Note';
  }

  if (item.type === 'project_action') {
    return 'Project action';
  }

  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function getItemSubtitle(item: TodayDetailSheetItem) {
  if ('source' in item) {
    return [item.workspaceName, item.source, item.createdAt ? formatDateTimeLabel(item.createdAt) : item.dateLabel ?? null]
      .filter(Boolean)
      .join(' · ');
  }

  if (item.type === 'focus') {
    return [item.workspaceName, 'Focus', item.urgency ?? 'Low'].filter(Boolean).join(' · ');
  }

  if (item.type === 'note') {
    const parts = [item.workspaceName, 'Note', item.updatedAt ? formatDateTimeLabel(item.updatedAt) : null].filter(Boolean);
    return parts.join(' · ');
  }

  const metaParts: string[] = [];

  if (item.workspaceName) {
    metaParts.push(item.workspaceName);
  }

  if (item.type === 'project_action' && item.dueLabel && item.dueLabel !== 'Today' && item.dateLabel) {
    metaParts.push(item.dateLabel);
  } else if (item.type !== 'project_action' && 'dueLabel' in item && item.dueLabel) {
    metaParts.push(item.dueLabel);
  } else if (item.type === 'project_action' && item.dueLabel) {
    metaParts.push(item.dueLabel);
  }

  if (item.type === 'event' && item.startsAt) {
    const timeLabel = formatDateTimeLabel(item.startsAt);
    if (timeLabel) {
      metaParts.push(timeLabel);
    }
  }

  return metaParts.join(' · ');
}

function getItemMeta(item: TodayDetailSheetItem): AppDetailSheetMetaRow[] {
  if ('source' in item) {
    return [
      { label: 'Workspace', value: item.workspaceName ?? 'Unknown workspace' },
      { label: 'Source', value: item.source },
      { label: 'Created', value: formatDateTimeLabel(item.createdAt) ?? item.dateLabel ?? 'Unknown' },
    ].filter((entry) => Boolean(entry.value));
  }

  if (item.type === 'focus') {
    return [
      { label: 'Workspace', value: item.workspaceName ?? 'Unknown workspace' },
      { label: 'Type', value: 'Focus' },
      { label: 'Urgency', value: item.urgency ?? 'Low' },
    ];
  }

  if (item.type === 'note') {
    return [
      { label: 'Workspace', value: item.workspaceName ?? 'Unknown workspace' },
      { label: 'Type', value: 'Note' },
      { label: 'Updated', value: formatDateTimeLabel(item.updatedAt) ?? 'Unknown' },
    ];
  }

  const rows: AppDetailSheetMetaRow[] = [
    { label: 'Workspace', value: item.workspaceName ?? 'Unknown workspace' },
    { label: 'Type', value: getItemTypeLabel(item) },
  ];

  if ('status' in item && item.status) {
    rows.push({ label: 'Status', value: item.status });
  }

  if ('timeLabel' in item && item.timeLabel) {
    rows.push({ label: 'Time', value: item.timeLabel });
  } else if ('startsAt' in item && item.startsAt) {
    const timeLabel = formatDateTimeLabel(item.startsAt);
    if (timeLabel) {
      rows.push({ label: 'Time', value: timeLabel });
    }
  }

  if ('dateLabel' in item && item.dateLabel) {
    rows.push({ label: 'Date', value: item.dateLabel });
  }

  if (
    item.type === 'project_action' &&
    'meta' in item &&
    item.meta &&
    item.meta.toLowerCase() !== 'overdue' &&
    item.meta !== item.dueLabel
  ) {
    rows.push({ label: 'Project', value: item.meta });
  }

  return rows;
}

function getItemBody(item: TodayDetailSheetItem, mode: TodayDetailSheetMode) {
  if ('source' in item) {
    return mode === 'actions'
      ? 'Capture waiting to be sorted.'
      : 'Tap an action below to turn this into something useful.';
  }

  if ('meta' in item) {
    return item.meta || null;
  }

  if (item.type === 'note') {
    return item.body || null;
  }

  return null;
}

function getActionsForItem(item: TodayDetailSheetItem, mode: TodayDetailSheetMode): AppDetailSheetAction[] {
  if ('source' in item) {
    return [
      { id: 'convert_task', label: 'Convert to task', variant: 'primary' },
      { id: 'convert_reminder', label: 'Convert to reminder' },
      { id: 'convert_note', label: 'Convert to note' },
      { id: 'convert_event', label: 'Convert to event' },
      { id: 'archive', label: 'Archive' },
      { id: 'delete', label: 'Delete', variant: 'danger' },
    ];
  }

  switch (item.type) {
    case 'focus':
      return mode === 'actions'
        ? [
            { id: 'mark_done', label: 'Mark as done', variant: 'primary' },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'remove_today', label: 'Remove from Today' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', variant: 'danger' },
          ]
        : [
            { id: 'mark_done', label: 'Mark as done', variant: 'primary' },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'remove_today', label: 'Remove from Today' },
          ];
    case 'note':
      return mode === 'actions'
        ? [
            { id: 'add_follow_up', label: 'Add follow-up', variant: 'primary' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', variant: 'danger' },
          ]
        : [
            { id: 'add_follow_up', label: 'Add follow-up', variant: 'primary' },
            { id: 'edit', label: 'Edit' },
          ];
    case 'event':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'add_note', label: 'Add note' },
            { id: 'create_follow_up', label: 'Create follow-up' },
            { id: 'reschedule', label: 'Reschedule' },
            { id: 'dismiss_today', label: 'Dismiss from Today', variant: 'danger' },
            { id: 'delete', label: 'Delete', variant: 'danger' },
          ]
        : [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'add_note', label: 'Add note' },
            { id: 'create_follow_up', label: 'Create follow-up' },
            { id: 'reschedule', label: 'Reschedule' },
          ];
    case 'reminder':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'snooze_hour', label: 'Snooze 1 hour' },
            { id: 'snooze_tomorrow', label: 'Snooze tomorrow' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', variant: 'danger' },
          ]
        : [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'snooze_hour', label: 'Snooze 1 hour' },
            { id: 'edit', label: 'Edit' },
          ];
    case 'task':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'add_focus', label: 'Add to focus' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', variant: 'danger' },
          ]
        : [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'edit', label: 'Edit' },
          ];
    case 'project_action':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'open_project', label: 'Open project' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', variant: 'danger' },
          ]
        : [
            { id: 'complete', label: 'Mark as done', variant: 'primary' },
            { id: 'open_project', label: 'Open project' },
            { id: 'edit', label: 'Edit' },
          ];
    default:
      return [];
  }
}

export function TodayItemDetailSheet({ visible, item, mode, onClose, onAction }: TodayItemDetailSheetProps) {
  if (!item) {
    return null;
  }

  return (
    <AppDetailSheet
      visible={visible}
      title={item.title}
      subtitle={getItemSubtitle(item)}
      meta={getItemMeta(item)}
      body={getItemBody(item, mode) || undefined}
      actions={getActionsForItem(item, mode)}
      onClose={onClose}
      onAction={(actionId) => onAction(actionId, item)}
    />
  );
}
