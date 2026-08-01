import { AppDetailSheet, type AppDetailSheetAction, type AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import type { MobileCalendarItem } from './calendarItemNormalizer';

type MonthCalendarItemSheetProps = {
  visible: boolean;
  item: MobileCalendarItem | null;
  actionMode?: boolean;
  onClose: () => void;
  onAction?: (actionId: string, item: MobileCalendarItem) => void;
};

function formatDate(item: MobileCalendarItem) {
  const date = new Date(`${item.dateKey}T12:00:00`);
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function MonthCalendarItemSheet({ visible, item, actionMode = false, onClose, onAction }: MonthCalendarItemSheetProps) {
  if (!item) return null;

  const typeLabel = item.type === 'external_event' ? 'Imported event' : item.type.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const meta: AppDetailSheetMetaRow[] = [
    { label: 'Type', value: typeLabel },
    { label: 'Date', value: formatDate(item) },
    ...(formatTime(item.startAt) && !item.allDay ? [{ label: 'Time', value: formatTime(item.startAt)! }] : []),
    ...(item.sourceName ? [{ label: 'Source', value: item.sourceName }] : []),
    ...(item.projectName ? [{ label: 'Project', value: item.projectName }] : []),
    ...(item.completed ? [{ label: 'Status', value: 'Completed' }] : []),
    ...(item.overdue && !item.completed ? [{ label: 'Status', value: 'Overdue' }] : []),
    ...(item.readOnly ? [{ label: 'Access', value: 'Read-only' }] : []),
  ];
  const actions: AppDetailSheetAction[] = actionMode ? [
    ...(item.type === 'reminder' && !item.readOnly ? [{ id: 'complete', label: item.completed ? 'Mark incomplete' : 'Complete', variant: 'primary' as const }] : []),
    ...(item.type === 'task' || item.type === 'project_action' ? [{ id: 'focus', label: 'Add to Focus', variant: 'primary' as const }] : []),
    ...(!item.readOnly ? [{ id: 'follow-up', label: 'Create follow-up' }] : []),
  ] : [];

  return (
    <AppDetailSheet
      visible={visible}
      title={item.title}
      subtitle={item.projectName ?? typeLabel}
      meta={meta}
      body={item.overdue && !item.completed ? 'This item is past due.' : undefined}
      actions={actions}
      onClose={onClose}
      onAction={(actionId) => onAction?.(actionId, item)}
    />
  );
}
