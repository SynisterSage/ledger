import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmbeddingIndexService,
  LedgerRetrievalService,
  formatEmbeddingInput,
  type EmbeddingProvider,
} from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-local-model';
  readonly version = 'test-1';
  calls = 0;

  async embed(texts: string[]) {
    this.calls += 1;
    return texts.map((text) => {
      const value = text.toLowerCase();
      return [value.includes('apple') || value.includes('calendar') ? 1 : 0, value.includes('qwen') || value.includes('local ai') ? 1 : 0];
    });
  }
}

const resource = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a',
  resourceType: 'note',
  resourceId: 'note-1',
  title: 'Note',
  content: 'General context.',
  ...overrides,
});

test('formats Nomic query and document inputs consistently', () => {
  assert.equal(formatEmbeddingInput('calendar decisions', 'query', 'nomic-embed-text-v1.5'), 'search_query: calendar decisions');
  assert.equal(formatEmbeddingInput('Calendar\nDecisions', 'document', 'nomic-embed-text-v1.5'), 'search_document: Calendar\nDecisions');
  assert.equal(formatEmbeddingInput('calendar decisions', 'query', 'other-model'), 'calendar decisions');
});

test('combines lexical and local semantic candidates without crossing workspaces', async () => {
  const provider = new FakeEmbeddingProvider();
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceId: 'calendar-note', title: 'Calendar design', content: 'Make the calendar feel more like Apple.' }),
    resource({ resourceId: 'local-ai', title: 'Local AI', content: 'Qwen3 is the current local model.' }),
    resource({ workspaceId: 'workspace-b', resourceId: 'private-calendar', title: 'Private calendar', content: 'Apple calendar notes from another workspace.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'How should the calendar behave?', [
    { type: 'note', id: 'local-ai', title: 'Local AI', match_source: 'title' },
  ]);

  assert.equal(result.items.some((item) => item.resourceId === 'private-calendar'), false);
  assert.equal(result.items[0]?.resourceId, 'calendar-note');
  assert.ok(result.debug[0]?.why.some((reason) => reason.startsWith('semantic:')));
});

test('does not re-embed unchanged chunks and chunks large resources', async () => {
  const provider = new FakeEmbeddingProvider();
  const index = new EmbeddingIndexService(provider);
  const large = resource({ resourceId: 'long-note', content: Array.from({ length: 40 }, (_, index) => `Section ${index}. Calendar planning and follow-up.`).join(' ') });

  const first = await index.replaceWorkspace('workspace-a', [large]);
  const callsAfterFirstIndex = provider.calls;
  const second = await index.replaceWorkspace('workspace-a', [large]);

  assert.ok(first.indexed > 1);
  assert.equal(second.embedded, 0);
  assert.equal(provider.calls, callsAfterFirstIndex);
});

test('lexical retrieval can return exact evidence when embeddings are unavailable', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [resource({ resourceId: 'project-local-ai', resourceType: 'project', title: 'Local AI', content: 'Planning at 15% progress.' })]);

  const result = await retrieval.retrieve('workspace-a', 'What is the status of Local AI?', [
    { type: 'project', id: 'project-local-ai', title: 'Local AI', match_source: 'title' },
  ]);

  assert.equal(result.items[0]?.resourceId, 'project-local-ai');
});

test('deadline intent prioritizes dated work and deduplicates chunks by resource', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceId: 'old-note', title: 'Old meeting', content: 'A discussion about deadlines from May.' }),
    resource({ resourceType: 'task', resourceId: 'due-task', title: 'Submit final checks', content: 'Prepare the final submission.', dueAt: '2026-08-18', status: 'Not started' }),
    resource({ resourceType: 'task', resourceId: 'due-task', title: 'Submit final checks', content: 'Prepare the final submission. More details. Another section.', dueAt: '2026-08-18', status: 'Not started' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'when are my project deadlines', [], 20);
  assert.equal(result.items.filter((item) => item.resourceId === 'due-task').length, 1);
  assert.equal(result.items[0]?.resourceId, 'due-task');
  assert.ok(result.debug[0]?.why.includes('due-date'));
});

test('team-member intent prioritizes authoritative team and person resources', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'task', resourceId: 'task', title: 'Team overview message', content: 'Send the team overview.' }),
    resource({ resourceType: 'team', resourceId: 'team', title: 'Design team', content: 'Members: Alex (lead), Sam (member).' }),
    resource({ resourceType: 'person', resourceId: 'alex', title: 'Alex', content: 'Name: Alex. Team: Design team. Role: lead.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'who are my team members', [], 3);
  assert.equal(result.items[0]?.resourceType, 'team');
  assert.equal(result.items[1]?.resourceType, 'person');
  assert.ok(result.debug[0]?.why.includes('team-members-resource'));
});

test('entity policies exclude notes from direct project lookups', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'note', resourceId: 'project-note', title: 'Projects discussion', content: 'We discussed several projects.' }),
    resource({ resourceType: 'project', resourceId: 'project-1', title: 'Local AI', content: 'Status: Planning' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what projects do I have', [], 8);
  assert.deepEqual(result.items.map((item) => item.resourceType), ['project']);
});

test('blocker intent retains project evidence and supporting notes', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'project-1', title: 'Local AI', content: 'Planning.' }),
    resource({ resourceType: 'task', resourceId: 'task-1', title: 'Evaluate runtime', content: 'Blocked by model selection.' }),
    resource({ resourceType: 'note', resourceId: 'note-1', title: 'Local AI decision', content: 'The model decision is still pending.' }),
    resource({ resourceType: 'event', resourceId: 'event-1', title: 'Unrelated meeting', content: 'Calendar details.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what is blocking Local AI', [], 8);
  assert.equal(result.items.some((item) => item.resourceType === 'project'), true);
  assert.equal(result.items.some((item) => item.resourceType === 'task'), true);
  assert.equal(result.items.some((item) => item.resourceType === 'note'), true);
  assert.equal(result.items.some((item) => item.resourceType === 'event'), false);
});

test('explicit contextual resource outranks unrelated matches', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'context-project', title: 'Mobile calendar', content: 'The mobile calendar project is blocked on testing.' }),
    resource({ resourceType: 'note', resourceId: 'unrelated', title: 'Calendar notes', content: 'General calendar ideas.' }),
  ]);
  const result = await retrieval.retrieve('workspace-a', 'What should I do next?', [], 8, { boostResourceKeys: ['project:context-project'] });
  assert.equal(result.items[0]?.resourceId, 'context-project');
  assert.ok(result.debug[0]?.why.includes('explicit-context'));
});
