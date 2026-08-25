import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRelatedContextReader,
  dedupeRelatedContextItems,
  resolveEventProjectId,
} from './related-context.js';

const createFakeSupabase = (tables) => {
  const from = (table) => {
    const state = { filters: [] };
    const builder = {
      select() { return builder; },
      eq(column, value) { state.filters.push({ type: 'eq', column, value }); return builder; },
      in(column, value) { state.filters.push({ type: 'in', column, value }); return builder; },
      is(column, value) { state.filters.push({ type: 'is', column, value }); return builder; },
      then(resolve, reject) {
        try {
          const rows = (tables[table] ?? []).filter((row) => state.filters.every((filter) => {
            if (filter.type === 'eq') return String(row[filter.column] ?? '') === String(filter.value ?? '');
            if (filter.type === 'in') return filter.value.map(String).includes(String(row[filter.column] ?? ''));
            if (filter.type === 'is') return row[filter.column] === filter.value;
            return true;
          }));
          return Promise.resolve(resolve({ data: rows, error: null }));
        } catch (error) {
          return Promise.reject(reject(error));
        }
      },
    };
    return builder;
  };
  return { from };
};

const ensureWorkspaceResource = (tables) => async (table, id, workspaceId) =>
  (tables[table] ?? []).some((row) => String(row.id) === String(id) && row.workspace_id === workspaceId);

test('canonical event project id wins and legacy project id is a read fallback', () => {
  assert.equal(resolveEventProjectId({ project_id: 'canonical', linked_project_id: 'legacy' }), 'canonical');
  assert.equal(resolveEventProjectId({ project_id: null, linked_project_id: 'legacy' }), 'legacy');
  assert.equal(resolveEventProjectId({ project_id: null, linked_project_id: null }), null);
});

test('related-context deduplication keeps one logical relationship', () => {
  const target = { type: 'event', id: 'event-1', title: 'Planning', workspace_id: 'workspace-1' };
  const items = dedupeRelatedContextItems([
    { relationship: 'contains', direction: 'outgoing', source: 'foreign_key', target },
    { relationship: 'contains', direction: 'outgoing', source: 'foreign_key', target },
  ]);
  assert.equal(items.length, 1);
});

test('project aggregation combines authoritative sources and deduplicates legacy event fallback', async () => {
  const tables = {
    projects: [{ id: 'project-1', workspace_id: 'workspace-1', name: 'Launch' }],
    tasks: [{ id: 'task-1', workspace_id: 'workspace-1', project_id: 'project-1', title: 'Ship', status: 'todo' }],
    events: [{ id: 'event-1', workspace_id: 'workspace-1', project_id: 'project-1', linked_project_id: 'project-1', title: 'Review' }],
    reminders: [{ id: 'reminder-1', workspace_id: 'workspace-1', project_id: 'project-1', title: 'Follow up' }],
    project_milestones: [{ id: 'milestone-1', workspace_id: 'workspace-1', project_id: 'project-1', title: 'Beta', completed: false }],
    project_note_links: [{ id: 'project-note-1', workspace_id: 'workspace-1', project_id: 'project-1', note_id: 'note-1' }],
    notes: [{ id: 'note-1', workspace_id: 'workspace-1', title: 'Brief', preview: 'Context', mode: 'meeting_note' }],
    ledger_context_links: [],
    external_reference_links: [{ id: 'external-link-1', workspace_id: 'workspace-1', external_reference_id: 'github-1', target_type: 'project', target_id: 'project-1', sources: ['manual'] }],
    external_references: [{ id: 'github-1', workspace_id: 'workspace-1', provider: 'github', external_type: 'repository', normalized_url: 'https://github.com/acme/launch', metadata: { name: 'acme/launch' }, access_status: 'accessible' }],
    connected_source_relationships: [],
    connected_external_sources: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'project', resourceId: 'project-1' });

  assert.equal(result.resource.type, 'project');
  assert.equal(result.items.filter((item) => item.target.type === 'event' && item.target.id === 'event-1').length, 1);
  assert.ok(result.items.some((item) => item.target.type === 'task' && item.route?.kind === 'workspace-resource'));
  assert.ok(result.items.some((item) => item.target.type === 'note'));
  assert.equal(result.items.find((item) => item.target.type === 'note')?.target.mode, 'meeting_note');
  assert.ok(result.items.some((item) => item.target.type === 'milestone'));
  const external = result.items.find((item) => item.target.type === 'external_reference' && item.target.provider === 'github');
  assert.equal(external?.route?.kind, 'external-resource');
  assert.equal(external?.route?.url, 'https://github.com/acme/launch');
});

test('intake conversion is readable from the converted destination', async () => {
  const tables = {
    tasks: [{ id: 'task-1', workspace_id: 'workspace-1', title: 'Converted task', project_id: null }],
    inbox_items: [{ id: 'intake-1', workspace_id: 'workspace-1', title: 'Captured request', source: 'slack', source_id: 'slack-1', source_url: 'https://slack.test/1', converted_type: 'task', converted_id: 'task-1', converted_at: '2026-08-16T12:00:00Z' }],
    ledger_context_links: [],
    external_reference_links: [],
    external_references: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'task', resourceId: 'task-1' });
  const provenance = result.items.find((item) => item.relationship === 'converted_from');

  assert.equal(provenance?.target.type, 'intake');
  assert.equal(provenance?.provenance?.source_type, 'slack');
  assert.equal(provenance?.route?.resourceId, 'intake-1');
});

test('meeting transcript provenance is readable from the Ledger action', async () => {
  const tables = {
    tasks: [{ id: 'task-1', workspace_id: 'workspace-1', title: 'Send recap', project_id: null }],
    notes: [{ id: 'meeting-1', workspace_id: 'workspace-1', title: 'Customer meeting' }],
    meeting_transcript_links: [{ id: 'transcript-link-1', workspace_id: 'workspace-1', meeting_note_id: 'meeting-1', transcript_segment_id: 'segment-1', ledger_item_type: 'task', ledger_item_id: 'task-1', quoted_text: 'Please send the recap.', timestamp_ms: 1200, speaker_label: 'Customer' }],
    ledger_context_links: [],
    external_reference_links: [],
    external_references: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'task', resourceId: 'task-1' });
  const provenance = result.items.find((item) => item.relationship === 'created_from');

  assert.equal(provenance?.target.id, 'meeting-1');
  assert.equal(provenance?.provenance?.source_id, 'segment-1');
  assert.equal(provenance?.provenance?.quoted_text, 'Please send the recap.');
});

test('meeting note context exposes its transcript-linked Ledger action', async () => {
  const tables = {
    notes: [{ id: 'meeting-1', workspace_id: 'workspace-1', title: 'Customer meeting' }],
    tasks: [{ id: 'task-1', workspace_id: 'workspace-1', title: 'Send recap', project_id: null }],
    meeting_note_metadata: [],
    meeting_transcript_links: [{ id: 'transcript-link-1', workspace_id: 'workspace-1', meeting_note_id: 'meeting-1', transcript_segment_id: 'segment-1', link_type: 'ledger_item', ledger_item_type: 'task', ledger_item_id: 'task-1', quoted_text: 'Please send the recap.', timestamp_ms: 1200, speaker_label: 'Customer', audio_source: 'system_audio' }],
    ledger_context_links: [],
    external_reference_links: [],
    external_references: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'note', resourceId: 'meeting-1' });
  const action = result.items.find((item) => item.target.type === 'task');

  assert.equal(action?.relationship, 'supports');
  assert.equal(action?.provenance?.source_id, 'segment-1');
});

test('all Intake destinations preserve reciprocal conversion provenance', async () => {
  const destinations = [
    ['note', 'note-1', { title: 'Converted note' }],
    ['reminder', 'reminder-1', { title: 'Converted reminder' }],
    ['event', 'event-1', { title: 'Converted event' }],
    ['project', 'project-1', { name: 'Converted project' }],
  ];
  for (const [convertedType, convertedId, destination] of destinations) {
    const table = convertedType === 'project' ? 'projects' : `${convertedType}s`;
    const tables = {
      [table]: [{ id: convertedId, workspace_id: 'workspace-1', ...destination }],
      inbox_items: [{ id: `intake-${convertedType}`, workspace_id: 'workspace-1', title: `Captured ${convertedType}`, source: 'browser', source_url: 'https://example.test/source', converted_type: convertedType, converted_id: convertedId, converted_at: '2026-08-16T12:00:00Z' }],
      ledger_context_links: [],
      external_reference_links: [],
      external_references: [],
      slack_context_links: [],
      slack_contexts: [],
    };
    const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
    const result = await reader({ workspaceId: 'workspace-1', resourceType: convertedType, resourceId: convertedId });
    const provenance = result.items.find((item) => item.target.type === 'intake');
    assert.equal(provenance?.relationship, 'converted_from');
    assert.equal(provenance?.target.id, `intake-${convertedType}`);
  }
});

test('calendar follow-up task exposes its originating event', async () => {
  const tables = {
    tasks: [{ id: 'task-1', workspace_id: 'workspace-1', title: 'Follow up', description: 'calendar_followup:event-1', project_id: null }],
    events: [{ id: 'event-1', workspace_id: 'workspace-1', title: 'Customer call', start_at: '2026-08-16T15:00:00Z', project_id: null, linked_project_id: null }],
    ledger_context_links: [],
    external_reference_links: [],
    external_references: [],
    slack_context_links: [],
    slack_contexts: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'task', resourceId: 'task-1' });
  const provenance = result.items.find((item) => item.provenance?.source_type === 'calendar_event');
  assert.equal(provenance?.relationship, 'created_from');
  assert.equal(provenance?.target.id, 'event-1');
});

test('Slack source links remain visible after conversion', async () => {
  const tables = {
    tasks: [{ id: 'task-1', workspace_id: 'workspace-1', title: 'Slack task', project_id: null }],
    slack_context_links: [{ id: 'slack-link-1', workspace_id: 'workspace-1', slack_context_id: 'slack-1', target_type: 'task', target_id: 'task-1', relationship_type: 'conversion', created_at: '2026-08-16T12:00:00Z' }],
    slack_contexts: [{ id: 'slack-1', workspace_id: 'workspace-1', slack_channel_name: 'launch', message_text: 'Please ship the update', message_author_name: 'Sam', permalink: 'https://slack.test/thread/1', message_created_at: '2026-08-16T11:00:00Z', sync_status: 'sync_ready' }],
    ledger_context_links: [],
    external_reference_links: [],
    external_references: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'task', resourceId: 'task-1' });
  const source = result.items.find((item) => item.provenance?.source_type === 'slack');
  assert.equal(source?.relationship, 'captured_from');
  assert.equal(source?.target.provider, 'slack');
  assert.equal(source?.route?.url, 'https://slack.test/thread/1');
});

test('converted external resources remain visible from Intake', async () => {
  const tables = {
    inbox_items: [{ id: 'intake-1', workspace_id: 'workspace-1', title: 'unknown', raw_payload: { node_name: 'Onboarding-Tiles' }, source: 'figma', source_provider: 'figma', converted_type: 'external_resource', converted_id: 'drive-ref-1', converted_at: '2026-08-16T12:00:00Z' }],
    external_references: [{ id: 'drive-ref-1', workspace_id: 'workspace-1', provider: 'google_drive', external_type: 'file', normalized_url: 'https://drive.google.com/file/d/1', metadata: {}, access_status: 'accessible' }],
    external_reference_links: [],
    ledger_context_links: [],
    slack_context_links: [],
    slack_contexts: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'intake', resourceId: 'intake-1' });
  const source = result.items.find((item) => item.target.id === 'drive-ref-1');
  assert.equal(source?.relationship, 'converted_from');
  assert.equal(source?.target.provider, 'google_drive');
  assert.equal(source?.target.title, 'Onboarding-Tiles');
});

test('direct Intake external links use the captured Figma title', async () => {
  const tables = {
    inbox_items: [{ id: 'intake-1', workspace_id: 'workspace-1', title: 'unknown', raw_payload: { node_name: 'welcome-gate' } }],
    external_references: [{ id: 'figma-ref-1', workspace_id: 'workspace-1', provider: 'figma', external_type: 'unknown', normalized_url: 'https://www.figma.com/design/file', metadata: {} }],
    external_reference_links: [{ id: 'external-link-1', workspace_id: 'workspace-1', external_reference_id: 'figma-ref-1', target_type: 'intake', target_id: 'intake-1', sources: ['manual'] }],
    ledger_context_links: [],
    slack_context_links: [],
    slack_contexts: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'intake', resourceId: 'intake-1' });
  const source = result.items.find((item) => item.target.id === 'figma-ref-1');
  assert.equal(source?.target.title, 'welcome-gate');
});

test('meeting-note external references remain visible through the canonical note reader', async () => {
  const tables = {
    notes: [{ id: 'meeting-1', workspace_id: 'workspace-1', title: 'Customer meeting', mode: 'meeting_note' }],
    external_reference_links: [{ id: 'figma-link-1', workspace_id: 'workspace-1', external_reference_id: 'figma-1', target_type: 'meetingNote', target_id: 'meeting-1', sources: ['manual'] }],
    external_references: [{ id: 'figma-1', workspace_id: 'workspace-1', provider: 'figma', external_type: 'file', normalized_url: 'https://figma.com/design/abc', metadata: { name: 'Customer flow' }, access_status: 'accessible' }],
    ledger_context_links: [],
    slack_context_links: [],
    slack_contexts: [],
  };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  const result = await reader({ workspaceId: 'workspace-1', resourceType: 'note', resourceId: 'meeting-1' });
  const reference = result.items.find((item) => item.target.id === 'figma-1');

  assert.equal(reference?.target.provider, 'figma');
  assert.equal(reference?.route?.kind, 'external-resource');
});

test('workspace isolation rejects a resource outside the requested workspace', async () => {
  const tables = { projects: [{ id: 'project-1', workspace_id: 'workspace-2', name: 'Private' }] };
  const reader = createRelatedContextReader({ supabase: createFakeSupabase(tables), ensureWorkspaceResource: ensureWorkspaceResource(tables) });
  await assert.rejects(
    () => reader({ workspaceId: 'workspace-1', resourceType: 'project', resourceId: 'project-1' }),
    (error) => error.statusCode === 404
  );
});
