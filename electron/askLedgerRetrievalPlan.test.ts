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
