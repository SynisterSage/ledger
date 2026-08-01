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
