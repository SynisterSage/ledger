import { mobileRequest } from './client';

import type { CaptureOption, MobileProjectOption } from '@/types/ledger';

export const mockCaptureOptions: CaptureOption[] = [
  { id: 'reminder', title: 'Reminder', subtitle: 'Quick reminder for later', href: '/capture/reminder' },
  { id: 'task', title: 'Task', subtitle: 'A simple action to complete', href: '/capture/task' },
  { id: 'event', title: 'Event', subtitle: 'A time-bound calendar item', href: '/capture/event' },
  { id: 'note', title: 'Note', subtitle: 'Save a thought or detail', href: '/capture/note' },
  { id: 'project-action', title: 'Project action', subtitle: 'Add a next step to a project', href: '/capture/project-action' },
];

export function listCaptureOptions() {
  return mockCaptureOptions;
}

export type CreateMobileTaskInput = {
  title: string;
  due_date?: string | null;
  due_time?: string | null;
  description?: string | null;
  notes?: string | null;
  project_id?: string | null;
  status?: string;
  priority?: string;
  tags?: string[];
  show_in_today?: boolean;
  is_today_focus?: boolean;
  source?: string;
  sourcePlatform?: string | null;
};

export type CreateMobileReminderInput = {
  title: string;
  remind_at: string;
  body?: string | null;
  calendar_id?: string | null;
  linked_type?: string | null;
  linked_id?: string | null;
  project_id?: string | null;
  note_id?: string | null;
  source?: string;
  sourcePlatform?: string | null;
};

export type CreateMobileEventInput = {
  title: string;
  start_at: string;
  end_at?: string | null;
  notes?: string | null;
  location?: string | null;
  calendar_id?: string | null;
  project_id?: string | null;
  note_id?: string | null;
  all_day?: boolean;
  status?: string;
  recurrence_rule?: string | null;
  source?: string;
  sourcePlatform?: string | null;
};

export type CreateMobileNoteInput = {
  title: string;
  content?: string | null;
  content_html?: string | null;
  date?: string | null;
  source?: string;
  sourcePlatform?: string | null;
  section_id?: string | null;
  parent_id?: string | null;
};

export type MobileProjectListResponse = MobileProjectOption[];

export async function listMobileProjects(workspaceId: string, includeCompleted = true) {
  const suffix = includeCompleted ? '?includeCompleted=true' : '';
  return mobileRequest<MobileProjectListResponse>('/api/projects' + suffix, {
    headers: {
      'x-workspace-id': workspaceId,
    },
  });
}

export async function createMobileTask(workspaceId: string, payload: CreateMobileTaskInput) {
  return mobileRequest('/api/tasks', {
    method: 'POST',
    headers: {
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      title: payload.title,
      due_date: payload.due_date ?? null,
      due_time: payload.due_time ?? null,
      description: payload.description ?? null,
      notes: payload.notes ?? null,
      project_id: payload.project_id ?? null,
      status: payload.status ?? 'todo',
      priority: payload.priority ?? 'medium',
      tags: payload.tags ?? [],
      show_in_today: Boolean(payload.show_in_today ?? false),
      is_today_focus: Boolean(payload.is_today_focus ?? false),
      source: payload.source ?? 'workspace',
      source_platform: payload.sourcePlatform ?? null,
    }),
  });
}

export async function createMobileReminder(workspaceId: string, payload: CreateMobileReminderInput) {
  return mobileRequest('/api/reminders', {
    method: 'POST',
    headers: {
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      title: payload.title,
      remind_at: payload.remind_at,
      body: payload.body ?? null,
      calendar_id: payload.calendar_id ?? null,
      linked_type: payload.linked_type ?? null,
      linked_id: payload.linked_id ?? null,
      project_id: payload.project_id ?? null,
      note_id: payload.note_id ?? null,
      source: payload.source ?? 'workspace',
      source_platform: payload.sourcePlatform ?? null,
    }),
  });
}

export async function createMobileEvent(workspaceId: string, payload: CreateMobileEventInput) {
  return mobileRequest('/api/events', {
    method: 'POST',
    headers: {
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      title: payload.title,
      start_at: payload.start_at,
      end_at: payload.end_at ?? null,
      notes: payload.notes ?? null,
      location: payload.location ?? null,
      calendar_id: payload.calendar_id ?? null,
      project_id: payload.project_id ?? null,
      note_id: payload.note_id ?? null,
      all_day: Boolean(payload.all_day ?? false),
      status: payload.status ?? 'planned',
      recurrence_rule: payload.recurrence_rule ?? null,
      source: payload.source ?? 'workspace',
      source_platform: payload.sourcePlatform ?? null,
    }),
  });
}

export async function createMobileNote(workspaceId: string, payload: CreateMobileNoteInput) {
  return mobileRequest('/api/notes', {
    method: 'POST',
    headers: {
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content ?? null,
      content_html: payload.content_html ?? null,
      date: payload.date ?? null,
      source: payload.source ?? 'mobile',
      source_platform: payload.sourcePlatform ?? null,
      section_id: payload.section_id ?? null,
      parent_id: payload.parent_id ?? null,
    }),
  });
}

export async function createMobileSiriTask(workspaceId: string, payload: CreateMobileTaskInput) {
  return createMobileTask(workspaceId, {
    ...payload,
    source: payload.source ?? 'siri',
    sourcePlatform: payload.sourcePlatform ?? 'ios',
  });
}

export async function createMobileSiriReminder(workspaceId: string, payload: CreateMobileReminderInput) {
  return createMobileReminder(workspaceId, {
    ...payload,
    source: payload.source ?? 'siri',
    sourcePlatform: payload.sourcePlatform ?? 'ios',
  });
}

export async function createMobileSiriEvent(workspaceId: string, payload: CreateMobileEventInput) {
  return createMobileEvent(workspaceId, {
    ...payload,
    source: payload.source ?? 'siri',
    sourcePlatform: payload.sourcePlatform ?? 'ios',
  });
}

export async function createMobileSiriNote(workspaceId: string, payload: CreateMobileNoteInput) {
  return createMobileNote(workspaceId, {
    ...payload,
    source: payload.source ?? 'siri',
    sourcePlatform: payload.sourcePlatform ?? 'ios',
  });
}

export async function createMobileProjectAction(workspaceId: string, payload: {
  title: string;
  due_date?: string | null;
  due_time?: string | null;
  notes?: string | null;
  project_id?: string | null;
  show_in_today?: boolean;
}) {
  return createMobileTask(workspaceId, {
    title: payload.title,
    due_date: payload.due_date ?? null,
    due_time: payload.due_time ?? null,
    notes: payload.notes ?? null,
    project_id: payload.project_id ?? null,
    show_in_today: payload.show_in_today ?? true,
    is_today_focus: false,
  });
}
