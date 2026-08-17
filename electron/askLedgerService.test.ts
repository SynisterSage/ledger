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

test('formats direct entity lookups without invoking Qwen', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationCalled = false;
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({
      items: [
        { ...resource, resourceType: 'task', resourceId: 'task-1', title: 'Finish thumbnails', status: 'In Progress', dueAt: '2026-08-18' },
      ],
      debug: [{ resourceType: 'task', resourceId: 'task-1', title: 'Finish thumbnails', score: 0.4, why: ['entity-resource'] }],
    }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: () => { generationCalled = true; return 'request-1'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'what are my open tasks', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(generationCalled, false);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /Finish thumbnails/);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /Aug 18, 2026/);
});

test('returns an entity-specific empty state without invoking Qwen', async () => {
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

  service.start({ workspaceId: 'workspace-a', question: 'what reminders do I have', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(generationCalled, false);
  assert.equal(events.find((event) => event.type === 'delta')?.text, "I couldn't find any matching reminders in this workspace.");
});

test('executes a skill with boosted explicit context and skill instructions', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationPrompt = '';
  const transcript: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'transcript', resourceId: 'transcript-1', title: 'Weekly sync', content: 'Decide launch owner and follow up on the draft.',
  };
  const task: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'task', resourceId: 'task-1', title: 'Review draft', content: 'Review the launch draft.', projectId: 'project-1',
  };
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [task], debug: [{ resourceType: 'task', resourceId: task.resourceId, title: task.title, score: 0.7, why: ['lexical:title'] }] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }) => { generationPrompt = request.context; callbacks.onEvent({ type: 'done', requestId: 'request-skill', metrics: { totalMs: 1 } }); return 'request-skill'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({
    workspaceId: 'workspace-a',
    question: 'Prepare follow-up from this meeting',
    documents: [transcript, task],
    lexicalResults: [],
    skillId: 'meeting_follow_up',
    explicitContext: { resourceType: 'transcript', resourceId: 'transcript-1', title: 'Weekly sync' },
  }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.match(generationPrompt, /Meeting follow-up/);
  assert.match(generationPrompt, /Weekly sync/);
  assert.match(generationPrompt, /Decide launch owner/);
  assert.match(generationPrompt, /Review the launch draft/);
});
