import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIntelligenceContext } from './projectIntelligenceContext.ts';
import {
  buildProjectLensActionPrompt,
  buildProjectLensFallback,
  buildProjectLensPrompt,
  buildProjectLensRequest,
  validateProjectChangeProposals,
  validateProjectLensActionResult,
  validateProjectLensResult,
} from './projectLens.ts';
import { ProjectLensCache } from './projectLensCache.ts';

const context = (overrides: Record<string, unknown> = {}) => buildProjectIntelligenceContext({
  workspaceId: 'workspace-a',
  project: { id: 'project-a', workspace_id: 'workspace-a', name: 'Watercolor Exhibition', description: 'Prepare the summer exhibition.', status: 'in_progress', completeness: 35, end_date: '2026-09-01', updated_at: '2026-08-22T12:00:00Z' },
  today: '2026-08-22',
  tasks: [{ id: 'task-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Confirm venue', status: 'todo', due_date: '2026-08-12' }],
  ...overrides,
});

test('Lens request keeps authoritative structured facts separate from semantic evidence', () => {
  const request = buildProjectLensRequest(context({ semanticContext: [{ workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Related note', content: 'A possible idea', projectId: 'project-a', metadata: { context_scope: 'linked_project_context' } }] }));
  const prompt = buildProjectLensPrompt(request);
  assert.match(prompt, /AUTHORITATIVE STRUCTURED PROJECT FACTS/);
  assert.match(prompt, /LINKED PROJECT CONTEXT/);
  assert.match(prompt, /SEMANTIC EVIDENCE/);
  assert.equal(request.project.progress, 35);
  assert.equal(request.currentWork.overdueTasks[0]?.id, 'task-a');
});

test('rejects unsupported source IDs and structured fact conflicts', () => {
  const current = context();
  const request = buildProjectLensRequest(current);
  const unsupported = validateProjectLensResult({ summary: 'The project is moving.', sources: [{ resourceType: 'task', resourceId: 'not-real' }] }, request, current);
  assert.deepEqual(unsupported.rejectionReasons, ['unsupported_source']);

  const conflict = validateProjectLensResult({ summary: 'The project is 90% complete and has no overdue work.', sources: [{ resourceType: 'project', resourceId: 'project-a' }] }, request, current);
  assert.deepEqual(conflict.rejectionReasons, ['structured_fact_conflict']);
});

test('accepts valid JSON wrapped in local-model preamble or trailing markers', () => {
  const request = buildProjectLensRequest(context());
  const wrapped = 'Here is the project lens:\n{"summary":"The open action needs movement.","nextStep":{"text":"Continue the open action.","sources":[{"resourceType":"task","resourceId":"task-a"}]},"sources":[{"resourceType":"project","resourceId":"project-a"}]}\n<|endoftext|>';
  const validation = validateProjectLensResult(wrapped, request, context());
  assert.equal(validation.result?.summary, 'The open action needs movement.');
  assert.deepEqual(validation.rejectionReasons, []);
});

test('sparse projects get a deterministic, grounded fallback', () => {
  const sparse = context({ project: { id: 'project-a', workspace_id: 'workspace-a', name: 'New project', status: 'not_started', completeness: 0 } , tasks: [], milestones: [] });
  const result = buildProjectLensFallback(sparse);
  assert.match(result.summary, /no active next action or milestone/i);
  assert.match(result.nextStep?.text ?? '', /first action or milestone/i);
  assert.deepEqual(result.sources, [{ resourceType: 'project', resourceId: 'project-a' }]);
});

test('Lens cache reuses matching context and invalidates changed context', () => {
  const cache = new ProjectLensCache();
  const result = { summary: 'Current.', sources: [] };
  cache.set('workspace-a:project-a', 'fingerprint-a', result);
  assert.equal(cache.get('workspace-a:project-a', 'fingerprint-a'), result);
  assert.equal(cache.get('workspace-a:project-a', 'fingerprint-b'), null);
  cache.set('workspace-a:project-a', 'fingerprint-b', { summary: 'Updated.', sources: [] });
  assert.equal(cache.get('workspace-a:project-a', 'fingerprint-a'), null);
  assert.equal(cache.get('workspace-a:project-a', 'fingerprint-b')?.summary, 'Updated.');
});

test('action prompts preserve the project anchor and action-specific grounding rules', () => {
  const prompt = buildProjectLensActionPrompt('find_blockers', buildProjectLensRequest(context()));
  assert.match(prompt, /Action: find_blockers/);
  assert.match(prompt, /confirmed blockers from possible blockers/);
  assert.match(prompt, /Project A|Watercolor Exhibition/);
});

test('blockers retain confirmed versus possible distinctions and next steps stay bounded', () => {
  const current = context({ semanticContext: [
    { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-linked', title: 'Linked', content: 'Linked context', projectId: 'project-a', metadata: { context_scope: 'linked_project_context' } },
    { workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-related', title: 'Related', content: 'Possibly related context', metadata: { context_scope: 'workspace_related_context' } },
  ] });
  const blockers = validateProjectLensActionResult({ action: 'find_blockers', summary: 'Two levels of concern.', blockers: [{ text: 'The task is overdue.', kind: 'confirmed', sources: [{ resourceType: 'task', resourceId: 'task-a' }] }, { text: 'A note may indicate a dependency.', kind: 'possible', sources: [{ resourceType: 'note', resourceId: 'note-related' }] }], sources: [] }, 'find_blockers', current);
  assert.equal(blockers.result?.blockers?.[0]?.kind, 'confirmed');
  assert.equal(blockers.result?.blockers?.[1]?.kind, 'possible');
  const nextSteps = validateProjectLensActionResult({ action: 'next_steps', summary: 'Priorities.', items: [{ text: 'One', sources: [] }, { text: 'Two', sources: [] }, { text: 'Three', sources: [] }, { text: 'Four', sources: [] }], sources: [] }, 'next_steps', current);
  assert.equal(nextSteps.result?.items?.length, 3);
  const contextResult = validateProjectLensActionResult({ action: 'find_context', summary: 'Related context.', relatedResources: [{ resourceType: 'note', resourceId: 'note-linked' }, { resourceType: 'note', resourceId: 'note-related' }], sources: [] }, 'find_context', current);
  assert.deepEqual(contextResult.result?.relatedResources, [{ resourceType: 'note', resourceId: 'note-related' }]);
});

test('prepare actions remain suggestions and reject unsupported source IDs', () => {
  const current = context();
  const result = validateProjectLensActionResult({ action: 'prepare_actions', summary: 'Suggested work.', proposedActions: [{ title: 'Confirm venue', description: 'Follow up with the venue.', reason: 'The open task is overdue.', suggestedDueDate: '2026-08-25', sourceRefs: [{ resourceType: 'task', resourceId: 'task-a' }] }], sources: [] }, 'prepare_actions', current);
  assert.equal(result.result?.proposedActions?.[0]?.title, 'Confirm venue');
  const invalid = validateProjectLensActionResult({ action: 'prepare_actions', summary: 'Bad.', proposedActions: [{ title: 'Nope', reason: 'Unsupported.', sourceRefs: [{ resourceType: 'task', resourceId: 'not-real' }] }], sources: [] }, 'prepare_actions', current);
  assert.deepEqual(invalid.rejectionReasons, ['invalid_output']);
});

test('reviewable change proposals are workspace-scoped and read-only until validated', () => {
  const current = context({ semanticContext: [{ workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-a', title: 'Context', content: 'Context', metadata: { context_scope: 'workspace_related_context' } }] });
  const valid = validateProjectChangeProposals([
    { type: 'create_action', title: 'Confirm venue', dueDate: '2026-08-27', sourceRefs: [{ resourceType: 'task', resourceId: 'task-a' }] },
    { type: 'link_resource', resource: { resourceType: 'note', resourceId: 'note-a' } },
  ], current);
  assert.equal(valid.length, 2);
  const invalid = validateProjectChangeProposals([
    { type: 'create_action', title: '', sourceRefs: [{ resourceType: 'task', resourceId: 'not-real' }] },
    { type: 'link_resource', resource: { resourceType: 'note', resourceId: 'other-workspace-note' } },
  ], current);
  assert.equal(invalid.length, 0);
});
