import test from 'node:test';
import assert from 'node:assert/strict';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { compileAskLedgerEvidence } from './askLedgerEvidencePipeline.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-default', title: 'Evidence', content: 'Useful evidence.', ...overrides,
});

const debug = (resource: AskLedgerContextItem, score: number, why: string[] = [], signals: Partial<{ structuredMatch: boolean; exactEntityMatch: boolean }> = {}) => ({
  resourceType: resource.resourceType, resourceId: resource.resourceId, title: resource.title, score, why, ...signals,
});

test('preserves requested category coverage when notes dominate the input', () => {
  const notes = Array.from({ length: 12 }, (_, index) => item({ resourceType: 'note', resourceId: `note-${index}`, title: `Catalog note ${index}`, content: `Note detail ${index}.` }));
  const milestone = item({ resourceType: 'milestone', resourceId: 'milestone-1', title: 'Final production', content: 'Production milestone.', projectId: 'project-1' });
  const task = item({ resourceType: 'task', resourceId: 'task-1', title: 'Review final proof', content: 'Open today task.', projectId: 'project-1', horizon: 'today', taskHorizon: 'today', status: 'In Progress' });
  const result = compileAskLedgerEvidence({
    question: 'Connect meetings, milestones, and tasks.',
    result: {
      items: [...notes, milestone, task],
      debug: [...notes.map((entry) => debug(entry, 1.1)), debug(milestone, 0.3), debug(task, 0.25, ['structured'], { structuredMatch: true })],
      orchestration: { mode: 'research', objectives: [], retrievalRounds: 1, discoveredEntities: [], coverage: { meetings: 'not_found', milestones: 'found', tasks: 'found' }, resourcesCollected: 14, resourcesDiscarded: 0, stopReason: 'objectives_satisfied', provenance: [] },
      mode: 'research',
    },
    budget: { maxResources: 5, maxTokens: 2000 },
  });
  assert.ok(result.selectedItems.some((entry) => entry.resourceType === 'milestone'));
  assert.ok(result.selectedItems.some((entry) => entry.resourceType === 'task'));
  assert.deepEqual(result.package.coverage.missing, ['meetings']);
  assert.equal(result.diagnostics.selectedResources <= 5, true);
});

test('structural authority outranks a stronger unrelated semantic match', () => {
  const linkedTask = item({ resourceType: 'task', resourceId: 'task-linked', title: 'Review Alfa proof', content: 'Direct project task.', projectId: 'project-alfa', status: 'In Progress' });
  const unrelatedNote = item({ resourceType: 'note', resourceId: 'note-unrelated', title: 'Catalog discussion', content: 'Semantically similar catalog discussion.' });
  const result = compileAskLedgerEvidence({
    question: 'What is happening with Alfa?',
    result: {
      items: [unrelatedNote, linkedTask],
      debug: [debug(unrelatedNote, 1.7), debug(linkedTask, 0.58, ['structured-match'], { structuredMatch: true })],
      orchestration: { mode: 'research', objectives: [], retrievalRounds: 1, discoveredEntities: [], coverage: { projects: 'found', tasks: 'found' }, resourcesCollected: 2, resourcesDiscarded: 0, stopReason: 'objectives_satisfied', provenance: [{ resourceKey: 'task:task-linked', objectiveId: 'project-open-tasks', path: ['project:project-alfa', 'task:task-linked'] }] },
      mode: 'research',
    },
    budget: { maxResources: 1, maxTokens: 1000 },
  });
  assert.equal(result.selectedItems[0].resourceId, 'task-linked');
  assert.ok(result.package.sources[0].score.reasons.includes('direct-ledger-relationship'));
});

test('limits transcript segments per meeting and preserves chronological order', () => {
  const transcripts = [1, 2, 3, 4].map((index) => item({ resourceType: 'transcript', resourceId: `transcript-${index}`, title: 'Workday transcript', content: `Segment ${index}`, parentResourceId: 'note-workday', timestamp: `2026-08-14T10:0${index}:00Z` }));
  const result = compileAskLedgerEvidence({
    question: 'Summarize the Workday meeting transcript.',
    result: { items: transcripts, debug: transcripts.map((entry) => debug(entry, 0.8)), mode: 'research' },
    budget: { maxResources: 4, maxTokens: 1000, maxTranscriptSegmentsPerParent: 2 },
  });
  assert.equal(result.selectedItems.length, 2);
  assert.equal(result.package.sections[0].items[0].resource.resourceId, 'transcript-3');
  assert.equal(result.package.sections[0].items[1].resource.resourceId, 'transcript-4');
  assert.equal(result.diagnostics.dropReasons.redundant_transcript >= 2, true);
});

test('deduplicates identical transcript content and retains provenance', () => {
  const first = item({ resourceType: 'transcript', resourceId: 'transcript-1', title: 'Meeting transcript', content: 'The final proof is waiting on review.', parentResourceId: 'note-1' });
  const duplicate = { ...first, resourceId: 'transcript-2' };
  const result = compileAskLedgerEvidence({ question: 'What is waiting?', result: { items: [first, duplicate], debug: [debug(first, 0.8), debug(duplicate, 0.7)], mode: 'quick' } });
  assert.equal(result.selectedItems.length, 1);
  assert.equal(result.diagnostics.dropReasons.redundant_transcript, 1);
  assert.deepEqual(result.package.sources[0].relationshipPath, ['transcript:transcript-1']);
});

test('prioritizes unread attention signals and collapses duplicate activity notifications', () => {
  const activity = item({ resourceType: 'activity', resourceId: 'activity-1', title: 'Task due date changed', content: 'Review proof changed.', activityType: 'task_due_date_changed', projectId: 'project-1', metadata: { sourceType: 'task', sourceId: 'task-1', notificationType: 'task_due' } });
  const notification = item({ resourceType: 'notification', resourceId: 'notification-1', title: 'Review proof is due', content: 'Review proof changed.', read: false, priority: 'high', metadata: { sourceType: 'task', sourceId: 'task-1', notificationType: 'task_due' } });
  const result = compileAskLedgerEvidence({ question: 'What needs my attention?', result: { items: [activity, notification], debug: [debug(activity, 0.5), debug(notification, 0.4)], mode: 'research', orchestration: { mode: 'research', objectives: [], retrievalRounds: 1, discoveredEntities: [], coverage: { notifications: 'found', activity: 'found' }, resourcesCollected: 2, resourcesDiscarded: 0, stopReason: 'objectives_satisfied', provenance: [] } }, budget: { maxResources: 4, maxTokens: 1200 } });
  assert.equal(result.selectedItems.length, 1);
  assert.equal(result.selectedItems[0].resourceType, 'activity');
  assert.equal(result.diagnostics.dropReasons.duplicate_activity_notification, 1);
});
