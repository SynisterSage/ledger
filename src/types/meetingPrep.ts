export type MeetingPrepContext = {
  workspaceId: string;
  noteId: string;
  currentMeeting: { title: string; scheduledStart?: string | null; attendees: unknown[]; calendarSeriesId?: string | null; calendarSeriesKey?: string | null };
  priorMeetings: Array<{ noteId: string; title: string; scheduledStart?: string | null; summary?: string; actions?: string[]; decisions?: string[] }>;
  linkedProjects: Array<{ id: string; title: string; status?: string | null; completeness?: number | null }>;
  currentProjectState: Array<{ id: string; title: string; status?: string | null; completeness?: number | null; overdueActions?: number; openActions?: number }>;
  tasks: Array<{ id: string; title: string; status?: string | null; dueDate?: string | null; projectId?: string | null; sourceNoteId?: string | null }>;
  reminders: Array<{ id: string; title: string; isDone?: boolean; remindAt?: string | null; projectId?: string | null; sourceNoteId?: string | null }>;
  unresolvedThreads: string[];
};

export type MeetingPrepResult = { status: 'ready' | 'unavailable'; tier?: 'balanced' | 'fast'; points: string[]; metrics?: { priorMeetingCount: number; openWorkCount: number; promptChars: number; generationMs: number } };

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
export const buildMeetingPrepPrompt = (context: MeetingPrepContext) => `SYSTEM / LEDGER MEETING PREP\nReturn JSON only: {"points":["..."]}. Return 0-4 concise points. Prefer exact series relationships and current Ledger task/reminder/project state. A completed task must not be described as open. Do not use stale prior text when current state contradicts it. Do not mention weak semantic matches or invent context. Say nothing rather than filler.\nCURRENT MEETING\n${clean(context.currentMeeting.title)}\nATTENDEES\n${context.currentMeeting.attendees.map(clean).join(', ')}\nPRIOR MEETINGS\n${context.priorMeetings.slice(0, 3).map((meeting) => `${meeting.noteId}: ${clean(meeting.title)} ${clean(meeting.summary)} Actions: ${(meeting.actions ?? []).map(clean).join('; ')} Decisions: ${(meeting.decisions ?? []).map(clean).join('; ')}`).join('\n') || '(none)'}\nCURRENT PROJECT STATE\n${context.currentProjectState.map((project) => `${project.title}: ${project.status ?? 'unknown'}, ${project.completeness ?? '?'}% complete, ${project.openActions ?? 0} open actions, ${project.overdueActions ?? 0} overdue`).join('\n') || '(none)'}\nOPEN WORK\n${context.tasks.filter((task) => task.status !== 'completed').map((task) => `${task.title} [${task.status ?? 'open'}]`).slice(0, 12).join('\n') || '(none)'}\nUNRESOLVED THREADS\n${context.unresolvedThreads.map(clean).slice(0, 8).join('\n') || '(none)'}`;

export const parseMeetingPrep = (text: string): string[] => {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  try {
    const value = JSON.parse(body) as { points?: unknown };
    return Array.isArray(value.points) ? value.points.map(clean).filter(Boolean).slice(0, 4) : [];
  } catch { return []; }
};
