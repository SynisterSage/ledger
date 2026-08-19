export type OverviewFocusResourceType = 'task' | 'project' | 'event' | 'note';

export type OverviewFocusSnapshot = {
  generatedAt: string;
  workspaceId: string;
  tasks: Array<{ id: string; title: string; status: string; dueAt?: string; priority?: string; projectId?: string; projectTitle?: string; assignedToCurrentUser?: boolean; section: 'today' | 'long_term' }>;
  projects: Array<{ id: string; title: string; status?: string; dueAt?: string; progress?: number }>;
  events: Array<{ id: string; title: string; startsAt: string; endsAt?: string }>;
  recentNotes: Array<{ id: string; title: string; updatedAt: string }>;
};

export type OverviewFocusInsight = { id: string; title: string; summary: string; importance: 'normal' | 'attention'; resourceRefs: Array<{ type: OverviewFocusResourceType; id: string }> };
export type OverviewFocusResult = { insights: OverviewFocusInsight[] };

export const getOverviewFocusPrimaryResource = (insight: OverviewFocusInsight, snapshot: OverviewFocusSnapshot | null) => {
  if (!snapshot) return null;
  return insight.resourceRefs.find((ref) => (
    ref.type === 'task' ? snapshot.tasks.some((item) => item.id === ref.id)
      : ref.type === 'project' ? snapshot.projects.some((item) => item.id === ref.id)
        : ref.type === 'event' ? snapshot.events.some((item) => item.id === ref.id)
          : snapshot.recentNotes.some((item) => item.id === ref.id)
  )) ?? null;
};

export type OverviewFocusInput = {
  now?: Date;
  todayTasks: Array<Record<string, unknown>>;
  workspaceTasks: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  reminders?: Array<Record<string, unknown>>;
  notes?: Array<Record<string, unknown>>;
  currentUserId?: string;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value: unknown) => text(value) || undefined;
const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const dateValue = (value: unknown) => {
  const valueText = text(value);
  return valueText && Number.isFinite(Date.parse(valueText)) ? valueText : undefined;
};

const taskFrom = (task: Record<string, unknown>, section: 'today' | 'long_term', currentUserId?: string) => {
  const id = text(task.id);
  const title = text(task.title);
  if (!id || !title) return null;
  const assignedUserId = optionalText(task.assigned_to_user_id) ?? optionalText(task.assigned_to);
  return {
    id,
    title,
    status: text(task.status) || 'open',
    dueAt: dateValue(task.remind_at) ?? dateValue(task.due_date && task.due_time ? `${text(task.due_date)}T${text(task.due_time)}` : task.due_date),
    priority: optionalText(task.priority),
    projectId: optionalText(task.project_id),
    projectTitle: optionalText(task.project_name),
    assignedToCurrentUser: currentUserId ? assignedUserId === currentUserId : undefined,
    section,
  };
};

export const buildOverviewFocusSnapshot = (workspaceId: string, input: OverviewFocusInput): OverviewFocusSnapshot => ({
  generatedAt: (input.now ?? new Date()).toISOString(),
  workspaceId,
  tasks: [
    ...input.todayTasks.map((task) => taskFrom(task, 'today', input.currentUserId)),
    ...input.workspaceTasks.filter((task) => text(task.task_horizon) === 'long_term').map((task) => taskFrom(task, 'long_term', input.currentUserId)),
  ].filter((task): task is NonNullable<typeof task> => Boolean(task)).slice(0, 32),
  projects: input.projects.flatMap((project) => {
    const id = text(project.id);
    const title = text(project.name) || text(project.title);
    return id && title ? [{ id, title, status: optionalText(project.status), dueAt: dateValue(project.end_date) ?? dateValue(project.due_at), progress: finiteNumber(project.completeness ?? project.progress) }] : [];
  }).slice(0, 8),
  events: [...input.events, ...(input.reminders ?? [])].flatMap((event) => {
    const id = text(event.id);
    const title = text(event.title);
    const startsAt = dateValue(event.start_at) ?? dateValue(event.remind_at);
    return id && title && startsAt ? [{ id, title, startsAt, endsAt: dateValue(event.end_at) }] : [];
  }).slice(0, 10),
  recentNotes: (input.notes ?? []).flatMap((note) => {
    const id = text(note.id);
    const title = text(note.title);
    const updatedAt = dateValue(note.updated_at);
    return id && title && updatedAt ? [{ id, title, updatedAt }] : [];
  }).slice(0, 8),
});
