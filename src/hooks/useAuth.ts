import { useCallback, useEffect, useRef, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { authService } from '../services/auth';
import { supabaseConfigError } from '../services/supabase';
import { DEFAULT_API_URL } from '../config/runtime';
import type { UserProfile } from '../types/userProfile';
import { userProfileService } from '../services/userProfile';

export interface UseAuthReturn {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  isLoading: boolean;
  error: Error | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
}

export const useAuth = (): UseAuthReturn => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const hasEmittedSessionRef = useRef(false);
  // Supabase can finish INITIAL_SESSION/getSession after a login request has
  // already completed. Do not let that stale initialization result erase a
  // valid session, which is especially visible on slower Windows installs.
  const authMutationInFlightRef = useRef(false);
  const hasExplicitSessionRef = useRef(false);

  const refreshProfile = useCallback(async () => {
    const next = user?.id ? await userProfileService.get(user.id) : null;
    setProfile(next);
    return next;
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const accessToken = session?.access_token ?? null;
    const userId = session?.user?.id ?? null;

    if (accessToken) {
      hasEmittedSessionRef.current = true;
      window.ledgerIpc?.commands?.notificationsSetSession({
        accessToken,
        userId,
        apiUrl: DEFAULT_API_URL,
      });
      return;
    }

    if (!hasEmittedSessionRef.current) return;

    hasEmittedSessionRef.current = false;
    window.ledgerIpc?.commands?.notificationsSetSession({
      accessToken: null,
      userId: null,
      apiUrl: DEFAULT_API_URL,
    });
  }, [session?.access_token, session?.user?.id]);

  // The Electron notification scheduler only has a copy of the access token.
  // If that token expires or is rejected, let the renderer refresh the
  // Supabase session and send the replacement back over IPC.
  useEffect(() => {
    const onInvalidNotificationSession = () => {
      void authService.refreshSession().then((nextSession) => {
        if (!nextSession) return;
        hasExplicitSessionRef.current = true;
        setSession(nextSession);
        setUser(nextSession.user);
      });
    };
    const subscription = window.ledgerIpc?.events?.onLedgerNotificationsSessionInvalid(
      onInvalidNotificationSession
    );
    return () => {
      if (subscription) {
        window.ledgerIpc?.events?.offLedgerNotificationsSessionInvalid(subscription);
      }
    };
  }, []);

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

      if (
        !newSession &&
        (authMutationInFlightRef.current ||
          (event === 'INITIAL_SESSION' && hasExplicitSessionRef.current))
      ) {
        return;
      }

      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession) hasExplicitSessionRef.current = true;
      if (newSession?.user?.id) {
        userProfileService.get(newSession.user.id).then(setProfile).catch(() => undefined);
      } else {
        setProfile(null);
      }

      if (event === 'INITIAL_SESSION') {
        setIsLoading(false);
      }
    });

    const initAuth = async () => {
      try {
        const currentSession = await authService.getSession();
        if (!isMounted) return;

        if (currentSession) {
          hasExplicitSessionRef.current = true;
          setSession(currentSession);
          setUser(currentSession.user);
          userProfileService.get(currentSession.user.id).then(setProfile).catch(() => undefined);
          return;
        }

        if (!authMutationInFlightRef.current && !hasExplicitSessionRef.current) {
          setSession(null);
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error('Auth initialization failed'));
        if (!authMutationInFlightRef.current && !hasExplicitSessionRef.current) {
          setSession(null);
          setUser(null);
        }
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
    authMutationInFlightRef.current = true;
    try {
      setError(null);
      const { data, error } = await authService.signIn(email, password);
      if (error) throw error;
      if (data?.session) {
        hasExplicitSessionRef.current = true;
        setSession(data.session);
        setUser(data.session.user);
        userProfileService.get(data.session.user.id).then(setProfile).catch(() => undefined);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign in failed');
      setError(error);
      throw error;
    } finally {
      authMutationInFlightRef.current = false;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    authMutationInFlightRef.current = true;
    try {
      setError(null);
      const { data, error } = await authService.signUp(email, password, fullName);
      if (error) throw error;
      if (data?.session) {
        hasExplicitSessionRef.current = true;
        setSession(data.session);
        setUser(data.session.user);
        userProfileService.get(data.session.user.id).then(setProfile).catch(() => undefined);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign up failed');
      setError(error);
      throw error;
    } finally {
      authMutationInFlightRef.current = false;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setError(null);
      const { error } = await authService.signOut();
      if (error) throw error;
      hasExplicitSessionRef.current = false;
      setSession(null);
      setUser(null);
      setProfile(null);
      if (typeof window !== 'undefined' && !window.desktopWindow) {
        // The product shell is only for authenticated web work. Leave it
        // entirely after logout so the marketing site's auth page owns the
        // signed-out state instead of rendering the desktop login surface.
        window.location.replace('/login');
      }
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
    profile,
    session,
    isLoading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    refreshProfile,
  };
};

export default useAuth;
