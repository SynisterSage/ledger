import { formatCalendarDateKey } from './calendarMonthGenerator';

export type MobileCalendarItemType =
  | 'event'
  | 'reminder'
  | 'task'
  | 'project_action'
  | 'project_deadline'
  | 'milestone'
  | 'external_event';

export type MobileCalendarItem = {
  id: string;
  type: MobileCalendarItemType;
  title: string;
  dateKey: string;
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  completed?: boolean;
  overdue?: boolean;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceColor?: string | null;
  sourceKey?: string | null;
  sourceKind?: 'calendar' | 'reminder' | null;
  calendarId?: string | null;
  workspaceId: string;
  projectId?: string | null;
  projectName?: string | null;
  readOnly?: boolean;
  noteId?: string | null;
  notes?: string | null;
  location?: string | null;
  recurrenceRule?: string | null;
  status?: string | null;
};

export type CalendarItemsByDate = Record<string, MobileCalendarItem[]>;

type CalendarRangePayload = {
  workspace_id: string;
  events: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
  calendars: Array<Record<string, unknown>>;
};

const stringValue = (value: unknown) => (typeof value === 'string' && value ? value : null);
const boolValue = (value: unknown) => Boolean(value);
const todayKey = formatCalendarDateKey(new Date());

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function dateKeyFromValue(value: unknown, fallback?: string | null) {
  const raw = stringValue(value) ?? fallback ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : formatCalendarDateKey(date);
}

function isCompleted(status: unknown, completed?: unknown, done?: unknown) {
  return Boolean(completed || done || ['done', 'completed', 'cancelled', 'dismissed'].includes(String(status ?? '').toLowerCase()));
}

export function normalizeCalendarRange(payload: CalendarRangePayload): MobileCalendarItem[] {
  const calendars = new Map(payload.calendars.map((calendar) => [String(calendar.id), calendar]));
  const projects = new Map(payload.projects.map((project) => [String(project.id), project]));
  const items: MobileCalendarItem[] = [];

  for (const event of payload.events) {
    const startAt = stringValue(event.start_at);
    const dateKey = dateKeyFromValue(event.all_day ? event.start_at : startAt);
    if (!dateKey || !event.id || !event.title) continue;
    const endAt = stringValue(event.end_at);
    let lastDateKey = dateKeyFromValue(endAt) ?? dateKey;
    if (boolValue(event.all_day) && endAt && lastDateKey > dateKey) {
      lastDateKey = formatCalendarDateKey(addDays(new Date(`${lastDateKey}T12:00:00`), -1));
    }
    const calendar = calendars.get(String(event.calendar_id ?? ''));
    const sourcePlatform = stringValue(event.source_platform) ?? stringValue(event.source);
    const multiDay = lastDateKey > dateKey;
    let cursor = new Date(`${dateKey}T12:00:00`);
    let occurrence = 0;
    while (formatCalendarDateKey(cursor) <= lastDateKey && occurrence < 32) {
      const occurrenceDateKey = formatCalendarDateKey(cursor);
      items.push({
        id: `event:${event.id}:${occurrenceDateKey}`,
        type: sourcePlatform && sourcePlatform !== 'workspace' && sourcePlatform !== 'mobile' ? 'external_event' : 'event',
        title: String(event.title),
        dateKey: occurrenceDateKey,
        startAt: multiDay ? null : startAt,
        endAt: multiDay ? null : endAt,
        allDay: boolValue(event.all_day) || multiDay,
        completed: isCompleted(event.status),
        overdue: !isCompleted(event.status) && Boolean(endAt && new Date(endAt).getTime() < Date.now()),
      sourceId: String(event.id),
        calendarId: stringValue(event.calendar_id),
        sourceKey: event.calendar_id ? `calendar:${String(event.calendar_id)}` : (sourcePlatform ? `external-calendar:${sourcePlatform}:${stringValue(calendar?.name) ?? 'default'}` : null),
        sourceKind: 'calendar',
        sourceName: stringValue(calendar?.name) ?? stringValue(event.calendar_name) ?? sourcePlatform,
        sourceColor: stringValue(calendar?.color) ?? stringValue(event.color),
        workspaceId: String(event.workspace_id ?? payload.workspace_id),
        projectId: stringValue(event.project_id),
        projectName: stringValue(projects.get(String(event.project_id ?? ''))?.name),
        readOnly: sourcePlatform === 'apple' || sourcePlatform === 'google',
        noteId: stringValue(event.note_id),
        notes: stringValue(event.notes),
        location: stringValue(event.location),
        recurrenceRule: stringValue(event.recurrence_rule),
        status: stringValue(event.status),
      });
      cursor = addDays(cursor, 1);
      occurrence += 1;
    }
  }

  for (const reminder of payload.reminders) {
    const remindAt = stringValue(reminder.remind_at);
    const dateKey = dateKeyFromValue(remindAt);
    if (!dateKey || !reminder.id || !reminder.title) continue;
    items.push({
      id: `reminder:${reminder.id}:${dateKey}`,
      type: 'reminder',
      title: String(reminder.title),
      dateKey,
      startAt: remindAt,
      allDay: !remindAt || remindAt.endsWith('T00:00:00.000Z'),
      completed: isCompleted(reminder.status, reminder.is_done),
      overdue: !isCompleted(reminder.status, reminder.is_done) && dateKey < todayKey,
      sourceId: String(reminder.id),
      calendarId: stringValue(reminder.calendar_id),
      sourceKey: reminder.calendar_id ? `calendar:${String(reminder.calendar_id)}` : `reminder:${stringValue(reminder.source_platform) ?? 'ledger'}:${stringValue(reminder.list_name) ?? 'default'}`,
      sourceKind: 'reminder',
      sourceName: stringValue(reminder.list_name) ?? 'Reminders',
      sourceColor: stringValue(reminder.color),
      workspaceId: String(reminder.workspace_id ?? payload.workspace_id),
      projectId: stringValue(reminder.project_id),
      projectName: stringValue(projects.get(String(reminder.project_id ?? ''))?.name),
      readOnly: stringValue(reminder.source_platform) === 'apple',
      noteId: stringValue(reminder.note_id),
      notes: stringValue(reminder.notes) ?? stringValue(reminder.body),
      recurrenceRule: stringValue(reminder.recurrence_rule),
      status: stringValue(reminder.status),
    });
  }

  for (const task of payload.tasks) {
    const dateKey = dateKeyFromValue(task.due_date);
    if (!dateKey || !task.id || !task.title) continue;
    const projectId = stringValue(task.project_id);
    items.push({
      id: `task:${task.id}`,
      type: projectId ? 'project_action' : 'task',
      title: String(task.title),
      dateKey,
      startAt: task.due_time ? `${dateKey}T${String(task.due_time)}` : null,
      allDay: !task.due_time,
      completed: isCompleted(task.status, task.completed_at),
      overdue: !isCompleted(task.status, task.completed_at) && dateKey < todayKey,
      sourceId: String(task.id),
      sourceName: projectId ? 'Project action' : 'Tasks',
      workspaceId: String(task.workspace_id ?? payload.workspace_id),
      projectId,
      projectName: stringValue(projects.get(String(projectId ?? ''))?.name),
      notes: stringValue(task.notes) ?? stringValue(task.description),
      status: stringValue(task.status),
    });
  }

  for (const project of payload.projects) {
    const dateKey = dateKeyFromValue(project.end_date);
    if (!dateKey || !project.id || !project.name) continue;
    items.push({
      id: `project-deadline:${project.id}`,
      type: 'project_deadline',
      title: `${String(project.name)} due`,
      dateKey,
      allDay: true,
      completed: isCompleted(project.status),
      overdue: !isCompleted(project.status) && dateKey < todayKey,
      sourceName: 'Project deadline',
      sourceColor: stringValue(project.color),
      workspaceId: String(project.workspace_id ?? payload.workspace_id),
      projectId: String(project.id),
      projectName: String(project.name),
      status: stringValue(project.status),
    });
  }

  for (const milestone of payload.milestones) {
    const dateKey = dateKeyFromValue(milestone.milestone_date);
    if (!dateKey || !milestone.id || !milestone.title) continue;
    const projectId = stringValue(milestone.project_id);
    items.push({
      id: `milestone:${milestone.id}`,
      type: 'milestone',
      title: String(milestone.title),
      dateKey,
      allDay: true,
      completed: boolValue(milestone.completed),
      overdue: !boolValue(milestone.completed) && dateKey < todayKey,
      sourceName: 'Milestone',
      workspaceId: String(milestone.workspace_id ?? payload.workspace_id),
      projectId,
      projectName: stringValue(projects.get(String(projectId ?? ''))?.name),
      status: stringValue(milestone.status),
    });
  }

  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export function groupCalendarItems(items: MobileCalendarItem[]): CalendarItemsByDate {
  return items.reduce<CalendarItemsByDate>((groups, item) => {
    (groups[item.dateKey] ??= []).push(item);
    return groups;
  }, {});
}

const typeRank: Record<MobileCalendarItemType, number> = {
  event: 1,
  external_event: 1,
  reminder: 2,
  task: 3,
  project_action: 4,
  milestone: 5,
  project_deadline: 6,
};

export function sortCalendarItems(items: MobileCalendarItem[]) {
  return [...items].sort((left, right) => {
    const leftTimed = left.startAt ? 0 : 1;
    const rightTimed = right.startAt ? 0 : 1;
    return leftTimed - rightTimed || (left.startAt ?? '').localeCompare(right.startAt ?? '') || typeRank[left.type] - typeRank[right.type] || left.title.localeCompare(right.title);
  });
}
