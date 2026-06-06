import type { AppDetailSheetAction, AppDetailSheetMetaRow } from '@/components/AppDetailSheet';
import type { MobileSearchResult } from '@/types/ledger';

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

function formatTypeLabel(result: MobileSearchResult) {
  switch (result.type) {
    case 'note':
      return 'Note';
    case 'project':
      return 'Project';
    case 'task':
      return 'Task';
    case 'reminder':
      return 'Reminder';
    case 'event':
      return 'Event';
    default:
      return 'Result';
  }
}

export function getSearchResultSubtitle(result: MobileSearchResult) {
  const parts = [result.workspace_name ?? 'Workspace', formatTypeLabel(result)];

  if (result.type === 'task' && result.project_id) {
    parts.push('Project item');
  } else if (result.type === 'reminder' && result.remind_at) {
    const timeLabel = formatDateTimeLabel(result.remind_at);
    if (timeLabel) parts.push(timeLabel);
  } else if (result.type === 'event' && result.starts_at) {
    const timeLabel = formatDateTimeLabel(result.starts_at);
    if (timeLabel) parts.push(timeLabel);
  } else if (result.type === 'project' && result.preview) {
    parts.push(result.preview);
  }

  return parts.filter(Boolean).join(' · ');
}

export function getSearchResultBody(result: MobileSearchResult) {
  return result.snippet?.trim() || result.preview?.trim() || null;
}

export function getSearchResultMetaRows(result: MobileSearchResult): AppDetailSheetMetaRow[] {
  const rows: AppDetailSheetMetaRow[] = [
    { label: 'Workspace', value: result.workspace_name ?? 'Unknown workspace' },
    { label: 'Type', value: formatTypeLabel(result) },
  ];

  if (result.project_id) {
    rows.push({ label: 'Project', value: 'Linked project' });
  }

  if (result.remind_at) {
    rows.push({ label: 'Due', value: formatDateTimeLabel(result.remind_at) ?? 'Unknown' });
  }

  if (result.starts_at) {
    rows.push({ label: 'Time', value: formatDateTimeLabel(result.starts_at) ?? 'Unknown' });
  }

  if (result.updated_at) {
    rows.push({ label: 'Updated', value: formatDateTimeLabel(result.updated_at) ?? 'Unknown' });
  }

  return rows;
}

export function getSearchResultActions(result: MobileSearchResult): AppDetailSheetAction[] {
  switch (result.type) {
    case 'note':
      return [
        { id: 'add_follow_up', label: 'Add follow-up' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', variant: 'danger' },
      ];
    case 'task':
      return [
        { id: 'mark_done', label: 'Mark as done', variant: 'primary' },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'add_focus', label: 'Add to focus' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', variant: 'danger' },
      ];
    case 'reminder':
      return [
        { id: 'mark_done', label: 'Mark as done', variant: 'primary' },
        { id: 'snooze', label: 'Snooze' },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', variant: 'danger' },
      ];
    case 'event':
      return [
        { id: 'add_note', label: 'Add note' },
        { id: 'create_follow_up', label: 'Create follow-up' },
        { id: 'reschedule', label: 'Reschedule' },
        { id: 'delete', label: 'Delete', variant: 'danger' },
      ];
    case 'project':
      return [
        { id: 'open_project', label: 'Open project', variant: 'primary' },
        { id: 'add_action', label: 'Add action' },
        { id: 'add_note', label: 'Add note' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', variant: 'danger' },
      ];
    default:
      return [];
  }
}
