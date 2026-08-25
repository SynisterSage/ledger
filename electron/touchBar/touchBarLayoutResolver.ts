import type { LedgerTouchBarContext } from './touchBarContext.ts';
import { MEETING_LAYOUTS, TOUCH_BAR_LAYOUTS, type TouchBarLayoutDefinition } from './touchBarLayouts.ts';

export type { TouchBarLayoutDefinition } from './touchBarLayouts.ts';

export function resolveTouchBarLayout(context: LedgerTouchBarContext): TouchBarLayoutDefinition {
  const meeting = context.meeting;
  const viewingMeetingNote = Boolean(
    meeting?.noteId && context.page === 'notes' && context.surface === 'editor' &&
      context.resource?.type === 'note' && context.resource.id === meeting.noteId
  );
  if (viewingMeetingNote && meeting?.state === 'recording') return MEETING_LAYOUTS.recording;
  if (viewingMeetingNote && meeting?.state === 'paused') return MEETING_LAYOUTS.paused;
  if (viewingMeetingNote && meeting?.state === 'processing') return MEETING_LAYOUTS.processing;
  if (viewingMeetingNote && meeting?.state === 'completed') return MEETING_LAYOUTS.completed;

  let base: TouchBarLayoutDefinition;
  if (context.page === 'notes') {
    base = context.surface === 'editor' && context.resource?.type === 'note'
      ? TOUCH_BAR_LAYOUTS['notes.editor']
      : TOUCH_BAR_LAYOUTS['notes.list'];
  } else if (context.page === 'projects') {
    base = context.surface === 'detail' && context.resource?.type === 'project'
      ? TOUCH_BAR_LAYOUTS['projects.detail']
      : TOUCH_BAR_LAYOUTS['projects.list'];
  } else if (context.page === 'calendar') {
    base = TOUCH_BAR_LAYOUTS.calendar;
  } else {
    base = TOUCH_BAR_LAYOUTS.default;
  }
  if (!meeting?.active || meeting.state === 'completed') return base;
  return {
    id: `${base.id}.meeting` as TouchBarLayoutDefinition['id'],
    items: [...base.items, { type: 'spacer', spacing: 'section' }, { type: 'action', actionId: 'meeting.open', label: '● Meeting', accessibilityLabel: `Active meeting, ${meeting.state}` }],
  };
}
