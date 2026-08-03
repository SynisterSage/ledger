import type { MobileProjectsMilestone, MobileProjectsProject, ProjectAttention } from '@/api/projects';
import { matchesProjectDate, matchesProjectFilters, type ProjectFilterState } from './projectFilters';

export type MobileProjectDateKind = 'milestone' | 'project_deadline' | 'project_start';
export type MobileProjectDate = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  kind: MobileProjectDateKind;
  completed: boolean;
  projectTitle: string;
  projectColor?: string | null;
  attention?: ProjectAttention;
};

function dateKey(value?: string | null) { return value ? value.slice(0, 10) : null; }
function localDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function dayDifference(date: string, today: string) { return Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000); }
function overdueAttention(date: string, today: string, kind: MobileProjectDateKind): ProjectAttention | undefined {
  const days = Math.abs(dayDifference(date, today));
  if (days <= 0 || kind === 'project_start') return undefined;
  return { type: 'overdue_milestone', severity: 'critical', label: `${kind === 'project_deadline' ? 'Deadline' : 'Milestone'} overdue by ${days} day${days === 1 ? '' : 's'}`, date, priority: 2 };
}

export function normalizeProjectDates(projects: MobileProjectsProject[], milestones: MobileProjectsMilestone[], today = localDateKey()) {
  const dates: MobileProjectDate[] = [];
  for (const project of projects) {
    const completed = String(project.status ?? '').toLowerCase().includes('complete') || Number(project.completeness ?? 0) >= 100;
    const deadline = dateKey(project.end_date);
    if (deadline) dates.push({ id: `deadline:${project.id}`, projectId: project.id, title: project.name, date: deadline, kind: 'project_deadline', completed, projectTitle: project.name, projectColor: project.color, attention: completed ? undefined : project.attention?.type === 'deadline_approaching' ? project.attention : overdueAttention(deadline, today, 'project_deadline') });
    const start = dateKey(project.start_date);
    if (start && start >= today && !completed && !/paused|hold|archived/.test(String(project.status ?? '').toLowerCase())) dates.push({ id: `start:${project.id}`, projectId: project.id, title: project.name, date: start, kind: 'project_start', completed: false, projectTitle: project.name, projectColor: project.color });
  }
  const projectById = new Map(projects.map((project) => [project.id, project]));
  for (const milestone of milestones) {
    const date = dateKey(milestone.milestone_date);
    const project = milestone.project_id ? projectById.get(milestone.project_id) : null;
    if (!date || !milestone.project_id || !project) continue;
    dates.push({ id: `milestone:${milestone.id}`, projectId: project.id, title: milestone.title, date, kind: 'milestone', completed: Boolean(milestone.completed), projectTitle: project.name, projectColor: project.color, attention: !milestone.completed && date < today ? overdueAttention(date, today, 'milestone') : undefined });
  }
  return dates;
}

function projectDateMatchesFilters(item: MobileProjectDate, project: MobileProjectsProject | undefined, filters: ProjectFilterState) {
  if (filters.date.length && !filters.date.some((filter) => matchesProjectDate(item.date, filter))) return false;
  if (!project) return !filters.status.length && !filters.ownership && !filters.progress.length;
  if (item.completed && filters.status.includes('completed')) {
    if (filters.ownership && !(project.owned_by_current_user || project.assigned_to_current_user)) return false;
    return true;
  }
  return matchesProjectFilters(project, { ...filters, attention: [], date: [] });
}

export function filterProjectDates(items: MobileProjectDate[], projects: MobileProjectsProject[], filters: ProjectFilterState) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return items.filter((item) => {
    if (filters.status.includes('completed') && !item.completed && filters.status.length === 1) return false;
    if (!filters.status.includes('completed') && item.completed) return false;
    if (!projectDateMatchesFilters(item, projectById.get(item.projectId), filters)) return false;
    if (filters.attention.length) {
      const type = item.attention?.type;
      const matches = filters.attention.some((filter) => filter === 'overdue' ? type === 'overdue_milestone' : filter === 'attention' ? Boolean(item.attention) : false);
      if (!matches) return false;
    }
    return true;
  });
}

export type MobileProjectDateGroup = { key: string; title: string; items: MobileProjectDate[]; completed?: boolean };

export function groupProjectDates(items: MobileProjectDate[], today = localDateKey()): MobileProjectDateGroup[] {
  const active = items.filter((item) => !item.completed);
  const completed = items.filter((item) => item.completed).sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map<string, MobileProjectDate[]>();
  for (const item of active) {
    const difference = dayDifference(item.date, today);
    const key = difference < 0 ? 'overdue' : difference === 0 ? 'today' : item.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const result: MobileProjectDateGroup[] = [];
  if (groups.has('overdue')) result.push({ key: 'overdue', title: 'Overdue', items: groups.get('overdue')!.sort((a, b) => a.date.localeCompare(b.date)) });
  if (groups.has('today')) result.push({ key: 'today', title: 'Today', items: groups.get('today')! });
  [...groups.keys()].filter((key) => key !== 'overdue' && key !== 'today').sort().forEach((key) => result.push({ key, title: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(`${key}-15T12:00:00`)), items: groups.get(key)!.sort((a, b) => a.date.localeCompare(b.date)) }));
  if (completed.length) result.push({ key: 'completed', title: 'Completed', items: completed, completed: true });
  return result;
}

export function projectDateLabel(item: MobileProjectDate, today = localDateKey()) {
  const difference = dayDifference(item.date, today);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  if (difference < 0 && Math.abs(difference) <= 7) return `${Math.abs(difference)} day${Math.abs(difference) === 1 ? '' : 's'} overdue`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: item.date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }).format(new Date(`${item.date}T12:00:00`));
}
