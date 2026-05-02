import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuthContext } from './AuthContext'

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

export type WorkspaceSummary = {
  id: string
  name: string
  description: string | null
  is_personal: boolean
  color: string | null
  owner_id: string
  created_at: string
  updated_at: string
  role: WorkspaceRole
}

type WorkspaceContextType = {
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  isLoading: boolean
  error: string | null
  setActiveWorkspace: (workspaceId: string) => Promise<void>
  refreshWorkspaces: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const WORKSPACE_STORAGE_KEY = 'ledger:active-workspace-id'

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, user } = useAuthContext()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const authedRequest = useCallback(async (path: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body?.error || 'Workspace request failed')
    }

    return response.json()
  }, [session?.access_token])

  const refreshWorkspaces = useCallback(async () => {
    if (!session?.access_token || !user) {
      setWorkspaces([])
      setActiveWorkspaceId(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const [workspaceRows, active] = await Promise.all([
        authedRequest('/api/workspaces'),
        authedRequest('/api/workspaces/active'),
      ])

      const rows = Array.isArray(workspaceRows) ? (workspaceRows as WorkspaceSummary[]) : []
      const resolvedActiveWorkspaceId = String((active as { workspace_id?: string })?.workspace_id ?? '') || null

      setWorkspaces(rows)
      setActiveWorkspaceId(resolvedActiveWorkspaceId)

      if (resolvedActiveWorkspaceId) {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, resolvedActiveWorkspaceId)
      } else {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load workspaces')
    } finally {
      setIsLoading(false)
    }
  }, [authedRequest, session?.access_token, user])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_STORAGE_KEY) return
      setActiveWorkspaceId(event.newValue)
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setActiveWorkspace = useCallback(async (workspaceId: string) => {
    setError(null)

    const payload = await authedRequest('/api/workspaces/active', {
      method: 'PATCH',
      body: JSON.stringify({ workspace_id: workspaceId }),
    }) as { workspace_id?: string }

    const nextWorkspaceId = String(payload?.workspace_id ?? '').trim()
    if (!nextWorkspaceId) {
      throw new Error('Invalid workspace response')
    }

    setActiveWorkspaceId(nextWorkspaceId)
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, nextWorkspaceId)
    window.dispatchEvent(new CustomEvent('ledger:workspace-changed', { detail: { workspaceId: nextWorkspaceId } }))
  }, [authedRequest])

  const activeWorkspace = useMemo(() => {
    if (!activeWorkspaceId) return null
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  }, [activeWorkspaceId, workspaces])

  const value = useMemo(() => ({
    activeWorkspaceId,
    activeWorkspace,
    workspaces,
    isLoading,
    error,
    setActiveWorkspace,
    refreshWorkspaces,
  }), [activeWorkspaceId, activeWorkspace, workspaces, isLoading, error, setActiveWorkspace, refreshWorkspaces])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export const useWorkspaceContext = () => {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspaceContext must be used within WorkspaceProvider')
  }
  return context
}

export default WorkspaceContext
