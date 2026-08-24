import type { MeetingIntelligenceContext } from './notes.ts';

export type TranscriptEvidenceRef = {
  transcriptSegmentId: string;
  timestampMs: number;
};

export type MeetingInsight = {
  text: string;
  sourceRefs: TranscriptEvidenceRef[];
};

export type MeetingActionSuggestion = MeetingInsight & {
  ownerText?: string;
  dueDateText?: string;
};

export type MeetingRecapDraft = {
  overview: string;
  decisions: MeetingInsight[];
  actions: MeetingActionSuggestion[];
  openThreads: MeetingInsight[];
};

export type MeetingRecapGenerationResult =
  | { status: 'ready'; tier: 'balanced' | 'fast'; draft: MeetingRecapDraft; metrics: MeetingRecapMetrics }
  | { status: 'unavailable'; reason: 'model_unavailable' | 'generation_failed' | 'invalid_context' };

export type MeetingRecapMetrics = {
  requestedTier: 'balanced' | 'fast';
  actualTier: 'balanced' | 'fast';
  transcriptLength: number;
  chunkCount: number;
  evidenceCount: number;
  promptChars: number;
  generationMs: number;
};

export type MeetingEvidenceChunk = {
  index: number;
  segmentIds: string[];
  text: string;
};

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const autoMeetingTemplate = (context: MeetingIntelligenceContext) => {
  const title = clean(context.meeting.title).toLowerCase();
  if (/\b1[: -]?1\b|one[- ]on[- ]one/.test(title) || context.meeting.attendees.length === 2) return 'one_on_one';
  if (/customer|sales|client|demo|discovery/.test(title)) return 'customer_sales';
  if (/interview|candidate/.test(title)) return 'interview';
  if (/project|review|milestone/.test(title) && context.relatedContext?.project) return 'project_review';
  if (/sync|standup|weekly|team/.test(title)) return 'team_sync';
  return 'auto';
};
export const buildMeetingEvidenceChunks = (
  context: MeetingIntelligenceContext,
  maxChars = 2200,
): MeetingEvidenceChunk[] => {
  const segments = [...context.transcriptSegments]
    .filter((segment) => !segment.deleted_at)
    .sort((a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order);
  const chunks: MeetingEvidenceChunk[] = [];
  let current: MeetingEvidenceChunk = { index: 0, segmentIds: [], text: '' };
  for (const segment of segments) {
    const line = `[${segment.id}|${segment.start_ms}] ${clean(segment.speaker_label || '')}${segment.speaker_label ? ': ' : ''}${clean(segment.transcript_text)}`;
    if (current.text && current.text.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = { index: chunks.length, segmentIds: [], text: '' };
    }
    current.segmentIds.push(segment.id);
    current.text = current.text ? `${current.text}\n${line}` : line;
  }
  if (current.text) chunks.push(current);
  return chunks;
};

/**
 * Keep the final local-model packet bounded without making a long meeting
 * look like only its opening minutes. The selected chunks remain intact so
 * every citation still points to the original segment and timestamp.
 */
export const selectMeetingEvidenceChunks = (
  chunks: MeetingEvidenceChunk[],
  maxChunks: number,
): MeetingEvidenceChunk[] => {
  if (maxChunks <= 0 || chunks.length <= maxChunks) return chunks;
  if (maxChunks === 1) return [chunks[0]];

  const selectedIndexes = new Set<number>();
  for (let index = 0; index < maxChunks; index += 1) {
    selectedIndexes.add(Math.round((index * (chunks.length - 1)) / (maxChunks - 1)));
  }
  return [...selectedIndexes].sort((left, right) => left - right).map((index) => chunks[index]);
};

export const buildMeetingRecapPrompt = (
  context: MeetingIntelligenceContext,
  evidence: MeetingEvidenceChunk[],
  maxEvidenceChunks = 12,
) => {
  const notes = clean(context.humanNotes.contentText || context.humanNotes.contentHtml).slice(0, 6000);
  const meeting = [
    `Title: ${clean(context.meeting.title)}`,
    context.meeting.scheduledStart ? `Scheduled start: ${context.meeting.scheduledStart}` : '',
    context.meeting.scheduledEnd ? `Scheduled end: ${context.meeting.scheduledEnd}` : '',
    context.meeting.attendees.length ? `Attendees: ${context.meeting.attendees.map(clean).join(', ')}` : '',
    context.meeting.template ? `Template: ${context.meeting.template}` : '',
    context.meeting.templateInstructions ? `Custom emphasis: ${clean(context.meeting.templateInstructions).slice(0, 1000)}` : '',
    context.relatedContext?.project && typeof context.relatedContext.project === 'object'
      ? `Related project: ${clean((context.relatedContext.project as Record<string, unknown>).title)}`
      : '',
    context.relatedContext?.event && typeof context.relatedContext.event === 'object'
      ? `Related event: ${clean((context.relatedContext.event as Record<string, unknown>).title)}`
      : '',
  ].filter(Boolean).join('\n');
  const evidenceText = selectMeetingEvidenceChunks(evidence, maxEvidenceChunks).map((chunk) => `CHUNK ${chunk.index}\n${chunk.text}`).join('\n\n');
  const requestedTemplate = context.meeting.template ?? 'auto';
  const effectiveTemplate = requestedTemplate === 'auto' ? autoMeetingTemplate(context) : requestedTemplate;
  const emphasis: Record<string, string> = {
    one_on_one: 'Prioritize discussion themes, feedback, commitments, follow-ups, and unresolved topics.',
    team_sync: 'Prioritize updates, decisions, blockers, ownership, and next actions.',
    project_review: 'Prioritize progress, decisions, risks, milestones, and next actions.',
    customer_sales: 'Prioritize needs, pain points, objections, commitments, and follow-ups.',
    interview: 'Prioritize themes, notable responses, evidence/examples, and follow-up questions.',
    auto: 'Use useful generic emphasis; do not force a meeting type.',
    custom: context.meeting.templateInstructions ? clean(context.meeting.templateInstructions).slice(0, 1000) : 'Use a balanced generic meeting recap.',
  };
  const selectedEmphasis = emphasis[effectiveTemplate] ?? emphasis.auto;
  return `SYSTEM / LEDGER MEETING RECAP\nReturn JSON only. Do not return markdown.\nTemplate emphasis: ${selectedEmphasis}\nSchema: {"overview":"","decisions":[{"text":"","sourceRefs":[{"transcriptSegmentId":"","timestampMs":0}]}],"actions":[{"text":"","ownerText":"","dueDateText":"","sourceRefs":[{"transcriptSegmentId":"","timestampMs":0}]}],"openThreads":[{"text":"","sourceRefs":[{"transcriptSegmentId":"","timestampMs":0}]}]}\nUse only source IDs and timestamps present in the transcript evidence. Never fabricate citations. Human notes are user-authored context: use them to enrich the recap, recover details the transcript may underrepresent, and shape useful emphasis. Do not delete, rewrite, or present human notes as transcript evidence; the original human notes must remain preserved separately under Your notes. Transcript evidence is authoritative for what was said. Exact calendar/project data is authoritative for structured state. Do not invent decisions, owners, deadlines, or speaker identities. A discussion is not a decision unless commitment is supported. Omit uncertain owners and dates. Say less when evidence is weak. Keep overview to 2-4 sentences. Keep each item concise. Return at most 6 decisions, 8 actions, and 6 open threads.\n\nMEETING CONTEXT\n${meeting}\n\nHUMAN NOTES\n${notes || '(none)'}\n\nTRANSCRIPT EVIDENCE\n${evidenceText || '(none)'}`;
};

const parseJson = (text: string): unknown => {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  try { return JSON.parse(body); } catch { return null; }
};

export const parseMeetingRecapDraft = (text: string, context: MeetingIntelligenceContext): MeetingRecapDraft | null => {
  const value = parseJson(text);
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const segments = new Map(context.transcriptSegments.map((segment) => [segment.id, segment]));
  const refs = (value: unknown): TranscriptEvidenceRef[] => Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const ref = item as Record<string, unknown>;
        const id = clean(ref.transcriptSegmentId);
        const segment = segments.get(id);
        const timestampMs = Number(ref.timestampMs);
        return segment && Number.isFinite(timestampMs) && timestampMs >= segment.start_ms && timestampMs <= segment.end_ms
          ? [{ transcriptSegmentId: id, timestampMs: Math.max(0, Math.floor(timestampMs)) }]
          : [];
      }).slice(0, 4)
    : [];
  const insight = (item: unknown): MeetingInsight | null => {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const text = clean(row.text).slice(0, 500);
    const sourceRefs = refs(row.sourceRefs);
    return text && sourceRefs.length ? { text, sourceRefs } : null;
  };
  const actions = Array.isArray(raw.actions) ? raw.actions.flatMap((item) => {
    const base = insight(item);
    if (!base || !item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    return [{ ...base, ownerText: clean(row.ownerText).slice(0, 120) || undefined, dueDateText: clean(row.dueDateText).slice(0, 120) || undefined }];
  }).slice(0, 8) : [];
  return {
    overview: clean(raw.overview).slice(0, 1200),
    decisions: Array.isArray(raw.decisions) ? raw.decisions.flatMap((item) => { const parsed = insight(item); return parsed ? [parsed] : []; }).slice(0, 6) : [],
    actions,
    openThreads: Array.isArray(raw.openThreads) ? raw.openThreads.flatMap((item) => { const parsed = insight(item); return parsed ? [parsed] : []; }).slice(0, 6) : [],
  };
};
