import { useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useWorkspaceContext } from '../context/WorkspaceContext';
import { DEFAULT_API_URL } from '../config/runtime';

const API_URL = import.meta.env.VITE_API_URL?.trim() || DEFAULT_API_URL;
const INVITE_BASE_URL = import.meta.env.VITE_INVITE_BASE_URL?.trim() || window.location.origin;

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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    if (!options.skipWorkspaceHeader && activeWorkspaceId && endpoint.startsWith('/api/')) {
      headers['X-Workspace-Id'] = activeWorkspaceId;
    }

    if (endpoint.includes('/api/daily-accountability')) {
      headers['X-Ledger-Day-Key'] = localDayKey();
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    if (options.skipJson) {
      return null;
    }

    return response.json();
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
            origin: payload.origin ?? INVITE_BASE_URL,
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
        tags?: string[];
        project_id?: string | null;
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

      // Calendars
      getCalendars: () => request('/api/calendars'),
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
      getEvents: (startDate?: string, endDate?: string) => {
        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        const query = params.toString();
        return request(`/api/events${query ? `?${query}` : ''}`);
      },
      getUpcomingEvents: () => request('/api/events/upcoming'),
      createEvent: (payload: {
        title: string;
        start_at: string;
        end_at?: string | null;
        calendar_id?: string;
        project_id?: string | null;
        note_id?: string | null;
        color?: string;
        recurrence_rule?: string;
        notes?: string | null;
        location?: string | null;
        all_day?: boolean;
        status?: string;
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
      getReminders: () => request('/api/reminders'),
      createReminder: (payload: {
        title: string;
        remind_at: string;
        calendar_id?: string;
        project_id?: string | null;
        note_id?: string | null;
        notes?: string | null;
        color?: string;
        is_done?: boolean;
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
