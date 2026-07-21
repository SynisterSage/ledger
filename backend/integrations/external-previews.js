import { fetchFigmaPreviewImage, FigmaProviderError } from './figma/figma-adapter.js';
import { parseFigmaUrl } from './figma/figma-url-parser.js';
import { markExternalReferenceCurrent } from './external-change-awareness.js';

const PREVIEW_BUCKET = 'note-images';
const MAX_PREVIEW_AGE_MS = 10 * 60 * 1000;
const inFlight = new Map();
const FIGMA_PREVIEW_POLICY_VERSION = '2026-07-20';
const isMissingPreviewVersionColumn = (error) => error?.code === 'PGRST204' || error?.code === '42703';

export const getFigmaPreviewConsent = async ({ supabase, workspaceId }) => {
  const result = await supabase.from('figma_workspace_settings').select('*').eq('workspace_id', workspaceId).maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? { workspace_id: workspaceId, preview_sharing_accepted: false, preview_sharing_policy_version: FIGMA_PREVIEW_POLICY_VERSION };
};

// Cleanup is intentionally callable by the existing maintenance runner rather
// than running from renderer lifecycle events. The delay protects undo/restore
// and lets concurrent link operations settle before assets are removed.
export const cleanupOrphanedFigmaData = async ({ supabase, workspaceId, retentionDays = 30 }) => {
  const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86400000).toISOString();
  const links = await supabase.from('external_reference_links').select('external_reference_id').eq('workspace_id', workspaceId);
  if (links.error) throw links.error;
  const activeIds = new Set((links.data ?? []).map((row) => row.external_reference_id));
  const refs = await supabase.from('external_references').select('id').eq('workspace_id', workspaceId).eq('provider', 'figma').is('deleted_at', null);
  if (refs.error) throw refs.error;
  const orphanIds = (refs.data ?? []).map((row) => row.id).filter((id) => !activeIds.has(id));
  if (!orphanIds.length) return { references: 0, previews: 0 };
  const previews = await supabase.from('external_reference_previews').select('id, storage_key').eq('workspace_id', workspaceId).in('external_reference_id', orphanIds).lt('created_at', cutoff);
  if (previews.error) throw previews.error;
  const keys = (previews.data ?? []).map((row) => row.storage_key).filter(Boolean);
  if (keys.length) await supabase.storage.from(PREVIEW_BUCKET).remove(keys);
  if (previews.data?.length) await supabase.from('external_reference_previews').delete().eq('workspace_id', workspaceId).in('id', previews.data.map((row) => row.id));
  const remaining = await supabase.from('external_reference_previews').select('external_reference_id').eq('workspace_id', workspaceId).in('external_reference_id', orphanIds);
  if (remaining.error) throw remaining.error;
  const stillUsed = new Set((remaining.data ?? []).map((row) => row.external_reference_id));
  const deletable = orphanIds.filter((id) => !stillUsed.has(id));
  if (deletable.length) await supabase.from('external_references').delete().eq('workspace_id', workspaceId).in('id', deletable);
  return { references: deletable.length, previews: previews.data?.length ?? 0 };
};

const getLatestReady = async (supabase, workspaceId, referenceId) => {
  const result = await supabase
    .from('external_reference_previews')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('external_reference_id', referenceId)
    .eq('status', 'ready')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
};

export const mapPreviewResponse = async (supabase, preview) => {
  if (!preview) return null;
  const signed = await supabase.storage.from(PREVIEW_BUCKET).createSignedUrl(preview.storage_key, 300);
  const publicUrl = signed.error
    ? supabase.storage.from(PREVIEW_BUCKET).getPublicUrl(preview.storage_key)?.data?.publicUrl ?? null
    : null;
  return {
    id: preview.id,
    workspaceId: preview.workspace_id,
    externalReferenceId: preview.external_reference_id,
    url: signed.error ? publicUrl : signed.data?.signedUrl ?? null,
    mimeType: preview.mime_type,
    width: preview.width ?? null,
    height: preview.height ?? null,
    fileSize: preview.file_size ?? null,
    capturedAt: preview.captured_at,
    sourceLastModifiedAt: preview.source_last_modified_at ?? null,
    sourceVersion: preview.source_version ?? null,
    status: preview.status,
  };
};

export const getExternalReferencePreview = async ({ supabase, workspaceId, referenceId }) =>
  mapPreviewResponse(supabase, await getLatestReady(supabase, workspaceId, referenceId));

export const generateExternalReferencePreview = async ({
  supabase,
  workspaceId,
  referenceId,
  createdByUserId,
  getConnection,
  force = false,
  fetchImpl = fetch,
}) => {
  const key = `${workspaceId}:${referenceId}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const work = (async () => {
    const referenceResult = await supabase
      .from('external_references')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', referenceId)
      .maybeSingle();
    if (referenceResult.error) throw referenceResult.error;
    if (!referenceResult.data) {
      const error = new Error('External reference not found');
      error.statusCode = 404;
      throw error;
    }
    const reference = referenceResult.data;
    const previous = await getLatestReady(supabase, workspaceId, referenceId);
    const previousResponse = await mapPreviewResponse(supabase, previous);
    if (!force && previous && previousResponse?.url && Date.now() - new Date(previous.captured_at).getTime() < MAX_PREVIEW_AGE_MS) {
      return { preview: previousResponse, reused: true, accessStatus: reference.access_status };
    }
    const connection = await getConnection({ workspaceId, provider: 'figma', requestedByUserId: createdByUserId });
    if (!connection?.access_token_encrypted) return { preview: previousResponse, reused: false, accessStatus: 'connection_required' };
    const consent = await getFigmaPreviewConsent({ supabase, workspaceId });
    if (!consent.preview_sharing_accepted || consent.preview_sharing_policy_version !== FIGMA_PREVIEW_POLICY_VERSION) return { preview: previousResponse, reused: false, accessStatus: reference.access_status, consentRequired: true };
    const parsed = parseFigmaUrl(reference.external_url);
    if (!parsed.nodeId) return { preview: previousResponse, reused: false, accessStatus: reference.access_status || 'accessible', noPreview: true };

    const sourceVersion = reference.metadata?.version ?? reference.metadata?.fileVersion ?? null;
    const pendingPayload = { workspace_id: workspaceId, external_reference_id: referenceId, storage_key: `pending/${referenceId}`, mime_type: 'image/png', file_size: 0, captured_at: new Date().toISOString(), source_last_modified_at: reference.metadata?.lastModifiedAt ?? null, source_version: sourceVersion, created_by_user_id: createdByUserId, status: 'pending' };
    let pending = await supabase.from('external_reference_previews').insert(pendingPayload).select('*').single();
    // Keep preview capture usable while a deployment is waiting for the
    // Phase 11 source_version migration. The richer version state will be
    // populated automatically on the next capture after migration.
    if (pending.error && isMissingPreviewVersionColumn(pending.error)) {
      const { source_version: _sourceVersion, ...legacyPayload } = pendingPayload;
      pending = await supabase.from('external_reference_previews').insert(legacyPayload).select('*').single();
    }
    if (pending.error) throw pending.error;
    try {
      const image = await fetchFigmaPreviewImage(parsed, { accessToken: connection.access_token_encrypted, fetchImpl });
      if (!image) return { preview: previousResponse, reused: false, accessStatus: reference.access_status || 'accessible', noPreview: true };
      const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1];
      const storageKey = `workspaces/${workspaceId}/external-previews/${referenceId}/${Date.now()}.${extension}`;
      const upload = await supabase.storage.from(PREVIEW_BUCKET).upload(storageKey, image.buffer, { contentType: image.contentType, cacheControl: '31536000', upsert: false });
      if (upload.error) throw new Error('Preview storage failed');
      const readyPayload = { storage_key: storageKey, mime_type: image.contentType, file_size: image.buffer.length, captured_at: new Date().toISOString(), source_last_modified_at: reference.metadata?.lastModifiedAt ?? null, source_version: sourceVersion, status: 'ready' };
      let ready = await supabase.from('external_reference_previews').update(readyPayload).eq('id', pending.data.id).eq('workspace_id', workspaceId).select('*').single();
      if (ready.error && isMissingPreviewVersionColumn(ready.error)) {
        const { source_version: _sourceVersion, ...legacyPayload } = readyPayload;
        ready = await supabase.from('external_reference_previews').update(legacyPayload).eq('id', pending.data.id).eq('workspace_id', workspaceId).select('*').single();
      }
      if (ready.error) throw ready.error;
      // A preview is valid even when the optional change-awareness tables are
      // temporarily unavailable during rollout.
      try { await markExternalReferenceCurrent({ supabase, workspaceId, referenceId, preview: ready.data }); } catch { /* version state can be repaired by the next check */ }
      return { preview: await mapPreviewResponse(supabase, ready.data), reused: false, accessStatus: 'accessible', changeState: 'current' };
    } catch (error) {
      const status = error instanceof FigmaProviderError ? error.accessStatus : 'error';
      console.error('Figma preview capture failed', { workspaceId, referenceId, accessStatus: status, error: error instanceof Error ? error.message : 'unknown_error' });
      await supabase.from('external_reference_previews').update({ status: 'error' }).eq('id', pending.data.id).eq('workspace_id', workspaceId);
      await supabase.from('external_references').update({ access_status: status }).eq('id', referenceId).eq('workspace_id', workspaceId);
      return { preview: previousResponse, reused: false, accessStatus: status, error: status === 'revoked' ? 'Figma authorization needs to be renewed.' : 'Ledger couldn’t load this Figma preview.' };
    }
  })();
  inFlight.set(key, work);
  try { return await work; } finally { inFlight.delete(key); }
};
