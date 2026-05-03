import { useEffect } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { useWorkspaceContext } from '../context/WorkspaceContext'

/**
 * Ensure workspace state is loaded for authenticated users.
 */
export const useWorkspaceInit = () => {
  const { user } = useAuthContext()
  const { refreshWorkspaces } = useWorkspaceContext()

  useEffect(() => {
    if (!user) return

    const initializeWorkspace = async () => {
      try {
        await refreshWorkspaces()
      } catch (err) {
        console.error('Failed to initialize workspace:', err)
      }
    }

    initializeWorkspace()
  }, [refreshWorkspaces, user])
}

export default useWorkspaceInit
