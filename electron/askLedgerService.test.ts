import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_LEDGER_ABSTENTION } from './askLedgerPrompt.ts';
import { AskLedgerService } from './askLedgerService.ts';
import type { LocalAIStreamEvent, LocalAIService } from './localAIService.ts';
import type { LedgerRetrievalService } from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

const resource: AskLedgerContextItem = {
  workspaceId: 'workspace-a',
  resourceType: 'project',
  resourceId: 'project-local-ai',
  title: 'Local AI',
  content: 'Planning at 15% progress.',
  status: 'Planning',
  route: { kind: 'workspace-resource', resourceType: 'project', resourceId: 'project-local-ai' },
};

const waitForEvents = async (events: LocalAIStreamEvent[]) => {
  for (let attempt = 0; attempt < 20 && !events.some((event) => event.type === 'done' || event.type === 'error'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

test('selects only budgeted sources and sends grounded context to generation', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationPrompt = '';
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [resource], debug: [{ resourceType: 'project', resourceId: resource.resourceId, title: resource.title, score: 0.8, why: ['lexical:title'] }] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }) => { generationPrompt = request.context; callbacks.onEvent({ type: 'done', requestId: 'request-1', metrics: { totalMs: 1 } }); return 'request-1'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'What is the status?', documents: [resource], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(events.find((event) => event.type === 'sources')?.sources?.[0]?.resourceId, 'project-local-ai');
  assert.match(generationPrompt, /Planning at 15% progress/);
});

test('abstains before generation when retrieval evidence is insufficient', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationCalled = false;
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [], debug: [] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: () => { generationCalled = true; return 'request-1'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'When does this launch?', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(generationCalled, false);
  assert.equal(events.find((event) => event.type === 'delta')?.text, ASK_LEDGER_ABSTENTION);
});
