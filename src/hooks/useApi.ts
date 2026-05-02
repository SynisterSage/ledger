import { useAuthContext } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export const useApi = () => {
  const { session } = useAuthContext()

  const request = async (endpoint: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }

  return {
    // Projects
    getProjects: () => request('/api/projects'),
    createProject: (name: string) => request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
    updateProject: (id: string, update: any) => request(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
    deleteProject: (id: string) => request(`/api/projects/${id}`, {
      method: 'DELETE',
    }),

    // Events
    getUpcomingEvents: () => request('/api/events/upcoming'),
    createEvent: (title: string, start_at: string, end_at: string) => request('/api/events', {
      method: 'POST',
      body: JSON.stringify({ title, start_at, end_at }),
    }),

    // Daily Accountability
    getDailyAccountability: () => request('/api/daily-accountability'),
    saveDailyAccountability: (data: any) => request('/api/daily-accountability', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

    // Notes
    getNotes: () => request('/api/notes'),
    createNote: (title: string, body: string) => request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    }),
  }
}
