import { useMemo } from 'react'
import { useAuthContext } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

type ApiRequestOptions = RequestInit & {
  skipJson?: boolean
}

export const useApi = () => {
  const { session } = useAuthContext()

  const localDayKey = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const request = async (endpoint: string, options: ApiRequestOptions = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    if (endpoint.includes('/api/daily-accountability')) {
      headers['X-Ledger-Day-Key'] = localDayKey()
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    if (options.skipJson) {
      return null
    }

    return response.json()
  }

  return useMemo(() => ({
    // User
    getOnboardingStatus: () => request('/api/user/onboarding'),
    completeOnboarding: () => request('/api/user/onboarding', { method: 'PATCH' }),

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

    // Calendars
    getCalendars: () => request('/api/calendars'),
    createCalendar: (name: string, color?: string) => request('/api/calendars', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
    updateCalendar: (id: string, update: { name?: string; color?: string }) => request(`/api/calendars/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),

    // Events
    getEvents: (startDate?: string, endDate?: string) => {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const query = params.toString()
      return request(`/api/events${query ? `?${query}` : ''}`)
    },
    getUpcomingEvents: () => request('/api/events/upcoming'),
    createEvent: (payload: {
      title: string
      start_at: string
      end_at: string
      calendar_id?: string
      color?: string
      recurrence_rule?: string
      notes?: string | null
      location?: string | null
      all_day?: boolean
      status?: string
    }) => request('/api/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    updateEvent: (id: string, update: Record<string, unknown>) => request(`/api/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
    deleteEvent: (id: string) => request(`/api/events/${id}`, {
      method: 'DELETE',
    }),

    // Reminders
    getReminders: () => request('/api/reminders'),
    createReminder: (payload: {
      title: string
      remind_at: string
      calendar_id?: string
      color?: string
      is_done?: boolean
    }) => request('/api/reminders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    updateReminder: (id: string, update: Record<string, unknown>) => request(`/api/reminders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
    deleteReminder: (id: string) => request(`/api/reminders/${id}`, {
      method: 'DELETE',
    }),

    // Daily Accountability
    getDailyAccountability: () => request('/api/daily-accountability'),
    saveDailyAccountability: (data: Record<string, unknown>) => request('/api/daily-accountability', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

    // Notes
    getNotes: () => request('/api/notes'),
    createNote: (title: string, content: string) => request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title, content }),
    }),
    deleteNote: (id: string) => request(`/api/notes/${id}`, {
      method: 'DELETE',
    }),
  }), [session?.access_token])
}
