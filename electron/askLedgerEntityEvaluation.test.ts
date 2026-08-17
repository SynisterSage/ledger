import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbeddingIndexService, LedgerRetrievalService } from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a',
  resourceType: 'note',
  resourceId: 'note-default',
  title: 'Workspace note',
  content: 'General workspace context.',
  ...overrides,
});

const buildRetrieval = async (items: AskLedgerContextItem[]) => {
  const index = new EmbeddingIndexService();
  await index.replaceWorkspace('workspace-a', items);
  return new LedgerRetrievalService(index);
};

test('project status keeps project work together and excludes unrelated events', async () => {
  const retrieval = await buildRetrieval([
    item({ resourceType: 'project', resourceId: 'local-ai', title: 'Local AI', content: 'Status: Planning. Progress: 25%.' }),
    item({ resourceType: 'task', resourceId: 'compare-models', title: 'Compare local AI models', content: 'Evaluate Qwen3.', projectId: 'local-ai', projectName: 'Local AI', status: 'Not Started' }),
    item({ resourceType: 'event', resourceId: 'calendar', title: 'Calendar review', content: 'Review the calendar.', projectId: 'calendar-project' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what is the status of Local AI', [], 8);
  assert.equal(result.items.some((entry) => entry.resourceId === 'local-ai'), true);
  assert.equal(result.items.some((entry) => entry.resourceId === 'calendar'), false);
});

test('milestone queries return milestones rather than notes', async () => {
  const retrieval = await buildRetrieval([
    item({ resourceType: 'milestone', resourceId: 'milestone-1', title: 'Local AI evaluation complete', content: 'Due 2026-08-20.', dueAt: '2026-08-20' }),
    item({ resourceType: 'note', resourceId: 'note-1', title: 'Milestone discussion', content: 'We discussed milestones.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what milestones do I have', [], 8);
  assert.deepEqual(result.items.map((entry) => entry.resourceType), ['milestone']);
});

test('blocker queries retain supporting project notes', async () => {
  const retrieval = await buildRetrieval([
    item({ resourceType: 'project', resourceId: 'local-ai', title: 'Local AI', content: 'Planning.' }),
    item({ resourceType: 'task', resourceId: 'task-1', title: 'Choose generation model', content: 'Blocked by evaluation.', projectId: 'local-ai' }),
    item({ resourceType: 'note', resourceId: 'note-1', title: 'Local AI decision', content: 'The model decision is still pending.', projectId: 'local-ai' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what is blocking Local AI', [], 8);
  assert.equal(result.items.some((entry) => entry.resourceType === 'project'), true);
  assert.equal(result.items.some((entry) => entry.resourceType === 'task'), true);
  assert.equal(result.items.some((entry) => entry.resourceType === 'note'), true);
});

test('workspace isolation applies to entity retrieval', async () => {
  const retrieval = await buildRetrieval([
    item({ resourceType: 'project', resourceId: 'private-project', title: 'Private project', content: 'Do not expose this.' , workspaceId: 'workspace-b' }),
    item({ resourceType: 'project', resourceId: 'workspace-project', title: 'Workspace project', content: 'Visible project.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what projects do I have', [], 8);
  assert.equal(result.items.some((entry) => entry.resourceId === 'private-project'), false);
  assert.equal(result.items.some((entry) => entry.resourceId === 'workspace-project'), true);
});
