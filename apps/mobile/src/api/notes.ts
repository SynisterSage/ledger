import { mobileRequest } from './client';

export type MobileNoteSummary = {
  id: string;
  workspace_id: string;
  title: string;
  preview?: string | null;
  mode?: 'text' | 'mind_map' | 'meeting_note' | null;
  section_id?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
  updated_at: string | null;
  created_at: string | null;
};

export type MobileNoteSection = {
  id: string;
  name: string;
  color?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
  note_count?: number | null;
};

export type MobilePin = {
  id: string;
  object_type: string;
  object_id: string;
  title: string;
  subtitle?: string | null;
  sort_order?: number | null;
};

export type MobileNoteDetail = {
  id: string;
  workspace_id?: string;
  title: string;
  content: string | null;
  content_html: string | null;
  date?: string | null;
  mood?: string | null;
  mode?: 'text' | 'mind_map' | 'meeting_note' | null;
  mind_map_structure?: unknown;
  section_id?: string | null;
  parent_id?: string | null;
  updated_by?: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type MobileNoteTemplate = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  is_system?: boolean;
  visibility?: string | null;
  suggested_section_id?: string | null;
  title_pattern?: string | null;
  pinned?: boolean;
  content_html?: string | null;
};

export type MobileMeetingMetadata = {
  note_id: string;
  calendar_event_id?: string | null;
  calendar_provider?: string | null;
  calendar_event_key?: string | null;
  calendar_event_title?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  attendees?: Array<{ name?: string; email?: string } | string> | null;
  transcription_status?: 'idle' | 'recording' | 'paused' | 'processing' | 'complete' | 'failed' | string | null;
  transcription_error?: string | null;
  meeting_start_at?: string | null;
  meeting_end_at?: string | null;
  duration_seconds?: number | null;
  calendar_event_deleted?: boolean;
};

export type MobileTranscriptSegment = {
  id: string;
  meetingNoteId: string;
  speaker?: string;
  startTimeMs: number;
  endTimeMs?: number;
  text: string;
  audioSource?: string;
  segmentOrder?: number;
  deleted?: boolean;
  edited?: boolean;
};

export type MobileMindMapStructure = {
  rootId: string;
  nodes: Record<string, {
    id: string;
    label?: string;
    title?: string;
    children: string[];
    parentId?: string | null;
    collapsed?: boolean;
    completed?: boolean;
    position?: { x: number; y: number };
    x?: number;
    y?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export async function getMobileNote(noteId: string) {
  return mobileRequest<MobileNoteDetail>(`/api/notes/${encodeURIComponent(noteId)}`);
}

export async function getMobileNoteSummaries(workspaceId: string, sectionId?: string) {
  const query = sectionId ? `?section_id=${encodeURIComponent(sectionId)}` : '';
  return mobileRequest<{ notes?: MobileNoteSummary[] } | MobileNoteSummary[]>(`/api/notes${query}`, {
    headers: { 'x-workspace-id': workspaceId },
  });
}

export async function getMobileNoteSections(workspaceId: string) {
  return mobileRequest<MobileNoteSection[]>('/api/sections', {
    headers: { 'x-workspace-id': workspaceId },
  });
}

export async function getMobilePins(workspaceId: string) {
  return mobileRequest<{ pins?: MobilePin[] }>('/api/pins', {
    headers: { 'x-workspace-id': workspaceId },
  });
}

export async function pinMobileNote(workspaceId: string, noteId: string) {
  return mobileRequest('/api/pins', {
    method: 'POST',
    headers: { 'x-workspace-id': workspaceId },
    body: JSON.stringify({ object_type: 'note', object_id: noteId }),
  });
}

export async function unpinMobileObject(workspaceId: string, pinId: string) {
  return mobileRequest(`/api/pins/${encodeURIComponent(pinId)}`, {
    method: 'DELETE',
    headers: { 'x-workspace-id': workspaceId },
  });
}

export async function createMobileChildNote(workspaceId: string, parentId: string, payload: { title?: string; content_html?: string; mode?: MobileNoteSummary['mode']; section_id?: string | null }) {
  return mobileRequest<MobileNoteDetail>(`/api/notes/${encodeURIComponent(parentId)}/children`, {
    method: 'POST',
    headers: { 'x-workspace-id': workspaceId },
    body: JSON.stringify({ title: payload.title ?? 'Untitled', content_html: payload.content_html ?? '<p></p>', mode: payload.mode ?? 'text', section_id: payload.section_id ?? undefined }),
  });
}

export async function moveMobileNote(workspaceId: string, noteId: string, payload: { section_id?: string | null; parent_id?: string | null }) {
  const updates: Promise<unknown>[] = [];
  if (payload.section_id !== undefined) updates.push(mobileRequest(`/api/notes/${encodeURIComponent(noteId)}`, { method: 'PATCH', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ section_id: payload.section_id }) }));
  if (payload.parent_id !== undefined) updates.push(mobileRequest(`/api/notes/${encodeURIComponent(noteId)}/parent`, { method: 'PATCH', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ parent_id: payload.parent_id }) }));
  const results = await Promise.all(updates);
  return (results[results.length - 1] ?? null) as MobileNoteDetail | null;
}

export async function duplicateMobileNote(workspaceId: string, noteId: string) {
  return mobileRequest<MobileNoteDetail>(`/api/notes/${encodeURIComponent(noteId)}/duplicate`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({}) });
}

export async function deleteMobileNote(workspaceId: string, noteId: string) {
  return mobileRequest<{ success: boolean }>(`/api/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
}

export async function createMobileNoteFromTemplate(workspaceId: string, templateId: string, payload?: { section_id?: string | null }) {
  return mobileRequest<MobileNoteDetail>(`/api/notes/from-template/${encodeURIComponent(templateId)}`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ section_id: payload?.section_id ?? null }) });
}

export async function getMobileNoteTemplates(workspaceId: string) {
  return mobileRequest<MobileNoteTemplate[]>('/api/templates', { headers: { 'x-workspace-id': workspaceId } });
}

export async function createMobileNoteSection(workspaceId: string, payload: { name: string; parent_id?: string | null; color?: string }) {
  return mobileRequest<MobileNoteSection>('/api/sections', { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify(payload) });
}

export async function updateMobileNoteSection(workspaceId: string, sectionId: string, payload: { name?: string; parent_id?: string | null; color?: string }) {
  return mobileRequest<MobileNoteSection>(`/api/sections/${encodeURIComponent(sectionId)}`, { method: 'PATCH', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify(payload) });
}

export async function deleteMobileNoteSection(workspaceId: string, sectionId: string) {
  return mobileRequest<{ success: boolean }>(`/api/sections/${encodeURIComponent(sectionId)}`, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
}

export type MobileProjectNoteLink = { id: string; project_id: string; note_id: string; project_name: string; created_at?: string | null };

export async function getMobileWorkspaceNoteLinks(workspaceId: string, noteId?: string) {
  const result = await mobileRequest<{ links?: MobileProjectNoteLink[] }>('/api/workspaces/' + encodeURIComponent(workspaceId) + '/project-note-links');
  return (result.links ?? []).filter((link) => !noteId || link.note_id === noteId);
}

export async function linkMobileNoteToProject(workspaceId: string, projectId: string, noteId: string) {
  return mobileRequest(`/api/projects/${encodeURIComponent(projectId)}/note-links`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ note_id: noteId }) });
}

export async function unlinkMobileNoteFromProject(workspaceId: string, projectId: string, noteId: string) {
  return mobileRequest(`/api/projects/${encodeURIComponent(projectId)}/note-links/${encodeURIComponent(noteId)}`, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
}

export async function getMobileMeetingMetadata(noteId: string) {
  return mobileRequest<MobileMeetingMetadata>(`/api/notes/${encodeURIComponent(noteId)}/meeting`);
}

export async function updateMobileMeetingMetadata(workspaceId: string, noteId: string, payload: Partial<MobileMeetingMetadata>) {
  return mobileRequest<MobileMeetingMetadata>(`/api/notes/${encodeURIComponent(noteId)}/meeting`, { method: 'PATCH', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify(payload) });
}

function normalizeTranscriptSegment(row: Record<string, unknown>, noteId: string): MobileTranscriptSegment {
  return { id: String(row.id), meetingNoteId: noteId, speaker: typeof row.speaker_label === 'string' ? row.speaker_label : undefined, startTimeMs: Number(row.start_ms ?? 0), endTimeMs: row.end_ms == null ? undefined : Number(row.end_ms), text: String(row.transcript_text ?? ''), audioSource: typeof row.audio_source === 'string' ? row.audio_source : undefined, segmentOrder: row.segment_order == null ? undefined : Number(row.segment_order), edited: Boolean(row.edited ?? row.updated_by) };
}

export async function getMobileTranscriptSegments(noteId: string) {
  const rows = await mobileRequest<Array<Record<string, unknown>>>(`/api/notes/${encodeURIComponent(noteId)}/transcript-segments`);
  return rows.map((row) => normalizeTranscriptSegment(row, noteId));
}

export async function updateMobileTranscriptSegment(workspaceId: string, noteId: string, segmentId: string, payload: { text?: string; speaker?: string; startTimeMs?: number; endTimeMs?: number; segmentOrder?: number }) {
  return mobileRequest<Record<string, unknown>>(`/api/notes/${encodeURIComponent(noteId)}/transcript-segments/${encodeURIComponent(segmentId)}`, { method: 'PATCH', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ transcript_text: payload.text, speaker_label: payload.speaker, start_ms: payload.startTimeMs, end_ms: payload.endTimeMs, segment_order: payload.segmentOrder }) });
}

export async function deleteMobileTranscriptSegment(workspaceId: string, noteId: string, segmentId: string) {
  return mobileRequest<{ success: boolean }>(`/api/notes/${encodeURIComponent(noteId)}/transcript-segments/${encodeURIComponent(segmentId)}`, { method: 'DELETE', headers: { 'x-workspace-id': workspaceId } });
}

export async function restoreMobileTranscriptSegment(workspaceId: string, noteId: string, segmentId: string) {
  return mobileRequest<Record<string, unknown>>(`/api/notes/${encodeURIComponent(noteId)}/transcript-segments/${encodeURIComponent(segmentId)}/restore`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({}) });
}

export async function createMobileTranscriptSegment(workspaceId: string, noteId: string, payload: { text: string; speaker?: string; startTimeMs: number; endTimeMs: number; audioSource?: string; segmentOrder: number }) {
  return mobileRequest<Record<string, unknown>>(`/api/notes/${encodeURIComponent(noteId)}/transcript-segments`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ transcript_text: payload.text, speaker_label: payload.speaker ?? null, start_ms: payload.startTimeMs, end_ms: payload.endTimeMs, audio_source: payload.audioSource ?? 'user_microphone', segment_order: payload.segmentOrder }) });
}

export async function linkMobileTranscriptToLedgerItem(workspaceId: string, noteId: string, segmentId: string, payload: { ledgerItemType: 'task' | 'reminder' | 'event' | 'intake'; ledgerItemId: string; quotedText: string; timestampMs: number }) {
  return mobileRequest(`/api/notes/${encodeURIComponent(noteId)}/transcript-segments/${encodeURIComponent(segmentId)}/links`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ link_type: 'ledger_item', ledger_item_type: payload.ledgerItemType, ledger_item_id: payload.ledgerItemId, quoted_text: payload.quotedText, timestamp_ms: payload.timestampMs }) });
}

export async function getMobilePeople(workspaceId: string, query?: string) {
  const suffix = query?.trim() ? `?query=${encodeURIComponent(query.trim())}` : '';
  return mobileRequest<{ people?: Array<{ id: string; name?: string; email?: string; role?: string }> }>(`/api/people${suffix}`, { headers: { 'x-workspace-id': workspaceId } });
}

export async function linkMobileNoteToPerson(workspaceId: string, noteId: string, personId: string, sourceText: string) {
  return mobileRequest(`/api/notes/${encodeURIComponent(noteId)}/person-links`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ person_user_id: personId, source_key: `mobile-selection:${sourceText.trim().toLowerCase()}`, source_text: sourceText.trim() }) });
}

export type MobileNoteVersion = { id: string; note_id: string; reason?: string | null; title?: string | null; content_html?: string | null; mode?: string | null; created_at?: string | null; mind_map_structure?: unknown };

export async function getMobileNoteVersions(workspaceId: string, noteId: string) {
  return mobileRequest<MobileNoteVersion[]>(`/api/notes/${encodeURIComponent(noteId)}/versions`, { headers: { 'x-workspace-id': workspaceId } });
}

export async function createMobileNoteVersion(workspaceId: string, noteId: string, reason = 'manual') {
  return mobileRequest<MobileNoteVersion | null>(`/api/notes/${encodeURIComponent(noteId)}/versions`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({ reason }) });
}

export async function restoreMobileNoteVersion(workspaceId: string, noteId: string, versionId: string) {
  return mobileRequest<MobileNoteDetail>(`/api/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST', headers: { 'x-workspace-id': workspaceId }, body: JSON.stringify({}) });
}
