import test from 'node:test';
import assert from 'node:assert/strict';
import type { LocalAIRequest, LocalAIStreamEvent } from './localAIService.ts';
import { buildOverviewFocusFallbackResult, buildOverviewFocusPrompt, deriveOverviewFocusSignals, OverviewFocusService, validateOverviewFocusResult, type OverviewFocusSnapshot } from './overviewFocus.ts';
import { buildOverviewFocusFingerprint, buildOverviewFocusSnapshot, getOverviewFocusPrimaryResource } from '../src/types/overviewFocus.ts';

const snapshot: OverviewFocusSnapshot = {
  generatedAt: '2026-08-18T12:00:00.000Z',
  workspaceId: 'workspace-a',
  tasks: [
    { id: 'task-overdue', title: 'Finish Journals', status: 'open', dueAt: '2026-08-17T12:00:00.000Z', projectId: 'project-alfa', projectTitle: 'Alfa 2026 Catalog', section: 'today' },
    { id: 'task-tomorrow', title: 'Write exit essay', status: 'open', dueAt: '2026-08-19T12:00:00.000Z', projectId: 'project-alfa', section: 'today' },
    { id: 'task-done', title: 'Already done', status: 'completed', dueAt: '2026-08-10T12:00:00.000Z', section: 'today' },
  ],
  projects: [{ id: 'project-alfa', title: 'Alfa 2026 Catalog', status: 'in_progress', dueAt: '2026-08-17T12:00:00.000Z', progress: 29 }],
  events: [{ id: 'event-review', title: 'Catalog review', startsAt: '2026-08-19T15:00:00.000Z' }],
  recentNotes: [{ id: 'note-1', title: 'Catalog notes', updatedAt: '2026-08-18T10:00:00.000Z' }],
};

test('normalizes Overview data without changing domain records', () => {
  const result = buildOverviewFocusSnapshot('workspace-a', {
    now: new Date('2026-08-18T12:00:00.000Z'),
    todayTasks: [{ id: 'task-1', title: 'Today task', status: 'todo', due_date: '2026-08-19', project_id: 'project-1', project_name: 'Project 1' }],
    workspaceTasks: [{ id: 'task-2', title: 'Long task', status: 'todo', task_horizon: 'long_term' }, { id: 'ignored', title: 'Today duplicate', task_horizon: 'today' }],
    projects: [{ id: 'project-1', name: 'Project 1', status: 'in_progress', completeness: 12, end_date: '2026-08-20' }],
    events: [{ id: 'event-1', title: 'Meeting', start_at: '2026-08-19T10:00:00.000Z', end_at: '2026-08-19T11:00:00.000Z' }],
    reminders: [{ id: 'reminder-1', title: 'Reminder', remind_at: '2026-08-20T09:00:00.000Z' }],
    notes: [{ id: 'note-1', title: 'Note', updated_at: '2026-08-18T11:00:00.000Z', content: 'not included' }],
  });
  assert.deepEqual(result.tasks.map((task) => task.id), ['task-1', 'task-2']);
  assert.equal(result.tasks[0].dueAt, '2026-08-19');
  assert.equal(result.projects[0].progress, 12);
  assert.equal(result.events.length, 2);
  assert.equal('content' in result.recentNotes[0], false);
});

test('builds a reload-stable Lens fingerprint when resource order changes', () => {
  const first = buildOverviewFocusSnapshot('workspace-a', { todayTasks: [], workspaceTasks: [], projects: [{ id: 'project-a', name: 'A' }, { id: 'project-b', name: 'B' }], events: [], reminders: [], notes: [] });
  const second = { ...first, projects: [...first.projects].reverse() };
  assert.equal(buildOverviewFocusFingerprint(first), buildOverviewFocusFingerprint(second));
});

test('derives overdue, approaching, concentrated, and deadline/progress context', () => {
  const signals = deriveOverviewFocusSignals(snapshot, new Date('2026-08-18T12:00:00.000Z'));
  assert.ok(signals.some((signal) => signal.kind === 'overdue_task'));
  assert.ok(signals.some((signal) => signal.kind === 'approaching_deadline'));
  assert.ok(signals.some((signal) => signal.kind === 'project_concentration'));
  assert.ok(signals.some((signal) => signal.kind === 'project_deadline_progress'));
});

test('prompt bounds the model to snapshot resource IDs and asks for useful interpretation', () => {
  const prompt = buildOverviewFocusPrompt(snapshot, new Date('2026-08-18T12:00:00.000Z'));
  assert.match(prompt, /0-3/);
  assert.match(prompt, /task:task-overdue/);
  assert.match(prompt, /Never use urgent/);
});

test('rejects fabricated refs, duplicates, and results beyond three insights', () => {
  const value = {
    insights: Array.from({ length: 5 }, (_, index) => ({ id: `id-${index}`, title: index === 1 ? 'Same' : `Insight ${index}`, summary: index === 1 ? 'Same summary about an overdue deadline.' : `This project has an approaching deadline and needs attention ${index}.`, importance: 'attention', resourceRefs: [{ type: index === 4 ? 'task' : 'project', id: index === 4 ? 'fake' : 'project-alfa' }] })),
  };
  const result = validateOverviewFocusResult(value, snapshot);
  assert.ok(result.insights.length <= 3);
  assert.equal(result.insights.every((insight) => insight.resourceRefs.every((ref) => ref.id !== 'fake')), true);
});

test('invalid JSON and unavailable AI produce a safe empty result', async () => {
  assert.deepEqual(validateOverviewFocusResult('bad JSON', snapshot), { insights: [] });
  const service = new OverviewFocusService({
    start: (_request: LocalAIRequest, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => { callbacks.onEvent({ type: 'error', requestId, error: { code: 'model_missing', message: 'not installed' } }); return requestId; },
    cancel: () => ({ ok: true }),
  } as never);
  assert.deepEqual(await service.generate(snapshot), { insights: [] });
});

test('skips the model entirely when Overview has no meaningful Focus signal', async () => {
  let startCalls = 0;
  const service = new OverviewFocusService({
    start: () => { startCalls += 1; return 'unexpected'; },
    cancel: () => ({ ok: true }),
  } as never);
  assert.deepEqual(await service.generate({ ...snapshot, tasks: [{ id: 'quiet-task', title: 'Routine task', status: 'open', section: 'today' }], projects: [], events: [], recentNotes: [] }), { insights: [] });
  assert.equal(startCalls, 0);
});

test('builds factual fallback insights when structured model output is rejected', () => {
  const result = buildOverviewFocusFallbackResult(snapshot);
  assert.ok(result.insights.length > 0);
  assert.ok(result.insights.length <= 3);
  assert.equal(result.insights.some((insight) => /immediate|urgent|critical/i.test(`${insight.title} ${insight.summary}`)), false);
});

test('prefers the Fast tier before falling back to Balanced', async () => {
  let selectedTier = '';
  let requestedBudget = 0;
  const service = new OverviewFocusService({
    switchGenerationTier: async (tier: string) => { selectedTier = tier; return { ok: true }; },
    start: (request: LocalAIRequest, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      requestedBudget = request.generationBudget ?? 0;
      callbacks.onEvent({ type: 'delta', requestId, text: JSON.stringify({ insights: [] }) });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
  } as never);
  assert.deepEqual(await service.generate(snapshot), { insights: [] });
  assert.equal(selectedTier, 'fast');
  assert.equal(requestedBudget, 768);
});

test('falls back to Balanced when the Fast model is unavailable', async () => {
  const selectedTiers: string[] = [];
  const service = new OverviewFocusService({
    switchGenerationTier: async (tier: string) => {
      selectedTiers.push(tier);
      return tier === 'fast' ? { ok: false } : { ok: true };
    },
    start: (_request: LocalAIRequest, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      callbacks.onEvent({ type: 'delta', requestId, text: JSON.stringify({ insights: [] }) });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
  } as never);
  await service.generate(snapshot);
  assert.deepEqual(selectedTiers, ['fast', 'balanced']);
});

test('chooses the first still-present resource and leaves stale references non-navigable', () => {
  const project = getOverviewFocusPrimaryResource({ id: 'focus', title: 'Focus', summary: 'Summary', importance: 'normal', resourceRefs: [{ type: 'task', id: 'missing' }, { type: 'project', id: 'project-alfa' }] }, snapshot);
  const stale = getOverviewFocusPrimaryResource({ id: 'focus', title: 'Focus', summary: 'Summary', importance: 'normal', resourceRefs: [{ type: 'note', id: 'missing' }] }, snapshot);
  assert.deepEqual(project, { type: 'project', id: 'project-alfa' });
  assert.equal(stale, null);
});
