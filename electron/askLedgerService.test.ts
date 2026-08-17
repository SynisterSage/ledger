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

test('expands project reviews with linked work records', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationPrompt = '';
  const reviewProject: AskLedgerContextItem = { ...resource, resourceId: 'project-1', title: 'Alfa 2026 Catalog', projectId: 'project-1', projectName: 'Alfa 2026 Catalog' };
  const linkedTask: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'task', resourceId: 'task-1', title: 'Finish catalog proofs', content: 'Waiting on final proof approval.', projectId: 'project-1', projectName: 'Alfa 2026 Catalog', status: 'Blocked',
  };
  const linkedNote: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-1', title: 'Catalog review notes', content: 'Printer feedback is still outstanding.', projectId: 'project-1', projectName: 'Alfa 2026 Catalog',
  };
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [reviewProject], debug: [{ resourceType: 'project', resourceId: reviewProject.resourceId, title: reviewProject.title, score: 0.8, why: ['lexical:title', 'entity-resource'] }] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }) => { generationPrompt = request.context; callbacks.onEvent({ type: 'done', requestId: 'request-review', metrics: { totalMs: 1 } }); return 'request-review'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({
    workspaceId: 'workspace-a',
    question: 'Review my projects. See what is moving, blocked, or needs attention.',
    documents: [reviewProject, linkedTask, linkedNote],
    lexicalResults: [],
  }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.match(generationPrompt, /Finish catalog proofs/);
  assert.match(generationPrompt, /Catalog review notes/);
  assert.match(generationPrompt, /blocked or stalled/);
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

test('formats weekly dated work without asking generation to summarize it', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationCalled = false;
  const task: AskLedgerContextItem = {
    ...resource, resourceType: 'task', resourceId: 'task-week', title: 'Upload weekly logs', status: 'Not started', dueAt: '2026-08-19',
  };
  const meeting: AskLedgerContextItem = {
    ...resource, resourceType: 'event', resourceId: 'event-week', title: 'Packanack Work', timestamp: '2026-08-20T11:00:00.000Z',
  };
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [task, meeting], debug: [
      { resourceType: 'task', resourceId: task.resourceId, title: task.title, score: 0.8, why: ['in-time-window'] },
      { resourceType: 'event', resourceId: meeting.resourceId, title: meeting.title, score: 0.7, why: ['in-time-window'] },
    ] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: () => { generationCalled = true; return 'request-week'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'what do i go this week', documents: [task, meeting], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  const answer = events.find((event) => event.type === 'delta')?.text ?? '';
  assert.equal(generationCalled, false);
  assert.match(answer, /Upload weekly logs/);
  assert.match(answer, /Packanack Work/);
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

test('expands an empty meeting follow-up request beyond duplicate events', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationPrompt = '';
  const event: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'event', resourceId: 'event-1', title: 'Packanack Golf Work', content: 'Meeting notes are linked.', parentResourceId: 'note-1', projectId: 'project-1',
  };
  const note: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-1', title: 'Packanack meeting notes', content: 'Discussed the next work session and an unresolved handoff.',
  };
  const task: AskLedgerContextItem = {
    workspaceId: 'workspace-a', resourceType: 'task', resourceId: 'task-1', title: 'Confirm Packanack handoff', content: 'Follow up on the Packanack meeting.', projectId: 'project-1',
  };
  const duplicateEvent: AskLedgerContextItem = { ...event, resourceId: 'event-2', title: 'Packanack Work', parentResourceId: undefined };
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [event, duplicateEvent], debug: [
      { resourceType: 'event', resourceId: event.resourceId, title: event.title, score: 1.6, why: ['explicit-context'] },
      { resourceType: 'event', resourceId: duplicateEvent.resourceId, title: duplicateEvent.title, score: 0.8, why: ['semantic:0.8'] },
    ] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }) => { generationPrompt = request.context; callbacks.onEvent({ type: 'delta', requestId: 'request-meeting', text: ASK_LEDGER_ABSTENTION }); callbacks.onEvent({ type: 'done', requestId: 'request-meeting', metrics: { totalMs: 1 } }); return 'request-meeting'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({
    workspaceId: 'workspace-a', question: '', documents: [event, note, task, duplicateEvent], lexicalResults: [], skillId: 'meeting_follow_up', explicitContext: { resourceType: 'event', resourceId: event.resourceId, title: event.title },
  }, { onEvent: (streamEvent) => events.push(streamEvent) });
  await waitForEvents(events);

  assert.match(generationPrompt, /Packanack meeting notes/);
  assert.match(generationPrompt, /Confirm Packanack handoff/);
  const answer = events.filter((streamEvent) => streamEvent.type === 'delta').map((streamEvent) => streamEvent.text).join('');
  assert.match(answer, /Next step/);
  assert.doesNotMatch(answer, /I don't have enough Ledger context/);
  assert.equal(events.find((streamEvent) => streamEvent.type === 'sources')?.sources?.some((source) => source.resourceId === duplicateEvent.resourceId), false);
  assert.equal(events.find((streamEvent) => streamEvent.type === 'error'), undefined);
});

test('falls back to a grounded weekly plan when the local model abstains', async () => {
  const events: LocalAIStreamEvent[] = [];
  const task: AskLedgerContextItem = { ...resource, resourceType: 'task', resourceId: 'task-plan', title: 'Upload weekly logs', status: 'Not started', dueAt: '2026-08-19' };
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [task], debug: [{ resourceType: 'task', resourceId: task.resourceId, title: task.title, score: 0.8, why: ['semantic:0.8'] }] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (_request: unknown, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      callbacks.onEvent({ type: 'delta', requestId, text: ASK_LEDGER_ABSTENTION });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'help me out', documents: [task], lexicalResults: [], skillId: 'plan_my_week' }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  const answer = events.filter((event) => event.type === 'delta').map((event) => event.text).join('');
  assert.match(answer, /Focus this week/);
  assert.match(answer, /Upload weekly logs/);
  assert.doesNotMatch(answer, /I don't have enough Ledger context/);
});
