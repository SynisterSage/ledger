export type ProjectSignalResourceType =
  | 'project'
  | 'task'
  | 'milestone'
  | 'event'
  | 'reminder'
  | 'activity';

export type ProjectSignalKind =
  | 'overdue_action'
  | 'missing_next_action'
  | 'overdue_milestone'
  | 'deadline_approaching'
  | 'milestone_approaching'
  | 'upcoming_event'
  | 'upcoming_reminder'
  | 'blocked'
  | 'stale_activity'
  | 'recent_activity'
  | 'missing_dates'
  | 'project_state';

export type ProjectSignalSeverity = 'critical' | 'warning' | 'info';

export type ProjectSignal = {
  id: string;
  kind: ProjectSignalKind;
  severity: ProjectSignalSeverity;
  workspaceId: string;
  projectId: string;
  resourceType: ProjectSignalResourceType;
  resourceId: string;
  title: string;
  detail: string;
  date?: string;
  count?: number;
  metadata?: Record<string, unknown>;
};

export type ProjectSignalProject = {
  id: string;
  workspace_id?: string | null;
  name: string;
  description?: string | null;
  status?: string | null;
  completeness?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProjectSignalTask = {
  id: string;
  workspace_id?: string | null;
  project_id?: string | null;
  title: string;
  status?: string | null;
  due_date?: string | null;
  priority?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProjectSignalMilestone = {
  id: string;
  workspace_id?: string | null;
  project_id?: string | null;
  title: string;
  milestone_date?: string | null;
  completed?: boolean | null;
  note?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProjectSignalCalendarItem = {
  id: string;
  workspace_id?: string | null;
  project_id?: string | null;
  title: string;
  start_at?: string | null;
  remind_at?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProjectSignalActivity = {
  id: string;
  workspace_id?: string | null;
  project_id?: string | null;
  at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type ProjectSignalInput = {
  workspaceId: string;
  project: ProjectSignalProject;
  tasks?: ProjectSignalTask[];
  milestones?: ProjectSignalMilestone[];
  events?: ProjectSignalCalendarItem[];
  reminders?: ProjectSignalCalendarItem[];
  activity?: ProjectSignalActivity[];
  today?: string | Date;
  deadlineWindowDays?: number;
  staleAfterDays?: number;
};

export type ProjectSignalSummary = {
  signals: ProjectSignal[];
  needsActionProjectIds: string[];
  overdueCount: number;
  dueSoonCount: number;
  blockedCount: number;
  staleCount: number;
};

const CLOSED_TASK_STATUSES = new Set(['completed', 'complete', 'done', 'cancelled', 'canceled', 'dismissed']);
const CLOSED_PROJECT_STATUS = /completed|complete|done|paused|hold|archived/i;

const dateKey = (value: string | Date | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

const dayNumber = (value: string) => Date.parse(`${value}T12:00:00`);

const dayDifference = (left: string, right: string) =>
  Math.round((dayNumber(left) - dayNumber(right)) / 86_400_000);

const normalizedStatus = (value: unknown) => String(value ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();

const scoped = <T extends { workspace_id?: string | null; project_id?: string | null }>(
  rows: T[] | undefined,
  workspaceId: string,
  projectId: string,
) => (rows ?? []).filter((row) =>
  (!row.workspace_id || row.workspace_id === workspaceId) &&
  (!row.project_id || row.project_id === projectId)
);

const signal = (
  input: ProjectSignalInput,
  kind: ProjectSignalKind,
  severity: ProjectSignalSeverity,
  resourceType: ProjectSignalResourceType,
  resourceId: string,
  title: string,
  detail: string,
  extra: Pick<ProjectSignal, 'date' | 'count' | 'metadata'> = {},
): ProjectSignal => ({
  id: `${kind}:${resourceType}:${resourceId}`,
  kind,
  severity,
  workspaceId: input.workspaceId,
  projectId: input.project.id,
  resourceType,
  resourceId,
  title,
  detail,
  ...extra,
});

export const deriveProjectSignals = (input: ProjectSignalInput): ProjectSignal[] => {
  const today = dateKey(input.today) ?? dateKey(new Date())!;
  const deadlineWindowDays = input.deadlineWindowDays ?? 7;
  const staleAfterDays = input.staleAfterDays ?? 14;
  const projectStatus = normalizedStatus(input.project.status);
  const projectClosed = CLOSED_PROJECT_STATUS.test(projectStatus) || Number(input.project.completeness ?? 0) >= 100;
  const tasks = scoped(input.tasks, input.workspaceId, input.project.id);
  const milestones = scoped(input.milestones, input.workspaceId, input.project.id);
  const events = scoped(input.events, input.workspaceId, input.project.id);
  const reminders = scoped(input.reminders, input.workspaceId, input.project.id);
  const activity = scoped(input.activity, input.workspaceId, input.project.id);
  const activeTasks = tasks.filter((task) => !CLOSED_TASK_STATUSES.has(normalizedStatus(task.status)));
  const overdueTasks = projectClosed
    ? []
    : activeTasks.filter((task) => {
        const due = dateKey(task.due_date);
        return Boolean(due && due < today);
      });
  const activeMilestones = milestones.filter((milestone) => !milestone.completed && normalizedStatus(milestone.status) !== 'completed');
  const overdueMilestones = projectClosed
    ? []
    : activeMilestones.filter((milestone) => {
        const due = dateKey(milestone.milestone_date);
        return Boolean(due && due < today);
      });
  const blockedTasks = projectClosed
    ? []
    : activeTasks.filter((task) => normalizedStatus(task.status).includes('blocked'));
  const signals: ProjectSignal[] = [];

  signals.push(signal(input, 'project_state', 'info', 'project', input.project.id, input.project.name, `${input.project.status ?? 'Not started'} · ${Number(input.project.completeness ?? 0)}% complete`, {
    count: activeTasks.length,
    metadata: { status: input.project.status ?? null, completeness: Number(input.project.completeness ?? 0), activeTaskCount: activeTasks.length, completedTaskCount: tasks.filter((task) => normalizedStatus(task.status) === 'completed').length, totalTaskCount: tasks.length },
  }));

  if (overdueTasks.length) {
    signals.push(signal(input, 'overdue_action', 'critical', 'task', overdueTasks[0].id, `${overdueTasks.length} overdue action${overdueTasks.length === 1 ? '' : 's'}`, 'An active project action is past its due date.', { count: overdueTasks.length, date: dateKey(overdueTasks[0].due_date) ?? undefined, metadata: { resourceIds: overdueTasks.map((task) => task.id) } }));
  }

  if (!projectClosed && activeTasks.length === 0) {
    signals.push(signal(input, 'missing_next_action', 'warning', 'project', input.project.id, 'No next action', 'This active project has no open actions.'));
  }

  if (overdueMilestones.length) {
    signals.push(signal(input, 'overdue_milestone', 'critical', 'milestone', overdueMilestones[0].id, `${overdueMilestones.length} overdue milestone${overdueMilestones.length === 1 ? '' : 's'}`, 'An active milestone is past its date.', { count: overdueMilestones.length, date: dateKey(overdueMilestones[0].milestone_date) ?? undefined, metadata: { resourceIds: overdueMilestones.map((milestone) => milestone.id) } }));
  }

  if (!projectClosed && projectStatus.includes('blocked')) {
    signals.push(signal(input, 'blocked', 'critical', 'project', input.project.id, 'Blocked', 'The project is explicitly marked blocked.'));
  }
  if (blockedTasks.length) {
    signals.push(signal(input, 'blocked', 'critical', 'task', blockedTasks[0].id, `${blockedTasks.length} blocked action${blockedTasks.length === 1 ? '' : 's'}`, 'An active action is explicitly marked blocked.', { count: blockedTasks.length, metadata: { resourceIds: blockedTasks.map((task) => task.id) } }));
  }

  const approaching = (date: string | null, kind: ProjectSignalKind, resourceType: 'project' | 'milestone', resourceId: string, title: string) => {
    if (!date || projectClosed) return;
    const difference = dayDifference(date, today);
    if (difference >= 0 && difference <= deadlineWindowDays) {
      signals.push(signal(input, kind, 'warning', resourceType, resourceId, title, `Due ${difference === 0 ? 'today' : `in ${difference} day${difference === 1 ? '' : 's'}`}.`, { date }));
    }
  };
  approaching(dateKey(input.project.end_date), 'deadline_approaching', 'project', input.project.id, 'Project deadline approaching');
  for (const milestone of activeMilestones) approaching(dateKey(milestone.milestone_date), 'milestone_approaching', 'milestone', milestone.id, milestone.title);

  for (const event of events) {
    const date = dateKey(event.start_at);
    if (date && dayDifference(date, today) >= 0 && dayDifference(date, today) <= deadlineWindowDays) {
      signals.push(signal(input, 'upcoming_event', 'info', 'event', event.id, event.title, 'Upcoming project event.', { date }));
    }
  }
  for (const reminder of reminders) {
    const date = dateKey(reminder.remind_at);
    if (date && dayDifference(date, today) >= 0 && dayDifference(date, today) <= deadlineWindowDays) {
      signals.push(signal(input, 'upcoming_reminder', 'info', 'reminder', reminder.id, reminder.title, 'Upcoming project reminder.', { date }));
    }
  }

  if (!projectClosed && !input.project.start_date && !input.project.end_date) {
    signals.push(signal(input, 'missing_dates', 'info', 'project', input.project.id, 'Missing project dates', 'This active project has no start or end date.'));
  }

  const activityDates = [input.project.updated_at, ...tasks.flatMap((task) => [task.created_at, task.updated_at]), ...milestones.flatMap((milestone) => [milestone.created_at, milestone.updated_at]), ...activity.flatMap((item) => [item.at, item.created_at, item.updated_at])]
    .map((value) => value ? Date.parse(value) : NaN)
    .filter(Number.isFinite);
  if (!projectClosed && activityDates.length) {
    const lastActivity = Math.max(...activityDates);
    const ageDays = Math.floor((dayNumber(today) - lastActivity) / 86_400_000);
    if (ageDays >= staleAfterDays) {
      signals.push(signal(input, 'stale_activity', 'info', 'project', input.project.id, 'Stale project activity', `No activity recorded for ${ageDays} days.`, { metadata: { ageDays } }));
    } else if (ageDays >= 0 && ageDays <= 7) {
      signals.push(signal(input, 'recent_activity', 'info', 'activity', input.project.id, 'Recent activity', 'This project has recent activity.', { metadata: { ageDays } }));
    }
  }

  return signals;
};

export const deriveWorkspaceProjectSignals = (input: Omit<ProjectSignalInput, 'project'> & {
  projects: ProjectSignalProject[];
}) => input.projects.flatMap((project) => deriveProjectSignals({ ...input, project }));

export const summarizeProjectSignals = (signals: ProjectSignal[]): ProjectSignalSummary => {
  const projectIds = (kind: ProjectSignalKind) => [...new Set(signals.filter((item) => item.kind === kind).map((item) => item.projectId))];
  return {
    signals,
    needsActionProjectIds: [...new Set([...projectIds('missing_next_action'), ...projectIds('overdue_action'), ...projectIds('overdue_milestone'), ...projectIds('blocked')])],
    overdueCount: signals.filter((item) => item.kind === 'overdue_action' || item.kind === 'overdue_milestone').reduce((sum, item) => sum + (item.count ?? 1), 0),
    dueSoonCount: signals.filter((item) => ['deadline_approaching', 'milestone_approaching', 'upcoming_event', 'upcoming_reminder'].includes(item.kind)).length,
    blockedCount: signals.filter((item) => item.kind === 'blocked').length,
    staleCount: signals.filter((item) => item.kind === 'stale_activity').length,
  };
};
