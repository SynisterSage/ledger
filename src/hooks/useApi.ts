import { useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useWorkspaceContext } from '../context/WorkspaceContext';
import { DEFAULT_API_URL } from '../config/runtime';
import { getInviteBaseUrl } from '../config/invite';
import { buildLedgerSessionHeaders } from '../utils/deviceSession';
import type { PinFolder, PinObjectType, PinRecord } from '../utils/pins';
import authService from '../services/auth';

const API_URL = import.meta.env.VITE_API_URL?.trim() || DEFAULT_API_URL;

type ApiRequestOptions = RequestInit & {
  skipJson?: boolean;
  skipWorkspaceHeader?: boolean;
};

export const useApi = () => {
  const { session } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();

  const normalizeNameKey = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toLowerCase();

  const dedupeProjects = <T extends { id?: string; name?: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = normalizeNameKey(item?.name);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const dedupeById = <T extends { id?: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item?.id) return true;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };

  const localDayKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const request = async (endpoint: string, options: ApiRequestOptions = {}) => {
    const buildHeaders = (token: string | null) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (!options.skipWorkspaceHeader && activeWorkspaceId && endpoint.startsWith('/api/')) {
        headers['X-Workspace-Id'] = activeWorkspaceId;
      }

      if (endpoint.includes('/api/daily-accountability')) {
        headers['X-Ledger-Day-Key'] = localDayKey();
      }

      return headers;
    };

    const executeRequest = async (token: string | null) => {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: buildHeaders(token),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const requestError = new Error(error.error || `Request failed: ${response.status}`) as Error & {
          status?: number;
        };
        requestError.status = response.status;
        throw requestError;
      }

      if (options.skipJson) {
        return null;
      }

      return response.json();
    };

    const currentToken = session?.access_token ?? null;

    try {
      return await executeRequest(currentToken);
    } catch (error) {
      const isUnauthorized = error instanceof Error && /invalid token|missing token|401/i.test(error.message);
      if (!isUnauthorized || !currentToken) {
        throw error;
      }

      const refreshedSession = await authService.refreshSession();
      const refreshedToken = refreshedSession?.access_token ?? null;
      if (!refreshedToken || refreshedToken === currentToken) {
        throw error;
      }

      return executeRequest(refreshedToken);
    }
  };

  return useMemo(
    () => ({
      // User
      getOnboardingStatus: () => request('/api/user/onboarding'),
      completeOnboarding: () => request('/api/user/onboarding', { method: 'PATCH' }),
      getUserSettings: () => request('/api/user/settings'),
      deleteAccount: () =>
        request('/api/account', {
          method: 'DELETE',
          skipWorkspaceHeader: true,
          body: JSON.stringify({ confirmed: true }),
        }),
      updateUserSettings: (payload: {
        full_name?: string | null;
        preferences?: Record<string, unknown>;
      }) =>
        request('/api/user/settings', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      getNotificationPreferences: () => request('/api/notifications/preferences'),
      updateNotificationPreferences: (payload: Record<string, unknown>) =>
        request('/api/notifications/preferences', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      checkNotifications: () => request('/api/notifications/check'),
      getNotificationCenterSummary: () => request('/api/notifications/summary'),
      getNotificationCenter: () => request('/api/notifications'),
      updateNotificationAction: (
        notificationId: string,
        action: 'open' | 'dismiss' | 'complete' | 'snooze',
        payload?: { snooze_until?: string }
      ) =>
        request(`/api/notifications/${notificationId}/action`, {
          method: 'POST',
          body: JSON.stringify({ action, ...(payload ?? {}) }),
        }),

      // Sessions
      getAccountSessions: () =>
        request('/api/account/sessions', {
          skipWorkspaceHeader: true,
          headers: buildLedgerSessionHeaders(),
        }),
      heartbeatAccountSession: () =>
        request('/api/account/sessions/heartbeat', {
          method: 'POST',
          skipWorkspaceHeader: true,
          headers: buildLedgerSessionHeaders(),
        }),

      // Workspaces
      getWorkspaces: () => request('/api/workspaces'),
      getActiveWorkspace: () => request('/api/workspaces/active'),
      setActiveWorkspace: (workspaceId: string) =>
        request('/api/workspaces/active', {
          method: 'PATCH',
          body: JSON.stringify({ workspace_id: workspaceId }),
        }),
      getWorkspaceMembers: (workspaceId: string) =>
        request(`/api/workspaces/${workspaceId}/members`),
      updateWorkspaceMemberRole: (
        workspaceId: string,
        userId: string,
        role: 'admin' | 'member' | 'viewer'
      ) =>
        request(`/api/workspaces/${workspaceId}/members/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        }),
      removeWorkspaceMember: (workspaceId: string, userId: string) =>
        request(`/api/workspaces/${workspaceId}/members/${userId}`, {
          method: 'DELETE',
        }),
      getWorkspaceInvitations: (workspaceId: string) =>
        request(`/api/workspaces/${workspaceId}/invitations`),
      createWorkspace: (payload: {
        name: string;
        description?: string | null;
        is_personal?: boolean;
        color?: string;
      }) =>
        request('/api/workspaces', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateWorkspace: (
        workspaceId: string,
        payload: { name?: string; description?: string | null; is_personal?: boolean }
      ) =>
        request(`/api/workspaces/${workspaceId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      deleteWorkspace: (workspaceId: string) =>
        request(`/api/workspaces/${workspaceId}`, {
          method: 'DELETE',
        }),
      createWorkspaceInvitation: (
        workspaceId: string,
        payload: { email?: string | null; role?: 'admin' | 'member'; origin?: string }
      ) =>
        request(`/api/workspaces/${workspaceId}/invitations`, {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            origin: payload.origin ?? getInviteBaseUrl(),
          }),
        }),
      revokeWorkspaceInvitation: (workspaceId: string, invitationId: string) =>
        request(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
          method: 'DELETE',
        }),
      acceptWorkspaceInvitation: (token: string) =>
        request('/api/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({ token }),
        }),
      getWorkspaceInvitation: (token: string) =>
        request(`/api/invitations/${encodeURIComponent(token)}`, {
          skipWorkspaceHeader: true,
        }),

      // Integrations
      getSlackIntegrationStatus: (workspaceId: string) =>
        request(`/api/integrations/slack/status?workspaceId=${encodeURIComponent(workspaceId)}`, {
          skipWorkspaceHeader: true,
        }),
      getSlackCaptures: (workspaceId: string) =>
        request(`/api/integrations/slack/captures?workspaceId=${encodeURIComponent(workspaceId)}`, {
          skipWorkspaceHeader: true,
        }),
      getSlackInstallUrl: (workspaceId: string) =>
        request(
          `/api/integrations/slack/install-url?workspaceId=${encodeURIComponent(workspaceId)}`,
          {
            skipWorkspaceHeader: true,
          }
        ),
      disconnectSlackIntegration: (workspaceId: string) =>
        request(`/api/integrations/slack/disconnect?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: 'DELETE',
          skipWorkspaceHeader: true,
        }),
      getFigmaIntegrationStatus: (workspaceId: string) =>
        request(`/api/integrations/figma/status?workspaceId=${encodeURIComponent(workspaceId)}`, {
          skipWorkspaceHeader: true,
        }),
      getFigmaAutomationSettings: (workspaceId: string) =>
        request(`/api/integrations/figma/automation?workspaceId=${encodeURIComponent(workspaceId)}`),
      updateFigmaAutomationSettings: (workspaceId: string, body: unknown) =>
        request(`/api/integrations/figma/automation?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      getFigmaInstallUrl: (workspaceId: string) =>
        request(`/api/integrations/figma/install-url?workspaceId=${encodeURIComponent(workspaceId)}`, {
          skipWorkspaceHeader: true,
        }),
      disconnectFigmaIntegration: (workspaceId: string) =>
        request(`/api/integrations/figma/disconnect?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: 'DELETE',
          skipWorkspaceHeader: true,
        }),
      getFigmaPrivacySettings: () => request('/api/integrations/figma/privacy'),
      acceptFigmaPrivacySettings: () => request('/api/integrations/figma/privacy/accept', { method: 'POST' }),
      removeFigmaWorkspaceData: (workspaceName: string) => request('/api/integrations/figma/data/remove', { method: 'POST', body: JSON.stringify({ workspace_name: workspaceName }) }),
      approveFigmaPluginAuthorization: (sessionId: string, verificationCode: string) => request('/api/figma-plugin/auth/approve', { method: 'POST', body: JSON.stringify({ session_id: sessionId, verification_code: verificationCode }) }),
      parseExternalReferenceUrl: (provider: string, url: string) =>
        request('/api/external-references/parse', {
          method: 'POST',
          body: JSON.stringify({ provider, url }),
        }),
      createExternalReference: (provider: string, url: string) =>
        request('/api/external-references', {
          method: 'POST',
          body: JSON.stringify({ provider, url }),
        }),
      resolveExternalReference: (referenceId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/resolve`, {
          method: 'POST',
        }),
      linkExternalReference: (referenceId: string, targetType: string, targetId: string, source = 'manual') =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/links`, {
          method: 'POST',
          body: JSON.stringify({ target_type: targetType, target_id: targetId, source }),
        }),
      unlinkExternalReference: (referenceId: string, linkId: string, source?: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/links/${encodeURIComponent(linkId)}${source ? `?source=${encodeURIComponent(source)}` : ''}`, {
          method: 'DELETE',
        }),
      getExternalReferencesForTarget: (targetType: string, targetId: string) =>
        request(`/api/external-references?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`),
      getExternalReferencePreview: (referenceId: string, targetType: string, targetId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/preview?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`),
      getExternalReferenceChangeState: (referenceId: string, targetType: string, targetId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/change-state?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`),
      checkExternalReferenceChangeState: (referenceId: string, targetType: string, targetId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/change-state?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`),
      searchExternalReferences: (query = '') =>
        request(`/api/external-references/search?provider=figma&query=${encodeURIComponent(query)}`),
      getExternalReferenceLinkedTargets: (referenceId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/linked-targets`),
      deleteExternalReferencePreview: (referenceId: string, targetType: string, targetId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/preview`, { method: 'DELETE', body: JSON.stringify({ target_type: targetType, target_id: targetId }) }),
      createExternalReferencePreview: (referenceId: string, targetType: string, targetId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/preview`, {
          method: 'POST',
          body: JSON.stringify({ target_type: targetType, target_id: targetId }),
        }),
      refreshExternalReferencePreview: (referenceId: string, targetType: string, targetId: string) =>
        request(`/api/external-references/${encodeURIComponent(referenceId)}/preview/refresh`, {
          method: 'POST',
          body: JSON.stringify({ target_type: targetType, target_id: targetId }),
        }),
      getExtensionTokenStatus: (workspaceId: string) =>
        request(`/api/extension/token/status?workspaceId=${encodeURIComponent(workspaceId)}`, {
          skipWorkspaceHeader: true,
        }),
      createExtensionToken: (workspaceId: string) =>
        request(`/api/extension/token?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: 'POST',
          skipWorkspaceHeader: true,
        }),
      regenerateExtensionToken: (workspaceId: string) =>
        request(`/api/extension/token/regenerate?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: 'POST',
          skipWorkspaceHeader: true,
        }),
      revokeExtensionToken: (workspaceId: string) =>
        request(`/api/extension/token/revoke?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: 'POST',
          skipWorkspaceHeader: true,
        }),

      // Inbox
      getInboxCount: () => request('/api/inbox/count', { skipWorkspaceHeader: true }),
      getInboxItems: (options?: { status?: string; source?: string }) => {
        const params = new URLSearchParams();
        if (options?.status) params.set('status', options.status);
        if (options?.source) params.set('source', options.source);
        const query = params.toString();
        return request(`/api/inbox${query ? `?${query}` : ''}`, { skipWorkspaceHeader: true });
      },
      archiveIntakeItem: (id: string) =>
        request(`/api/inbox/${id}/archive`, {
          method: 'POST',
          skipWorkspaceHeader: true,
        }),
      restoreIntakeItem: (id: string) =>
        request(`/api/inbox/${id}/restore`, {
          method: 'POST',
          skipWorkspaceHeader: true,
        }),
      snoozeIntakeItem: (id: string, snoozedUntil: string) =>
        request(`/api/inbox/${id}/snooze`, {
          method: 'POST',
          body: JSON.stringify({ snoozed_until: snoozedUntil }),
          skipWorkspaceHeader: true,
        }),
      deleteIntakeItem: (id: string) =>
        request(`/api/inbox/${id}`, {
          method: 'DELETE',
          skipWorkspaceHeader: true,
        }),
      convertIntakeItem: (
        id: string,
        payload: {
          type: 'task' | 'note' | 'reminder' | 'event' | 'project';
          title?: string;
          body?: string | null;
          project_id?: string | null;
          note_id?: string | null;
          calendar_id?: string | null;
          assigned_to_user_id?: string | null;
          assigned_to_team_id?: string | null;
          assigned_team_id?: string | null;
          assigned_to?: string | null;
          due_date?: string | null;
          due_time?: string | null;
          remind_at?: string | null;
          start_at?: string | null;
          end_at?: string | null;
          all_day?: boolean;
          color?: string | null;
          status?: string | null;
          tags?: string[];
          task_horizon?: 'today' | 'long_term';
          show_in_today?: boolean;
          is_today_focus?: boolean;
          recurrence_rule?: string | null;
          location?: string | null;
          notes?: string | null;
          description?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          section_id?: string | null;
          project_type?: string | null;
          lead_id?: string | null;
          owner_team_id?: string | null;
        }
      ) =>
        request(`/api/inbox/${id}/convert`, {
          method: 'POST',
          body: JSON.stringify(payload),
          skipWorkspaceHeader: true,
        }),
      createIntakeItem: (payload: {
        workspace_id: string;
        source: 'quick_capture' | 'browser' | 'meeting' | 'calendar' | 'manual' | 'system_suggestion';
        source_provider?: string | null;
        suggested_type?: 'task' | 'note' | 'event' | 'reminder' | 'deadline' | 'project' | 'milestone' | 'capture';
        title: string;
        body?: string | null;
        raw_content?: string | null;
        reason?: string | null;
        suggested_project_id?: string | null;
        suggested_team_id?: string | null;
        suggested_assignee_id?: string | null;
        suggested_calendar_id?: string | null;
        suggested_note_section_id?: string | null;
        suggested_date?: string | null;
        suggested_due_date?: string | null;
        suggested_due_at?: string | null;
        suggested_start_at?: string | null;
        suggested_end_at?: string | null;
        source_object_type?: string | null;
        source_object_id?: string | null;
      }) =>
        request('/api/intake', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),

      // Projects
      getProjects: (options?: { includeCompleted?: boolean }) => {
        const params = new URLSearchParams();
        if (options?.includeCompleted) {
          params.set('includeCompleted', 'true');
        }
        const query = params.toString();
        return request(`/api/projects${query ? `?${query}` : ''}`).then((data) => {
          if (!Array.isArray(data)) return data;
          return dedupeProjects(data);
        });
      },
      createProject: (
        input:
          | string
          | {
              name: string;
              description?: string | null;
              color?: string;
              start_date?: string | null;
              end_date?: string | null;
              status?: string;
              project_type?: string | null;
              lead_id?: string | null;
              owner_team_id?: string | null;
            }
      ) => {
        const payload = typeof input === 'string' ? { name: input } : input;
        return request('/api/projects', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },
      updateProject: (
        id: string,
        update: {
          name?: string;
          description?: string | null;
          status?: string;
          completeness?: number;
          color?: string;
          start_date?: string | null;
          end_date?: string | null;
          project_type?: string | null;
          lead_id?: string | null;
          owner_team_id?: string | null;
        }
      ) =>
        request(`/api/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        }),
      deleteProject: (id: string) =>
        request(`/api/projects/${id}`, {
          method: 'DELETE',
        }),
      getProjectNoteLinks: (projectId: string) => request(`/api/projects/${projectId}/note-links`),
      getWorkspaceProjectNoteLinks: (workspaceId: string) =>
        request(`/api/workspaces/${workspaceId}/project-note-links`),
      linkProjectNote: (projectId: string, noteId: string) =>
        request(`/api/projects/${projectId}/note-links`, {
          method: 'POST',
          body: JSON.stringify({ note_id: noteId }),
        }),
      unlinkProjectNote: (projectId: string, noteId: string) =>
        request(`/api/projects/${projectId}/note-links/${noteId}`, {
          method: 'DELETE',
        }),
      getProjectMilestones: (projectId: string) =>
        request(`/api/projects/${projectId}/milestones`).then((data) => {
          if (!Array.isArray(data)) return data;
          return dedupeById(data);
        }),
      getWorkspaceProjectMilestones: () =>
        request('/api/project-milestones').then((data) => {
          if (!Array.isArray(data)) return data;
          return dedupeById(data);
        }),
      createProjectMilestone: (
        projectId: string,
        payload: {
          title: string;
          milestone_date: string;
          type?: string;
          note?: string | null;
          completed?: boolean;
          linked_note_id?: string | null;
          linked_reminder_id?: string | null;
          linked_event_id?: string | null;
          assigned_to_user_id?: string | null;
          assigned_team_id?: string | null;
          assigned_to_team_id?: string | null;
        }
      ) =>
        request(`/api/projects/${projectId}/milestones`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateProjectMilestone: (
        id: string,
        payload: {
          title?: string;
          milestone_date?: string;
          type?: string;
          note?: string | null;
          completed?: boolean;
          project_id?: string;
          linked_note_id?: string | null;
          linked_reminder_id?: string | null;
          linked_event_id?: string | null;
          assigned_to_user_id?: string | null;
          assigned_team_id?: string | null;
          assigned_to_team_id?: string | null;
        }
      ) =>
        request(`/api/project-milestones/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      deleteProjectMilestone: (id: string) =>
        request(`/api/project-milestones/${id}`, {
          method: 'DELETE',
        }),

      // Tasks
      getTasks: (options?: { projectId?: string }) => {
        const params = new URLSearchParams();
        if (options?.projectId) {
          params.set('projectId', options.projectId);
        }
        const query = params.toString();
        return request(`/api/tasks${query ? `?${query}` : ''}`).then((data) => {
          if (!Array.isArray(data)) return data;
          return dedupeById(data);
        });
      },
      // Today (scoped to the active workspace when available)
      getToday: () => request('/api/today'),
      createTask: (payload: {
        title: string;
        description?: string | null;
        notes?: string | null;
        due_date?: string | null;
        due_time?: string | null;
        status?: string;
        priority?: string;
        assigned_to?: string | null;
        assigned_to_user_id?: string | null;
        assigned_team_id?: string | null;
        assigned_to_team_id?: string | null;
        tags?: string[];
        task_horizon?: 'today' | 'long_term';
        project_id?: string | null;
        milestone_id?: string | null;
        show_in_today?: boolean;
        is_today_focus?: boolean;
      }) =>
        request('/api/tasks', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateTask: (id: string, update: Record<string, unknown>) =>
        request(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        }),
      updateTaskInWorkspace: (id: string, workspaceId: string, update: Record<string, unknown>) =>
        request(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
          // skip the automatic active workspace header and send the correct workspace header
          skipWorkspaceHeader: true,
          headers: { 'X-Workspace-Id': workspaceId },
        }),
      deleteTask: (id: string) =>
        request(`/api/tasks/${id}`, {
          method: 'DELETE',
        }),
      deleteTaskInWorkspace: (id: string, workspaceId: string) =>
        request(`/api/tasks/${id}`, {
          method: 'DELETE',
          skipWorkspaceHeader: true,
          headers: { 'X-Workspace-Id': workspaceId },
        }),

      // Teams
      getTeams: (options?: { includeArchived?: boolean }) => {
        const params = new URLSearchParams();
        if (options?.includeArchived) params.set('include_archived', 'true');
        const query = params.toString();
        return request(`/api/teams${query ? `?${query}` : ''}`);
      },
      getTeamOverview: (teamId: string) => request(`/api/teams/${teamId}/overview`),
      getTeam: (teamId: string) => request(`/api/teams/${teamId}`),
      getTeamMembers: (teamId: string) => request(`/api/teams/${teamId}/members`),
      updateTeamMember: (
        teamId: string,
        userId: string,
        payload: { role?: 'lead' | 'member' | 'viewer' }
      ) =>
        request(`/api/teams/${teamId}/members/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      getTeamTasks: (
        teamId: string,
        options?: {
          status?: string;
          task_type?: string;
          assignee?: string;
          project_id?: string;
          priority?: string;
          due?: string;
          search?: string;
          sort?: string;
          limit?: number;
          page?: number;
          cursor?: string;
        }
      ) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options ?? {})) {
          if (value === undefined || value === null || value === '') continue;
          params.set(key, String(value));
        }
        const query = params.toString();
        return request(`/api/teams/${teamId}/tasks${query ? `?${query}` : ''}`);
      },
      getTeamProjects: (
        teamId: string,
        options?: { status?: string; lead?: string; search?: string; sort?: string }
      ) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options ?? {})) {
          if (value === undefined || value === null || value === '') continue;
          params.set(key, String(value));
        }
        const query = params.toString();
        return request(`/api/teams/${teamId}/projects${query ? `?${query}` : ''}`);
      },
      getTeamMilestones: (
        teamId: string,
        options?: { status?: string; project_id?: string; date_from?: string; date_to?: string }
      ) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options ?? {})) {
          if (value === undefined || value === null || value === '') continue;
          params.set(key, String(value));
        }
        const query = params.toString();
        return request(`/api/teams/${teamId}/milestones${query ? `?${query}` : ''}`);
      },
      getTeamNotes: (
        teamId: string,
        options?: {
          search?: string;
          project_id?: string;
          created_by?: string;
          section?: string;
          recent?: boolean;
          updated_after?: string;
          limit?: number;
        }
      ) => {
        const params = new URLSearchParams();
        if (options?.search) params.set('search', options.search);
        if (options?.project_id) params.set('project_id', options.project_id);
        if (options?.created_by) params.set('created_by', options.created_by);
        if (options?.section) params.set('section', options.section);
        if (options?.recent) params.set('recent', 'true');
        if (options?.updated_after) params.set('updated_after', options.updated_after);
        if (options?.limit) params.set('limit', String(options.limit));
        const query = params.toString();
        return request(`/api/teams/${teamId}/notes${query ? `?${query}` : ''}`);
      },
      getTeamCalendar: (
        teamId: string,
        options?: {
          start?: string;
          end?: string;
          event_type?: string;
          project_id?: string;
          assignee?: string;
          owner?: string;
        }
      ) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options ?? {})) {
          if (value === undefined || value === null || value === '') continue;
          params.set(key, String(value));
        }
        const query = params.toString();
        return request(`/api/teams/${teamId}/calendar${query ? `?${query}` : ''}`);
      },
      getTeamIntake: (
        teamId: string,
        options?: {
          status?: string;
          source?: string;
          suggested_type?: string;
          assignee?: string;
          search?: string;
          created_after?: string;
        }
      ) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options ?? {})) {
          if (value === undefined || value === null || value === '') continue;
          params.set(key, String(value));
        }
        const query = params.toString();
        return request(`/api/teams/${teamId}/intake${query ? `?${query}` : ''}`);
      },
      getTeamActivity: (
        teamId: string,
        options?: { limit?: number; page?: number; cursor?: string }
      ) => {
        const params = new URLSearchParams();
        if (options?.limit) params.set('limit', String(options.limit));
        if (options?.page) params.set('page', String(options.page));
        if (options?.cursor) params.set('cursor', options.cursor);
        const query = params.toString();
        return request(`/api/teams/${teamId}/activity${query ? `?${query}` : ''}`);
      },
      linkTeamNote: (teamId: string, noteId: string) =>
        request(`/api/teams/${teamId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ note_id: noteId }),
        }),
      unlinkTeamNote: (teamId: string, noteId: string) =>
        request(`/api/teams/${teamId}/notes/${noteId}`, {
          method: 'DELETE',
        }),
      createTeam: (payload: {
        name: string;
        identifier?: string | null;
        description?: string | null;
        color?: string | null;
        member_ids?: string[];
        default_task_scope?: 'long_term' | 'today';
        default_project_visibility?: 'workspace' | 'team';
        default_assignee_behavior?: 'team' | 'lead';
      }) =>
        request('/api/teams', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateTeam: (
        teamId: string,
        payload: {
          name?: string;
          identifier?: string;
          description?: string | null;
          color?: string | null;
          default_task_scope?: 'long_term' | 'today';
          default_project_visibility?: 'workspace' | 'team';
          default_assignee_behavior?: 'team' | 'lead';
        }
      ) =>
        request(`/api/teams/${teamId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      archiveTeam: (teamId: string) =>
        request(`/api/teams/${teamId}/archive`, {
          method: 'POST',
        }),
      restoreTeam: (teamId: string) =>
        request(`/api/teams/${teamId}/unarchive`, {
          method: 'POST',
        }),
      deleteTeam: (teamId: string) =>
        request(`/api/teams/${teamId}`, {
          method: 'DELETE',
        }),
      addTeamMember: (
        teamId: string,
        payload: { user_id: string; role?: 'lead' | 'member' | 'viewer' }
      ) =>
        request(`/api/teams/${teamId}/members`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      removeTeamMember: (teamId: string, userId: string) =>
        request(`/api/teams/${teamId}/members/${userId}`, {
          method: 'DELETE',
        }),

      // Pins
      getPins: () => request('/api/pins') as Promise<{ pins?: PinRecord[]; folders?: PinFolder[] } | PinRecord[]>,
      getPinFolders: () =>
        request('/api/pin-folders') as Promise<{ folders?: PinFolder[] } | PinFolder[]>,
      pinObject: (
        objectType: PinObjectType,
        objectId: string,
        payload?: { folder_id?: string | null; sort_order?: number }
      ) =>
        request('/api/pins', {
          method: 'POST',
          body: JSON.stringify({ object_type: objectType, object_id: objectId, ...payload }),
        }),
      unpinObject: (pinId: string) =>
        request(`/api/pins/${pinId}`, {
          method: 'DELETE',
        }),
      updatePin: (pinId: string, payload: { folder_id?: string | null; sort_order?: number }) =>
        request(`/api/pins/${pinId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      reorderPins: (
        pins: Array<{ id: string; folder_id?: string | null; sort_order?: number }>
      ) =>
        request('/api/pins/reorder', {
          method: 'POST',
          body: JSON.stringify({ pins }),
        }),
      createPinFolder: (payload: {
        name: string;
        sort_order?: number;
        collapsed?: boolean;
      }) =>
        request('/api/pin-folders', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updatePinFolder: (
        folderId: string,
        payload: { name?: string; sort_order?: number; collapsed?: boolean }
      ) =>
        request(`/api/pin-folders/${folderId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      deletePinFolder: (folderId: string) =>
        request(`/api/pin-folders/${folderId}`, {
          method: 'DELETE',
        }),
      reorderPinFolders: (folders: Array<{ id: string; sort_order?: number }>) =>
        request('/api/pin-folders/reorder', {
          method: 'POST',
          body: JSON.stringify({ folders }),
        }),

      // Circle
      getPeople: (query?: string) => {
        const normalizedQuery = String(query ?? '').trim();
        const searchParam = normalizedQuery ? `?query=${encodeURIComponent(normalizedQuery)}` : '';
        return request(`/api/people${searchParam}`);
      },
      getPerson: (personId: string) => request(`/api/people/${personId}`),
      getPersonWork: (personId: string) => request(`/api/people/${personId}/work`),
      getPersonProjects: (personId: string) => request(`/api/people/${personId}/projects`),
      getPersonFollowUps: (personId: string) => request(`/api/people/${personId}/follow-ups`),
      getPersonActivity: (personId: string) => request(`/api/people/${personId}/activity`),
      updatePersonPreferences: (
        personId: string,
        payload: { is_pinned?: boolean; sort_order?: number }
      ) =>
        request(`/api/people/${personId}/preferences`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),

      // Calendars
      getCalendars: (options?: { scope?: 'current_workspace' | 'all_accessible_workspaces' }) => {
        const params = new URLSearchParams();
        if (options?.scope) params.set('scope', options.scope);
        const query = params.toString();
        return request(`/api/calendars${query ? `?${query}` : ''}`);
      },
      createCalendar: (name: string, color?: string, is_visible?: boolean) =>
        request('/api/calendars', {
          method: 'POST',
          body: JSON.stringify({ name, color, is_visible }),
        }),
      updateCalendar: (
        id: string,
        update: { name?: string; color?: string; is_visible?: boolean }
      ) =>
        request(`/api/calendars/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        }),
      deleteCalendar: (id: string) =>
        request(`/api/calendars/${id}`, {
          method: 'DELETE',
        }),

      // Events
      getEvents: (
        startDate?: string,
        endDate?: string,
        options?: { scope?: 'current_workspace' | 'all_accessible_workspaces'; projectId?: string }
      ) => {
        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (options?.scope) params.set('scope', options.scope);
        if (options?.projectId) params.set('projectId', options.projectId);
        const query = params.toString();
        return request(`/api/events${query ? `?${query}` : ''}`);
      },
      getUpcomingEvents: (options?: { scope?: 'current_workspace' | 'all_accessible_workspaces' }) => {
        const params = new URLSearchParams();
        if (options?.scope) params.set('scope', options.scope);
        const query = params.toString();
        return request(`/api/events/upcoming${query ? `?${query}` : ''}`);
      },
      createEvent: (payload: {
        title: string;
        start_at: string;
        end_at?: string | null;
        calendar_id?: string;
        project_id?: string | null;
        note_id?: string | null;
        assigned_to_team_id?: string | null;
        color?: string;
        recurrence_rule?: string;
        specific_dates?: string[];
        series_type?: string | null;
        notes?: string | null;
        location?: string | null;
        all_day?: boolean;
        status?: string;
        visibility?: 'private' | 'workspace';
      }) =>
        request('/api/events', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateEvent: (id: string, update: Record<string, unknown>) =>
        request(`/api/events/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        }),
      deleteEvent: (id: string) =>
        request(`/api/events/${id}`, {
          method: 'DELETE',
        }),

      // Reminders
      getReminders: (
        options?: {
          scope?: 'current_workspace' | 'all_accessible_workspaces';
          projectId?: string;
        }
      ) => {
        const params = new URLSearchParams();
        if (options?.scope) params.set('scope', options.scope);
        if (options?.projectId) params.set('projectId', options.projectId);
        const query = params.toString();
        return request(`/api/reminders${query ? `?${query}` : ''}`);
      },
      createReminder: (payload: {
        title: string;
        remind_at: string;
        calendar_id?: string;
        project_id?: string | null;
        note_id?: string | null;
        assigned_to_team_id?: string | null;
        notes?: string | null;
        color?: string;
        is_done?: boolean;
        recurrence_rule?: string | null;
        specific_dates?: string[];
        series_type?: string | null;
      }) =>
        request('/api/reminders', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateReminder: (id: string, update: Record<string, unknown>) =>
        request(`/api/reminders/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        }),
      snoozeReminder: (id: string, snoozeUntil: string) =>
        request(`/api/reminders/${id}/snooze`, {
          method: 'POST',
          body: JSON.stringify({ snooze_until: snoozeUntil }),
        }),
      deleteReminder: (id: string) =>
        request(`/api/reminders/${id}`, {
          method: 'DELETE',
        }),

      // Daily Accountability
      getDailyAccountability: () => request('/api/daily-accountability'),
      saveDailyAccountability: (data: Record<string, unknown>) =>
        request('/api/daily-accountability', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      // Search
      searchWorkspace: (workspaceId: string, query: string) =>
        request(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`, {
          method: 'POST',
        }),

      // Notes
      getNotes: () => request('/api/notes'),
      getNoteById: (id: string) => request(`/api/notes/${id}`),
      getNoteVersions: (id: string) => request(`/api/notes/${id}/versions`),
      restoreNoteVersion: (id: string, versionId: string) =>
        request(`/api/notes/${id}/versions/${versionId}/restore`, {
          method: 'POST',
        }),
      createNoteVersion: (id: string, payload?: { reason?: string }) =>
        request(`/api/notes/${id}/versions`, {
          method: 'POST',
          body: JSON.stringify(payload ?? {}),
        }),
      createNote: (
        title: string,
        content: string,
        options?: {
          date?: string;
          mood?: string | null;
          source?: string;
          mode?: 'text' | 'mind_map';
          mind_map_structure?: unknown;
          content_html?: string;
          parent_id?: string | null;
          sort_order?: number;
          section_id?: string | null;
        }
      ) =>
        request('/api/notes', {
          method: 'POST',
          body: JSON.stringify({ title, content, ...options }),
        }),
      updateNote: (
        id: string,
        update: {
          title?: string;
          content?: string;
          content_html?: string;
          date?: string;
          mood?: string | null;
          source?: string;
          mode?: 'text' | 'mind_map';
          mind_map_structure?: unknown;
          parent_id?: string | null;
          sort_order?: number;
          section_id?: string | null;
        }
      ) =>
        request(`/api/notes/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        }),
      createChildNote: (
        id: string,
        options?: {
          title?: string;
          content?: string;
          content_html?: string;
          date?: string;
          mood?: string | null;
          source?: string;
          mode?: 'text' | 'mind_map';
          mind_map_structure?: unknown;
          section_id?: string | null;
        }
      ) =>
        request(`/api/notes/${id}/children`, {
          method: 'POST',
          body: JSON.stringify(options ?? {}),
        }),
      duplicateNote: (id: string) =>
        request(`/api/notes/${id}/duplicate`, {
          method: 'POST',
        }),
      moveNoteParent: (id: string, parent_id: string | null) =>
        request(`/api/notes/${id}/parent`, {
          method: 'PATCH',
          body: JSON.stringify({ parent_id }),
        }),
      reorderNote: (id: string, sort_order: number) =>
        request(`/api/notes/${id}/sort_order`, {
          method: 'PATCH',
          body: JSON.stringify({ sort_order }),
        }),
      getNoteTree: (id: string) => request(`/api/notes/${id}/tree`),
      deleteNote: (id: string) =>
        request(`/api/notes/${id}`, {
          method: 'DELETE',
        }),
      getNoteSmartLinks: (noteId: string) => request(`/api/notes/${noteId}/smart-links`),
      upsertNoteSmartLink: (
        noteId: string,
        payload: {
          source_key: string;
          source_text: string;
          source_start_offset?: number | null;
          source_end_offset?: number | null;
          linked_event_id?: string | null;
          linked_reminder_id?: string | null;
          dismissed_at?: string | null;
        }
      ) =>
        request(`/api/notes/${noteId}/smart-links`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      getNotePersonLinks: (noteId: string) => request(`/api/notes/${noteId}/person-links`),
      upsertNotePersonLink: (
        noteId: string,
        payload: {
          person_user_id: string;
          source_key: string;
          source_text: string;
        }
      ) =>
        request(`/api/notes/${noteId}/person-links`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),

      // Templates
      getTemplates: (category?: string) => {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        const query = params.toString();
        return request(`/api/templates${query ? `?${query}` : ''}`);
      },
      getTemplate: (id: string) => request(`/api/templates/${id}`),
      createTemplate: (payload: {
        name: string;
        description?: string | null;
        category?: string;
        content_html?: string;
        is_default?: boolean;
        visibility?: 'mine' | 'workspace';
        icon?: string | null;
        color?: string | null;
        suggested_section_id?: string | null;
        title_pattern?: string | null;
      }) =>
        request('/api/templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateTemplate: (
        id: string,
        payload: {
          name?: string;
          description?: string | null;
          category?: string;
          content_html?: string;
          is_default?: boolean;
          visibility?: 'mine' | 'workspace';
          icon?: string | null;
          color?: string | null;
          suggested_section_id?: string | null;
          title_pattern?: string | null;
        }
      ) =>
        request(`/api/templates/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      deleteTemplate: (id: string) =>
        request(`/api/templates/${id}`, {
          method: 'DELETE',
        }),
      duplicateTemplate: (id: string, options?: { visibility?: 'mine' | 'workspace' }) =>
        request(`/api/templates/${id}/duplicate`, {
          method: 'POST',
          body: JSON.stringify(options ?? {}),
        }),
      pinTemplate: (id: string, pinned: boolean) =>
        request(`/api/templates/${id}/pin`, {
          method: 'PATCH',
          body: JSON.stringify({ pinned }),
        }),
      createNoteFromTemplate: (templateId: string, options?: { section_id?: string | null }) =>
        request(`/api/notes/from-template/${templateId}`, {
          method: 'POST',
          body: JSON.stringify(options ?? {}),
        }),
      saveNoteAsTemplate: (
        noteId: string,
        payload: {
          name?: string;
          description?: string | null;
          category?: string;
          is_default?: boolean;
          visibility?: 'mine' | 'workspace';
          icon?: string | null;
          color?: string | null;
          suggested_section_id?: string | null;
          title_pattern?: string | null;
        }
      ) =>
        request(`/api/templates/from-note/${noteId}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      setTemplateDefault: (id: string, is_default: boolean) =>
        request(`/api/templates/${id}/set-default`, {
          method: 'PATCH',
          body: JSON.stringify({ is_default }),
        }),

      // Sections
      getSections: () => request('/api/sections'),
      createSection: (payload: { name: string; color?: string; parent_id?: string | null }) =>
        request('/api/sections', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateSection: (
        id: string,
        payload: { name?: string; color?: string; sort_order?: number; parent_id?: string | null }
      ) =>
        request(`/api/sections/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      deleteSection: (id: string) =>
        request(`/api/sections/${id}`, {
          method: 'DELETE',
        }),
      reorderSections: (
        sections: Array<{ id: string; sort_order: number; parent_id?: string | null }>
      ) =>
        request('/api/sections/reorder', {
          method: 'PATCH',
          body: JSON.stringify({ sections }),
        }),
    }),
    [activeWorkspaceId, session?.access_token]
  );
};
