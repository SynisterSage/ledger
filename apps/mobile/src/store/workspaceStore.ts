import { useSyncExternalStore } from 'react';

import { getMobileWorkspaces, mockWorkspaceScopeOptions } from '@/api/workspaces';
import type { MobileWorkspaceScopeOption } from '@/types/ledger';

export type WorkspaceState = {
  isLoading: boolean;
  isHydrated: boolean;
  hasUserSelectedWorkspace: boolean;
  options: MobileWorkspaceScopeOption[];
  selectedWorkspaceId: string;
  error: string | null;
};

const initialState: WorkspaceState = {
  isLoading: false,
  isHydrated: false,
  hasUserSelectedWorkspace: false,
  options: [],
  selectedWorkspaceId: 'all',
  error: null,
};

let state = initialState;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getWorkspaceState() {
  return state;
}

export function setWorkspaceState(next: Partial<WorkspaceState>) {
  state = { ...state, ...next };
  emit();
}

export function selectWorkspace(workspaceId: string) {
  setWorkspaceState({
    selectedWorkspaceId: workspaceId,
    hasUserSelectedWorkspace: true,
  });
}

export function resetWorkspaceState() {
  state = initialState;
  emit();
}

export function subscribeWorkspaceState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaceState() {
  return useSyncExternalStore(subscribeWorkspaceState, getWorkspaceState, getWorkspaceState);
}

export function getWorkspaceLabel(workspaceId: string, options: MobileWorkspaceScopeOption[]) {
  if (workspaceId === 'all') return 'All Workspaces';
  return options.find((option) => option.id === workspaceId)?.name ?? 'Workspace';
}

export async function bootstrapWorkspaceState() {
  if (state.isHydrated) {
    return;
  }

  setWorkspaceState({ isLoading: true, error: null });

  try {
    const response = await getMobileWorkspaces();
    const options = response.scopeOptions?.length ? response.scopeOptions : mockWorkspaceScopeOptions;
    setWorkspaceState({
      isLoading: false,
      isHydrated: true,
      options,
      selectedWorkspaceId:
        state.hasUserSelectedWorkspace || state.selectedWorkspaceId !== 'all'
          ? state.selectedWorkspaceId
          : response.defaultWorkspaceId ?? state.selectedWorkspaceId,
    });
  } catch {
    setWorkspaceState({
      isLoading: false,
      isHydrated: true,
      options: mockWorkspaceScopeOptions,
      error: null,
    });
  }
}
