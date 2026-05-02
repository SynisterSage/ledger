import { useEffect } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { useApi } from './useApi'

/**
 * Hook to initialize workspace for authenticated users
 * Creates a personal workspace if one doesn't exist
 */
export const useWorkspaceInit = () => {
  const { user } = useAuthContext()
  const api = useApi()

  useEffect(() => {
    if (!user) return

    const initializeWorkspace = async () => {
      try {
        await api.getCalendars()
      } catch (err) {
        console.error('Failed to initialize workspace:', err)
      }
    }

    initializeWorkspace()
  }, [api, user])
}

export default useWorkspaceInit
