import { parseFigmaUrl, getFigmaExternalIdentity } from './figma/figma-url-parser.js';
import { resolveFigmaMetadata, FigmaProviderError } from './figma/figma-adapter.js';
import { parseGithubUrl, getGithubExternalIdentity } from './github/github-url-parser.js';
import { resolveGithubMetadata, GithubProviderError } from './github/github-adapter.js';

const adapters = {
  figma: {
    parse: parseFigmaUrl,
    getExternalIdentity: getFigmaExternalIdentity,
    resolveMetadata: resolveFigmaMetadata,
  },
  github: {
    parse: parseGithubUrl,
    getExternalIdentity: getGithubExternalIdentity,
    resolveMetadata: resolveGithubMetadata,
  },
};
const allowedTargetTypes = new Set([
  'task',
  'project',
  'note',
  'meetingNote',
  'intake',
  'comment',
  'event',
  'reminder',
]);
const allowedLinkSources = new Set(['embed', 'manual', 'conversion', 'integration']);

const getAdapter = (provider) => {
  const adapter = adapters[String(provider ?? '').toLowerCase()];
  if (!adapter) {
    const error = new Error('Unsupported external reference provider');
    error.statusCode = 400;
    throw error;
  }
  return adapter;
};

export const parseExternalUrl = ({ provider, url }) => {
  const adapter = getAdapter(provider);
  return adapter.parse(url);
};

export const createOrGetExternalReference = async ({
  supabase,
  workspaceId,
  provider,
  url,
  createdByUserId,
}) => {
  const adapter = getAdapter(provider);
  const parsed = adapter.parse(url);
  const externalIdentity = adapter.getExternalIdentity(parsed);
  const existing = await supabase
    .from('external_references')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('external_identity', externalIdentity)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { reference: existing.data, reused: true, parsed };
  if (provider === 'github') {
    const candidates = await supabase.from('external_references').select('*').eq('workspace_id', workspaceId).eq('provider', 'github').eq('external_type', parsed.resourceKind).limit(100);
    if (candidates.error) throw candidates.error;
    const match = (candidates.data ?? []).find((candidate) => {
      const metadata = candidate.metadata ?? {};
      return String(metadata.owner ?? '').toLowerCase() === parsed.owner.toLowerCase()
        && String(metadata.repository ?? '').toLowerCase() === parsed.repository.toLowerCase()
        && (parsed.resourceKind === 'repository' || Number(metadata.number) === parsed.number);
    });
    if (match) return { reference: match, reused: true, parsed };
  }
  const insert = await supabase
    .from('external_references')
    .insert({
      workspace_id: workspaceId,
      provider,
      external_type: parsed.resourceKind,
      external_id: externalIdentity,
      external_identity: externalIdentity,
      external_url: parsed.provider === 'github' ? parsed.normalizedUrl : url,
      normalized_url: parsed.normalizedUrl,
      metadata: {
        fileKey: parsed.fileKey,
        ...(parsed.nodeId ? { nodeId: parsed.nodeId } : {}),
        ...(parsed.branchKey ? { branchKey: parsed.branchKey } : {}),
        ...(parsed.provider === 'github' ? { owner: parsed.owner, repository: parsed.repository, ...(parsed.number ? { number: parsed.number } : {}) } : {}),
      },
      access_status: 'unresolved',
      created_by_user_id: createdByUserId,
    })
    .select('*')
    .single();
  if (!insert.error) return { reference: insert.data, reused: false, parsed };
  if (insert.error.code === '23505') {
    const raced = await supabase
      .from('external_references')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .eq('external_identity', externalIdentity)
      .single();
    if (raced.error) throw raced.error;
    return { reference: raced.data, reused: true, parsed };
  }
  throw insert.error;
};

export const resolveExternalReference = async ({
  supabase,
  workspaceId,
  referenceId,
  requestedByUserId,
  getConnection,
}) => {
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
  const connection = await getConnection({
    workspaceId,
    requestedByUserId,
    provider: reference.provider,
    reference,
    parsed: getAdapter(reference.provider).parse(reference.external_url),
  });
  if (!connection?.access_token_encrypted) {
    const updated = await supabase
      .from('external_references')
      .update({ access_status: 'connection_required' })
      .eq('id', reference.id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  }
  const adapter = getAdapter(reference.provider);
  const parsed = adapter.parse(reference.external_url);
  try {
    const result = await adapter.resolveMetadata(parsed, {
      accessToken: connection.access_token_encrypted,
      connectionId: connection.id,
      approvedRepository: connection.approvedRepository,
    });
    const mergedMetadata = { ...(reference.metadata ?? {}), ...(result.metadata ?? {}) };
    const nodeType = String(result.metadata?.nodeType ?? '').toUpperCase();
    const resourceKindByNodeType = {
      PAGE: 'page',
      SECTION: 'section',
      FRAME: 'frame',
      COMPONENT: 'component',
      COMPONENT_SET: 'componentSet',
    };
    const externalType = reference.provider === 'figma'
      ? resourceKindByNodeType[nodeType] ?? reference.external_type
      : parsed.resourceKind;
    const immutableIdentity = reference.provider === 'github'
      ? `github:${String(result.metadata?.githubRepositoryId ?? parsed.owner + '/' + parsed.repository)}:${externalType}:${String(result.metadata?.githubId ?? 'repository')}`
      : null;
    const updated = await supabase
      .from('external_references')
      .update({
        metadata: mergedMetadata,
        external_type: externalType,
        ...(immutableIdentity ? { external_identity: immutableIdentity, external_id: immutableIdentity } : {}),
        access_status: result.accessStatus,
        last_resolved_at: new Date().toISOString(),
      })
      .eq('id', reference.id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  } catch (error) {
    const status = error instanceof FigmaProviderError || error instanceof GithubProviderError ? error.accessStatus : 'error';
    const updated = await supabase
      .from('external_references')
      .update({ access_status: status })
      .eq('id', reference.id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  }
};

export const linkExternalReference = async ({
  supabase,
  workspaceId,
  referenceId,
  targetType,
  targetId,
  createdByUserId,
  source = 'manual',
  linkMetadata = null,
  ensureTarget,
}) => {
  if (!allowedTargetTypes.has(targetType)) {
    const error = new Error('Unsupported external reference target');
    error.statusCode = 400;
    throw error;
  }
  if (!allowedLinkSources.has(source)) {
    const error = new Error('Unsupported external reference link source');
    error.statusCode = 400;
    throw error;
  }
  const targetExists = await ensureTarget({ workspaceId, targetType, targetId });
  if (!targetExists) {
    const error = new Error('Target object not found');
    error.statusCode = 404;
    throw error;
  }
  const reference = await supabase
    .from('external_references')
    .select('id, provider, external_type')
    .eq('workspace_id', workspaceId)
    .eq('id', referenceId)
    .maybeSingle();
  if (reference.error) throw reference.error;
  if (!reference.data) {
    const error = new Error('External reference not found');
    error.statusCode = 404;
    throw error;
  }
  if (reference.data.provider === 'github') {
    if (reference.data.external_type === 'repository' && targetType !== 'project') {
      const error = new Error('GitHub repositories can only be linked to projects'); error.statusCode = 400; throw error;
    }
    if (['issue', 'pullRequest'].includes(reference.data.external_type) && !['project', 'task', 'note', 'intake'].includes(targetType)) {
      const error = new Error('GitHub work can only be linked to projects, tasks, notes, or Intake'); error.statusCode = 400; throw error;
    }
    if (linkMetadata?.role && !['primary', 'supporting'].includes(String(linkMetadata.role))) {
      const error = new Error('Unsupported GitHub repository link role'); error.statusCode = 400; throw error;
    }
  }
  const existing = await supabase
    .from('external_reference_links')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('external_reference_id', referenceId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const sources = Array.from(new Set([...(existing.data.sources ?? ['manual']), source]));
    if (sources.length !== (existing.data.sources ?? []).length || linkMetadata) {
      const updated = await supabase.from('external_reference_links').update({ sources, ...(linkMetadata ? { link_metadata: linkMetadata } : {}) }).eq('id', existing.data.id).eq('workspace_id', workspaceId).select('*').single();
      if (updated.error) throw updated.error;
      return updated.data;
    }
    return existing.data;
  }
  const insert = await supabase
    .from('external_reference_links')
    .insert({
      workspace_id: workspaceId,
      external_reference_id: referenceId,
      target_type: targetType,
      target_id: targetId,
      created_by_user_id: createdByUserId,
      sources: [source],
      link_metadata: linkMetadata ?? {},
    })
    .select('*')
    .single();
  if (insert.error && insert.error.code === '23505') {
    const raced = await supabase
      .from('external_reference_links')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('external_reference_id', referenceId)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .single();
    if (raced.error) throw raced.error;
    return raced.data;
  }
  if (insert.error) throw insert.error;
  return insert.data;
};

export const unlinkExternalReference = async ({ supabase, workspaceId, referenceId, linkId, source = null }) => {
  if (source) {
    const existing = await supabase.from('external_reference_links').select('id, sources').eq('workspace_id', workspaceId).eq('external_reference_id', referenceId).eq('id', linkId).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return { removed: false };
    const sources = (existing.data.sources ?? ['manual']).filter((value) => value !== source);
    if (sources.length > 0) {
      const updated = await supabase.from('external_reference_links').update({ sources }).eq('id', linkId).eq('workspace_id', workspaceId).select('id').single();
      if (updated.error) throw updated.error;
      return { removed: false, sourceRemoved: true };
    }
  }
  const result = await supabase
    .from('external_reference_links')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('external_reference_id', referenceId)
    .eq('id', linkId)
    .select('id')
    .maybeSingle();
  if (result.error) throw result.error;
  return { removed: Boolean(result.data?.id) };
};

export const getExternalReferencesForTarget = async ({
  supabase,
  workspaceId,
  targetType,
  targetId,
}) => {
  const links = await supabase
    .from('external_reference_links')
    .select(
      'id, external_reference_id, target_type, target_id, created_by_user_id, created_at, external_references(*)'
    )
    .eq('workspace_id', workspaceId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('created_at', { ascending: true });
  if (links.error) throw links.error;
  return links.data ?? [];
};

export const searchExternalReferences = async ({ supabase, workspaceId, provider = null, query = '', limit = 30 }) => {
  let request = supabase
    .from('external_references')
    .select('id, workspace_id, provider, external_type, external_url, normalized_url, metadata, access_status, last_resolved_at, created_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 30, 1), 50));
  if (provider) request = request.eq('provider', String(provider).trim().toLowerCase());
  const trimmed = String(query ?? '').trim();
  if (trimmed) request = request.or(`normalized_url.ilike.%${trimmed}%,external_url.ilike.%${trimmed}%,metadata->>fileName.ilike.%${trimmed}%,metadata->>nodeName.ilike.%${trimmed}%,metadata->>fullName.ilike.%${trimmed}%,metadata->>title.ilike.%${trimmed}%`);
  const result = await request;
  if (result.error) throw result.error;
  return result.data ?? [];
};
