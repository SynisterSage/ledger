import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMeetingEvidenceChunks,
  buildMeetingRecapPrompt,
  parseMeetingRecapDraft,
} from '../src/types/meetingRecap.ts';
import type { MeetingIntelligenceContext } from '../src/types/notes.ts';
import { MeetingRecapService } from './meetingRecapService.ts';

const context = (overrides: Partial<MeetingIntelligenceContext> = {}): MeetingIntelligenceContext => ({
  workspaceId: 'workspace-a',
  noteId: 'note-a',
  meeting: { title: 'Sprint planning', attendees: ['Lex', 'Sam'] },
  humanNotes: { contentHtml: '<p>budget depends on Sarah</p>', contentText: 'budget depends on Sarah' },
  transcriptSegments: [
    { id: 'segment-1', note_id: 'note-a', workspace_id: 'workspace-a', audio_source: 'system_audio', speaker_label: 'Sam', start_ms: 1000, end_ms: 3000, transcript_text: 'We decided to keep the September date.', confidence: 0.9, segment_order: 0, created_at: '', updated_at: '' },
    { id: 'segment-2', note_id: 'note-a', workspace_id: 'workspace-a', audio_source: 'user_microphone', speaker_label: 'You', start_ms: 4000, end_ms: 6000, transcript_text: 'I will send the revised thumbnails by Friday.', confidence: 0.9, segment_order: 1, created_at: '', updated_at: '' },
  ],
  transcriptLinks: [],
  ...overrides,
});

test('meeting evidence chunks preserve segment IDs and timestamps', () => {
  const chunks = buildMeetingEvidenceChunks(context(), 40);
  assert.equal(chunks.length, 2);
  assert.match(chunks[0].text, /segment-1\|1000/);
  assert.deepEqual(chunks[1].segmentIds, ['segment-2']);
});

test('meeting recap prompt prioritizes human notes and grounding rules', () => {
  const prompt = buildMeetingRecapPrompt(context(), buildMeetingEvidenceChunks(context()));
  assert.match(prompt, /budget depends on Sarah/);
  assert.match(prompt, /Never fabricate citations/);
  assert.match(prompt, /segment-1\|1000/);
});

test('recap validation rejects unknown transcript citations', () => {
  const draft = parseMeetingRecapDraft(JSON.stringify({
    overview: 'The date was retained.',
    decisions: [{ text: 'Keep September.', sourceRefs: [{ transcriptSegmentId: 'missing', timestampMs: 1000 }] }],
    actions: [],
    openThreads: [],
  }), context());
  assert.ok(draft);
  assert.equal(draft.decisions.length, 0);
});

test('recap validation preserves valid action owners and dates', () => {
  const draft = parseMeetingRecapDraft(JSON.stringify({
    overview: 'The team aligned on timing.',
    decisions: [],
    actions: [{ text: 'Send thumbnails', ownerText: 'Lex', dueDateText: 'Friday', sourceRefs: [{ transcriptSegmentId: 'segment-2', timestampMs: 4000 }] }],
    openThreads: [],
  }), context());
  assert.equal(draft?.actions[0]?.ownerText, 'Lex');
  assert.equal(draft?.actions[0]?.dueDateText, 'Friday');
});

test('recap service rejects cross-workspace transcript evidence before model use', async () => {
  let switched = false;
  const service = new MeetingRecapService({
    switchGenerationTier: async () => { switched = true; return { ok: true }; },
    cancel: () => ({ ok: true }),
    start: () => '',
  } as never);
  const invalid = context({ transcriptSegments: [{ ...context().transcriptSegments[0], workspace_id: 'workspace-b' }] });
  const result = await service.generate(invalid);
  assert.deepEqual(result, { status: 'unavailable', reason: 'invalid_context' });
  assert.equal(switched, false);
});

test('recap service returns unavailable when neither local generation tier is installed', async () => {
  const service = new MeetingRecapService({
    switchGenerationTier: async () => ({ ok: false }),
    cancel: () => ({ ok: true }),
    start: () => '',
  } as never);
  const result = await service.generate(context());
  assert.deepEqual(result, { status: 'unavailable', reason: 'model_unavailable' });
});
