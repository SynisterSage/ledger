import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetrievalPlan } from './askLedgerRetrievalPlan.ts';
import { EmbeddingIndexService, LedgerRetrievalService } from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-default', title: 'Note', content: 'Content.', ...overrides,
});

test('builds a note container plan with ordering and count constraints', () => {
  const plan = buildRetrievalPlan('Can you look through my Workday meeting notes folder, last 3 notes or so, and summarize them?');
  assert.equal(plan.operation, 'summarize');
  assert.deepEqual(plan.primaryResourceTypes, ['note']);
  assert.equal(plan.containerQuery, 'Workday meeting notes');
  assert.equal(plan.ordering, 'newest');
  assert.equal(plan.requestedCount, 3);
  assert.equal(plan.expandRelatedContext, true);
});

test('builds resource-aware plans for common constrained requests', () => {
  assert.deepEqual(buildRetrievalPlan('Summarize my last 3 notes').primaryResourceTypes, ['note']);
  assert.equal(buildRetrievalPlan('Summarize my last 3 notes').requestedCount, 3);
  assert.deepEqual(buildRetrievalPlan('What happened in my last 3 meetings with Zhou?').primaryResourceTypes, ['event']);
  assert.equal(buildRetrievalPlan('What happened in my last 3 meetings with Zhou?').entityQuery, 'Zhou');
  assert.deepEqual(buildRetrievalPlan('Look at my newest reminders for Project X').primaryResourceTypes, ['reminder']);
  assert.equal(buildRetrievalPlan('Look at my newest reminders for Project X').entityQuery, 'Project X');
  assert.equal(buildRetrievalPlan('Look through my Workday meetings and linked context').entityQuery, 'Workday');
  assert.deepEqual(buildRetrievalPlan('Look through my Workday meetings and linked context').primaryResourceTypes, ['event', 'note']);
  assert.equal(buildRetrievalPlan('Show my today tasks').structuredConstraints.horizon, 'today');
  assert.equal(buildRetrievalPlan('Show overdue tasks').structuredConstraints.overdue, true);
  assert.equal(buildRetrievalPlan('Show completed Alfa tasks').entityQuery, 'Alfa');
});

test('builds attention and notification plans from authoritative fields', () => {
  const unread = buildRetrievalPlan('Show my unread notifications');
  assert.deepEqual(unread.primaryResourceTypes, ['notification']);
  assert.equal(unread.structuredConstraints.read, false);
  const circle = buildRetrievalPlan('What changed in Circle this week?');
  assert.deepEqual(circle.primaryResourceTypes, ['activity']);
  assert.equal(circle.structuredConstraints.sourceLabel, 'Circle');
  assert.ok(circle.structuredConstraints.dueAfter);
});

test('constrains explicit integration questions to their provider', () => {
  const plan = buildRetrievalPlan('What did Slack say about Alfa?');
  assert.deepEqual(plan.primaryResourceTypes, ['external']);
  assert.deepEqual(plan.integrationProviders, ['slack']);
  assert.equal(plan.integrationRequested, true);
  assert.equal(plan.entityQuery, 'Alfa');
});

test('treats last workday questions as newest event lookups', () => {
  const plan = buildRetrievalPlan('When was my last day working at Alfa Art Gallery?');
  assert.deepEqual(plan.primaryResourceTypes, ['event']);
  assert.equal(plan.entityQuery, 'Alfa');
  assert.equal(plan.ordering, 'newest');
  assert.equal(plan.requestedCount, 1);
  assert.equal(plan.expandRelatedContext, false);
});

test('anchors named project requests and expands linked work context', () => {
  const plan = buildRetrievalPlan('What is my Pigmented Perceptions project?');
  assert.deepEqual(plan.primaryResourceTypes, ['project']);
  assert.equal(plan.entityQuery, 'Pigmented Perceptions');
  assert.equal(plan.expandRelatedContext, true);
});

test('selects scoped newest notes before unrelated semantic candidates', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    item({ resourceId: 'note-old', title: 'Workday sync', content: 'Folder: Workday meeting notes. Old decision.', updatedAt: '2026-08-10T10:00:00Z' }),
    item({ resourceId: 'note-new-1', title: 'Workday sync', content: 'Folder: Workday meeting notes. Newest decision and content.', updatedAt: '2026-08-17T10:00:00Z' }),
    item({ resourceId: 'note-new-2', title: 'Workday review', content: 'Folder: Workday meeting notes. Another recent note with details.', updatedAt: '2026-08-16T10:00:00Z' }),
    item({ resourceId: 'note-new-3', title: 'Workday planning', content: 'Folder: Workday meeting notes. Third recent note.', updatedAt: '2026-08-15T10:00:00Z' }),
    item({ resourceId: 'note-unrelated', title: 'Calendar notes', content: 'Calendar event metadata with a highly similar meeting phrase.', updatedAt: '2026-08-17T12:00:00Z' }),
    item({ resourceType: 'event', resourceId: 'event-related', title: 'Workday meeting', content: 'Linked meeting context.', parentResourceId: 'note-new-1', updatedAt: '2026-08-17T11:00:00Z' }),
  ]);
  const plan = buildRetrievalPlan('Can you look through my Workday meeting notes folder, last 3 notes or so, and summarize them?');
  const result = await retrieval.retrieve('workspace-a', plan.semanticQuery, [], 8, { plan });
  assert.deepEqual(result.primaryItems?.map((entry) => entry.resourceId), ['note-new-1', 'note-new-2', 'note-new-3']);
  assert.equal(result.primaryItems?.every((entry) => entry.content.includes('decision') || entry.content.includes('details') || entry.content.includes('Third')), true);
  assert.equal(result.primaryItems?.some((entry) => entry.resourceId === 'note-unrelated'), false);
  assert.equal(result.relatedItems?.[0]?.resourceId, 'event-related');
});

test('does not fall back to projects when an authoritative meeting corpus is empty', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    item({ resourceType: 'project', resourceId: 'project-1', title: 'Workday rollout', content: 'Status: In progress.' }),
  ]);
  const plan = buildRetrievalPlan('Look through my Workday meetings and summarize them');
  const result = await retrieval.retrieve('workspace-a', plan.semanticQuery, [], 20, { plan });
  assert.deepEqual(result.primaryItems, []);
  assert.deepEqual(result.items, []);
});

test('expands meeting evidence through notes into linked project work', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    item({ resourceType: 'event', resourceId: 'event-1', title: 'Workday meeting', content: 'Workday review.', parentResourceId: 'note-1', projectId: 'project-1' }),
    item({ resourceType: 'note', resourceId: 'note-1', title: 'Workday meeting notes', content: 'Decision: ship the catalog. Next action: review milestones.', projectId: 'project-1' }),
    item({ resourceType: 'project', resourceId: 'project-1', title: 'Alfa 2026 Catalog', content: 'Status: In progress.', projectId: 'project-1' }),
    item({ resourceType: 'task', resourceId: 'task-1', title: 'Review catalog milestones', content: 'Open follow-up.', projectId: 'project-1' }),
  ]);
  const plan = buildRetrievalPlan('Look through my Workday meetings and summarize linked project work');
  const result = await retrieval.retrieve('workspace-a', plan.semanticQuery, [], 20, { plan });
  assert.equal(result.primaryItems?.[0]?.resourceId, 'event-1');
  assert.equal(result.primaryItems?.some((entry) => entry.resourceId === 'note-1'), true);
  assert.deepEqual(new Set(result.relatedItems?.map((entry) => entry.resourceId)), new Set(['project-1', 'task-1']));
  assert.ok(Object.keys(result.graphExpansion?.depthCounts ?? {}).length > 0);
  assert.ok((result.graphExpansion?.paths.length ?? 0) >= 2);
});
