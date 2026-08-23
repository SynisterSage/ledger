import type {
  MeetingNoteMetadata,
  MeetingSpeakerIdentity,
  TranscriptSegment,
} from './notes';
import type { TranscriptEvidenceRef } from './meetingRecap';

export type MeetingIdentitySuggestion = {
  rawSpeakerId?: string;
  personId?: string;
  displayName?: string;
  state: 'suggested' | 'unknown';
  confidence?: number;
  sourceRefs: TranscriptEvidenceRef[];
  rationale?: string;
};

export type MeetingIdentitySuggestionResult = {
  status: 'ready' | 'unavailable';
  tier?: 'balanced' | 'fast';
  suggestions: MeetingIdentitySuggestion[];
};

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const parseMeetingIdentitySuggestions = (
  text: string,
  context: { transcriptSegments: TranscriptSegment[]; attendees: MeetingAttendee[] }
): MeetingIdentitySuggestion[] => {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const rows = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(rows)) return [];
  const segments = new Map(context.transcriptSegments.map((segment) => [segment.id, segment]));
  const attendeeIds = new Set(context.attendees.flatMap((attendee) => attendee.id ? [attendee.id] : []));
  const attendeeNames = new Set(context.attendees.map((attendee) => attendee.name.toLowerCase()));
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const state: MeetingIdentitySuggestion['state'] | null = row.state === 'unknown' ? 'unknown' : row.state === 'suggested' ? 'suggested' : null;
    const displayName = clean(row.displayName).slice(0, 120);
    const personId = clean(row.personId) || undefined;
    if (!state || (state === 'suggested' && !displayName)) return [];
    if (personId && !attendeeIds.has(personId)) return [];
    if (displayName && state === 'suggested' && !attendeeNames.has(displayName.toLowerCase())) return [];
    const sourceRefs = Array.isArray(row.sourceRefs) ? row.sourceRefs.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const ref = raw as Record<string, unknown>;
      const segment = segments.get(clean(ref.transcriptSegmentId));
      const timestampMs = Number(ref.timestampMs);
      return segment && Number.isFinite(timestampMs) && timestampMs >= segment.start_ms && timestampMs <= segment.end_ms
        ? [{ transcriptSegmentId: segment.id, timestampMs: Math.floor(timestampMs) }]
        : [];
    }).slice(0, 4) : [];
    if (!sourceRefs.length) return [];
    return [{ rawSpeakerId: clean(row.rawSpeakerId) || undefined, personId, displayName: displayName || undefined, state, confidence: Number.isFinite(Number(row.confidence)) ? Math.max(0, Math.min(1, Number(row.confidence))) : undefined, sourceRefs, rationale: clean(row.rationale).slice(0, 240) || undefined }];
  }).slice(0, 8);
};

export const buildMeetingIdentityPrompt = (context: { meetingTitle: string; attendees: MeetingAttendee[]; humanNotes: string; transcriptSegments: TranscriptSegment[] }) => {
  const transcript = context.transcriptSegments.slice().sort((a, b) => a.start_ms - b.start_ms).map((segment) => `[${segment.id}|${segment.start_ms}] ${segment.speaker_label ?? ''}: ${segment.transcript_text}`).join('\n');
  return `SYSTEM / LEDGER MEETING PEOPLE\nReturn JSON only: {"suggestions":[{"rawSpeakerId":"","personId":"","displayName":"","state":"suggested|unknown","confidence":0,"sourceRefs":[{"transcriptSegmentId":"","timestampMs":0},],"rationale":""}]}\nKnown deterministic identities are handled by Ledger. Never output state known. Never identify individual speakers inside group system audio without a real raw speaker ID/diarization signal. A name mentioned in third person is not the speaker. Human notes are leads, not facts. Only suggest an attendee name when transcript wording strongly supports it. Otherwise output unknown or omit the suggestion. Never invent names, IDs, citations, owners, or certainty.\nMEETING: ${clean(context.meetingTitle)}\nATTENDEES: ${context.attendees.map((attendee) => `${attendee.name}${attendee.id ? ` (${attendee.id})` : ''}`).join(', ')}\nHUMAN NOTES: ${clean(context.humanNotes).slice(0, 4000) || '(none)'}\nTRANSCRIPT:\n${transcript || '(none)'}`;
};

export type MeetingAttendee = {
  id?: string;
  name: string;
  email?: string;
};

export const normalizeMeetingAttendees = (attendees: unknown[] | null | undefined): MeetingAttendee[] =>
  (attendees ?? [])
    .map((attendee) => {
      if (typeof attendee === 'string') return { name: attendee.trim() };
      if (!attendee || typeof attendee !== 'object') return null;
      const value = attendee as Record<string, unknown>;
      const name = String(value.name ?? value.full_name ?? value.displayName ?? value.email ?? '').trim();
      if (!name) return null;
      const id = String(value.id ?? value.user_id ?? value.person_id ?? '').trim();
      const email = String(value.email ?? '').trim();
      return { name, ...(id ? { id } : {}), ...(email ? { email } : {}) };
    })
    .filter((attendee): attendee is MeetingAttendee => Boolean(attendee?.name));

const samePerson = (left: MeetingAttendee, right: { name?: string | null; email?: string | null }) => {
  const leftEmail = left.email?.toLowerCase();
  const rightEmail = right.email?.toLowerCase();
  return Boolean(leftEmail && rightEmail && leftEmail === rightEmail) || left.name.toLowerCase() === String(right.name ?? '').trim().toLowerCase();
};

export const resolveDeterministicSpeakerIdentity = ({
  segment,
  metadata,
  currentUser,
  currentUserName,
}: {
  segment: TranscriptSegment;
  metadata: MeetingNoteMetadata | null;
  currentUser?: { id?: string; email?: string | null } | null;
  currentUserName?: string | null;
}): MeetingSpeakerIdentity => {
  const rawSpeakerId = `source:${segment.audio_source}`;
  if (segment.speaker_identity?.confirmedByUser) return segment.speaker_identity;
  if (segment.audio_source === 'user_microphone') {
    return {
      rawSpeakerId,
      personId: currentUser?.id,
      displayName: currentUserName || currentUser?.email || 'You',
      state: 'known',
      confidence: 1,
      source: 'current_user',
      confirmedByUser: false,
    };
  }
  const attendees = normalizeMeetingAttendees(metadata?.attendees);
  const external = attendees.filter((attendee) => !samePerson(attendee, { name: currentUserName, email: currentUser?.email }));
  if (external.length === 1) {
    const attendee = external[0];
    return {
      rawSpeakerId,
      personId: attendee.id,
      displayName: attendee.name,
      state: 'known',
      confidence: 1,
      source: 'calendar_attendee',
      confirmedByUser: false,
    };
  }
  return { rawSpeakerId, state: 'unknown', confirmedByUser: false };
};
