export type LedgerActionId =
  | 'task.create'
  | 'note.create'
  | 'event.create'
  | 'search.open'
  | 'note.mode.write'
  | 'note.mode.mind-map'
  | 'note.mode.transcribe'
  | 'project.create'
  | 'project.lens.catch-up'
  | 'project.lens.blockers'
  | 'project.lens.next-steps'
  | 'project.lens.prepare-actions'
  | 'project.lens.find-context'
  | 'calendar.today'
  | 'calendar.previous'
  | 'calendar.next'
  | 'calendar.view.day'
  | 'calendar.view.week'
  | 'calendar.view.month'
  | 'meeting.open'
  | 'meeting.transcript.open'
  | 'meeting.pause'
  | 'meeting.resume'
  | 'meeting.stop';

export type LedgerActionSource = 'touch-bar' | 'menu' | 'keyboard' | 'unknown';

export interface LedgerActionContext {
  source: LedgerActionSource;
  authenticated?: boolean;
  appReady?: boolean;
  touchBarContext?: import('../touchBar/touchBarContext.ts').LedgerTouchBarContext;
}

export type LedgerActionAvailability = 'always' | 'authenticated';
export type LedgerActionIcon =
  | 'task'
  | 'note'
  | 'event'
  | 'search'
  | 'project'
  | 'previous'
  | 'next'
  | 'today'
  | 'lens';
  // Meeting controls use semantic glyphs but remain native monochrome assets.

export interface LedgerActionDefinition {
  id: LedgerActionId;
  label: string;
  icon: LedgerActionIcon;
  accessibilityLabel: string;
  availability: LedgerActionAvailability;
}

export const LEDGER_ACTION_DEFINITIONS: Record<LedgerActionId, LedgerActionDefinition> = {
  'task.create': {
    id: 'task.create',
    label: 'Task',
    icon: 'task',
    accessibilityLabel: 'Create task',
    availability: 'authenticated',
  },
  'note.create': {
    id: 'note.create',
    label: 'Note',
    icon: 'note',
    accessibilityLabel: 'Create note',
    availability: 'authenticated',
  },
  'event.create': {
    id: 'event.create',
    label: 'Event',
    icon: 'event',
    accessibilityLabel: 'Create event',
    availability: 'authenticated',
  },
  'search.open': {
    id: 'search.open',
    label: 'Search',
    icon: 'search',
    accessibilityLabel: 'Open Ledger search',
    availability: 'authenticated',
  },
  'note.mode.write': { id: 'note.mode.write', label: 'Write', icon: 'note', accessibilityLabel: 'Switch note to write mode', availability: 'authenticated' },
  'note.mode.mind-map': { id: 'note.mode.mind-map', label: 'Mind Map', icon: 'note', accessibilityLabel: 'Switch note to mind map mode', availability: 'authenticated' },
  'note.mode.transcribe': { id: 'note.mode.transcribe', label: 'Transcribe', icon: 'note', accessibilityLabel: 'Switch note to transcribe mode', availability: 'authenticated' },
  'project.create': { id: 'project.create', label: 'Project', icon: 'project', accessibilityLabel: 'Create project', availability: 'authenticated' },
  'project.lens.catch-up': { id: 'project.lens.catch-up', label: 'Catch me up', icon: 'lens', accessibilityLabel: 'Catch me up on this project', availability: 'authenticated' },
  'project.lens.blockers': { id: 'project.lens.blockers', label: 'Find blockers', icon: 'lens', accessibilityLabel: 'Find project blockers', availability: 'authenticated' },
  'project.lens.next-steps': { id: 'project.lens.next-steps', label: 'Next steps', icon: 'lens', accessibilityLabel: 'Find project next steps', availability: 'authenticated' },
  'project.lens.prepare-actions': { id: 'project.lens.prepare-actions', label: 'Prepare actions', icon: 'lens', accessibilityLabel: 'Prepare project actions', availability: 'authenticated' },
  'project.lens.find-context': { id: 'project.lens.find-context', label: 'Find context', icon: 'lens', accessibilityLabel: 'Find project context', availability: 'authenticated' },
  'calendar.today': { id: 'calendar.today', label: 'Today', icon: 'today', accessibilityLabel: 'Go to today', availability: 'authenticated' },
  'calendar.previous': { id: 'calendar.previous', label: '‹', icon: 'previous', accessibilityLabel: 'Go to previous calendar period', availability: 'authenticated' },
  'calendar.next': { id: 'calendar.next', label: '›', icon: 'next', accessibilityLabel: 'Go to next calendar period', availability: 'authenticated' },
  'calendar.view.day': { id: 'calendar.view.day', label: 'Day', icon: 'today', accessibilityLabel: 'Show calendar day view', availability: 'authenticated' },
  'calendar.view.week': { id: 'calendar.view.week', label: 'Week', icon: 'today', accessibilityLabel: 'Show calendar week view', availability: 'authenticated' },
  'calendar.view.month': { id: 'calendar.view.month', label: 'Month', icon: 'today', accessibilityLabel: 'Show calendar month view', availability: 'authenticated' },
  'meeting.open': { id: 'meeting.open', label: 'Meeting', icon: 'lens', accessibilityLabel: 'Open active meeting', availability: 'authenticated' },
  'meeting.transcript.open': { id: 'meeting.transcript.open', label: 'Transcript', icon: 'note', accessibilityLabel: 'Open meeting transcript', availability: 'authenticated' },
  'meeting.pause': { id: 'meeting.pause', label: 'Pause', icon: 'lens', accessibilityLabel: 'Pause transcription', availability: 'authenticated' },
  'meeting.resume': { id: 'meeting.resume', label: 'Resume', icon: 'lens', accessibilityLabel: 'Resume transcription', availability: 'authenticated' },
  'meeting.stop': { id: 'meeting.stop', label: 'Stop', icon: 'lens', accessibilityLabel: 'Stop transcription', availability: 'authenticated' },
};

export function getLedgerActionDefinition(actionId: unknown): LedgerActionDefinition | null {
  if (typeof actionId !== 'string') return null;
  return LEDGER_ACTION_DEFINITIONS[actionId as LedgerActionId] ?? null;
}
