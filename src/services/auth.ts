import { supabase, supabaseConfigError } from './supabase'
import type { AuthChangeEvent, AuthError, Session, Subscription, User } from '@supabase/supabase-js'

export interface AuthResponse {
  data: { user: User | null; session: Session | null } | null
  error: AuthError | null
}

const unavailableAuthError = () =>
  new Error(
    supabaseConfigError?.message ||
      'Supabase is not configured. Please check your VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY settings.'
  )

export const authService = {
  isConfigured: !supabaseConfigError,

  // Sign up with email and password
  async signUp(email: string, password: string, fullName?: string): Promise<AuthResponse> {
    if (!supabase) return { data: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })
    return { data, error }
  },

  // Sign in with email and password
  async signIn(email: string, password: string): Promise<AuthResponse> {
    if (!supabase) return { data: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  },

  // Sign in with OAuth (Google, GitHub, etc.)
  async signInWithOAuth(provider: 'google' | 'github') {
    if (!supabase) return { data: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return { data, error }
  },

  // Sign out
  async signOut() {
    if (!supabase) return { error: unavailableAuthError() as AuthError }

    const { error } = await supabase.auth.signOut()
    return { error }
  },

  // Get current session
  async getSession(): Promise<Session | null> {
    if (!supabase) return null

    const { data } = await supabase.auth.getSession()
    return data.session
  },

  // Get current user
  async getUser(): Promise<{ user: User | null; error: AuthError | null }> {
    if (!supabase) return { user: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.getUser()
    return { user: data.user, error }
  },

  // Reset password
  async resetPassword(email: string) {
    if (!supabase) return { data: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.resetPasswordForEmail(email)
    return { data, error }
  },

  // Update password
  async updatePassword(newPassword: string) {
    if (!supabase) return { data: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    return { data, error }
  },

  // Update profile metadata
  async updateProfile(fullName?: string | null) {
    if (!supabase) return { data: null, error: unavailableAuthError() as AuthError }

    const { data, error } = await supabase.auth.updateUser({
      data: {
        full_name: fullName ?? '',
      },
    })
    return { data, error }
  },

  // Listen to auth changes
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    if (!supabase) {
      const subscription: Subscription = {
        id: Symbol('ledger-auth'),
        callback,
        unsubscribe: () => undefined,
      }
      return subscription
    }

    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(_event, session)
    }).data?.subscription
  },
}

export default authService
