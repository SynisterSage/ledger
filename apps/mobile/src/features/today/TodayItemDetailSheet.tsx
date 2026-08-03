import { AppDetailSheet, type AppDetailSheetAction, type AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import type { MobileTodayInteractionItem } from '@/types/ledger';
import { getTodayItemActions } from './todayActions';

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
  return getTodayItemActions(item, { onAction: () => undefined, includeDestructive: mode === 'actions' })
    .filter((action) => mode === 'actions' || !['delete', 'dismiss_today', 'edit'].includes(action.id))
    .map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.role === 'destructive' ? 'danger' : action.id === 'complete' || action.id === 'mark_done' || action.id === 'add_follow_up' ? 'primary' : undefined,
    }));
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
      metaInCard
      body={getItemBody(item, mode) || undefined}
      actions={getActionsForItem(item, mode)}
      actionsInCard
      onClose={onClose}
      onAction={(actionId) => onAction(actionId, item)}
    />
  );
}
