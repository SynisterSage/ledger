import type { LocalAIService, LocalAIStreamEvent } from './localAIService.ts';
import { buildMeetingPrepPrompt, parseMeetingPrep, type MeetingPrepContext, type MeetingPrepResult } from '../src/types/meetingPrep.ts';

export class MeetingPrepService {
  constructor(private readonly localAI: LocalAIService) {}
  async generate(context: MeetingPrepContext): Promise<MeetingPrepResult> {
    if (!context.workspaceId || !context.noteId) return { status: 'unavailable', points: [] };
    const startedAt = Date.now();
    for (const tier of ['balanced', 'fast'] as const) {
      const switched = await this.localAI.switchGenerationTier(tier).catch(() => ({ ok: false }));
      if (switched?.ok !== true) continue;
      let text = '';
      let failed = false;
      const requestId = `meeting-prep-${Date.now()}`;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { failed = true; this.localAI.cancel(requestId); resolve(); }, 90_000);
        this.localAI.start({ question: 'Prepare me for this meeting.', context: buildMeetingPrepPrompt(context), generationBudget: tier === 'balanced' ? 700 : 450, reasoningSignals: { answerDepth: 'standard', generationDepth: 'standard', retrievalRequired: true, routeReason: 'meeting_prep' } }, { onEvent: (event: LocalAIStreamEvent) => { if (event.type === 'delta') text += event.text ?? ''; if (event.type === 'error' || event.type === 'done') { clearTimeout(timeout); failed = event.type === 'error'; resolve(); } } }, requestId);
      });
      if (failed) continue;
      return { status: 'ready', tier, points: parseMeetingPrep(text), metrics: { priorMeetingCount: context.priorMeetings.length, openWorkCount: context.tasks.filter((task) => task.status !== 'completed').length, promptChars: buildMeetingPrepPrompt(context).length, generationMs: Date.now() - startedAt } };
    }
    return { status: 'unavailable', points: [] };
  }
}
