import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIntelligenceContext } from './projectIntelligenceContext.ts';
import { buildProjectLensActionPrompt, buildProjectLensPrompt, buildProjectLensRequest, type ProjectLensAction } from './projectLens.ts';

const baseProject = (overrides: Record<string, unknown> = {}) => ({ id: 'project-a', workspace_id: 'workspace-a', name: 'Exhibition', description: 'Prepare the summer exhibition.', status: 'in_progress', completeness: 35, start_date: '2026-08-01', end_date: '2026-09-15', updated_at: '2026-08-22T12:00:00Z', ...overrides });
const fixtureContext = (kind: string) => {
  const common = { workspaceId: 'workspace-a', project: baseProject(), today: '2026-08-22' };
  if (kind === 'healthy') return buildProjectIntelligenceContext({ ...common, tasks: [{ id: 'task-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Confirm venue', status: 'todo', due_date: '2026-08-28' }] });
  if (kind === 'overdue') return buildProjectIntelligenceContext({ ...common, tasks: [{ id: 'task-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Confirm venue', status: 'todo', due_date: '2026-08-01' }] });
  if (kind === 'no_next_action') return buildProjectIntelligenceContext({ ...common, tasks: [] });
  if (kind === 'blocked') return buildProjectIntelligenceContext({ ...common, project: baseProject({ status: 'blocked' }), tasks: [{ id: 'task-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Resolve dependency', status: 'blocked' }] });
  if (kind === 'stale') return buildProjectIntelligenceContext({ ...common, project: baseProject({ updated_at: '2026-07-01T12:00:00Z' }), activity: [{ id: 'activity-a', workspace_id: 'workspace-a', project_id: 'project-a', at: '2026-07-01T12:00:00Z' }] });
  if (kind === 'sparse') return buildProjectIntelligenceContext({ ...common, project: baseProject({ status: 'not_started', completeness: 0, start_date: null, end_date: null }), tasks: [], milestones: [] });
  if (kind === 'milestone') return buildProjectIntelligenceContext({ ...common, milestones: [{ id: 'milestone-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Install', milestone_date: '2026-08-25', completed: false }] });
  if (kind === 'completed') return buildProjectIntelligenceContext({ ...common, project: baseProject({ status: 'completed', completeness: 100 }), tasks: [{ id: 'task-a', workspace_id: 'workspace-a', project_id: 'project-a', title: 'Done', status: 'completed', due_date: '2026-08-01' }] });
  if (kind === 'lots_context') return buildProjectIntelligenceContext({ ...common, linkedNotes: Array.from({ length: 12 }, (_, index) => ({ workspaceId: 'workspace-a', resourceType: 'note' as const, resourceId: `note-${index}`, title: `Meeting ${index}`, content: 'Artwork selection and gallery setup.', projectId: 'project-a' })) });
  if (kind === 'misleading_semantic') return buildProjectIntelligenceContext({ ...common, semanticContext: [{ workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-related', title: 'Maybe related', content: 'A different exhibition.', metadata: { context_scope: 'workspace_related_context' } }] });
  if (kind === 'unlinked_related') return buildProjectIntelligenceContext({ ...common, semanticContext: [{ workspaceId: 'workspace-a', resourceType: 'note', resourceId: 'note-related', title: 'Planning meeting', content: 'Gallery setup and artwork selection.', metadata: { context_scope: 'workspace_related_context' } }] });
  if (kind === 'cross_workspace') return buildProjectIntelligenceContext({ ...common, semanticContext: [{ workspaceId: 'workspace-b', resourceType: 'note', resourceId: 'note-leak', title: 'Other workspace', content: 'Private context.', metadata: { context_scope: 'workspace_related_context' } }] });
  throw new Error(`Unknown fixture ${kind}`);
};

const fixtures: Array<{ name: string; expected: string[] }> = [
  { name: 'healthy', expected: [] }, { name: 'overdue', expected: ['overdue_action'] }, { name: 'no_next_action', expected: ['missing_next_action'] },
  { name: 'blocked', expected: ['blocked'] }, { name: 'stale', expected: ['stale_activity'] }, { name: 'sparse', expected: ['missing_next_action'] },
  { name: 'milestone', expected: ['milestone_approaching'] }, { name: 'completed', expected: [] }, { name: 'lots_context', expected: [] },
  { name: 'misleading_semantic', expected: [] }, { name: 'unlinked_related', expected: [] }, { name: 'cross_workspace', expected: [] },
];

test('Projects AI evaluation fixtures cover the representative Phase 5 cases', () => {
  assert.equal(fixtures.length, 12);
  for (const fixture of fixtures) {
    const context = fixtureContext(fixture.name);
    const kinds = context.signals.map((signal) => signal.kind);
    for (const expected of fixture.expected) assert.ok(kinds.includes(expected as never), `${fixture.name} should include ${expected}`);
    if (fixture.name === 'cross_workspace') assert.equal(context.semanticContext.length, 0);
    if (fixture.name === 'completed') assert.equal(kinds.includes('overdue_action'), false);
  }
});

test('evaluation prompts preserve exact state and action-specific quality targets', () => {
  const overdue = fixtureContext('overdue');
  const request = buildProjectLensRequest(overdue);
  const basePrompt = buildProjectLensPrompt(request);
  assert.match(basePrompt, /Exact structured Ledger facts are authoritative/);
  assert.match(basePrompt, /overdue/i);
  const actions: ProjectLensAction[] = ['catch_up', 'find_blockers', 'next_steps', 'prepare_actions', 'find_context'];
  for (const action of actions) assert.match(buildProjectLensActionPrompt(action, request), new RegExp(`Action: ${action}`));
});
