import type { LocalAIService, LocalAIStreamEvent } from './localAIService.ts';
import { buildMeetingIdentityPrompt, parseMeetingIdentitySuggestions, type MeetingIdentitySuggestionResult } from '../src/types/meetingPeople.ts';
import { normalizeMeetingAttendees } from '../src/types/meetingPeople.ts';
import type { MeetingIntelligenceContext } from '../src/types/notes.ts';

export class MeetingPeopleService {
  private readonly localAI: LocalAIService;
  constructor(localAI: LocalAIService) { this.localAI = localAI; }

  async suggest(context: MeetingIntelligenceContext): Promise<MeetingIdentitySuggestionResult> {
    if (!context.workspaceId || !context.noteId || !context.transcriptSegments.length) return { status: 'unavailable', suggestions: [] };
    const attendees = normalizeMeetingAttendees(context.meeting.attendees);
    for (const tier of ['balanced', 'fast'] as const) {
      const switched = await this.localAI.switchGenerationTier(tier).catch(() => ({ ok: false }));
      if (!switched || switched.ok !== true) continue;
      let text = '';
      let failed = false;
      const requestId = `meeting-people-${Date.now()}`;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { failed = true; this.localAI.cancel(requestId); resolve(); }, 90_000);
        this.localAI.start({ question: 'Suggest conservative meeting identity mappings.', context: buildMeetingIdentityPrompt({ meetingTitle: context.meeting.title, attendees, humanNotes: context.humanNotes.contentText ?? context.humanNotes.contentHtml, transcriptSegments: context.transcriptSegments }), generationBudget: tier === 'balanced' ? 900 : 600, reasoningSignals: { answerDepth: 'standard', generationDepth: 'standard', retrievalRequired: true, routeReason: 'meeting_people' } }, { onEvent: (event: LocalAIStreamEvent) => { if (event.type === 'delta') text += event.text ?? ''; if (event.type === 'error' || event.type === 'done') { clearTimeout(timeout); failed = event.type === 'error'; resolve(); } } }, requestId);
      });
      if (failed) continue;
      return { status: 'ready', tier, suggestions: parseMeetingIdentitySuggestions(text, { transcriptSegments: context.transcriptSegments, attendees }) };
    }
    return { status: 'unavailable', suggestions: [] };
  }
}
