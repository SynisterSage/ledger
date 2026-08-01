import { mobileRequest } from './client';

export type MobileCalendarRangeResponse = {
  workspace_id: string;
  start_date: string;
  end_date: string;
  events: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
  calendars: Array<Record<string, unknown>>;
};

export type MobileCalendarMonthItem = {
  id: string;
  type: string;
  title: string;
  dateKey: string;
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  completed?: boolean;
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

export type MobileCalendarMonthResponse = {
  workspace_id: string;
  start_date: string;
  end_date: string;
  items: MobileCalendarMonthItem[];
};

export async function getMobileCalendarMonth(workspaceId: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({ workspace_id: workspaceId, start_date: startDate, end_date: endDate });
  return mobileRequest<MobileCalendarMonthResponse>(`/api/mobile/calendar/month?${params.toString()}`);
}

export async function getMobileCalendarRange(workspaceId: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    start_date: startDate,
    end_date: endDate,
  });
  const payload = await mobileRequest<MobileCalendarRangeResponse>(`/api/mobile/calendar?${params.toString()}`);
  const hasItems = [payload.events, payload.reminders, payload.tasks, payload.projects, payload.milestones, payload.calendars]
    .some((group) => Array.isArray(group) && group.length > 0);
  const hasAllGroups = [payload.events, payload.reminders, payload.tasks, payload.projects, payload.milestones, payload.calendars]
    .every((group) => Array.isArray(group));
  if (hasItems && hasAllGroups) return payload;

  // Keep mobile Calendar compatible with the established desktop resources.
  // Older deployments may expose the individual Calendar endpoints before the
  // aggregate mobile endpoint has been populated.
  const headers = { 'x-workspace-id': workspaceId };
  const scope = workspaceId === 'all' ? 'scope=all_accessible_workspaces&' : '';
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = `${endDate}T23:59:59.999Z`;
  const [events, reminders, tasks, projects, calendars] = await Promise.all([
    mobileRequest<Array<Record<string, unknown>>>(`/api/events?${scope}startDate=${encodeURIComponent(startIso)}&endDate=${encodeURIComponent(endIso)}`, { headers }).catch(() => []),
    mobileRequest<Array<Record<string, unknown>>>(`/api/reminders?${scope}from=${encodeURIComponent(startIso)}&to=${encodeURIComponent(endIso)}&status=all`, { headers }).catch(() => []),
    mobileRequest<Array<Record<string, unknown>>>(`/api/tasks?${scope}`, { headers }).then((items) => items.filter((item) => {
      const date = typeof item.due_date === 'string' ? item.due_date.slice(0, 10) : '';
      return date >= startDate && date <= endDate;
    })).catch(() => []),
    mobileRequest<Array<Record<string, unknown>>>(`/api/projects?${scope}`, { headers }).then((items) => items.filter((item) => {
      const date = typeof item.end_date === 'string' ? item.end_date.slice(0, 10) : '';
      return date >= startDate && date <= endDate;
    })).catch(() => []),
    mobileRequest<Array<Record<string, unknown>>>(`/api/calendars?${scope}`, { headers }).catch(() => []),
  ]);
  return {
    ...payload,
    events: Array.isArray(payload.events) && payload.events.length ? payload.events : events,
    reminders: Array.isArray(payload.reminders) && payload.reminders.length ? payload.reminders : reminders,
    tasks: Array.isArray(payload.tasks) && payload.tasks.length ? payload.tasks : tasks,
    projects: Array.isArray(payload.projects) && payload.projects.length ? payload.projects : projects,
    milestones: Array.isArray(payload.milestones) ? payload.milestones : [],
    calendars: Array.isArray(payload.calendars) && payload.calendars.length ? payload.calendars : calendars,
  };
}

export async function createMobileCalendar(workspaceId: string, payload: { name: string; color?: string }) {
  return mobileRequest<Record<string, unknown>>('/api/calendars', {
    method: 'POST',
    headers: { 'x-workspace-id': workspaceId },
    body: JSON.stringify({ ...payload, is_visible: true }),
  });
}

export async function createMeetingNoteFromCalendar(workspaceId: string, payload: { eventId?: string; provider?: string; eventKey?: string; projectId?: string | null }) {
  return mobileRequest<{ note?: { id: string }; existing?: boolean }>('/api/meeting-notes/from-calendar', {
    method: 'POST',
    headers: { 'x-workspace-id': workspaceId },
    body: JSON.stringify({
      event_id: payload.eventId ?? null,
      calendar_provider: payload.provider ?? 'ledger',
      calendar_event_key: payload.eventKey ?? payload.eventId ?? null,
      project_id: payload.projectId ?? null,
    }),
  });
}
