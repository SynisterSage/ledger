import test from 'node:test';
import assert from 'node:assert/strict';
import type { LocalAIRequest, LocalAIStreamEvent } from './localAIService.ts';
import { buildOverviewFocusPrompt, deriveOverviewFocusSignals, OverviewFocusService, validateOverviewFocusResult, type OverviewFocusSnapshot } from './overviewFocus.ts';
import { buildOverviewFocusSnapshot, getOverviewFocusPrimaryResource } from '../src/types/overviewFocus.ts';

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

test('derives overdue, approaching, concentrated, and deadline/progress context', () => {
  const signals = deriveOverviewFocusSignals(snapshot, new Date('2026-08-18T12:00:00.000Z'));
  assert.ok(signals.some((signal) => signal.kind === 'overdue_task'));
  assert.ok(signals.some((signal) => signal.kind === 'approaching_deadline'));
  assert.ok(signals.some((signal) => signal.kind === 'project_concentration'));
  assert.ok(signals.some((signal) => signal.kind === 'project_deadline_progress'));
});

test('prompt bounds the model to snapshot resource IDs and asks for useful interpretation', () => {
  const prompt = buildOverviewFocusPrompt(snapshot, new Date('2026-08-18T12:00:00.000Z'));
  assert.match(prompt, /0 to 3 insights maximum/);
  assert.match(prompt, /task:task-overdue/);
  assert.match(prompt, /Do not manufacture urgency/);
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

test('asks the existing model router for the Balanced tier when it is available', async () => {
  let selectedTier = '';
  const service = new OverviewFocusService({
    getModelRouting: () => ({ requestedTier: 'fast', recommendedTier: 'balanced', resolvedTier: 'fast', shouldSwitch: true, reason: 'moderate grounded synthesis' }),
    switchGenerationTier: async (tier: string) => { selectedTier = tier; return { ok: true }; },
    start: (_request: LocalAIRequest, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, requestId: string) => {
      callbacks.onEvent({ type: 'delta', requestId, text: JSON.stringify({ insights: [] }) });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
      return requestId;
    },
    cancel: () => ({ ok: true }),
  } as never);
  assert.deepEqual(await service.generate(snapshot), { insights: [] });
  assert.equal(selectedTier, 'balanced');
});

test('chooses the first still-present resource and leaves stale references non-navigable', () => {
  const project = getOverviewFocusPrimaryResource({ id: 'focus', title: 'Focus', summary: 'Summary', importance: 'normal', resourceRefs: [{ type: 'task', id: 'missing' }, { type: 'project', id: 'project-alfa' }] }, snapshot);
  const stale = getOverviewFocusPrimaryResource({ id: 'focus', title: 'Focus', summary: 'Summary', importance: 'normal', resourceRefs: [{ type: 'note', id: 'missing' }] }, snapshot);
  assert.deepEqual(project, { type: 'project', id: 'project-alfa' });
  assert.equal(stale, null);
});
