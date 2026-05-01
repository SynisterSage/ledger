import { useEffect } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { supabase } from '../services/supabase'

/**
 * Hook to initialize workspace for authenticated users
 * Creates a personal workspace if one doesn't exist
 */
export const useWorkspaceInit = () => {
  const { user } = useAuthContext()

  useEffect(() => {
    if (!user) return

    const initializeWorkspace = async () => {
      try {
        // Check if personal workspace exists
        const { data, error } = await supabase
          .from('workspaces')
          .select('id')
          .eq('owner_id', user.id)
          .eq('is_personal', true)
          .single()

        // If no personal workspace, create one (fallback if trigger didn't fire)
        if (error?.code === 'PGRST116') {
          await supabase.from('workspaces').insert({
            owner_id: user.id,
            name: 'My Work',
            is_personal: true,
          })
        }
      } catch (err) {
        console.error('Failed to initialize workspace:', err)
      }
    }

    initializeWorkspace()
  }, [user])
}

export default useWorkspaceInit
