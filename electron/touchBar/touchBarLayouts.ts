import type { LedgerActionId } from '../actions/ledgerActionTypes.ts';

export type TouchBarSpacing = 'compact' | 'standard' | 'section';

export interface TouchBarActionButtonDefinition {
  type: 'action';
  actionId: LedgerActionId;
  label?: string;
  accessibilityLabel?: string;
  spacing?: TouchBarSpacing;
}

export interface TouchBarSpacerDefinition {
  type: 'spacer';
  spacing: TouchBarSpacing;
}

export interface TouchBarSegmentDefinition {
  id: string;
  actionId: string;
  label: string;
  icon?: string;
  enabled?: boolean;
}

export type TouchBarLayoutId =
  | 'default'
  | 'notes.list'
  | 'notes.editor'
  | 'projects.list'
  | 'projects.detail'
  | 'calendar'
  | 'notes.meeting'
  | 'notes.meeting.recording'
  | 'notes.meeting.paused'
  | 'notes.meeting.processing'
  | 'notes.completed-meeting'
  | `${'default' | 'notes.list' | 'notes.editor' | 'projects.list' | 'projects.detail' | 'calendar'}.meeting`;

export interface TouchBarLayoutDefinition {
  id: TouchBarLayoutId;
  items: readonly TouchBarLayoutItem[];
}

export interface TouchBarSegmentedDefinition {
  type: 'segmented';
  selected?: string;
  items: TouchBarSegmentDefinition[];
}

export interface TouchBarPopoverDefinition {
  type: 'popover';
  label: string;
  icon?: string;
  items: TouchBarLayoutItem[];
}

export type TouchBarLayoutItem =
  | TouchBarActionButtonDefinition
  | TouchBarSpacerDefinition
  | TouchBarSegmentedDefinition
  | TouchBarPopoverDefinition;

export const action = (actionId: LedgerActionId): TouchBarActionButtonDefinition => ({
  type: 'action',
  actionId,
});
export const spacer = (spacing: TouchBarSpacing = 'standard'): TouchBarSpacerDefinition => ({
  type: 'spacer',
  spacing,
});

export const DEFAULT_TOUCH_BAR_LAYOUT = [
  action('task.create'),
  action('note.create'),
  action('event.create'),
  spacer('section'),
  action('search.open'),
] as const satisfies readonly TouchBarLayoutItem[];

const NOTES_LIST_LAYOUT = [action('note.create'), spacer('section'), action('search.open')] as const;
const NOTES_EDITOR_LAYOUT = [
  action('note.create'),
  spacer('standard'),
  { type: 'segmented', items: [
    { id: 'write', actionId: 'note.mode.write', label: 'Write' },
    { id: 'mind-map', actionId: 'note.mode.mind-map', label: 'Mind Map' },
    { id: 'transcribe', actionId: 'note.mode.transcribe', label: 'Transcribe' },
  ] },
  spacer('standard'),
  action('search.open'),
] as const satisfies readonly TouchBarLayoutItem[];
const PROJECTS_LIST_LAYOUT = [action('project.create'), spacer('section'), action('search.open')] as const;
const PROJECTS_DETAIL_LAYOUT = [
  action('task.create'),
  spacer('standard'),
  { type: 'popover', label: 'Project Lens', icon: 'lens', items: [
    action('project.lens.catch-up'),
    action('project.lens.blockers'),
    action('project.lens.next-steps'),
    action('project.lens.prepare-actions'),
    action('project.lens.find-context'),
  ] },
  spacer('section'),
  action('search.open'),
] as const satisfies readonly TouchBarLayoutItem[];
const CALENDAR_LAYOUT = [
  action('calendar.today'),
  { ...action('calendar.previous'), label: '' },
  { ...action('calendar.next'), label: '' },
  spacer('section'),
  { type: 'segmented', items: [
    { id: 'day', actionId: 'calendar.view.day', label: 'Day' },
    { id: 'week', actionId: 'calendar.view.week', label: 'Week' },
    { id: 'month', actionId: 'calendar.view.month', label: 'Month' },
  ] },
  spacer('section'),
  action('event.create'),
] as const satisfies readonly TouchBarLayoutItem[];

const MEETING_RECORDING_LAYOUT = [
  action('meeting.transcript.open'),
  spacer('standard'),
  action('meeting.pause'),
  spacer('standard'),
  action('meeting.stop'),
] as const satisfies readonly TouchBarLayoutItem[];
const MEETING_PAUSED_LAYOUT = [
  action('meeting.transcript.open'),
  spacer('standard'),
  action('meeting.resume'),
  spacer('standard'),
  action('meeting.stop'),
] as const satisfies readonly TouchBarLayoutItem[];
const MEETING_PROCESSING_LAYOUT = [action('meeting.transcript.open')] as const satisfies readonly TouchBarLayoutItem[];
const COMPLETED_MEETING_LAYOUT = [
  action('note.create'),
  spacer('standard'),
  { type: 'segmented', items: [
    { id: 'write', actionId: 'note.mode.write', label: 'Write' },
    { id: 'mind-map', actionId: 'note.mode.mind-map', label: 'Mind Map' },
    { id: 'transcribe', actionId: 'note.mode.transcribe', label: 'Transcribe' },
  ] },
  spacer('standard'),
  action('meeting.transcript.open'),
] as const satisfies readonly TouchBarLayoutItem[];

export const TOUCH_BAR_LAYOUTS: Record<string, TouchBarLayoutDefinition> = {
  default: { id: 'default', items: DEFAULT_TOUCH_BAR_LAYOUT },
  'notes.list': { id: 'notes.list', items: NOTES_LIST_LAYOUT },
  'notes.editor': { id: 'notes.editor', items: NOTES_EDITOR_LAYOUT },
  'projects.list': { id: 'projects.list', items: PROJECTS_LIST_LAYOUT },
  'projects.detail': { id: 'projects.detail', items: PROJECTS_DETAIL_LAYOUT },
  calendar: { id: 'calendar', items: CALENDAR_LAYOUT },
};

export const MEETING_LAYOUTS = {
  recording: { id: 'notes.meeting.recording', items: MEETING_RECORDING_LAYOUT },
  paused: { id: 'notes.meeting.paused', items: MEETING_PAUSED_LAYOUT },
  processing: { id: 'notes.meeting.processing', items: MEETING_PROCESSING_LAYOUT },
  completed: { id: 'notes.completed-meeting', items: COMPLETED_MEETING_LAYOUT },
} as const;
