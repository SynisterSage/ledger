import type { MobileProjectsProject } from '@/api/projects';

export type ProjectStatusFilter = 'planned' | 'active' | 'hold' | 'completed' | 'archived';
export type ProjectAttentionFilter = 'attention' | 'overdue' | 'missing_next_action' | 'blocked' | 'stale';
export type ProjectDateFilter = 'soon' | 'today' | 'week' | 'month' | 'none';
export type ProjectProgressFilter = 'not_started' | 'in_progress' | 'nearly_complete' | 'complete';
export type ProjectSort = 'attention' | 'due' | 'updated' | 'progress' | 'name';

export type ProjectFilterState = {
  status: ProjectStatusFilter[];
  attention: ProjectAttentionFilter[];
  ownership: 'mine' | null;
  date: ProjectDateFilter[];
  progress: ProjectProgressFilter[];
  sort: ProjectSort;
  progressDescending: boolean;
};

export const DEFAULT_PROJECT_FILTERS: ProjectFilterState = {
  status: [], attention: [], ownership: null, date: [], progress: [], sort: 'attention', progressDescending: true,
};

export function isCompletedProject(project: MobileProjectsProject) {
  return String(project.status ?? '').toLowerCase().includes('complete') || Number(project.completeness ?? 0) >= 100;
}

function isArchivedProject(project: MobileProjectsProject) {
  return String(project.status ?? '').toLowerCase().includes('archived');
}

function statusMatches(project: MobileProjectsProject, filters: ProjectStatusFilter[]) {
  if (!filters.length) return !isCompletedProject(project) && !isArchivedProject(project);
  const status = String(project.status ?? '').toLowerCase();
  return filters.some((filter) => {
    if (filter === 'completed') return isCompletedProject(project);
    if (filter === 'hold') return /paused|hold/.test(status);
    if (filter === 'archived') return status.includes('archived');
    if (filter === 'planned') return /notstarted|not_started|planned|todo/.test(status);
    return /inprogress|in_progress|active|doing/.test(status) && !isCompletedProject(project);
  });
}

function attentionMatches(project: MobileProjectsProject, filter: ProjectAttentionFilter) {
  const reason = String(project.attention_reason ?? '').toLowerCase();
  const status = String(project.status ?? '').toLowerCase();
  const type = project.attention?.type;
  if (filter === 'attention') return Boolean(project.attention || project.attention_reason);
  if (filter === 'overdue') return type === 'overdue_action' || type === 'overdue_milestone' || reason.includes('overdue');
  if (filter === 'missing_next_action') return type === 'missing_next_action' || reason.includes('next action');
  if (filter === 'blocked') return type === 'blocked' || reason.includes('blocked') || status.includes('blocked');
  return type === 'stale' || reason.includes('stale');
}

export function matchesProjectDate(value: string | null | undefined, filter: ProjectDateFilter) {
  if (filter === 'none') return !value;
  if (!value) return false;
  const today = new Date();
  const due = new Date(`${value.slice(0, 10)}T12:00:00`);
  const todayKey = today.toISOString().slice(0, 10);
  if (filter === 'today') return value.slice(0, 10) === todayKey;
  const days = filter === 'soon' ? 14 : filter === 'week' ? 7 : 31;
  return due.getTime() >= today.getTime() - 86400000 && due.getTime() <= today.getTime() + days * 86400000;
}

function dateMatches(project: MobileProjectsProject, filter: ProjectDateFilter) {
  return matchesProjectDate(project.end_date, filter);
}

function progressMatches(project: MobileProjectsProject, filter: ProjectProgressFilter) {
  if (typeof project.completeness !== 'number' || !Number.isFinite(project.completeness)) return false;
  const progress = Math.max(0, Math.min(100, project.completeness));
  if (filter === 'not_started') return progress === 0;
  if (filter === 'in_progress') return progress > 0 && progress < 90;
  if (filter === 'nearly_complete') return progress >= 90 && progress < 100;
  return progress >= 100 || isCompletedProject(project);
}

export function matchesProjectFilters(project: MobileProjectsProject, filters: ProjectFilterState) {
  return statusMatches(project, filters.status)
    && (!filters.ownership || project.owned_by_current_user || project.assigned_to_current_user)
    && (!filters.attention.length || filters.attention.some((filter) => attentionMatches(project, filter)))
    && (!filters.date.length || filters.date.some((filter) => dateMatches(project, filter)))
    && (!filters.progress.length || filters.progress.some((filter) => progressMatches(project, filter)));
}

function attentionRank(project: MobileProjectsProject) {
  if (project.attention) {
    const severityRank = project.attention.severity === 'critical' ? 0 : project.attention.severity === 'warning' ? 1 : 2;
    return severityRank * 10 + (project.attention.priority ?? 9);
  }
  const reason = String(project.attention_reason ?? '').toLowerCase();
  if (reason.includes('overdue')) return 0;
  if (reason.includes('blocked')) return 1;
  if (reason.includes('next action')) return 2;
  if (reason) return 3;
  return 4;
}

export function sortProjects(projects: MobileProjectsProject[], filters: ProjectFilterState) {
  return [...projects].sort((left, right) => {
    if (filters.sort === 'attention') {
      const rank = attentionRank(left) - attentionRank(right);
      if (rank) return rank;
      const attentionDate = (left.attention?.date ?? '9999-12-31').localeCompare(right.attention?.date ?? '9999-12-31');
      if (attentionDate) return attentionDate;
    }
    if (filters.sort === 'due' || filters.sort === 'attention') {
      const due = (left.end_date ?? '9999-12-31').localeCompare(right.end_date ?? '9999-12-31');
      if (due) return due;
    }
    if (filters.sort === 'updated') {
      const updated = String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? ''));
      if (updated) return updated;
    }
    if (filters.sort === 'progress') {
      const progress = (Number(right.completeness ?? 0) - Number(left.completeness ?? 0)) * (filters.progressDescending ? 1 : -1);
      if (progress) return progress;
    }
    return left.name.localeCompare(right.name);
  });
}

export function projectFilterCount(filters: ProjectFilterState) {
  return filters.status.length + filters.attention.length + (filters.ownership ? 1 : 0) + filters.date.length + filters.progress.length + (filters.sort !== 'attention' ? 1 : 0);
}

export function projectFilterSummary(filters: ProjectFilterState) {
  const labels = [
    ...filters.status.map((value) => value === 'hold' ? 'On hold' : value[0].toUpperCase() + value.slice(1)),
    ...filters.attention.map((value) => value === 'missing_next_action' ? 'Missing next action' : value[0].toUpperCase() + value.slice(1)),
    filters.ownership === 'mine' ? 'Mine' : null,
    ...filters.date.map((value) => value === 'soon' ? 'Due soon' : value === 'week' ? 'Due this week' : value === 'month' ? 'Due this month' : value === 'none' ? 'No due date' : 'Due today'),
    ...filters.progress.map((value) => value === 'not_started' ? 'Not started' : value === 'in_progress' ? 'In progress' : value === 'nearly_complete' ? 'Nearly complete' : 'Complete'),
    filters.sort !== 'attention' ? `Sort: ${filters.sort}` : null,
  ].filter(Boolean) as string[];
  return labels.join(' · ');
}
