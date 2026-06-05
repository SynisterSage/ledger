import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

import { getMobileWorkspaces, mockWorkspaceScopeOptions } from '@/api/workspaces';
import { getMobileUserSettings, updateMobileUserSettings } from '@/api/userSettings';
import type { MobileWorkspaceScopeOption } from '@/types/ledger';

const WORKSPACE_STORAGE_KEY = 'ledger-mobile-selected-workspace';
const TODAY_SCOPE_STORAGE_KEY = 'ledger-mobile-today-scope-workspace';
const DEFAULT_CAPTURE_STORAGE_KEY = 'ledger-mobile-default-capture-workspace';
const DEFAULT_SIRI_STORAGE_KEY = 'ledger-mobile-default-siri-workspace';
const REMEMBER_LAST_WORKSPACE_STORAGE_KEY = 'ledger-mobile-remember-last-workspace';
const MOBILE_SELECTED_WORKSPACE_PREF = 'mobile_selected_workspace_id';
const MOBILE_TODAY_SCOPE_PREF = 'mobile_today_scope_workspace_id';
const MOBILE_DEFAULT_CAPTURE_PREF = 'mobile_default_capture_workspace_id';
const MOBILE_DEFAULT_SIRI_PREF = 'mobile_default_siri_workspace_id';
const MOBILE_SIRI_ASK_EVERY_TIME_PREF = 'mobile_siri_ask_every_time';
const MOBILE_REMEMBER_LAST_PREF = 'mobile_remember_last_workspace';

export type WorkspaceState = {
  isLoading: boolean;
  isHydrated: boolean;
  hasUserSelectedWorkspace: boolean;
  options: MobileWorkspaceScopeOption[];
  selectedWorkspaceId: string;
  todayScopeWorkspaceId: string;
  defaultCaptureWorkspaceId: string;
  defaultSiriWorkspaceId: string;
  siriAskEveryTime: boolean;
  rememberLastWorkspace: boolean;
  error: string | null;
};

const initialState: WorkspaceState = {
  isLoading: false,
  isHydrated: false,
  hasUserSelectedWorkspace: false,
  options: [],
  selectedWorkspaceId: 'all',
  todayScopeWorkspaceId: 'all',
  defaultCaptureWorkspaceId: 'all',
  defaultSiriWorkspaceId: 'all',
  siriAskEveryTime: false,
  rememberLastWorkspace: true,
  error: null,
};

let state = initialState;
const listeners = new Set<() => void>();
let hydrationPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function readPreferenceString(preferences: Record<string, unknown>, key: string) {
  const value = preferences[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPreferenceBoolean(preferences: Record<string, unknown>, key: string, fallback = true) {
  const value = preferences[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

async function syncWorkspacePreferencesToServer(payload: {
  activeWorkspaceId?: string | null;
  preferences?: Record<string, unknown>;
}) {
  try {
    await updateMobileUserSettings({
      ...(payload.activeWorkspaceId !== undefined && payload.activeWorkspaceId !== 'all'
        ? { active_workspace_id: payload.activeWorkspaceId }
        : {}),
      ...(payload.preferences ? { preferences: payload.preferences } : {}),
    });
  } catch {
    // Ignore sync failures; local state and device cache still update immediately.
  }
}

export function getWorkspaceState() {
  return state;
}

export function setWorkspaceState(next: Partial<WorkspaceState>) {
  state = { ...state, ...next };
  emit();
}

export function selectWorkspace(workspaceId: string) {
  void SecureStore.setItemAsync(WORKSPACE_STORAGE_KEY, workspaceId).catch(() => {
    // Ignore storage failures; workspace selection should still update in-memory.
  });
  void syncWorkspacePreferencesToServer({
    activeWorkspaceId: workspaceId === 'all' ? undefined : workspaceId,
    preferences: { [MOBILE_SELECTED_WORKSPACE_PREF]: workspaceId },
  });
  setWorkspaceState({
    selectedWorkspaceId: workspaceId,
    hasUserSelectedWorkspace: true,
  });
}

export function setTodayScopeWorkspace(workspaceId: string) {
  void SecureStore.setItemAsync(TODAY_SCOPE_STORAGE_KEY, workspaceId).catch(() => {
    // Ignore storage failures; preference should still update in-memory.
  });
  void syncWorkspacePreferencesToServer({
    preferences: { [MOBILE_TODAY_SCOPE_PREF]: workspaceId },
  });
  setWorkspaceState({
    todayScopeWorkspaceId: workspaceId,
    selectedWorkspaceId: state.rememberLastWorkspace ? state.selectedWorkspaceId : workspaceId,
  });
}

export function setDefaultCaptureWorkspace(workspaceId: string) {
  void SecureStore.setItemAsync(DEFAULT_CAPTURE_STORAGE_KEY, workspaceId).catch(() => {
    // Ignore storage failures; preference should still update in-memory.
  });
  void syncWorkspacePreferencesToServer({
    preferences: { [MOBILE_DEFAULT_CAPTURE_PREF]: workspaceId },
  });
  setWorkspaceState({
    defaultCaptureWorkspaceId: workspaceId,
  });
}

export function setDefaultSiriWorkspace(workspaceId: string) {
  void SecureStore.setItemAsync(DEFAULT_SIRI_STORAGE_KEY, workspaceId).catch(() => {
    // Ignore storage failures; preference should still update in-memory.
  });
  void syncWorkspacePreferencesToServer({
    preferences: { [MOBILE_DEFAULT_SIRI_PREF]: workspaceId },
  });
  setWorkspaceState({
    defaultSiriWorkspaceId: workspaceId,
  });
}

export function setSiriAskEveryTime(siriAskEveryTime: boolean) {
  void syncWorkspacePreferencesToServer({
    preferences: { [MOBILE_SIRI_ASK_EVERY_TIME_PREF]: siriAskEveryTime },
  });
  setWorkspaceState({
    siriAskEveryTime,
  });
}

export function setRememberLastWorkspace(rememberLastWorkspace: boolean) {
  void SecureStore.setItemAsync(
    REMEMBER_LAST_WORKSPACE_STORAGE_KEY,
    rememberLastWorkspace ? 'true' : 'false',
  ).catch(() => {
    // Ignore storage failures; preference should still update in-memory.
  });
  void syncWorkspacePreferencesToServer({
    preferences: { [MOBILE_REMEMBER_LAST_PREF]: rememberLastWorkspace },
  });
  setWorkspaceState({
    rememberLastWorkspace,
    selectedWorkspaceId: rememberLastWorkspace ? state.selectedWorkspaceId : state.todayScopeWorkspaceId,
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

export function resolveCaptureWorkspaceId(state = getWorkspaceState()) {
  const validWorkspaceIds = new Set(state.options.map((option) => option.id));
  const candidates = [state.defaultCaptureWorkspaceId, state.selectedWorkspaceId, state.todayScopeWorkspaceId];

  for (const candidate of candidates) {
    if (candidate && candidate !== 'all' && validWorkspaceIds.has(candidate)) {
      return candidate;
    }
  }

  const firstWorkspaceId = state.options.find((option) => option.id !== 'all')?.id;
  return firstWorkspaceId ?? 'all';
}

export function resolveSiriCaptureWorkspaceId(state = getWorkspaceState()) {
  if (state.siriAskEveryTime) {
    return null;
  }

  const validWorkspaceIds = new Set(state.options.map((option) => option.id));
  const candidates = [
    state.defaultSiriWorkspaceId,
    state.defaultCaptureWorkspaceId,
    state.selectedWorkspaceId,
    state.todayScopeWorkspaceId,
  ];

  for (const candidate of candidates) {
    if (candidate && candidate !== 'all' && validWorkspaceIds.has(candidate)) {
      return candidate;
    }
  }

  const firstWorkspaceId = state.options.find((option) => option.id !== 'all')?.id;
  return firstWorkspaceId ?? null;
}

export async function bootstrapWorkspaceState() {
  if (hydrationPromise) {
    await hydrationPromise;
    return;
  }

  hydrationPromise = (async () => {
    if (state.isHydrated) {
      return;
    }

    setWorkspaceState({ isLoading: true, error: null });

    try {
      const [
        savedWorkspaceId,
        savedTodayScopeWorkspaceId,
        savedDefaultCaptureWorkspaceId,
        savedDefaultSiriWorkspaceId,
        savedRememberLastWorkspace,
      ] =
        await Promise.all([
          SecureStore.getItemAsync(WORKSPACE_STORAGE_KEY).catch(() => null),
          SecureStore.getItemAsync(TODAY_SCOPE_STORAGE_KEY).catch(() => null),
          SecureStore.getItemAsync(DEFAULT_CAPTURE_STORAGE_KEY).catch(() => null),
          SecureStore.getItemAsync(DEFAULT_SIRI_STORAGE_KEY).catch(() => null),
          SecureStore.getItemAsync(REMEMBER_LAST_WORKSPACE_STORAGE_KEY).catch(() => null),
        ]);

      const [userSettings, response] = await Promise.all([getMobileUserSettings(), getMobileWorkspaces()]);
      const options = response.scopeOptions?.length ? response.scopeOptions : mockWorkspaceScopeOptions;
      const availableWorkspaceIds = options.filter((option) => option.id !== 'all').map((option) => option.id);
      const firstWorkspaceId = availableWorkspaceIds[0] ?? 'all';
      const validWorkspaceIds = new Set(options.map((option) => option.id));
      const serverPreferences = userSettings.preferences ?? {};
      const serverSelectedWorkspaceId = readPreferenceString(serverPreferences, MOBILE_SELECTED_WORKSPACE_PREF);
      const serverTodayScopeWorkspaceId = readPreferenceString(serverPreferences, MOBILE_TODAY_SCOPE_PREF);
      const serverDefaultCaptureWorkspaceId = readPreferenceString(serverPreferences, MOBILE_DEFAULT_CAPTURE_PREF);
      const serverDefaultSiriWorkspaceId = readPreferenceString(serverPreferences, MOBILE_DEFAULT_SIRI_PREF);
      const serverSiriAskEveryTime = readPreferenceBoolean(
        serverPreferences,
        MOBILE_SIRI_ASK_EVERY_TIME_PREF,
        false,
      );
      const serverRememberLastWorkspace = readPreferenceBoolean(serverPreferences, MOBILE_REMEMBER_LAST_PREF, true);
      const savedWorkspaceIsValid = savedWorkspaceId ? validWorkspaceIds.has(savedWorkspaceId) : false;
      const savedTodayScopeIsValid = savedTodayScopeWorkspaceId ? validWorkspaceIds.has(savedTodayScopeWorkspaceId) : false;
      const savedDefaultCaptureIsValid = savedDefaultCaptureWorkspaceId
        ? validWorkspaceIds.has(savedDefaultCaptureWorkspaceId)
        : false;
      const savedDefaultSiriIsValid = savedDefaultSiriWorkspaceId
        ? validWorkspaceIds.has(savedDefaultSiriWorkspaceId)
        : false;
      const serverSelectedWorkspaceIsValid = serverSelectedWorkspaceId
        ? validWorkspaceIds.has(serverSelectedWorkspaceId)
        : false;
      const serverTodayScopeIsValid = serverTodayScopeWorkspaceId
        ? validWorkspaceIds.has(serverTodayScopeWorkspaceId)
        : false;
      const serverDefaultCaptureIsValid = serverDefaultCaptureWorkspaceId
        ? validWorkspaceIds.has(serverDefaultCaptureWorkspaceId)
        : false;
      const rememberLastWorkspace =
        savedRememberLastWorkspace === null ? serverRememberLastWorkspace : savedRememberLastWorkspace === 'true';

      const nextSelectedWorkspaceId =
        state.hasUserSelectedWorkspace || state.selectedWorkspaceId !== 'all'
          ? state.selectedWorkspaceId
          : rememberLastWorkspace && serverSelectedWorkspaceIsValid
            ? String(serverSelectedWorkspaceId)
            : rememberLastWorkspace && savedWorkspaceIsValid
            ? String(savedWorkspaceId)
            : serverTodayScopeIsValid
              ? String(serverTodayScopeWorkspaceId)
              : savedTodayScopeIsValid
              ? String(savedTodayScopeWorkspaceId)
              : response.defaultWorkspaceId && validWorkspaceIds.has(response.defaultWorkspaceId)
                ? response.defaultWorkspaceId
                : firstWorkspaceId;
      const nextDefaultSiriWorkspaceId =
        serverDefaultSiriWorkspaceId && validWorkspaceIds.has(serverDefaultSiriWorkspaceId)
          ? String(serverDefaultSiriWorkspaceId)
          : savedDefaultSiriIsValid
            ? String(savedDefaultSiriWorkspaceId)
            : response.defaultWorkspaceId && validWorkspaceIds.has(response.defaultWorkspaceId)
              ? response.defaultWorkspaceId
              : firstWorkspaceId;

      setWorkspaceState({
        isLoading: false,
        isHydrated: true,
        options,
        selectedWorkspaceId: nextSelectedWorkspaceId,
        todayScopeWorkspaceId: serverTodayScopeIsValid
          ? String(serverTodayScopeWorkspaceId)
          : savedTodayScopeIsValid
            ? String(savedTodayScopeWorkspaceId)
            : 'all',
        defaultCaptureWorkspaceId: serverDefaultCaptureIsValid
          ? String(serverDefaultCaptureWorkspaceId)
          : savedDefaultCaptureIsValid
          ? String(savedDefaultCaptureWorkspaceId)
          : response.defaultWorkspaceId && validWorkspaceIds.has(response.defaultWorkspaceId)
            ? response.defaultWorkspaceId
            : firstWorkspaceId,
        defaultSiriWorkspaceId: nextDefaultSiriWorkspaceId,
        siriAskEveryTime: serverSiriAskEveryTime,
        rememberLastWorkspace,
      });
    } catch {
      const savedWorkspaceId = await SecureStore.getItemAsync(WORKSPACE_STORAGE_KEY).catch(() => null);
      const savedTodayScopeWorkspaceId = await SecureStore.getItemAsync(TODAY_SCOPE_STORAGE_KEY).catch(() => null);
      const savedDefaultCaptureWorkspaceId = await SecureStore.getItemAsync(DEFAULT_CAPTURE_STORAGE_KEY).catch(() => null);
      const savedDefaultSiriWorkspaceId = await SecureStore.getItemAsync(DEFAULT_SIRI_STORAGE_KEY).catch(() => null);
      const savedRememberLastWorkspace = await SecureStore.getItemAsync(REMEMBER_LAST_WORKSPACE_STORAGE_KEY).catch(() => null);
      setWorkspaceState({
        isLoading: false,
        isHydrated: true,
        options: mockWorkspaceScopeOptions,
        error: null,
        selectedWorkspaceId:
          state.hasUserSelectedWorkspace || state.selectedWorkspaceId !== 'all'
            ? state.selectedWorkspaceId
            : mockWorkspaceScopeOptions.find((option) => option.id !== 'all')?.id ?? 'all',
        todayScopeWorkspaceId:
          savedTodayScopeWorkspaceId && mockWorkspaceScopeOptions.some((option) => option.id === savedTodayScopeWorkspaceId)
            ? savedTodayScopeWorkspaceId
            : 'all',
        defaultCaptureWorkspaceId:
          savedDefaultCaptureWorkspaceId &&
          mockWorkspaceScopeOptions.some((option) => option.id === savedDefaultCaptureWorkspaceId)
            ? savedDefaultCaptureWorkspaceId
            : mockWorkspaceScopeOptions.find((option) => option.id !== 'all')?.id ?? 'all',
        defaultSiriWorkspaceId:
          savedDefaultSiriWorkspaceId &&
          mockWorkspaceScopeOptions.some((option) => option.id === savedDefaultSiriWorkspaceId)
            ? savedDefaultSiriWorkspaceId
            : mockWorkspaceScopeOptions.find((option) => option.id !== 'all')?.id ?? 'all',
        siriAskEveryTime: false,
        rememberLastWorkspace: savedRememberLastWorkspace === null ? true : savedRememberLastWorkspace === 'true',
      });
    }
  })();

  try {
    await hydrationPromise;
  } finally {
    hydrationPromise = null;
  }
}
