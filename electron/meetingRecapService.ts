import type { LocalAIService, LocalAIStreamEvent } from './localAIService.ts';
import {
  buildMeetingEvidenceChunks,
  buildMeetingRecapPrompt,
  dedupeMeetingTranscriptSegments,
  parseMeetingRecapDraft,
  selectMeetingEvidenceChunks,
  type MeetingRecapGenerationResult,
} from '../src/types/meetingRecap.ts';
import type { MeetingIntelligenceContext } from '../src/types/notes.ts';

export class MeetingRecapService {
  private readonly localAI: LocalAIService;
  private activeRequestId: string | null = null;
  private generationRunId = 0;

  constructor(localAI: LocalAIService) { this.localAI = localAI; }

  async generate(context: MeetingIntelligenceContext): Promise<MeetingRecapGenerationResult> {
    const sameScope = context.transcriptSegments.every(
      (segment) => segment.workspace_id === context.workspaceId && segment.note_id === context.noteId
    ) && context.transcriptLinks.every(
      (link) => link.workspace_id === context.workspaceId && link.meeting_note_id === context.noteId
    );
    if (!context.workspaceId || !context.noteId || !context.transcriptSegments.length || !sameScope) {
      return { status: 'unavailable', reason: 'invalid_context' };
    }
    const generationRunId = ++this.generationRunId;
    if (this.activeRequestId) this.localAI.cancel(this.activeRequestId);
    // These are transport chunks, not semantic meeting sections. Keep them
    // small enough that a normal meeting can be assembled back into one
    // chronological evidence packet without the model seeing only a few
    // arbitrary slices.
    const recapContext = {
      ...context,
      transcriptSegments: dedupeMeetingTranscriptSegments(context.transcriptSegments),
    };
    const chunks = buildMeetingEvidenceChunks(recapContext, 900);
    const startedAt = Date.now();
    const requestedTier = this.localAI.getMeetingRecapGenerationTier();
    let generatedResponse = false;
    // Recaps prefer the stronger installed model. This is independent from
    // the user's general Ask Ledger selection, and never persists a recap-only
    // model switch.
    const tiers = [requestedTier] as const;
    for (const tier of tiers) {
      const switched = await this.localAI.switchGenerationTier(tier, { persistSelection: false }).catch(() => ({ ok: false }));
      if (generationRunId !== this.generationRunId) return { status: 'unavailable', reason: 'generation_failed' };
      if (!switched || switched.ok !== true) continue;
      // 12 x 900 chars covers a typical short meeting end-to-end. Prefer the
      // complete chronological packet whenever it fits; only use bounded
      // coverage sampling for meetings that would exceed the local context.
      const coverageLimit = tier === 'fast' ? 12 : 16;
      const wholePrompt = buildMeetingRecapPrompt(recapContext, chunks, chunks.length);
      const maxEvidenceChunks = wholePrompt.length <= 14_000
        ? chunks.length
        : coverageLimit;
      const prompt = maxEvidenceChunks === chunks.length
        ? wholePrompt
        : buildMeetingRecapPrompt(recapContext, chunks, maxEvidenceChunks);
      const requestId = `meeting-recap-${Date.now()}`;
      this.activeRequestId = requestId;
      const requestStartedAt = Date.now();
      console.info('[meeting-recap] generation started', {
        workspaceId: context.workspaceId,
        noteId: context.noteId,
        tier,
        requestId,
        promptChars: prompt.length,
      });
      const answer = await new Promise<{ text: string; failed: boolean }>((resolve) => {
        let text = '';
        let settled = false;
        const finish = (result: { text: string; failed: boolean }) => { if (settled) return; settled = true; resolve(result); };
        // Enhancement is interactive. Keep a stalled local runtime from
        // making the user wait through the general Ask Ledger timeout twice
        // (Balanced, then Fast) before the UI can report a failure.
        const timeout = setTimeout(() => {
          console.warn('[meeting-recap] generation timed out', {
            workspaceId: context.workspaceId,
            noteId: context.noteId,
            tier,
            requestId,
            durationMs: Date.now() - requestStartedAt,
          });
          this.localAI.cancel(requestId);
          finish({ text, failed: true });
        }, tier === 'balanced' ? 120_000 : 90_000);
        this.localAI.start({
          question: 'Enhance this meeting note with a grounded recap.',
          context: prompt,
          generationBudget: tier === 'balanced' ? 1400 : 1400,
          timeoutMs: tier === 'balanced' ? 115_000 : 85_000,
          reasoningSignals: { answerDepth: 'standard', generationDepth: 'standard', retrievalRequired: true, routeReason: 'meeting_recap' },
        }, { onEvent: (event: LocalAIStreamEvent) => {
          if (event.type === 'delta') text += event.text ?? '';
          if (event.type === 'error') {
            clearTimeout(timeout);
            console.warn('[meeting-recap] generation failed', {
              workspaceId: context.workspaceId,
              noteId: context.noteId,
              tier,
              requestId,
              durationMs: Date.now() - requestStartedAt,
              code: event.error?.code,
              error: event.error?.message,
            });
            finish({ text, failed: true });
          }
          if (event.type === 'done') {
            clearTimeout(timeout);
            generatedResponse = true;
            console.info('[meeting-recap] generation finished', {
              workspaceId: context.workspaceId,
              noteId: context.noteId,
              tier,
              requestId,
              durationMs: Date.now() - requestStartedAt,
              textChars: text.length,
              finishReason: event.metrics?.finishReason,
            });
            finish({ text, failed: false });
          }
        } }, requestId);
      });
      if (this.activeRequestId === requestId) this.activeRequestId = null;
      if (generationRunId !== this.generationRunId) return { status: 'unavailable', reason: 'generation_failed' };
      if (answer.failed) {
        // Do not silently downgrade a generation failure. Tier selection was
        // already resolved from installed-model availability above.
        break;
      }
      const draft = parseMeetingRecapDraft(answer.text, recapContext);
      const groundedItemCount = draft
        ? draft.decisions.length + draft.actions.length + draft.openThreads.length
        : 0;
      if (!draft || !draft.overview.trim() || groundedItemCount === 0) {
        console.warn('[meeting-recap] generated response was not valid recap JSON', {
          workspaceId: context.workspaceId,
          noteId: context.noteId,
          tier,
          requestId,
          textChars: answer.text.length,
          overviewChars: draft?.overview.length ?? 0,
          decisions: draft?.decisions.length ?? 0,
          actions: draft?.actions.length ?? 0,
          openThreads: draft?.openThreads.length ?? 0,
          reason: !draft ? 'invalid_json_or_shape' : 'overview_only_or_empty',
        });
        break;
      }
      console.info('[meeting-recap] parsed draft', {
        workspaceId: context.workspaceId,
        noteId: context.noteId,
        tier,
        overviewChars: draft.overview.length,
        decisions: draft.decisions.length,
        actions: draft.actions.length,
        openThreads: draft.openThreads.length,
      });
      const metrics = {
        requestedTier,
        actualTier: tier,
        transcriptLength: recapContext.transcriptSegments.reduce((sum, segment) => sum + segment.transcript_text.length, 0),
        chunkCount: selectMeetingEvidenceChunks(chunks, maxEvidenceChunks).length,
        evidenceCount: selectMeetingEvidenceChunks(chunks, maxEvidenceChunks).reduce((count, chunk) => count + chunk.segmentIds.length, 0),
        promptChars: prompt.length,
        generationMs: Date.now() - startedAt,
      };
      console.info('[meeting-recap] served', { workspaceId: context.workspaceId, noteId: context.noteId, ...metrics });
      return { status: 'ready', tier, draft, metrics };
    }
    return { status: 'unavailable', reason: generatedResponse ? 'generation_failed' : 'model_unavailable' };
  }
}
