import { AppDetailSheet, type AppDetailSheetAction, type AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import { AppText } from '@/components/AppText';
import type { MobileCalendarItem } from './calendarItemNormalizer';

type MonthCalendarItemSheetProps = {
  visible: boolean;
  item: MobileCalendarItem | null;
  actionMode?: boolean;
  onClose: () => void;
  onAction?: (actionId: string, item: MobileCalendarItem) => void;
  workspaceLabel?: string;
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

export function MonthCalendarItemSheet({ visible, item, actionMode = false, onClose, onAction, workspaceLabel }: MonthCalendarItemSheetProps) {
  if (!item) return null;

  const typeLabel = item.type === 'external_event' ? 'Imported event' : item.type.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const editable = ['event', 'external_event', 'reminder', 'task', 'project_action'].includes(item.type) && !item.readOnly;
  const meta: AppDetailSheetMetaRow[] = [
    { label: 'Type', value: typeLabel },
    ...(workspaceLabel ? [{ label: 'Workspace', value: workspaceLabel }] : []),
    { label: 'Date', value: formatDate(item) },
    ...(formatTime(item.startAt) && !item.allDay ? [{ label: 'Time', value: formatTime(item.startAt)! }] : []),
    ...(item.sourceName ? [{ label: 'Source', value: item.sourceName }] : []),
    ...(item.projectName ? [{ label: 'Project', value: item.projectName }] : []),
    ...(item.completed ? [{ label: 'Status', value: 'Completed' }] : []),
    ...(item.overdue && !item.completed ? [{ label: 'Status', value: 'Overdue' }] : []),
    ...(item.readOnly ? [{ label: 'Access', value: 'Read-only' }] : []),
    ...(item.noteId ? [{ label: 'Linked note', value: 'Meeting or supporting note' }] : []),
  ];
  const actions: AppDetailSheetAction[] = [
    ...(editable ? [{ id: 'edit', label: 'Edit' }] : []),
    ...(editable ? [{ id: 'duplicate', label: 'Duplicate' }] : []),
    ...(item.type === 'event' && editable ? [{ id: 'meeting-note', label: item.noteId ? 'Open meeting notes' : 'Start meeting notes' }] : []),
    ...(item.projectId ? [{ id: 'open-project', label: 'Open project' }] : []),
    ...(item.type === 'reminder' && editable ? [{ id: 'complete', label: item.completed ? 'Mark incomplete' : 'Complete', variant: 'primary' as const }] : []),
    ...((item.type === 'task' || item.type === 'project_action') && !item.readOnly ? [{ id: 'complete', label: item.completed ? 'Mark incomplete' : 'Complete', variant: 'primary' as const }, { id: 'focus', label: 'Add to Focus' }] : []),
    ...(!item.readOnly ? [{ id: 'follow-up', label: 'Create follow-up' }] : []),
    ...(item.type === 'reminder' && !item.completed && editable ? [{ id: 'snooze', label: 'Snooze 1 hour' }] : []),
    ...(editable ? [{ id: 'reschedule', label: 'Reschedule' }] : []),
    ...(actionMode && editable ? [{ id: 'delete', label: `Delete ${typeLabel.toLowerCase()}`, variant: 'danger' as const }] : []),
  ];

  return (
    <AppDetailSheet
      visible={visible}
      title={item.title}
      subtitle={item.projectName ?? typeLabel}
      meta={meta}
      body={item.overdue && !item.completed ? 'This item is past due.' : undefined}
      footer={item.notes ? <AppText variant="caption" style={{ color: '#4B5563' }}>{item.notes}</AppText> : undefined}
      actions={actions}
      onClose={onClose}
      onAction={(actionId) => onAction?.(actionId, item)}
    />
  );
}
