const activeTarget = (targetType, targetId) => targetType !== 'task' || Boolean(targetId);

const safeText = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const githubReferenceMatches = ({ reference, repositoryId, githubId, nodeId, number, resourceKind }) => {
  if (!reference || reference.provider !== 'github') return false;
  const metadata = reference.metadata ?? {};
  if (String(metadata.githubRepositoryId ?? '') !== String(repositoryId ?? '')) return false;
  if (resourceKind && String(reference.external_type) !== String(resourceKind)) return false;
  return (githubId && String(metadata.githubId ?? '') === String(githubId)) ||
    (nodeId && String(metadata.githubNodeId ?? '') === String(nodeId)) ||
    (number != null && Number(metadata.number) === Number(number));
};

export const findLinkedGithubReferences = async ({ supabase, workspaceId, repositoryId, githubId, nodeId, number, resourceKind }) => {
  const references = await supabase.from('external_references').select('id, workspace_id, provider, external_type, external_id, external_url, normalized_url, metadata, access_status, updated_at').eq('workspace_id', workspaceId).eq('provider', 'github').limit(500);
  if (references.error) throw references.error;
  const matches = (references.data ?? []).filter((reference) => githubReferenceMatches({ reference, repositoryId, githubId, nodeId, number, resourceKind }));
  if (!matches.length) return [];
  const links = await supabase.from('external_reference_links').select('id, external_reference_id, target_type, target_id, link_metadata').eq('workspace_id', workspaceId).in('external_reference_id', matches.map((reference) => reference.id));
  if (links.error) throw links.error;
  const byReference = new Map(matches.map((reference) => [reference.id, []]));
  for (const link of links.data ?? []) byReference.get(link.external_reference_id)?.push(link);
  return matches.filter((reference) => (byReference.get(reference.id) ?? []).length).map((reference) => ({ ...reference, links: byReference.get(reference.id) ?? [] }));
};

const targetLabel = (link) => link.target_type === 'project' ? 'project' : link.target_type === 'note' ? 'note' : ['inbox', 'intake'].includes(link.target_type) ? 'Intake item' : 'task';
const focusPayload = (link) => ({
  kind: ['inbox', 'intake'].includes(link.target_type) ? 'inbox' : link.target_type === 'note' ? 'notes' : link.target_type === 'project' ? 'projects' : 'dashboard',
  ...(link.target_type === 'intake' || link.target_type === 'inbox' ? { focusInboxId: link.target_id } : {}),
  ...(link.target_type === 'project' ? { focusProjectId: link.target_id } : {}),
  ...(link.target_type === 'note' ? { focusNoteId: link.target_id } : {}),
  ...(link.target_type === 'task' ? { focusTaskId: link.target_id } : {}),
});

export const githubAttentionFingerprint = (attentionType, referenceId, targetType, targetId) => `${attentionType}:${referenceId}:${targetType}:${targetId}`;

const signalDefinitions = ({ reference, link, metadata }) => {
  const result = [];
  const title = safeText(metadata.title || `${metadata.resourceKind === 'pullRequest' ? 'Pull request' : 'Issue'} #${metadata.number}`);
  const base = { title, metadata: { externalReferenceId: reference.id, canonicalUrl: metadata.canonicalUrl, repositoryFullName: metadata.repositoryFullName } };
  if (metadata.resourceKind === 'pullRequest') {
    const review = metadata.reviewSummary ?? {};
    const checks = metadata.checksSummary ?? {};
    if (Number(review.reviewRequestedCount) > 0) result.push({ attentionType: 'github_review_requested', reason: `Review requested on ${title}`, ...base });
    if (Number(review.changesRequestedCount) > 0) result.push({ attentionType: 'github_changes_requested', reason: `Changes requested on ${title}`, ...base });
    if (checks.overallState === 'failing') result.push({ attentionType: 'github_checks_failing', reason: `${title} has failing checks`, ...base });
    if (metadata.state === 'closed' && !metadata.mergedAt) result.push({ attentionType: 'github_pr_closed_without_merge', reason: `${title} closed without merging`, ...base });
  } else if (metadata.state === 'closed' && link.target_type === 'task') {
    result.push({ attentionType: 'github_issue_closed_task_open', reason: `Linked GitHub issue is closed but this task is still open`, ...base });
  }
  if (['inaccessible', 'not_found', 'revoked'].includes(reference.access_status)) result.push({ attentionType: 'github_repository_unavailable', reason: 'GitHub access is no longer available', ...base });
  return result.map((signal) => ({ ...signal, link, fingerprint: githubAttentionFingerprint(signal.attentionType, reference.id, link.target_type, link.target_id) }));
};

const notificationUsers = async (supabase, workspaceId) => {
  const [workspace, members] = await Promise.all([
    supabase.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle(),
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId),
  ]);
  if (workspace.error) throw workspace.error;
  if (members.error) throw members.error;
  return [...new Set([workspace.data?.owner_id, ...(members.data ?? []).map((member) => member.user_id)].filter(Boolean))];
};

const insertAttentionNotification = async ({ supabase, workspaceId, signal, eventTime }) => {
  const users = await notificationUsers(supabase, workspaceId);
  if (!users.length) return;
  const scheduledFor = eventTime || new Date().toISOString();
  const payload = users.map((userId) => ({
    user_id: userId,
    workspace_id: workspaceId,
    source_type: 'github_attention',
    source_id: signal.fingerprint,
    notification_type: signal.attentionType,
    scheduled_for: scheduledFor,
    delivered_in_app_at: scheduledFor,
    metadata: {
      title: signal.title,
      body: signal.reason,
      context: signal.link ? `Linked ${targetLabel(signal.link)}` : 'Linked GitHub work',
      moduleKind: focusPayload(signal.link).kind,
      focusPayload: focusPayload(signal.link),
      actions: ['open', 'dismiss'],
      githubUrl: signal.metadata?.canonicalUrl ?? null,
    },
  }));
  const result = await supabase.from('notification_events').upsert(payload, { onConflict: 'user_id,source_type,source_id,notification_type,scheduled_for', ignoreDuplicates: true });
  if (result.error) throw result.error;
};

export const reconcileGithubAttention = async ({ supabase, workspaceId, reference, eventTime = null }) => {
  const links = reference.links ?? [];
  const desired = links.flatMap((link) => activeTarget(link.target_type, link.target_id) ? signalDefinitions({ reference, link, metadata: reference.metadata ?? {} }) : []);
  const existing = await supabase.from('github_attention_signals').select('id, fingerprint, status').eq('workspace_id', workspaceId).eq('external_reference_id', reference.id).eq('status', 'active');
  if (existing.error) throw existing.error;
  const desiredFingerprints = new Set(desired.map((signal) => signal.fingerprint));
  const staleIds = (existing.data ?? []).filter((row) => !desiredFingerprints.has(row.fingerprint)).map((row) => row.id);
  if (staleIds.length) {
    const resolved = await supabase.from('github_attention_signals').update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', staleIds);
    if (resolved.error) throw resolved.error;
  }
  for (const signal of desired) {
    const prior = (existing.data ?? []).find((row) => row.fingerprint === signal.fingerprint);
    const upserted = await supabase.from('github_attention_signals').upsert({ workspace_id: workspaceId, external_reference_id: reference.id, target_type: signal.link.target_type, target_id: signal.link.target_id, attention_type: signal.attentionType, fingerprint: signal.fingerprint, status: 'active', title: signal.title, reason: signal.reason, metadata: signal.metadata, last_seen_at: new Date().toISOString(), resolved_at: null, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,fingerprint' }).select('id').single();
    if (upserted.error) throw upserted.error;
    if (!prior) await insertAttentionNotification({ supabase, workspaceId, signal, eventTime });
  }
  return desired;
};

export const listGithubAttention = async ({ supabase, workspaceId, targetType = null, targetId = null }) => {
  let query = supabase.from('github_attention_signals').select('id, external_reference_id, target_type, target_id, attention_type, title, reason, metadata, last_seen_at').eq('workspace_id', workspaceId).eq('status', 'active').order('last_seen_at', { ascending: false }).limit(100);
  if (targetType) query = query.eq('target_type', targetType);
  if (targetId) query = query.eq('target_id', targetId);
  const result = await query;
  if (result.error) throw result.error;
  return result.data ?? [];
};
