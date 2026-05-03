import { supabase, supabaseConfigError } from './supabase'
import type { AuthChangeEvent, AuthError, Session, User } from '@supabase/supabase-js'

export interface AuthResponse {
  data: { user: User | null; session: Session | null } | null
  error: AuthError | null
}

export const authService = {
  isConfigured: !supabaseConfigError,

  // Sign up with email and password
  async signUp(email: string, password: string, fullName?: string): Promise<AuthResponse> {
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  },

  // Sign in with OAuth (Google, GitHub, etc.)
  async signInWithOAuth(provider: 'google' | 'github') {
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
    const { error } = await supabase.auth.signOut()
    return { error }
  },

  // Get current session
  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession()
    return data.session
  },

  // Get current user
  async getUser(): Promise<{ user: User | null; error: AuthError | null }> {
    const { data, error } = await supabase.auth.getUser()
    return { user: data.user, error }
  },

  // Reset password
  async resetPassword(email: string) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email)
    return { data, error }
  },

  // Update password
  async updatePassword(newPassword: string) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    return { data, error }
  },

  // Update profile metadata
  async updateProfile(fullName?: string | null) {
    const { data, error } = await supabase.auth.updateUser({
      data: {
        full_name: fullName ?? '',
      },
    })
    return { data, error }
  },

  // Listen to auth changes
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(_event, session)
    }).data?.subscription
  },
}

export default authService
