import { getMobileCalendarRange, type MobileCalendarRangeResponse } from './calendar';
import { getMobileProjects, type MobileProjectsMilestone, type MobileProjectsProject } from './projects';
import { mobileRequest } from './client';
import { normalizeCalendarRange, type MobileCalendarItem } from '@/features/calendar/calendarItemNormalizer';

export type MobileProjectTask = {
  id: string;
  title: string;
  status?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  priority?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MobileProjectNote = { id: string; title: string; preview?: string | null; updated_at?: string | null };
export type MobileProjectResource = { id?: string; name?: string; provider?: string; type?: string; canonical_url?: string | null; external_metadata?: Record<string, unknown> | null };
export type MobileProjectActivity = { id: string; title: string; timestamp: string | null };

export type MobileProjectDetail = {
  project: MobileProjectsProject;
  tasks: MobileProjectTask[];
  milestones: MobileProjectsMilestone[];
  notes: MobileProjectNote[];
  calendar: MobileCalendarItem[];
  resources: MobileProjectResource[];
  activity: MobileProjectActivity[];
  sectionErrors: Partial<Record<'tasks' | 'notes' | 'calendar' | 'resources', string>>;
};

type SectionResult<T> = { value: T; error?: string };

function localDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function addDays(dateKey: string, amount: number) { const date = new Date(`${dateKey}T12:00:00`); date.setDate(date.getDate() + amount); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

export async function getMobileProjectDetail(projectId: string, workspaceId: string): Promise<MobileProjectDetail> {
  const projectResponse = await getMobileProjects(workspaceId, true);
  const project = projectResponse.projects.find((item) => item.id === projectId);
  if (!project) throw new Error('Project not found.');
  const projectWorkspaceId = project.workspace_id;
  const headers = { 'x-workspace-id': projectWorkspaceId };
  const today = localDateKey();
  const [tasksResult, notesResult, calendarResult, resourcesResult] = await Promise.all([
    mobileRequest<MobileProjectTask[]>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`, { headers })
      .then((value): SectionResult<MobileProjectTask[]> => ({ value }))
      .catch((error): SectionResult<MobileProjectTask[]> => ({ value: [], error: error instanceof Error ? error.message : 'Could not load tasks.' })),
    mobileRequest<{ links?: Array<{ note?: MobileProjectNote }> }>(`/api/projects/${encodeURIComponent(projectId)}/note-links`, { headers })
      .then((value): SectionResult<{ links?: Array<{ note?: MobileProjectNote }> }> => ({ value }))
      .catch((error): SectionResult<{ links?: Array<{ note?: MobileProjectNote }> }> => ({ value: {}, error: error instanceof Error ? error.message : 'Could not load notes.' })),
    getMobileCalendarRange(projectWorkspaceId, addDays(today, -30), addDays(today, 90))
      .then((value): SectionResult<MobileCalendarRangeResponse> => ({ value }))
      .catch((error): SectionResult<MobileCalendarRangeResponse> => ({ value: { workspace_id: projectWorkspaceId, start_date: today, end_date: today, events: [], reminders: [], tasks: [], projects: [], milestones: [], calendars: [] }, error: error instanceof Error ? error.message : 'Could not load calendar items.' })),
    mobileRequest<MobileProjectResource[]>(`/api/projects/${encodeURIComponent(projectId)}/connected-sources`, { headers })
      .then((value): SectionResult<MobileProjectResource[]> => ({ value }))
      .catch((error): SectionResult<MobileProjectResource[]> => ({ value: [], error: error instanceof Error ? error.message : 'Could not load resources.' })),
  ]);
  const milestones = projectResponse.milestones.filter((item) => item.project_id === projectId);
  const calendar = normalizeCalendarRange(calendarResult.value).filter((item) => item.projectId === projectId || item.type === 'project_deadline' && item.projectId === projectId);
  const tasks = Array.isArray(tasksResult.value) ? tasksResult.value : [];
  const activity = [
    project.updated_at ? { id: `project:${project.id}`, title: 'Project updated', timestamp: project.updated_at } : null,
    ...tasks.filter((task) => task.updated_at || task.completed_at).map((task) => ({ id: `task:${task.id}`, title: task.completed_at ? `Completed “${task.title}”` : `Updated “${task.title}”`, timestamp: task.completed_at ?? task.updated_at ?? null })),
    ...milestones.filter((item) => item.updated_at).map((item) => ({ id: `milestone:${item.id}`, title: `${item.completed ? 'Completed' : 'Updated'} “${item.title}”`, timestamp: item.updated_at ?? null })),
  ].filter(Boolean).sort((left, right) => String(right!.timestamp ?? '').localeCompare(String(left!.timestamp ?? ''))).slice(0, 8) as MobileProjectActivity[];
  return {
    project,
    tasks,
    milestones,
    notes: (notesResult.value.links ?? []).map((link) => link.note).filter(Boolean) as MobileProjectNote[],
    calendar,
    resources: Array.isArray(resourcesResult.value) ? resourcesResult.value : [],
    activity,
    sectionErrors: {
      ...(tasksResult.error ? { tasks: tasksResult.error } : {}),
      ...(notesResult.error ? { notes: notesResult.error } : {}),
      ...(calendarResult.error ? { calendar: calendarResult.error } : {}),
      ...(resourcesResult.error ? { resources: resourcesResult.error } : {}),
    },
  };
}
