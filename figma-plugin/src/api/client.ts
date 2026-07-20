import type { ExternalReferenceChangeState, LinkedWorkResponse, LinkedWorkSummary, PluginResult, PluginTarget, PluginWorkEditOptions, UserSummary, Workspace } from '../types';

declare const __LEDGER_API_ORIGIN__: string;
const API_ORIGIN = __LEDGER_API_ORIGIN__.replace(/\/$/, '');
const request = async <T>(path: string, options: RequestInit = {}, credential?: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(String(body?.error || `Request failed: ${response.status}`)); (error as Error & { status?: number }).status = response.status; throw error; }
    return body as T;
  } finally { window.clearTimeout(timeout); }
};
export const createAuthSession = (pluginSession: string, scopes?: string[]) => request<{ session_id: string; verification_code: string; poll_secret: string; expires_at: string; authorization_url: string }>('/api/figma-plugin/auth/sessions', { method: 'POST', body: JSON.stringify({ client_id: 'ledger-figma-plugin', plugin_session: pluginSession, ...(scopes ? { scopes } : {}) }) });
export const pollAuthSession = (sessionId: string, pollSecret: string) => request<{ status: 'pending' | 'approved' | 'expired' | 'cancelled'; credential?: string; scopes?: string[] }>('/api/figma-plugin/auth/poll', { method: 'POST', body: JSON.stringify({ session_id: sessionId, poll_secret: pollSecret }) });
export const cancelAuthSession = (sessionId: string) => request('/api/figma-plugin/auth/cancel', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) });
export const getPluginSession = (credential: string) => request<{ user: UserSummary; scopes: string[]; expires_at: string }>('/api/figma-plugin/session', {}, credential);
export const getWorkspaces = (credential: string) => request<Workspace[]>('/api/figma-plugin/workspaces', {}, credential);
export const revokePluginSession = (credential: string) => request('/api/figma-plugin/auth/revoke', { method: 'POST' }, credential);
const pluginRequest = <T,>(path: string, credential: string, workspaceId: string, body?: unknown, method = 'POST', idempotencyKey?: string) => request<T>(path, { method, headers: { 'X-Workspace-Id': workspaceId, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, credential);
export const resolvePluginIdentity = (credential: string, workspaceId: string, figmaUrl: string, selection: unknown) => pluginRequest<{ canonical_url: string; node_id: string }>('/api/figma-plugin/identity', credential, workspaceId, { figma_url: figmaUrl, selection });
export const searchPluginWork = (credential: string, workspaceId: string, query: string) => pluginRequest<PluginTarget[]>(`/api/figma-plugin/search?q=${encodeURIComponent(query)}`, credential, workspaceId, undefined, 'GET');
export const createPluginIntake = (credential: string, workspaceId: string, body: unknown, key: string) => pluginRequest<PluginResult>('/api/figma-plugin/intake', credential, workspaceId, body, 'POST', key);
export const createPluginTask = (credential: string, workspaceId: string, body: unknown, key: string) => pluginRequest<PluginResult>('/api/figma-plugin/tasks', credential, workspaceId, body, 'POST', key);
export const linkPluginWork = (credential: string, workspaceId: string, body: unknown) => pluginRequest<PluginResult>('/api/figma-plugin/links', credential, workspaceId, body);
export const getPluginLinkedWork = (credential: string, workspaceId: string, body: unknown) => pluginRequest<LinkedWorkResponse>('/api/figma-plugin/linked-work', credential, workspaceId, body);
export const checkPluginChangeState = (credential: string, workspaceId: string, body: unknown) => pluginRequest<ExternalReferenceChangeState & { canonical_url?: string; external_reference_id?: string | null }>('/api/figma-plugin/change-state', credential, workspaceId, body);
export const refreshPluginPreview = (credential: string, workspaceId: string, body: unknown, key: string) => pluginRequest<{ change_state: string; preview?: unknown; error?: string }>('/api/figma-plugin/preview/refresh', credential, workspaceId, body, 'POST', key);
export const unlinkPluginWork = (credential: string, workspaceId: string, body: unknown) => pluginRequest<{ removed: boolean; relationship_exists: boolean; remaining_sources?: string[]; canonical_url: string }>('/api/figma-plugin/unlink', credential, workspaceId, body);
export const getPluginEditOptions = (credential: string, workspaceId: string, targetType: string, targetId: string) => pluginRequest<PluginWorkEditOptions>(`/api/figma-plugin/work/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/edit-options`, credential, workspaceId, undefined, 'GET');
export const updatePluginWorkProperty = (credential: string, workspaceId: string, targetType: string, targetId: string, body: unknown, idempotencyKey: string) => pluginRequest<{ target: LinkedWorkSummary; property: string; updated_at: string | null }>(`/api/figma-plugin/work/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`, credential, workspaceId, body, 'PATCH', idempotencyKey);
