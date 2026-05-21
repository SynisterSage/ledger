export const API_BASE = 'https://api.ledgerworkspace.com';

export type CaptureType = 'link' | 'selection' | 'manual';

export type ExtensionWorkspace = {
  id: string;
  name: string;
  owner_id?: string | null;
  is_personal?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExtensionMeResponse = {
  ok: boolean;
  user: {
    id: string;
    email?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  };
  default_workspace_id: string | null;
  default_workspace: ExtensionWorkspace | null;
};

export type ExtensionWorkspacesResponse = {
  ok: boolean;
  default_workspace_id: string | null;
  workspaces: ExtensionWorkspace[];
};

export type BrowserCapturePayload = {
  capture_type: CaptureType;
  title: string;
  body: string | null;
  source_url: string | null;
  workspace_id: string | null;
  project_id: string | null;
  raw_payload: Record<string, unknown>;
};

export type BrowserCaptureResponse = {
  ok: boolean;
  item: {
    id: string;
    workspace_id: string;
    title: string;
    body: string | null;
    source: string;
    source_url: string | null;
    status: string;
  };
};

type StorageState = {
  extension_token?: string;
  default_workspace_id?: string | null;
};

const storageGet = (keys: string[] | string) =>
  new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });

const storageSet = (value: Record<string, unknown>) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });

const storageRemove = (keys: string[] | string) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });

export const getStoredToken = async () => {
  const result = (await storageGet('extension_token')) as StorageState;
  return String(result.extension_token ?? '').trim() || null;
};

export const setStoredToken = async (token: string) => {
  await storageSet({ extension_token: String(token ?? '').trim() });
};

export const clearStoredToken = async () => {
  await storageRemove(['extension_token', 'default_workspace_id']);
};

export const setStoredWorkspaceId = async (workspaceId: string | null) => {
  await storageSet({ default_workspace_id: workspaceId ?? null });
};

export const getStoredWorkspaceId = async () => {
  const result = (await storageGet('default_workspace_id')) as StorageState;
  return result.default_workspace_id ?? null;
};

export const getAuthHeaders = async () => {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('Connect Ledger first.');
  }
  return { Authorization: `Bearer ${token}` };
};

export const apiJson = async <T>(
  path: string,
  init: RequestInit = {},
  token?: string | null
): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : await getAuthHeaders()),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
};

export const saveBrowserCapture = async (payload: BrowserCapturePayload) =>
  apiJson<BrowserCaptureResponse>('/api/inbox/browser', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const loadExtensionMe = async () =>
  apiJson<ExtensionMeResponse>('/api/extension/me', { method: 'GET' });

export const loadExtensionWorkspaces = async () =>
  apiJson<ExtensionWorkspacesResponse>('/api/extension/workspaces', { method: 'GET' });

export const truncate = (value: string, maxLength: number) => {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
};

export const firstLine = (value: string) => {
  const line = String(value ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? '';
};

export const normalizeUrl = (value: string | null | undefined) => {
  const url = String(value ?? '').trim();
  return url || null;
};
