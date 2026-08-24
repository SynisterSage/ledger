import type { LocalAIService, LocalAIStreamEvent } from './localAIService.ts';
import {
  buildMeetingEvidenceChunks,
  buildMeetingRecapPrompt,
  parseMeetingRecapDraft,
  selectMeetingEvidenceChunks,
  type MeetingRecapGenerationResult,
} from '../src/types/meetingRecap.ts';
import type { MeetingIntelligenceContext } from '../src/types/notes.ts';

export class MeetingRecapService {
  private readonly localAI: LocalAIService;
  private activeRequestId: string | null = null;

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
    if (this.activeRequestId) this.localAI.cancel(this.activeRequestId);
    const chunks = buildMeetingEvidenceChunks(context, 2200);
    const startedAt = Date.now();
    for (const tier of ['balanced', 'fast'] as const) {
      const switched = await this.localAI.switchGenerationTier(tier).catch(() => ({ ok: false }));
      if (!switched || switched.ok !== true) continue;
      const maxEvidenceChunks = tier === 'fast' ? 3 : 4;
      const prompt = buildMeetingRecapPrompt(context, chunks, maxEvidenceChunks);
      const requestId = `meeting-recap-${Date.now()}`;
      this.activeRequestId = requestId;
      const answer = await new Promise<{ text: string; failed: boolean }>((resolve) => {
        let text = '';
        let settled = false;
        const finish = (result: { text: string; failed: boolean }) => { if (settled) return; settled = true; resolve(result); };
        const timeout = setTimeout(() => {
          this.localAI.cancel(requestId);
          finish({ text, failed: true });
        }, 120_000);
        this.localAI.start({
          question: 'Enhance this meeting note with a grounded recap.',
          context: prompt,
          generationBudget: tier === 'balanced' ? 1400 : 900,
          reasoningSignals: { answerDepth: 'standard', generationDepth: 'standard', retrievalRequired: true, routeReason: 'meeting_recap' },
        }, { onEvent: (event: LocalAIStreamEvent) => {
          if (event.type === 'delta') text += event.text ?? '';
          if (event.type === 'error') { clearTimeout(timeout); finish({ text, failed: true }); }
          if (event.type === 'done') { clearTimeout(timeout); finish({ text, failed: false }); }
        } }, requestId);
      });
      this.activeRequestId = null;
      if (answer.failed) continue;
      const draft = parseMeetingRecapDraft(answer.text, context);
      if (!draft) continue;
      const metrics = {
        requestedTier: 'balanced' as const,
        actualTier: tier,
        transcriptLength: context.transcriptSegments.reduce((sum, segment) => sum + segment.transcript_text.length, 0),
        chunkCount: selectMeetingEvidenceChunks(chunks, maxEvidenceChunks).length,
        evidenceCount: selectMeetingEvidenceChunks(chunks, maxEvidenceChunks).reduce((count, chunk) => count + chunk.segmentIds.length, 0),
        promptChars: prompt.length,
        generationMs: Date.now() - startedAt,
      };
      console.info('[meeting-recap] served', { workspaceId: context.workspaceId, noteId: context.noteId, ...metrics });
      return { status: 'ready', tier, draft, metrics };
    }
    return { status: 'unavailable', reason: 'model_unavailable' };
  }
}
