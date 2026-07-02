import { useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useWorkspaceContext } from '../context/WorkspaceContext';
import { DEFAULT_API_URL } from '../config/runtime';
import { getInviteBaseUrl } from '../config/invite';
import { buildLedgerSessionHeaders } from '../utils/deviceSession';
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
        payload: { name?: string; description?: string | null }
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
      archiveInboxItem: (id: string) =>
        request(`/api/inbox/${id}/archive`, {
          method: 'POST',
          skipWorkspaceHeader: true,
        }),
      deleteInboxItem: (id: string) =>
        request(`/api/inbox/${id}`, {
          method: 'DELETE',
          skipWorkspaceHeader: true,
        }),
      convertInboxItem: (
        id: string,
        payload: {
          type: 'task' | 'note' | 'reminder' | 'event';
          title?: string;
          body?: string | null;
          project_id?: string | null;
          note_id?: string | null;
          calendar_id?: string | null;
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
        }
      ) =>
        request(`/api/inbox/${id}/convert`, {
          method: 'POST',
          body: JSON.stringify(payload),
          skipWorkspaceHeader: true,
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
      // Today (unified across accessible workspaces)
      getToday: () => request('/api/today', { skipWorkspaceHeader: true }),
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
      getTeam: (teamId: string) => request(`/api/teams/${teamId}`),
      getTeamNotes: (teamId: string) => request(`/api/teams/${teamId}/notes`),
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
      duplicateTemplate: (id: string) =>
        request(`/api/templates/${id}/duplicate`, {
          method: 'POST',
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
