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

export async function getMobileCalendarRange(workspaceId: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    start_date: startDate,
    end_date: endDate,
  });
  return mobileRequest<MobileCalendarRangeResponse>(`/api/mobile/calendar?${params.toString()}`);
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
