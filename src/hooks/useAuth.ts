import { useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { authService } from '../services/auth'

export interface UseAuthReturn {
  user: User | null
  session: Session | null
  isLoading: boolean
  error: Error | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName?: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

export const useAuth = (): UseAuthReturn => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      try {
        const session = await authService.getSession()
        setSession(session)
        if (session?.user) {
          setUser(session.user)
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Auth initialization failed'))
      } finally {
        setIsLoading(false)
      }
    }

    initAuth()
  }, [])

  // Listen for auth state changes
  useEffect(() => {
    const subscription = authService.onAuthStateChange((newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
    })

    return () => subscription?.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setError(null)
      const { data, error } = await authService.signIn(email, password)
      if (error) throw error
      if (data?.session) {
        setSession(data.session)
        setUser(data.session.user)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign in failed')
      setError(error)
      throw error
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    try {
      setError(null)
      const { data, error } = await authService.signUp(email, password, fullName)
      if (error) throw error
      if (data?.session) {
        setSession(data.session)
        setUser(data.session.user)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign up failed')
      setError(error)
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      setError(null)
      const { error } = await authService.signOut()
      if (error) throw error
      setSession(null)
      setUser(null)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign out failed')
      setError(error)
      throw error
    }
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    try {
      setError(null)
      const { error } = await authService.resetPassword(email)
      if (error) throw error
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Password reset failed')
      setError(error)
      throw error
    }
  }, [])

  return {
    user,
    session,
    isLoading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
  }
}

export default useAuth
