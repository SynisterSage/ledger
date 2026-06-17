import type { Session } from '@supabase/supabase-js';

import { getSupabaseClient, supabaseConfigError } from './client';
import { getAuthState, resetAuthState, setAuthState } from '@/store/sessionStore';
import { validatePasswordRequirements } from '@/utils/passwordPolicy';

let authListenerAttached = false;
let bootstrapPromise: Promise<void> | null = null;

function syncSession(session: Session | null) {
  setAuthState({
    session,
    user: session?.user ?? null,
    isLoading: false,
    error: null,
    isConfigured: true,
  });
}

export async function initializeAuth() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    if (supabaseConfigError) {
      resetAuthState();
      setAuthState({
        isConfigured: false,
        isLoading: false,
        error: supabaseConfigError.message,
        session: null,
        user: null,
      });
      return;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      setAuthState({
        isLoading: false,
        error: error.message,
      });
      return;
    }

    syncSession(data.session);

    if (!authListenerAttached) {
      authListenerAttached = true;
      supabase.auth.onAuthStateChange((_event, nextSession) => {
        syncSession(nextSession);
      });
    }
  })();

  return bootstrapPromise;
}

export function isAuthReady() {
  const state = getAuthState();
  return state.isConfigured && !state.isLoading;
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data.session ?? null;
}

export async function signUpWithEmail(email: string, password: string, fullName: string) {
  const passwordError = validatePasswordRequirements(password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) throw error;
  return data.session ?? null;
}

export async function signOut() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error) throw error;
}

export async function updateDisplayName(fullName: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    data: {
      full_name: fullName,
    },
  });

  if (error) throw error;
  if (data.user) {
    setAuthState({
      user: data.user,
    });
  }
}

export async function updatePassword(password: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    password,
  });

  if (error) throw error;
  if (data.user) {
    setAuthState({
      user: data.user,
    });
  }
}
