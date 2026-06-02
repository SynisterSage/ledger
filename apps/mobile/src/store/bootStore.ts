import { useSyncExternalStore } from 'react';

type BootState = {
  isBooting: boolean;
  hasHydratedSession: boolean;
  minimumSplashElapsed: boolean;
  showFallbackLoading: boolean;
  isBootReady: boolean;
};

const initialState: BootState = {
  isBooting: true,
  hasHydratedSession: false,
  minimumSplashElapsed: false,
  showFallbackLoading: false,
  isBootReady: false,
};

let state = initialState;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getBootState() {
  return state;
}

export function setBootState(next: Partial<BootState>) {
  state = { ...state, ...next };
  emit();
}

export function resetBootState() {
  state = initialState;
  emit();
}

export function subscribeBootState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBootState() {
  return useSyncExternalStore(subscribeBootState, getBootState, getBootState);
}
