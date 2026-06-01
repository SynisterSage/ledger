import { useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export type AuthState = {
  isConfigured: boolean;
  isLoading: boolean;
  error: string | null;
  session: Session | null;
  user: User | null;
};

const initialState: AuthState = {
  isConfigured: true,
  isLoading: true,
  error: null,
  session: null,
  user: null,
};

let state = initialState;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getAuthState() {
  return state;
}

export function setAuthState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  emit();
}

export function resetAuthState() {
  state = initialState;
  emit();
}

export function subscribeAuthState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuthState() {
  return useSyncExternalStore(subscribeAuthState, getAuthState, getAuthState);
}
