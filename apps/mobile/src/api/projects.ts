import { mobileRequest } from './client';

export type ProjectAttentionType = 'overdue_action' | 'blocked' | 'overdue_milestone' | 'deadline_approaching' | 'missing_next_action' | 'stale' | 'explicit';
export type ProjectAttentionSeverity = 'critical' | 'warning' | 'info';
export type ProjectAttention = {
  type: ProjectAttentionType;
  severity: ProjectAttentionSeverity;
  label: string;
  date?: string;
  count?: number;
  priority?: number;
};
export type MobileProjectAttention = ProjectAttention;

export type MobileProjectsProject = {
  id: string;
  workspace_id: string;
  workspace_name?: string | null;
  name: string;
  description?: string | null;
  project_type?: string | null;
  status?: string | null;
  completeness?: number | null;
  color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  next_action?: string | null;
  attention_reason?: string | null;
  attention?: ProjectAttention | null;
  owned_by_current_user?: boolean;
  assigned_to_current_user?: boolean;
  updated_at?: string | null;
};

export type MobileProjectsMilestone = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  project_name?: string | null;
  title: string;
  milestone_date?: string | null;
  type?: string | null;
  completed?: boolean;
  updated_at?: string | null;
};

export type MobileProjectsResponse = {
  workspace_id: string;
  projects: MobileProjectsProject[];
  milestones: MobileProjectsMilestone[];
};

export type CreateMobileProjectInput = {
  name: string;
  workspace_id?: string;
  status?: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  color?: string | null;
  lead_id?: string | null;
};

export type UpdateMobileProjectInput = Partial<Omit<CreateMobileProjectInput, 'workspace_id'>> & { completeness?: number | null };

export function createMobileProject(workspaceId: string, payload: CreateMobileProjectInput) {
  return mobileRequest<MobileProjectsProject>('/api/projects', { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ ...payload, workspace_id: workspaceId }) });
}

export function updateMobileProject(workspaceId: string, projectId: string, payload: UpdateMobileProjectInput) {
  return mobileRequest<MobileProjectsProject>(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify(payload) });
}

export function deleteMobileProject(workspaceId: string, projectId: string) {
  return mobileRequest<{ success: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
}

export type CreateMobileMilestoneInput = { title: string; milestone_date: string; note?: string | null; completed?: boolean };

export function createMobileProjectMilestone(workspaceId: string, projectId: string, payload: CreateMobileMilestoneInput) {
  return mobileRequest<MobileProjectsMilestone>(`/api/projects/${encodeURIComponent(projectId)}/milestones`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify(payload) });
}

export function getMobileProjects(workspaceId: string, includeCompleted = true) {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (includeCompleted) params.set('include_completed', 'true');
  return mobileRequest<MobileProjectsResponse>(`/api/mobile/projects?${params.toString()}`);
}

export function updateMobileProjectMilestone(workspaceId: string, milestoneId: string, payload: { completed?: boolean; milestone_date?: string; note?: string | null }) {
  return mobileRequest(`/api/project-milestones/${encodeURIComponent(milestoneId)}`, {
    method: 'PATCH',
    headers: { 'x-workspace-id': workspaceId },
    body: JSON.stringify(payload),
  });
}

export function deleteMobileProjectMilestone(workspaceId: string, milestoneId: string) {
  return mobileRequest(`/api/project-milestones/${encodeURIComponent(milestoneId)}`, {
    method: 'DELETE',
    headers: { 'x-workspace-id': workspaceId },
  });
}
