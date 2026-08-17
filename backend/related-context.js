const INTERNAL_RESOURCE_TYPES = new Set([
  'note',
  'project',
  'task',
  'event',
  'reminder',
  'intake',
]);

const RESOURCE_TABLES = {
  note: 'notes',
  project: 'projects',
  task: 'tasks',
  event: 'events',
  reminder: 'reminders',
  intake: 'inbox_items',
};

const RESOURCE_TITLES = {
  note: 'title',
  project: 'name',
  task: 'title',
  event: 'title',
  reminder: 'title',
  intake: 'title',
};

const ROUTABLE_RESOURCE_TYPES = new Set([
  'note',
  'project',
  'task',
  'event',
  'reminder',
  'intake',
]);

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];

const asText = (value, fallback = null) => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const resourceRoute = (workspaceId, type, id, extra = {}) => {
  if (!ROUTABLE_RESOURCE_TYPES.has(type)) return null;
  return {
    kind: 'workspace-resource',
    workspaceId,
    resourceType: type,
    resourceId: String(id),
    ...extra,
  };
};

const externalRoute = (provider, url) => ({
  kind: 'external-resource',
  provider: asText(provider, 'external'),
  url: asText(url),
});

const targetFromRow = (workspaceId, type, row, extra = {}) => {
  const titleColumn = RESOURCE_TITLES[type];
  const target = {
    type,
    id: String(row.id),
    title: asText(row[titleColumn], 'Untitled'),
    workspace_id: workspaceId,
    ...extra,
  };

  if (type === 'note') {
    target.preview = asText(row.preview);
    target.mode = row.mode ?? null;
    target.updated_at = row.updated_at ?? null;
  }
  if (type === 'task') {
    target.preview = asText(row.description ?? row.notes);
    target.status = row.status ?? null;
    target.due_date = row.due_date ?? null;
    target.due_time = row.due_time ?? null;
    target.project_id = row.project_id ?? null;
  }
  if (type === 'event') {
    target.preview = asText(row.notes);
    target.start_at = row.start_at ?? null;
    target.end_at = row.end_at ?? null;
    target.project_id = row.project_id ?? row.linked_project_id ?? null;
    target.note_id = row.note_id ?? null;
  }
  if (type === 'reminder') {
    target.preview = asText(row.body ?? row.notes);
    target.remind_at = row.remind_at ?? null;
    target.project_id = row.project_id ?? null;
    target.note_id = row.note_id ?? null;
  }
  if (type === 'intake') {
    target.preview = asText(row.body);
    target.provider = asText(row.source_provider ?? row.source);
    target.source_type = asText(row.source);
    target.source_url = asText(row.source_url);
    target.status = row.status ?? null;
  }
  return target;
};

const targetKey = (target) => `${target.type}:${target.id}`;

const externalReferenceTarget = (workspaceId, reference, extra = {}) => {
  const metadata = reference.metadata && typeof reference.metadata === 'object' ? reference.metadata : {};
  return {
    type: 'external_reference',
    id: String(reference.id),
    title: asText(metadata.title ?? metadata.name ?? metadata.repositoryFullName, reference.external_type || 'External resource'),
    workspace_id: workspaceId,
    provider: reference.provider,
    url: reference.normalized_url ?? reference.external_url ?? null,
    external_type: reference.external_type,
    access_status: reference.access_status,
    updated_at: reference.updated_at ?? null,
    ...extra,
  };
};

const relationshipKey = (item) => [
  item.relationship,
  item.direction,
  item.target?.type,
  item.target?.id,
].join(':');

export const dedupeRelatedContextItems = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = relationshipKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const resolveEventProjectId = (event) =>
  asText(event?.project_id ?? event?.linked_project_id);

const createReader = ({ supabase, ensureWorkspaceResource }) => {
  const query = async (table, select, filters = []) => {
    let builder = supabase.from(table).select(select);
    for (const [column, value] of filters) {
      if (Array.isArray(value)) builder = builder.in(column, value);
      else if (value === null) builder = builder.is(column, null);
      else builder = builder.eq(column, value);
    }
    const result = await builder;
    if (result.error) throw result.error;
    return result.data ?? [];
  };

  const queryOne = async (type, id, workspaceId) => {
    if (!INTERNAL_RESOURCE_TYPES.has(type)) return null;
    const rows = await query(RESOURCE_TABLES[type], `id, workspace_id, ${RESOURCE_TITLES[type]}`, [
      ['id', id],
      ['workspace_id', workspaceId],
    ]);
    return rows[0] ? targetFromRow(workspaceId, type, rows[0]) : null;
  };

  const addItem = (items, {
    relationship,
    direction,
    source,
    target,
    provenance = null,
    created_at = null,
  }) => {
    if (!target || !target.id) return;
    items.push({
      relationship,
      direction,
      source,
      target,
      provenance,
      route: target.type === 'external_reference'
        ? externalRoute(target.provider, target.url)
        : resourceRoute(target.workspace_id, target.type, target.id, target.route ?? {}),
      created_at,
    });
  };

  const addGenericLinks = async (workspaceId, resourceType, resourceId, items) => {
    const [rowsA, rowsB] = await Promise.all([
      query('ledger_context_links', 'id, resource_a_type, resource_a_id, resource_b_type, resource_b_id, created_at', [
        ['workspace_id', workspaceId],
        ['resource_a_type', resourceType],
        ['resource_a_id', resourceId],
      ]),
      query('ledger_context_links', 'id, resource_a_type, resource_a_id, resource_b_type, resource_b_id, created_at', [
        ['workspace_id', workspaceId],
        ['resource_b_type', resourceType],
        ['resource_b_id', resourceId],
      ]),
    ]);
    const rows = [...rowsA, ...rowsB];
    const relevant = rows.filter((row) =>
      (row.resource_a_type === resourceType && String(row.resource_a_id) === String(resourceId)) ||
      (row.resource_b_type === resourceType && String(row.resource_b_id) === String(resourceId))
    );
    for (const row of relevant) {
      const isA = row.resource_a_type === resourceType && String(row.resource_a_id) === String(resourceId);
      const targetType = isA ? row.resource_b_type : row.resource_a_type;
      const targetId = isA ? row.resource_b_id : row.resource_a_id;
      const target = await queryOne(targetType, targetId, workspaceId);
      addItem(items, {
        relationship: 'related_to',
        direction: 'outgoing',
        source: 'context_link',
        target,
        created_at: row.created_at ?? null,
      });
    }
  };

  const addExternalReferences = async (workspaceId, resourceType, resourceId, items) => {
    const targetTypes = resourceType === 'note' ? ['note', 'meetingNote'] : [resourceType];
    const links = await query('external_reference_links', 'id, external_reference_id, target_type, target_id, sources, link_metadata, created_at', [
      ['workspace_id', workspaceId],
      ['target_type', targetTypes],
      ['target_id', resourceId],
    ]);
    const referenceIds = unique(links.map((link) => link.external_reference_id));
    if (!referenceIds.length) return;
    const references = await query('external_references', 'id, provider, external_type, external_url, normalized_url, metadata, access_status, updated_at', [
      ['workspace_id', workspaceId],
      ['id', referenceIds],
    ]);
    const byId = new Map(references.map((reference) => [String(reference.id), reference]));
    for (const link of links) {
      const reference = byId.get(String(link.external_reference_id));
      if (!reference) continue;
      addItem(items, {
        relationship: 'references',
        direction: 'outgoing',
        source: 'external_reference',
        target: externalReferenceTarget(workspaceId, reference),
        provenance: {
          source_type: reference.provider,
          source_id: reference.id,
          source_url: reference.normalized_url ?? reference.external_url ?? null,
          source_label: externalReferenceTarget(workspaceId, reference).title,
          link_sources: link.sources ?? [],
        },
        created_at: link.created_at ?? null,
      });
    }
  };

  const addSlackProvenance = async (workspaceId, resourceType, resourceId, items) => {
    const targetType = resourceType === 'intake' ? 'intake_item' : resourceType;
    const links = await query('slack_context_links', 'id, slack_context_id, target_type, target_id, relationship_type, created_at', [
      ['workspace_id', workspaceId],
      ['target_type', targetType],
      ['target_id', resourceId],
    ]);
    const contextIds = unique(links.map((link) => link.slack_context_id));
    if (!contextIds.length) return;
    const contexts = await query('slack_contexts', 'id, workspace_id, slack_channel_name, message_text, message_author_name, permalink, message_created_at, captured_at, sync_status', [
      ['workspace_id', workspaceId],
      ['id', contextIds],
    ]);
    const byId = new Map(contexts.map((context) => [String(context.id), context]));
    for (const link of links) {
      const context = byId.get(String(link.slack_context_id));
      if (!context) continue;
      const title = asText(context.message_text, context.slack_channel_name ? `Slack · #${context.slack_channel_name}` : 'Slack message');
      addItem(items, {
        relationship: 'captured_from',
        direction: 'outgoing',
        source: 'provenance',
        target: {
          type: 'external_reference',
          id: String(context.id),
          title,
          workspace_id: workspaceId,
          provider: 'slack',
          url: context.permalink ?? null,
          access_status: context.sync_status ?? null,
        },
        provenance: {
          source_type: 'slack',
          source_id: context.id,
          source_url: context.permalink ?? null,
          source_label: title,
          captured_at: context.message_created_at ?? context.captured_at ?? link.created_at ?? null,
          author_name: context.message_author_name ?? null,
          relationship_type: link.relationship_type ?? null,
        },
        created_at: link.created_at ?? null,
      });
    }
  };

  const addCalendarFollowUpProvenance = async (workspaceId, resourceId, items) => {
    const rows = await query('tasks', 'id, workspace_id, title, description, notes, project_id, status, due_date, due_time, updated_at, created_at', [
      ['workspace_id', workspaceId],
      ['id', resourceId],
    ]);
    const task = rows[0];
    const marker = String(task?.description ?? '').trim();
    if (!marker.startsWith('calendar_followup:')) return;
    const eventId = marker.slice('calendar_followup:'.length).trim();
    if (!eventId) return;
    const event = await query('events', 'id, workspace_id, project_id, linked_project_id, title, notes, start_at, end_at, status, note_id, updated_at, created_at', [
      ['workspace_id', workspaceId],
      ['id', eventId],
    ]);
    const sourceEvent = event[0];
    if (!sourceEvent) return;
    addItem(items, {
      relationship: 'created_from',
      direction: 'outgoing',
      source: 'provenance',
      target: targetFromRow(workspaceId, 'event', sourceEvent),
      provenance: {
        source_type: 'calendar_event',
        source_id: sourceEvent.id,
        source_label: sourceEvent.title,
        captured_at: sourceEvent.start_at ?? null,
      },
    });
  };

  const addConvertedExternalReference = async (workspaceId, resourceType, resourceId, items) => {
    if (resourceType !== 'intake') return;
    const rows = await query('inbox_items', 'id, workspace_id, title, source, source_id, source_url, source_provider, converted_type, converted_id, converted_at, created_at', [
      ['workspace_id', workspaceId],
      ['id', resourceId],
    ]);
    const intake = rows[0];
    if (intake?.converted_type !== 'external_resource' || !intake.converted_id) return;
    const references = await query('external_references', 'id, provider, external_type, external_url, normalized_url, metadata, access_status, updated_at', [
      ['workspace_id', workspaceId],
      ['id', intake.converted_id],
    ]);
    const reference = references[0];
    if (!reference) return;
    addItem(items, {
      relationship: 'converted_from',
      direction: 'incoming',
      source: 'provenance',
      target: externalReferenceTarget(workspaceId, reference),
      provenance: {
        source_type: reference.provider,
        source_id: reference.id,
        source_url: reference.normalized_url ?? reference.external_url ?? null,
        source_label: externalReferenceTarget(workspaceId, reference).title,
        captured_at: intake.converted_at ?? intake.created_at ?? null,
      },
      created_at: intake.converted_at ?? intake.created_at ?? null,
    });
  };

  const addProjectContext = async (workspaceId, projectId, items) => {
    const [tasks, events, reminders, milestones, noteLinks] = await Promise.all([
      query('tasks', 'id, workspace_id, project_id, title, description, notes, status, due_date, due_time, updated_at', [['workspace_id', workspaceId], ['project_id', projectId]]),
      Promise.all([
        query('events', 'id, workspace_id, project_id, linked_project_id, title, notes, start_at, end_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['project_id', projectId]]),
        query('events', 'id, workspace_id, project_id, linked_project_id, title, notes, start_at, end_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['linked_project_id', projectId]]),
      ]).then(([canonical, legacy]) => [...canonical, ...legacy]),
      query('reminders', 'id, workspace_id, project_id, title, body, notes, remind_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['project_id', projectId]]),
      query('project_milestones', 'id, workspace_id, project_id, title, milestone_date, type, completed, updated_at, created_at', [['workspace_id', workspaceId], ['project_id', projectId]]),
      query('project_note_links', 'id, project_id, note_id, created_at', [['workspace_id', workspaceId], ['project_id', projectId]]),
    ]);

    for (const row of tasks) addItem(items, { relationship: 'contains', direction: 'outgoing', source: 'foreign_key', target: targetFromRow(workspaceId, 'task', row), created_at: row.updated_at ?? row.created_at ?? null });
    for (const row of events) addItem(items, { relationship: 'contains', direction: 'outgoing', source: 'foreign_key', target: targetFromRow(workspaceId, 'event', row), created_at: row.updated_at ?? row.created_at ?? null });
    for (const row of reminders) addItem(items, { relationship: 'contains', direction: 'outgoing', source: 'foreign_key', target: targetFromRow(workspaceId, 'reminder', row), created_at: row.updated_at ?? row.created_at ?? null });
    for (const row of milestones) addItem(items, {
      relationship: 'contains',
      direction: 'outgoing',
      source: 'foreign_key',
      target: { type: 'milestone', id: String(row.id), title: asText(row.title, 'Untitled milestone'), workspace_id: workspaceId, project_id: row.project_id, milestone_date: row.milestone_date, completed: Boolean(row.completed), milestone_type: row.type ?? null },
      created_at: row.updated_at ?? row.created_at ?? null,
    });

    const noteIds = unique(noteLinks.map((link) => link.note_id));
    if (noteIds.length) {
      const notes = await query('notes', 'id, workspace_id, title, preview, mode, updated_at, created_at', [['workspace_id', workspaceId], ['id', noteIds]]);
      const notesById = new Map(notes.map((note) => [String(note.id), note]));
      for (const link of noteLinks) {
        const note = notesById.get(String(link.note_id));
        if (!note) continue;
        addItem(items, { relationship: 'contains', direction: 'outgoing', source: 'join', target: targetFromRow(workspaceId, 'note', note), created_at: link.created_at ?? null });
      }
    }

    const driveRelationships = await query('connected_source_relationships', 'id, connected_source_id, entity_type, entity_id, created_at', [['workspace_id', workspaceId], ['entity_type', 'project'], ['entity_id', projectId]]);
    const driveIds = unique(driveRelationships.map((row) => row.connected_source_id));
    if (driveIds.length) {
      const sources = await query('connected_external_sources', 'id, workspace_id, provider, source_type, provider_source_id, name, canonical_url, status, updated_at', [['workspace_id', workspaceId], ['id', driveIds]]);
      const sourcesById = new Map(sources.map((source) => [String(source.id), source]));
      for (const relationship of driveRelationships) {
        const source = sourcesById.get(String(relationship.connected_source_id));
        if (!source) continue;
        addItem(items, {
          relationship: 'references',
          direction: 'outgoing',
          source: 'integration',
          target: { type: 'external_reference', id: String(source.id), title: asText(source.name, 'Google Drive folder'), workspace_id: workspaceId, provider: source.provider, url: source.canonical_url ?? null, access_status: source.status ?? null },
          provenance: { source_type: source.provider, source_id: source.provider_source_id, source_url: source.canonical_url ?? null, source_label: asText(source.name, 'Google Drive folder') },
          created_at: relationship.created_at ?? null,
        });
      }
    }
  };

  const addDirectContext = async (workspaceId, resourceType, resourceId, items) => {
    if (resourceType === 'project') {
      await addProjectContext(workspaceId, resourceId, items);
      return;
    }

    if (resourceType === 'task') {
      const rows = await query('tasks', 'id, workspace_id, project_id, title, description, notes, status, due_date, due_time, updated_at', [['workspace_id', workspaceId], ['id', resourceId]]);
      const row = rows[0];
      if (row?.project_id) {
        const project = await queryOne('project', row.project_id, workspaceId);
        addItem(items, { relationship: 'belongs_to', direction: 'outgoing', source: 'foreign_key', target: project });
      }
    }

    if (resourceType === 'note') {
      const [projectLinks, events, reminders, metadata, transcriptLinks] = await Promise.all([
        query('project_note_links', 'id, project_id, note_id, created_at', [['workspace_id', workspaceId], ['note_id', resourceId]]),
        query('events', 'id, workspace_id, project_id, linked_project_id, title, notes, start_at, end_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['note_id', resourceId]]),
        query('reminders', 'id, workspace_id, project_id, title, body, notes, remind_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['note_id', resourceId]]),
        query('meeting_note_metadata', 'id, note_id, workspace_id, calendar_event_id, calendar_provider, calendar_event_key, calendar_event_title, calendar_source_name, scheduled_start_at, scheduled_end_at', [['workspace_id', workspaceId], ['note_id', resourceId]]),
        query('meeting_transcript_links', 'id, meeting_note_id, transcript_segment_id, link_type, ledger_item_type, ledger_item_id, quoted_text, timestamp_ms, speaker_label, audio_source, created_at', [['workspace_id', workspaceId], ['meeting_note_id', resourceId]]),
      ]);
      for (const link of projectLinks) addItem(items, { relationship: 'belongs_to', direction: 'outgoing', source: 'join', target: await queryOne('project', link.project_id, workspaceId), created_at: link.created_at ?? null });
      for (const event of events) addItem(items, { relationship: 'related_to', direction: 'outgoing', source: 'foreign_key', target: targetFromRow(workspaceId, 'event', event), created_at: event.updated_at ?? event.created_at ?? null });
      for (const reminder of reminders) addItem(items, { relationship: 'related_to', direction: 'outgoing', source: 'foreign_key', target: targetFromRow(workspaceId, 'reminder', reminder), created_at: reminder.updated_at ?? reminder.created_at ?? null });
      for (const meeting of metadata) {
        if (!meeting.calendar_event_id) continue;
        addItem(items, { relationship: 'created_from', direction: 'outgoing', source: 'provenance', target: await queryOne('event', meeting.calendar_event_id, workspaceId), provenance: { source_type: meeting.calendar_provider, source_id: meeting.calendar_event_key ?? meeting.calendar_event_id, source_label: asText(meeting.calendar_event_title ?? meeting.calendar_source_name, 'Calendar event'), captured_at: meeting.scheduled_start_at ?? null } });
      }
      for (const link of transcriptLinks) {
        if (link.ledger_item_type && link.ledger_item_id) {
          addItem(items, {
            relationship: 'supports',
            direction: 'outgoing',
            source: 'provenance',
            target: await queryOne(link.ledger_item_type, link.ledger_item_id, workspaceId),
            provenance: {
              source_type: 'meeting_transcript',
              source_id: link.transcript_segment_id,
              source_label: asText(link.link_type, 'Meeting transcript'),
              quoted_text: link.quoted_text,
              timestamp_ms: link.timestamp_ms,
              speaker_label: link.speaker_label,
              audio_source: link.audio_source,
            },
            created_at: link.created_at ?? null,
          });
        }
      }
    }

    if (resourceType === 'event') {
      const rows = await query('events', 'id, workspace_id, project_id, linked_project_id, title, notes, start_at, end_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['id', resourceId]]);
      const event = rows[0];
      const projectId = resolveEventProjectId(event);
      if (projectId) addItem(items, { relationship: 'belongs_to', direction: 'outgoing', source: 'foreign_key', target: await queryOne('project', projectId, workspaceId) });
      if (event?.note_id) addItem(items, { relationship: 'related_to', direction: 'outgoing', source: 'foreign_key', target: await queryOne('note', event.note_id, workspaceId) });
      const meeting = await query('meeting_note_metadata', 'note_id, calendar_event_id, calendar_provider, calendar_event_key, calendar_event_title, calendar_source_name, scheduled_start_at', [['workspace_id', workspaceId], ['calendar_event_id', resourceId]]);
      for (const row of meeting) addItem(items, { relationship: 'supports', direction: 'outgoing', source: 'provenance', target: await queryOne('note', row.note_id, workspaceId), provenance: { source_type: row.calendar_provider, source_id: row.calendar_event_key ?? resourceId, source_label: asText(row.calendar_event_title ?? row.calendar_source_name, 'Meeting note'), captured_at: row.scheduled_start_at ?? null } });
    }

    if (resourceType === 'reminder') {
      const rows = await query('reminders', 'id, workspace_id, project_id, title, body, notes, remind_at, status, note_id, updated_at, created_at', [['workspace_id', workspaceId], ['id', resourceId]]);
      const reminder = rows[0];
      if (reminder?.project_id) addItem(items, { relationship: 'belongs_to', direction: 'outgoing', source: 'foreign_key', target: await queryOne('project', reminder.project_id, workspaceId) });
      if (reminder?.note_id) addItem(items, { relationship: 'related_to', direction: 'outgoing', source: 'foreign_key', target: await queryOne('note', reminder.note_id, workspaceId) });
    }

    if (resourceType === 'intake') {
      const rows = await query('inbox_items', 'id, workspace_id, title, body, source, source_id, source_url, source_provider, status, converted_type, converted_id, converted_at, created_at, updated_at', [['workspace_id', workspaceId], ['id', resourceId]]);
      const intake = rows[0];
      if (intake?.converted_type && intake.converted_id && INTERNAL_RESOURCE_TYPES.has(intake.converted_type)) {
        addItem(items, { relationship: 'converted_from', direction: 'incoming', source: 'provenance', target: await queryOne(intake.converted_type, intake.converted_id, workspaceId), provenance: { source_type: intake.source_provider ?? intake.source, source_id: intake.source_id ?? intake.id, source_url: intake.source_url, source_label: asText(intake.title, 'Intake item'), captured_at: intake.converted_at ?? intake.created_at } });
      }
    }
  };

  const addIntakeProvenance = async (workspaceId, resourceType, resourceId, items) => {
    const rows = await query('inbox_items', 'id, workspace_id, title, source, source_id, source_url, source_provider, converted_type, converted_id, converted_at, created_at', [['workspace_id', workspaceId], ['converted_type', resourceType], ['converted_id', resourceId]]);
    for (const intake of rows) {
      addItem(items, { relationship: 'converted_from', direction: 'outgoing', source: 'provenance', target: targetFromRow(workspaceId, 'intake', intake), provenance: { source_type: intake.source_provider ?? intake.source, source_id: intake.source_id ?? intake.id, source_url: intake.source_url, source_label: asText(intake.title, 'Intake item'), captured_at: intake.converted_at ?? intake.created_at }, created_at: intake.converted_at ?? intake.created_at ?? null });
    }
  };

  const addTranscriptProvenance = async (workspaceId, resourceType, resourceId, items) => {
    const rows = await query('meeting_transcript_links', 'id, meeting_note_id, transcript_segment_id, ledger_item_type, ledger_item_id, quoted_text, timestamp_ms, speaker_label, audio_source, created_at', [['workspace_id', workspaceId], ['ledger_item_type', resourceType], ['ledger_item_id', resourceId]]);
    for (const link of rows) {
      const meeting = await queryOne('note', link.meeting_note_id, workspaceId);
      if (!meeting) continue;
      addItem(items, { relationship: 'created_from', direction: 'outgoing', source: 'provenance', target: meeting, provenance: { source_type: 'meeting_transcript', source_id: link.transcript_segment_id, source_label: meeting.title, quoted_text: link.quoted_text, timestamp_ms: link.timestamp_ms, speaker_label: link.speaker_label, audio_source: link.audio_source }, created_at: link.created_at ?? null });
    }
  };

  return async ({ workspaceId, resourceType, resourceId }) => {
    if (!INTERNAL_RESOURCE_TYPES.has(resourceType) || !resourceId) {
      const error = new Error('A valid related-context resource is required.');
      error.statusCode = 400;
      throw error;
    }
    const allowed = await ensureWorkspaceResource(RESOURCE_TABLES[resourceType], resourceId, workspaceId);
    if (!allowed) {
      const error = new Error('Resource not found.');
      error.statusCode = 404;
      throw error;
    }

    const items = [];
    await addDirectContext(workspaceId, resourceType, resourceId, items);
    await addGenericLinks(workspaceId, resourceType, resourceId, items);
    await addExternalReferences(workspaceId, resourceType, resourceId, items);
    await addSlackProvenance(workspaceId, resourceType, resourceId, items);
    await addConvertedExternalReference(workspaceId, resourceType, resourceId, items);
    await addIntakeProvenance(workspaceId, resourceType, resourceId, items);
    if (['task', 'reminder', 'event', 'intake'].includes(resourceType)) {
      await addTranscriptProvenance(workspaceId, resourceType, resourceId, items);
    }
    if (resourceType === 'task') {
      await addCalendarFollowUpProvenance(workspaceId, resourceId, items);
    }

    return {
      resource: { type: resourceType, id: String(resourceId), workspace_id: workspaceId },
      items: dedupeRelatedContextItems(items),
    };
  };
};

export const createRelatedContextReader = ({ supabase, ensureWorkspaceResource }) =>
  createReader({ supabase, ensureWorkspaceResource });

export { INTERNAL_RESOURCE_TYPES, RESOURCE_TABLES, resourceRoute };
