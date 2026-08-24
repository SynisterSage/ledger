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

test('answers conversational and capability requests without workspace retrieval', async () => {
  const events: LocalAIStreamEvent[] = [];
  let retrieveCalls = 0;
  let generationPrompt = '';
  const retrieval = {
    indexWorkspace: async () => { throw new Error('workspace indexing should not run'); },
    retrieve: async () => { retrieveCalls += 1; return { items: [], debug: [] }; },
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      generationPrompt = request.context;
      callbacks.onEvent({ type: 'activity', requestId, activity: { type: 'generating' } });
      callbacks.onEvent({ type: 'delta', requestId, text: 'Of course.' });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'Can you read PDFs?', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(retrieveCalls, 0);
  assert.match(generationPrompt, /Trusted application capabilities/);
  assert.deepEqual(events.find((event) => event.type === 'sources')?.sources, []);
  assert.equal(events.some((event) => event.type === 'activity' && event.activity?.type === 'searching'), false);
  assert.equal(events.some((event) => event.type === 'activity' && event.activity?.type === 'generating'), true);
});

test('answers product-help requests from canonical knowledge without indexing or retrieval', async () => {
  const events: LocalAIStreamEvent[] = [];
  let indexCalls = 0;
  let retrieveCalls = 0;
  let generationPrompt = '';
  const retrieval = {
    indexWorkspace: async () => { indexCalls += 1; throw new Error('product help should not index workspace'); },
    retrieve: async () => { retrieveCalls += 1; throw new Error('product help should not retrieve workspace'); },
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      generationPrompt = request.context;
      callbacks.onEvent({ type: 'delta', requestId, text: 'Slash commands insert supported note blocks.' });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  service.start({ workspaceId: 'workspace-a', question: 'How do slash commands work?', documents: [resource], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(indexCalls, 0);
  assert.equal(retrieveCalls, 0);
  assert.equal(generationPrompt, '');
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /# Notes in Ledger/);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /## Slash commands/);
  assert.deepEqual(events.find((event) => event.type === 'sources')?.sources, []);
});

test('answers Ledger product identity questions from canonical application facts', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationStarted = false;
  const retrieval = {
    indexWorkspace: async () => { throw new Error('workspace indexing should not run'); },
    retrieve: async () => { throw new Error('retrieval should not run'); },
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: () => { generationStarted = true; return 'unexpected-generation'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  service.start({ workspaceId: 'workspace-a', question: 'what does ledger do', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);
  assert.equal(generationStarted, false);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /desktop accountability workspace/);
});

test('answers combined Ledger product questions without invoking the model', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationStarted = false;
  const retrieval = { indexWorkspace: async () => { throw new Error('workspace indexing should not run'); }, retrieve: async () => { throw new Error('retrieval should not run'); }, shutdown: async () => undefined } as unknown as LedgerRetrievalService;
  const localAI = { start: () => { generationStarted = true; return 'unexpected-generation'; }, cancel: () => ({ ok: true }), shutdown: async () => undefined } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  service.start({ workspaceId: 'workspace-a', question: 'what is ledger what does it do', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);
  assert.equal(generationStarted, false);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /desktop accountability workspace/);
});

test('answers Ledger creator questions from canonical application facts', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationStarted = false;
  const retrieval = { indexWorkspace: async () => { throw new Error('workspace indexing should not run'); }, retrieve: async () => { throw new Error('retrieval should not run'); }, shutdown: async () => undefined } as unknown as LedgerRetrievalService;
  const localAI = { start: () => { generationStarted = true; return 'unexpected-generation'; }, cancel: () => ({ ok: true }), shutdown: async () => undefined } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  service.start({ workspaceId: 'workspace-a', question: 'who is it made by', documents: [], lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);
  assert.equal(generationStarted, false);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /Lex Ferguson/);
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /aferguson\.art/);
});

test('does not retrieve for conversational inertia when the prior turn has no sources', async () => {
  const events: LocalAIStreamEvent[] = [];
  let retrieveCalls = 0;
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => { retrieveCalls += 1; return { items: [], debug: [] }; },
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (_request: unknown, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      callbacks.onEvent({ type: 'delta', requestId, text: 'Not much — how about you?' });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  service.start({
    workspaceId: 'workspace-a',
    question: 'whats up',
    documents: [],
    lexicalResults: [],
    conversation: { id: 'conversation-greeting', previousQuestion: 'What is the status?', previousAnswer: 'No workspace facts were available.', previousSources: [] },
  }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);
  assert.equal(retrieveCalls, 0);
  assert.equal(events.some((event) => event.type === 'activity' && event.activity?.type === 'searching'), false);
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

test('passes the Notes Home workspace corpus directly into structured retrieval', async () => {
  const events: LocalAIStreamEvent[] = [];
  const note: AskLedgerContextItem = { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-brief', title: 'Workday notes', content: 'Prepare the client follow-up.' };
  const meeting: AskLedgerContextItem = { workspaceId: 'workspace-a', resourceType: 'event', resourceId: 'event-brief', title: 'Client follow-up', content: 'Discuss next steps.' };
  let retrievalDocuments: AskLedgerContextItem[] | undefined;
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async (_workspaceId: string, _question: string, _lexicalResults: unknown[], _limit: number, options?: { documents?: AskLedgerContextItem[] }) => {
      retrievalDocuments = options?.documents;
      return { items: [note, meeting], debug: [] };
    },
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (_request: unknown, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({
    workspaceId: 'workspace-a',
    question: 'Make me a meeting brief for my next workday using my notes.',
    documents: [note, meeting],
    lexicalResults: [],
    explicitContext: { resourceType: 'note', resourceId: 'notes-home:workspace-a', title: 'Notes workspace', contextType: 'notes_home', workspaceId: 'workspace-a' },
  }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.deepEqual(retrievalDocuments?.map((item) => item.resourceId), ['note-brief', 'event-brief']);
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
  const overdueDate = new Date();
  overdueDate.setHours(12, 0, 0, 0);
  overdueDate.setDate(overdueDate.getDate() - 3);
  const overdueDateValue = overdueDate.toISOString().slice(0, 10);
  const expectedDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(overdueDate);
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({
      items: [
        { ...resource, resourceType: 'task', resourceId: 'task-1', title: 'Finish thumbnails', status: 'In Progress', dueAt: overdueDateValue },
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
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', new RegExp(expectedDate));
  assert.match(events.find((event) => event.type === 'delta')?.text ?? '', /3 days overdue/);
});

test('generates from planned meeting notes instead of formatting the event intent', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationPrompt = '';
  const notes: AskLedgerContextItem[] = [
    { ...resource, resourceType: 'note', resourceId: 'note-workday-1', title: 'Jul 9, Workday Meeting', content: 'Folder: Workday Meetings. Discussed the launch sequence.', updatedAt: '2026-07-09T12:00:00Z' },
    { ...resource, resourceType: 'note', resourceId: 'note-workday-2', title: 'Jul 8, Workday Meeting', content: 'Folder: Workday Meetings. Reviewed open follow-ups.', updatedAt: '2026-07-08T12:00:00Z' },
    { ...resource, resourceType: 'note', resourceId: 'note-workday-3', title: 'Jul 7, Workday Meeting', content: 'Folder: Workday Meetings. Agreed on next steps.', updatedAt: '2026-07-07T12:00:00Z' },
  ];
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: notes, primaryItems: notes, relatedItems: [], relatedCandidateCount: 0, debug: notes.map((item) => ({ resourceType: 'note', resourceId: item.resourceId, title: item.title, score: 1, why: ['planned-primary-scope'] })) }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      generationPrompt = request.context;
      callbacks.onEvent({ type: 'delta', requestId, text: 'Summary of the Workday notes.' });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({ workspaceId: 'workspace-a', question: 'Can you look through my Workday meeting notes folder, last 3 notes or so, and summarize them?', documents: notes, lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.match(generationPrompt, /PRIMARY CONTEXT/);
  assert.match(generationPrompt, /launch sequence/);
  assert.equal(events.find((event) => event.type === 'delta')?.text, 'Summary of the Workday notes.');
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
  const answer = events.reduce((current, streamEvent) => streamEvent.type === 'replace' ? streamEvent.text ?? '' : streamEvent.type === 'delta' ? `${current}${streamEvent.text ?? ''}` : current, '');
  assert.match(answer, /Recommended next step/);
  assert.doesNotMatch(answer, /I don't have enough Ledger context/);
  assert.equal(events.find((streamEvent) => streamEvent.type === 'sources')?.sources?.some((source) => source.resourceId === duplicateEvent.resourceId), false);
  assert.equal(events.find((streamEvent) => streamEvent.type === 'error'), undefined);
});

test('reuses the active conversation context for continuation requests', async () => {
  const events: LocalAIStreamEvent[] = [];
  let generationPrompt = '';
  const priorNote: AskLedgerContextItem = { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-prior', title: 'Launch review notes', content: 'The launch review is waiting on final approval.' };
  const repeatedEvent: AskLedgerContextItem = { workspaceId: 'workspace-a', resourceType: 'event', resourceId: 'event-repeat', title: 'Alfa - Hybrid Work', content: 'Calendar event.' };
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [repeatedEvent], debug: [{ resourceType: 'event', resourceId: repeatedEvent.resourceId, title: repeatedEvent.title, score: 0.8, why: ['semantic:0.8'] }] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }) => { generationPrompt = request.context; callbacks.onEvent({ type: 'done', requestId: 'request-continue', metrics: { totalMs: 1 } }); return 'request-continue'; },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);

  service.start({
    workspaceId: 'workspace-a', question: 'do another sweep', documents: [priorNote, repeatedEvent], lexicalResults: [],
    conversation: { previousQuestion: 'Review the launch context', previousAnswer: 'The review is waiting on final approval.', previousSources: [{ resourceType: 'note', resourceId: priorNote.resourceId, title: priorNote.title }], recentExchanges: [] },
  }, { onEvent: (streamEvent) => events.push(streamEvent) });
  await waitForEvents(events);

  assert.match(generationPrompt, /Launch review notes/);
  assert.match(generationPrompt, /waiting on final approval/);
  assert.equal(events.find((streamEvent) => streamEvent.type === 'sources')?.sources?.some((source) => source.resourceId === priorNote.resourceId), true);
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

  const answer = events.reduce((current, event) => event.type === 'replace' ? event.text ?? '' : event.type === 'delta' ? `${current}${event.text ?? ''}` : current, '');
  assert.match(answer, /Focus this week/);
  assert.match(answer, /Upload weekly logs/);
  assert.doesNotMatch(answer, /I don't have enough Ledger context/);
});

test('performs one targeted answer repair without repeating retrieval', async () => {
  const events: LocalAIStreamEvent[] = [];
  let starts = 0;
  let retrievalCalls = 0;
  const project: AskLedgerContextItem = { ...resource, resourceId: 'project-alfa', title: 'Alfa 2026 Catalog', content: 'Catalog closeout.', status: 'In Progress' };
  const milestone: AskLedgerContextItem = { ...resource, resourceType: 'milestone', resourceId: 'milestone-final', title: 'Final Production', content: 'Final production milestone.', projectId: project.resourceId, status: 'In Progress' };
  const task: AskLedgerContextItem = { ...resource, resourceType: 'task', resourceId: 'task-proof', title: 'Review Final Proof', content: 'Review the final proof.', projectId: project.resourceId, status: 'In Progress', dueAt: '2026-08-20' };
  const documents = [project, milestone, task];
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => { retrievalCalls += 1; return { items: documents, primaryItems: documents, relatedItems: [], relatedCandidateCount: 0, debug: documents.map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, score: 1, why: ['structured-match'] })) }; },
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (_request: { context: string }, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      starts += 1;
      callbacks.onEvent({ type: 'delta', requestId, text: starts === 1 ? 'Alfa is due Aug 22.' : 'Alfa includes the Final Production milestone and Review Final Proof task, due Aug 20.' });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  service.start({ workspaceId: 'workspace-a', question: 'Look through my projects, milestones, and tasks and tell me where everything stands.', documents, lexicalResults: [] }, { onEvent: (event) => events.push(event) });
  await waitForEvents(events);

  assert.equal(starts, 2);
  assert.equal(events.filter((event) => event.type === 'done').length, 1);
  const answer = events.reduce((current, event) => event.type === 'replace' ? event.text ?? '' : event.type === 'delta' ? `${current}${event.text ?? ''}` : current, '');
  assert.match(answer, /Final Production/);
  assert.doesNotMatch(answer, /Aug 22/);
  assert.ok(retrievalCalls > 0);
});

test('supersedes an older in-flight conversation request before starting the newer one', async () => {
  const cancelled: string[] = [];
  const retrieval = {
    indexWorkspace: async () => undefined,
    retrieve: async () => ({ items: [resource], debug: [] }),
    shutdown: async () => undefined,
  } as unknown as LedgerRetrievalService;
  const localAI = {
    start: (_request: unknown, _callbacks: unknown, requestId: string) => requestId,
    cancel: (requestId: string) => { cancelled.push(requestId); return { ok: true }; },
    shutdown: async () => undefined,
  } as unknown as LocalAIService;
  const service = new AskLedgerService(retrieval, localAI);
  const conversation = { id: 'conversation-1', previousQuestion: 'Why is this blocked?', previousAnswer: 'Approval is pending.', previousSources: [] };
  service.start({ requestId: 'request-a', workspaceId: 'workspace-a', question: 'Explain that more simply.', documents: [resource], lexicalResults: [], conversation }, { onEvent: () => undefined });
  service.start({ requestId: 'request-b', workspaceId: 'workspace-a', question: 'Why is this blocked?', documents: [resource], lexicalResults: [], conversation }, { onEvent: () => undefined });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(cancelled, ['request-a']);
});
