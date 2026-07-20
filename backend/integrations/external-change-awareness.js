import { resolveExternalReference } from './external-references.js';

export const CHANGE_STATES = new Set(['unknown', 'current', 'updated', 'checking', 'unavailable', 'error']);

const latestPreview = async (supabase, workspaceId, referenceId) => {
  const result = await supabase
    .from('external_reference_previews')
    .select('captured_at, source_last_modified_at, source_version, status')
    .eq('workspace_id', workspaceId)
    .eq('external_reference_id', referenceId)
    .eq('status', 'ready')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
};

export const getExternalReferenceChangeState = async ({ supabase, workspaceId, referenceId }) => {
  const result = await supabase.from('external_reference_change_states').select('*').eq('workspace_id', workspaceId).eq('external_reference_id', referenceId).maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? { external_reference_id: referenceId, workspace_id: workspaceId, change_state: 'unknown' };
};

const saveState = async (supabase, state) => {
  const result = await supabase.from('external_reference_change_states').upsert({ ...state, updated_at: new Date().toISOString() }, { onConflict: 'external_reference_id' }).select('*').single();
  if (result.error) throw result.error;
  return result.data;
};

export const sourceIsNewer = ({ sourceLastModifiedAt, sourceVersion, preview }) => {
  if (sourceVersion && preview?.source_version) return sourceVersion !== preview.source_version;
  if (!sourceLastModifiedAt || !preview) return false;
  if (preview.source_last_modified_at) return new Date(sourceLastModifiedAt).getTime() > new Date(preview.source_last_modified_at).getTime();
  return new Date(sourceLastModifiedAt).getTime() > new Date(preview.captured_at).getTime();
};

export const checkExternalReferenceChange = async ({ supabase, workspaceId, referenceId, requestedByUserId, getConnection }) => {
  const checkingAt = new Date().toISOString();
  const previous = await getExternalReferenceChangeState({ supabase, workspaceId, referenceId });
  await saveState(supabase, { ...previous, external_reference_id: referenceId, workspace_id: workspaceId, change_state: 'checking', last_checked_at: checkingAt, error_code: null });
  try {
    const reference = await resolveExternalReference({ supabase, workspaceId, referenceId, requestedByUserId, getConnection });
    const preview = await latestPreview(supabase, workspaceId, referenceId);
    const sourceLastModifiedAt = reference.metadata?.lastModifiedAt ?? null;
    const sourceVersion = reference.metadata?.version ?? reference.metadata?.fileVersion ?? null;
    const unavailable = ['connection_required', 'inaccessible', 'revoked', 'not_found'].includes(reference.access_status);
    const changeState = unavailable ? 'unavailable' : sourceIsNewer({ sourceLastModifiedAt, sourceVersion, preview }) ? 'updated' : sourceLastModifiedAt ? 'current' : 'unknown';
    return saveState(supabase, {
      external_reference_id: referenceId,
      workspace_id: workspaceId,
      change_state: changeState,
      source_last_modified_at: sourceLastModifiedAt,
      source_version: sourceVersion,
      preview_captured_at: preview?.captured_at ?? null,
      preview_source_modified_at: preview?.source_last_modified_at ?? null,
      preview_source_version: preview?.source_version ?? null,
      last_checked_at: checkingAt,
      error_code: null,
    });
  } catch (error) {
    await saveState(supabase, { ...previous, external_reference_id: referenceId, workspace_id: workspaceId, change_state: 'error', last_checked_at: checkingAt, error_code: error?.accessStatus || 'check_failed' });
    return getExternalReferenceChangeState({ supabase, workspaceId, referenceId });
  }
};

export const markExternalReferenceCurrent = async ({ supabase, workspaceId, referenceId, preview }) => {
  const reference = await supabase.from('external_references').select('metadata').eq('workspace_id', workspaceId).eq('id', referenceId).maybeSingle();
  if (reference.error) throw reference.error;
  return saveState(supabase, {
    external_reference_id: referenceId,
    workspace_id: workspaceId,
    change_state: 'current',
    source_last_modified_at: reference.data?.metadata?.lastModifiedAt ?? null,
    source_version: reference.data?.metadata?.version ?? reference.data?.metadata?.fileVersion ?? null,
    preview_captured_at: preview?.captured_at ?? null,
    preview_source_modified_at: preview?.source_last_modified_at ?? null,
    preview_source_version: preview?.source_version ?? null,
    last_checked_at: new Date().toISOString(),
    error_code: null,
  });
};

export const getFigmaAutomationSettings = async ({ supabase, workspaceId }) => {
  const result = await supabase.from('figma_workspace_automation_settings').select('workspace_id, change_detection_enabled, notify_linked_work, automatically_refresh_previews, create_intake_on_change, webhook_health, webhook_id, webhook_event_type, last_webhook_at, updated_at').eq('workspace_id', workspaceId).maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? { workspace_id: workspaceId, change_detection_enabled: true, notify_linked_work: false, automatically_refresh_previews: false, create_intake_on_change: false, webhook_health: 'not_configured' };
};

export const updateFigmaAutomationSettings = async ({ supabase, workspaceId, values }) => {
  const result = await supabase.from('figma_workspace_automation_settings').upsert({ workspace_id: workspaceId, change_detection_enabled: values.change_detection_enabled !== false, notify_linked_work: values.notify_linked_work === true, automatically_refresh_previews: values.automatically_refresh_previews === true, create_intake_on_change: values.create_intake_on_change === true, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' }).select('workspace_id, change_detection_enabled, notify_linked_work, automatically_refresh_previews, create_intake_on_change, webhook_health, webhook_id, webhook_event_type, last_webhook_at, updated_at').single();
  if (result.error) throw result.error;
  return result.data;
};

export const markFigmaReferencesForCheck = async ({ supabase, workspaceId, fileKey }) => {
  const references = await supabase.from('external_references').select('id, metadata').eq('workspace_id', workspaceId).eq('provider', 'figma').is('deleted_at', null);
  if (references.error) throw references.error;
  const ids = (references.data ?? []).filter((row) => String(row.metadata?.fileKey ?? '') === String(fileKey)).map((row) => row.id);
  if (!ids.length) return 0;
  const rows = ids.map((id) => ({ external_reference_id: id, workspace_id: workspaceId, change_state: 'checking', last_checked_at: new Date().toISOString() }));
  const result = await supabase.from('external_reference_change_states').upsert(rows, { onConflict: 'external_reference_id' });
  if (result.error) throw result.error;
  return ids.length;
};
