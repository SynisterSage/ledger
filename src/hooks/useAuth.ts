import { useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { authService } from '../services/auth';
import { supabaseConfigError } from '../services/supabase';
import { DEFAULT_API_URL } from '../config/runtime';

const AUTH_SESSION_BACKUP_KEY = 'ledger-auth-session-backup:v1';

const readCachedSession = (): Session | null => {
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session | null;
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCachedSession = (session: Session | null) => {
  try {
    if (!session?.access_token || !session.refresh_token) {
      window.localStorage.removeItem(AUTH_SESSION_BACKUP_KEY);
      return;
    }
    window.localStorage.setItem(AUTH_SESSION_BACKUP_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures; Supabase auth remains the primary source of truth.
  }
};

export interface UseAuthReturn {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  error: Error | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

export const useAuth = (): UseAuthReturn => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.ipcRenderer?.send('notifications:set-session', {
      accessToken: session?.access_token ?? null,
      userId: session?.user?.id ?? null,
      apiUrl: DEFAULT_API_URL,
    });
  }, [session?.access_token, session?.user?.id]);

  // Initialize auth state
  useEffect(() => {
    let isMounted = true;

    if (!authService.isConfigured || supabaseConfigError) {
      setError(
        supabaseConfigError ||
          new Error('Missing Supabase credentials. Please check your environment configuration.')
      );
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const subscription = authService.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);
      writeCachedSession(newSession);

      if (event === 'INITIAL_SESSION') {
        setIsLoading(false);
      }
    });

    const initAuth = async () => {
      try {
        const currentSession = await authService.getSession();
        if (!isMounted) return;

        if (currentSession) {
          setSession(currentSession);
          setUser(currentSession.user);
          writeCachedSession(currentSession);
          return;
        }

        const cachedSession = readCachedSession();
        if (cachedSession) {
          const restoredSession = await authService.restoreSession({
            access_token: cachedSession.access_token,
            refresh_token: cachedSession.refresh_token,
          });

          if (!isMounted) return;

          if (restoredSession) {
            setSession(restoredSession);
            setUser(restoredSession.user);
            writeCachedSession(restoredSession);
            return;
          }

          // If restoration fails, keep the cached session optimistically so the UI
          // doesn't bounce back to the login form on restart. Subsequent auth refresh
          // or API calls can reconcile it.
          setSession(cachedSession);
          setUser(cachedSession.user);
          return;
        }

        setSession(null);
        setUser(null);
        writeCachedSession(null);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error('Auth initialization failed'));
        setSession(null);
        setUser(null);
      } finally {
        if (!isMounted) return;
        setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setError(null);
      const { data, error } = await authService.signIn(email, password);
      if (error) throw error;
      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        writeCachedSession(data.session);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign in failed');
      setError(error);
      throw error;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    try {
      setError(null);
      const { data, error } = await authService.signUp(email, password, fullName);
      if (error) throw error;
      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        writeCachedSession(data.session);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign up failed');
      setError(error);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setError(null);
      const { error } = await authService.signOut();
      if (error) throw error;
      setSession(null);
      setUser(null);
      writeCachedSession(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign out failed');
      setError(error);
      throw error;
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    try {
      setError(null);
      const { error } = await authService.resetPassword(email);
      if (error) throw error;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Password reset failed');
      setError(error);
      throw error;
    }
  }, []);

  return {
    user,
    session,
    isLoading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };
};

export default useAuth;
