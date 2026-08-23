import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIntelligenceContext } from '../src/features/projects/projectIntelligenceContext.ts';
import { ProjectLensService } from './projectLensService.ts';

const context = buildProjectIntelligenceContext({
  workspaceId: 'workspace-a',
  project: { id: 'project-a', workspace_id: 'workspace-a', name: 'Project A', status: 'in_progress', completeness: 20 },
  tasks: [{ id: 'task-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Open action', status: 'todo' }],
});

const generated = JSON.stringify({
  summary: 'Project A is moving with one open action.',
  nextStep: { text: 'Continue the open action.', sources: [{ resourceType: 'task', resourceId: 'task-a' }] },
  sources: [{ resourceType: 'project', resourceId: 'project-a' }],
});

const fakeRetrieval = { indexWorkspace: async () => ({ indexed: 0, embedded: 0, removed: 0 }) };

const fakeLocalAI = (available: ('balanced' | 'fast')[], output = generated) => {
  const switches: string[] = [];
  return {
    switches,
    switchGenerationTier: async (tier: 'balanced' | 'fast') => {
      switches.push(tier);
      return available.includes(tier)
        ? { ok: true, state: 'noop', tier, modelId: `${tier}-model` }
        : { ok: false, state: 'requires_download', tier, modelId: `${tier}-model` };
    },
    start: (_request: { question: string }, callbacks: { onEvent: (event: unknown) => void }, requestId: string) => {
      callbacks.onEvent({ type: 'delta', requestId, text: output });
      callbacks.onEvent({ type: 'done', requestId });
      return requestId;
    },
    cancel: () => ({ ok: true }),
  };
};

test('prefers Fast when it is available for Project Lens', async () => {
  const localAI = fakeLocalAI(['balanced', 'fast']);
  const result = await new ProjectLensService(localAI as never, fakeRetrieval as never).generate({ workspaceId: 'workspace-a', context });
  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.tier : null, 'fast');
  assert.deepEqual(localAI.switches, ['fast']);
});

test('falls back to Balanced when Fast is unavailable', async () => {
  const localAI = fakeLocalAI(['balanced']);
  const result = await new ProjectLensService(localAI as never, fakeRetrieval as never).generate({ workspaceId: 'workspace-a', context });
  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.tier : null, 'balanced');
  assert.deepEqual(localAI.switches, ['fast', 'balanced']);
});

test('returns an unavailable state when neither model is installed', async () => {
  const localAI = fakeLocalAI([]);
  const result = await new ProjectLensService(localAI as never, fakeRetrieval as never).generate({ workspaceId: 'workspace-a', context });
  assert.deepEqual(result, { status: 'unavailable', reason: 'model_unavailable' });
  assert.deepEqual(localAI.switches, ['fast', 'balanced']);
});

test('action generation prefers Fast, stays bounded, and does not mutate project data', async () => {
  const actionOutput = JSON.stringify({ action: 'prepare_actions', summary: 'Two suggestions.', proposedActions: [
    { title: 'Confirm venue', reason: 'The open action needs movement.', sourceRefs: [{ resourceType: 'task', resourceId: 'task-a' }] },
    { title: 'Review schedule', reason: 'Keep the target date visible.', sourceRefs: [{ resourceType: 'project', resourceId: 'project-a' }] },
    { title: 'Extra suggestion', reason: 'Should be bounded out.', sourceRefs: [] },
    { title: 'Another suggestion', reason: 'Should be bounded out.', sourceRefs: [] },
  ], sources: [] });
  const localAI = fakeLocalAI(['fast', 'balanced'], actionOutput);
  let indexed = 0;
  const retrieval = { indexWorkspace: async () => { indexed += 1; return { indexed: 0, embedded: 0, removed: 0 }; } };
  const result = await new ProjectLensService(localAI as never, retrieval as never).generateAction({ workspaceId: 'workspace-a', context, action: 'prepare_actions' });
  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.tier : null, 'fast');
  assert.equal(result.status === 'ready' ? result.result.proposedActions?.length : null, 3);
  assert.equal(indexed, 0);
});

test('a mid-request model failure does not mutate context and reports generation failure', async () => {
  const switches: string[] = [];
  const localAI = {
    switchGenerationTier: async (tier: 'balanced' | 'fast') => { switches.push(tier); return { ok: true, state: 'noop', tier, modelId: `${tier}-model` }; },
    start: (_request: unknown, callbacks: { onEvent: (event: unknown) => void }, requestId: string) => { callbacks.onEvent({ type: 'error', requestId, error: { message: 'runtime stopped' } }); return requestId; },
    cancel: () => ({ ok: true }),
  };
  const result = await new ProjectLensService(localAI as never, fakeRetrieval as never).generate({ workspaceId: 'workspace-a', context });
  assert.deepEqual(result, { status: 'unavailable', reason: 'generation_failed' });
  assert.deepEqual(switches, ['fast', 'balanced']);
  assert.equal(context.project.id, 'project-a');
});

test('newer Lens requests supersede older generation instead of falling through to Fast', async () => {
  const active = new Map<string, { onEvent: (event: unknown) => void }>();
  const localAI = {
    switchGenerationTier: async (tier: 'balanced' | 'fast') => ({ ok: true, state: 'noop', tier, modelId: `${tier}-model` }),
    start: (_request: unknown, callbacks: { onEvent: (event: unknown) => void }, requestId: string) => { active.set(requestId, callbacks); setTimeout(() => { const current = active.get(requestId); if (current) { current.onEvent({ type: 'delta', requestId, text: generated }); current.onEvent({ type: 'done', requestId }); active.delete(requestId); } }, 10); return requestId; },
    cancel: (requestId: string) => { const current = active.get(requestId); current?.onEvent({ type: 'error', requestId, error: { message: 'Generation cancelled.' } }); active.delete(requestId); return { ok: true }; },
  };
  const service = new ProjectLensService(localAI as never, fakeRetrieval as never);
  const first = service.generate({ workspaceId: 'workspace-a', context });
  const second = service.generate({ workspaceId: 'workspace-a', context });
  assert.deepEqual(await first, { status: 'unavailable', reason: 'superseded' });
  assert.equal((await second).status, 'ready');
});
