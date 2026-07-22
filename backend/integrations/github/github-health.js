const SAFE_ERROR_CODES = new Set([
  'github_rate_limited',
  'github_temporarily_unavailable',
  'github_permission_changed',
  'github_object_not_found',
  'installation_token_failed',
  'repository_sync_failed',
  'webhook_processing_failed',
]);

export const githubSafeErrorCode = (error, fallback = 'github_temporarily_unavailable') => {
  const candidate = String(error?.code ?? error?.errorCode ?? '').trim();
  if (SAFE_ERROR_CODES.has(candidate)) return candidate;
  if (Number(error?.status ?? error?.githubStatus) === 429) return 'github_rate_limited';
  if ([403, 404].includes(Number(error?.status ?? error?.githubStatus))) return 'github_permission_changed';
  return SAFE_ERROR_CODES.has(fallback) ? fallback : 'github_temporarily_unavailable';
};

export const githubSafeErrorMessage = (error) => {
  const code = githubSafeErrorCode(error);
  const messages = {
    github_rate_limited: 'GitHub is temporarily rate limited. Try again shortly.',
    github_permission_changed: 'GitHub access changed. Refresh access to continue.',
    github_object_not_found: 'This GitHub item is no longer available.',
    installation_token_failed: 'Ledger could not refresh GitHub access.',
    repository_sync_failed: 'Ledger could not finish syncing repositories.',
    webhook_processing_failed: 'Ledger could not finish processing a GitHub update.',
    github_temporarily_unavailable: 'GitHub could not be reached. Existing links remain available.',
  };
  return messages[code];
};

export const githubConnectionHealth = ({ installationStatus, repositoryCount = 0, lastSyncedAt, lastWebhookProcessedAt, lastErrorAt, now = Date.now() }) => {
  const status = String(installationStatus ?? '').toLowerCase();
  if (!installationStatus) return { state: 'disconnected', label: 'Disconnected' };
  if (status === 'suspended') return { state: 'suspended', label: 'Suspended' };
  if (status === 'deleted') return { state: 'disconnected', label: 'Disconnected' };
  if (status === 'error') return { state: 'action_required', label: 'Action required' };
  if (lastErrorAt && (!lastSyncedAt || new Date(lastErrorAt).getTime() >= new Date(lastSyncedAt).getTime())) return { state: 'action_required', label: 'Action required' };
  if (!lastSyncedAt) return { state: 'syncing', label: 'Syncing' };
  const syncedAt = new Date(lastSyncedAt).getTime();
  const webhookAt = lastWebhookProcessedAt ? new Date(lastWebhookProcessedAt).getTime() : 0;
  if (!Number.isFinite(syncedAt) || (webhookAt && !Number.isFinite(webhookAt))) return { state: 'delayed', label: 'Delayed' };
  if (now - syncedAt > 30 * 60 * 1000) return { state: 'delayed', label: 'Delayed' };
  if (repositoryCount === 0) return { state: 'access_changed', label: 'Access changed' };
  return { state: 'connected', label: 'Connected' };
};

export const isStaleGithubEvent = ({ eventUpdatedAt, storedUpdatedAt }) => {
  if (!eventUpdatedAt || !storedUpdatedAt) return false;
  const eventTime = new Date(eventUpdatedAt).getTime();
  const storedTime = new Date(storedUpdatedAt).getTime();
  return Number.isFinite(eventTime) && Number.isFinite(storedTime) && eventTime < storedTime;
};
