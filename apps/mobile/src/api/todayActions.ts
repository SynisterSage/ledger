import { mobileRequest } from './client';

import type { MobileTodayInteractionItem } from '@/types/ledger';

export type MobileTodayActionResult = {
  ok: boolean;
  refresh: boolean;
};

type MobileTodayActionContext = {
  actionId: string;
  item: MobileTodayInteractionItem;
};

function getWorkspaceHeaders(workspaceId: string) {
  return {
    'x-workspace-id': workspaceId,
  };
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTimeValue(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function shiftDateLike(dateLike: string | null | undefined, days: number) {
  const base = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(base.getTime())) {
    return null;
  }

  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function getTomorrowDateKey() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalDateKey(tomorrow);
}

function getTomorrowDateTime(dateLike: string | null | undefined) {
  return shiftDateLike(dateLike, 1);
}

export async function performMobileTodayAction({
  actionId,
  item,
}: MobileTodayActionContext): Promise<MobileTodayActionResult> {
  const workspaceId = item.workspaceId;
  const headers = getWorkspaceHeaders(workspaceId);

  if ('source' in item) {
    switch (actionId) {
      case 'convert_task':
        await mobileRequest(`/api/inbox/${item.id}/convert`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'task',
            title: item.title,
            body: item.title,
            priority: 'medium',
            status: 'todo',
            show_in_today: false,
            is_today_focus: false,
          }),
        });
        return { ok: true, refresh: true };
      case 'convert_reminder':
        await mobileRequest(`/api/inbox/${item.id}/convert`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'reminder',
            title: item.title,
            body: item.title,
            status: 'active',
          }),
        });
        return { ok: true, refresh: true };
      case 'convert_note':
        await mobileRequest(`/api/inbox/${item.id}/convert`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'note',
            title: item.title,
            content: item.title,
          }),
        });
        return { ok: true, refresh: true };
      case 'archive':
        await mobileRequest(`/api/inbox/${item.id}/archive`, {
          method: 'POST',
          headers,
        });
        return { ok: true, refresh: true };
      case 'delete':
        await mobileRequest(`/api/inbox/${item.id}`, {
          method: 'DELETE',
          headers,
        });
        return { ok: true, refresh: true };
      default:
        return { ok: true, refresh: false };
    }
  }

  if (item.type === 'focus' || item.type === 'task') {
    switch (actionId) {
      case 'complete':
      case 'mark_done':
        await mobileRequest(`/api/tasks/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'completed' }),
        });
        return { ok: true, refresh: true };
      case 'move_tomorrow':
        await mobileRequest(`/api/tasks/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            due_date: getTomorrowDateKey(),
            show_in_today: false,
            is_today_focus: false,
          }),
        });
        return { ok: true, refresh: true };
      case 'add_focus':
        await mobileRequest(`/api/tasks/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            show_in_today: true,
            is_today_focus: true,
          }),
        });
        return { ok: true, refresh: true };
      case 'remove_today':
        await mobileRequest(`/api/tasks/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            due_date: null,
            due_time: null,
            show_in_today: false,
            is_today_focus: false,
          }),
        });
        return { ok: true, refresh: true };
      case 'delete':
        await mobileRequest(`/api/tasks/${item.sourceId}`, {
          method: 'DELETE',
          headers,
        });
        return { ok: true, refresh: true };
      case 'edit':
      case 'open':
        return { ok: true, refresh: false };
      default:
        return { ok: true, refresh: false };
    }
  }

  if (item.type === 'reminder') {
    switch (actionId) {
      case 'complete':
        await mobileRequest(`/api/reminders/${item.sourceId}/complete`, {
          method: 'POST',
          headers,
        });
        return { ok: true, refresh: true };
      case 'snooze_hour':
        await mobileRequest(`/api/reminders/${item.sourceId}/snooze`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            snooze_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
        });
        return { ok: true, refresh: true };
      case 'snooze_tomorrow': {
        const next = getTomorrowDateTime(item.startsAt ?? null) ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
        await mobileRequest(`/api/reminders/${item.sourceId}/snooze`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            snooze_until: next.toISOString(),
          }),
        });
        return { ok: true, refresh: true };
      }
      case 'delete':
        await mobileRequest(`/api/reminders/${item.sourceId}`, {
          method: 'DELETE',
          headers,
        });
        return { ok: true, refresh: true };
      case 'edit':
        return { ok: true, refresh: false };
      default:
        return { ok: true, refresh: false };
    }
  }

  if (item.type === 'event') {
    switch (actionId) {
      case 'dismiss_today':
      case 'complete':
        await mobileRequest(`/api/events/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'done' }),
        });
        return { ok: true, refresh: true };
      case 'delete':
        await mobileRequest(`/api/events/${item.sourceId}`, {
          method: 'DELETE',
          headers,
        });
        return { ok: true, refresh: true };
      case 'reschedule': {
        const start = item.startsAt ? new Date(item.startsAt) : new Date();
        const end = item.endsAt ? new Date(item.endsAt) : null;
        const nextStart = shiftDateLike(start.toISOString(), 1) ?? start;
        const nextEnd = end ? shiftDateLike(end.toISOString(), 1) ?? end : new Date(nextStart.getTime() + 60 * 60 * 1000);
        await mobileRequest(`/api/events/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            start_at: nextStart.toISOString(),
            end_at: nextEnd.toISOString(),
          }),
        });
        return { ok: true, refresh: true };
      }
      case 'create_follow_up':
        await mobileRequest('/api/tasks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: `Follow up: ${item.title}`,
            description: `Follow up from ${item.title}`,
            notes: item.dateLabel ? `Event date: ${item.dateLabel}` : null,
            status: 'todo',
            priority: 'medium',
            show_in_today: true,
            is_today_focus: false,
          }),
        });
        return { ok: true, refresh: true };
      case 'add_note':
        await mobileRequest('/api/notes', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: item.title,
            content: item.dateLabel ? `${item.title}\n\n${item.dateLabel}` : item.title,
            source: 'mobile',
          }),
        });
        return { ok: true, refresh: false };
      case 'open':
      case 'edit':
        return { ok: true, refresh: false };
      default:
        return { ok: true, refresh: false };
    }
  }

  if (item.type === 'project_action') {
    switch (actionId) {
      case 'complete':
        await mobileRequest(`/api/projects/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'completed', completeness: 100 }),
        });
        return { ok: true, refresh: true };
      case 'move_tomorrow':
        await mobileRequest(`/api/projects/${item.sourceId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ end_date: getTomorrowDateKey() }),
        });
        return { ok: true, refresh: true };
      case 'delete':
        await mobileRequest(`/api/projects/${item.sourceId}`, {
          method: 'DELETE',
          headers,
        });
        return { ok: true, refresh: true };
      case 'open_project':
      case 'edit':
        return { ok: true, refresh: false };
      default:
        return { ok: true, refresh: false };
    }
  }

  return { ok: true, refresh: false };
}
