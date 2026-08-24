import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMeetingContext } from './askLedgerService.ts';
import type { AskLedgerContextItem, AskLedgerInitialContext } from '../src/types/askLedgerContext.ts';

const item = (resourceType: AskLedgerContextItem['resourceType'], resourceId: string, extra: Partial<AskLedgerContextItem> = {}): AskLedgerContextItem => ({ resourceType, resourceId, title: resourceId, content: resourceId, workspaceId: 'workspace-a', ...extra });

test('meeting expansion prefers current note, explicit series, linked project, and transcript evidence', () => {
  const current = item('note', 'note-current', { projectId: 'project-a', metadata: { calendarSeriesId: 'series-a' } });
  const sameSeries = item('note', 'note-prior', { metadata: { calendarSeriesId: 'series-a' } });
  const transcript = item('transcript', 'segment-1', { parentResourceId: 'note-prior' });
  const otherTitle = item('note', 'note-other', { title: 'Weekly Design Review', metadata: { calendarSeriesId: 'series-b' } });
  const context: AskLedgerInitialContext = { resourceType: 'note', resourceId: 'note-current', title: 'Weekly Design Review', contextType: 'meeting', workspaceId: 'workspace-a', meetingNoteId: 'note-current', calendarSeriesId: 'series-a', linkedProjectId: 'project-a' };
  const result = expandMeetingContext(current, [current], [current, sameSeries, transcript, otherTitle], context);
  assert.ok(result.some((candidate) => candidate.resourceId === 'note-current'));
  assert.ok(result.some((candidate) => candidate.resourceId === 'note-prior'));
  assert.ok(result.some((candidate) => candidate.resourceId === 'segment-1'));
  assert.equal(result.some((candidate) => candidate.resourceId === 'note-other'), false);
});

test('meeting context never crosses workspace boundaries', () => {
  const current = item('note', 'note-current');
  const distractor = item('note', 'note-other', { workspaceId: 'workspace-b', metadata: { calendarSeriesId: 'series-a' } });
  const context: AskLedgerInitialContext = { resourceType: 'note', resourceId: 'note-current', title: 'Review', contextType: 'meeting', workspaceId: 'workspace-a', calendarSeriesId: 'series-a' };
  const result = expandMeetingContext(current, [current], [current, distractor], context);
  assert.equal(result.some((candidate) => candidate.workspaceId === 'workspace-b'), false);
});

test('selected meeting notes do not expand to unrelated same-title notes', () => {
  const current = item('note', 'note-current', { title: 'Untitled Note' });
  const transcript = item('transcript', 'segment-current', { parentResourceId: 'note-current', content: 'The team approved the launch.' });
  const unrelated = item('note', 'note-unrelated', { title: 'Untitled Note', content: 'A different meeting with unrelated content.' });
  const unrelatedTranscript = item('transcript', 'segment-unrelated', { parentResourceId: 'note-unrelated', content: 'A different conversation.' });
  const context: AskLedgerInitialContext = { resourceType: 'note', resourceId: 'note-current', title: 'Untitled Note', contextType: 'meeting', workspaceId: 'workspace-a', meetingNoteId: 'note-current' };
  const result = expandMeetingContext(current, [current], [current, transcript, unrelated, unrelatedTranscript], context);
  assert.deepEqual(result.map((candidate) => candidate.resourceId), ['note-current', 'segment-current']);
});
