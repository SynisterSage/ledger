import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmbeddingIndexService,
  LedgerRetrievalService,
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
