#!/usr/bin/env node

// Read-only Phase 3.8 diagnostic. It intentionally reports identifiers and
// counts only; it never deletes or repairs user data.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'backend/.env' });

const workspaceId = process.argv[2] || process.env.GITHUB_AUDIT_WORKSPACE_ID;
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!workspaceId || !url || !key) {
  console.error('Usage: GITHUB_AUDIT_WORKSPACE_ID=<workspace-id> node scripts/audit-github-consistency.mjs');
  process.exitCode = 2;
} else {
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const [repositories, references, links] = await Promise.all([
    supabase.from('github_repositories').select('id, github_repository_id, is_disabled, is_archived').eq('workspace_id', workspaceId).limit(1000),
    supabase.from('external_references').select('id, workspace_id, external_type, metadata, access_status').eq('workspace_id', workspaceId).eq('provider', 'github').limit(2000),
    supabase.from('external_reference_links').select('id, external_reference_id, target_type, target_id, link_metadata').eq('workspace_id', workspaceId).limit(5000),
  ]);
  for (const result of [repositories, references, links]) if (result.error) throw result.error;

  const approvedIds = new Set((repositories.data ?? []).map((row) => String(row.github_repository_id)));
  const refs = references.data ?? [];
  const refIds = new Set(refs.map((row) => row.id));
  const linksByRef = new Map();
  const duplicateLinks = [];
  const linkKeys = new Set();
  for (const link of links.data ?? []) {
    if (!refIds.has(link.external_reference_id)) duplicateLinks.push(link.id);
    const keyForLink = `${link.external_reference_id}:${link.target_type}:${link.target_id}`;
    if (linkKeys.has(keyForLink)) duplicateLinks.push(link.id);
    linkKeys.add(keyForLink);
    const current = linksByRef.get(link.external_reference_id) ?? [];
    current.push(link);
    linksByRef.set(link.external_reference_id, current);
  }

  const inaccessibleRepositoryRefs = refs.filter((reference) => {
    const id = String(reference.metadata?.githubRepositoryId ?? '');
    return id && !approvedIds.has(id);
  }).map((reference) => reference.id);
  const primaryByProject = new Map();
  for (const link of links.data ?? []) {
    if (link.target_type !== 'project' || link.link_metadata?.role !== 'primary') continue;
    const current = primaryByProject.get(link.target_id) ?? [];
    current.push(link.id);
    primaryByProject.set(link.target_id, current);
  }
  const projectsWithMultiplePrimary = [...primaryByProject.entries()].filter(([, ids]) => ids.length > 1).map(([projectId]) => projectId);
  const orphanReferenceLinks = (links.data ?? []).filter((link) => !refIds.has(link.external_reference_id)).map((link) => link.id);

  console.log(JSON.stringify({
    workspace_id: workspaceId,
    counts: { approved_repositories: repositories.data?.length ?? 0, github_references: refs.length, github_links: links.data?.length ?? 0 },
    issues: {
      inaccessible_repository_references: inaccessibleRepositoryRefs,
      duplicate_or_invalid_links: [...new Set([...duplicateLinks, ...orphanReferenceLinks])],
      projects_with_multiple_primary_repositories: projectsWithMultiplePrimary,
    },
    repair_required: Boolean(inaccessibleRepositoryRefs.length || duplicateLinks.length || orphanReferenceLinks.length || projectsWithMultiplePrimary.length),
  }, null, 2));
}
