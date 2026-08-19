import test from 'node:test';
import assert from 'node:assert/strict';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { EmbeddingIndexService, LedgerRetrievalService } from './ledgerRetrievalService.ts';
import { AskLedgerRetrievalOrchestrator, classifyAskLedgerRetrievalMode, decomposeRetrievalObjectives } from './askLedgerRetrievalOrchestrator.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a', resourceType: 'project', resourceId: 'project-default', title: 'Default', content: '', ...overrides,
});

const buildOrchestrator = async (items: AskLedgerContextItem[], limits?: ConstructorParameters<typeof AskLedgerRetrievalOrchestrator>[1]) => {
  const index = new EmbeddingIndexService();
  await index.replaceWorkspace('workspace-a', items);
  return { orchestrator: new AskLedgerRetrievalOrchestrator(new LedgerRetrievalService(index), limits), index };
};

test('routes compound meeting-to-project questions through dependent objectives', async () => {
  const event = item({ resourceType: 'event', resourceId: 'event-workday', title: 'Workday meeting', content: 'Discussed catalog status.', relationships: [{ relationshipType: 'linked_note', resourceType: 'note', resourceId: 'note-workday' }] });
  const note = item({ resourceType: 'note', resourceId: 'note-workday', title: 'Workday meeting notes', content: 'Alfa 2026 Catalog and Watercolor Exhibition need follow-up.', projectId: 'project-alfa', projectName: 'Alfa 2026 Catalog', relationships: [{ relationshipType: 'linked_project', resourceType: 'project', resourceId: 'project-alfa' }, { relationshipType: 'linked_project', resourceType: 'project', resourceId: 'project-watercolor' }, { relationshipType: 'has_transcript', resourceType: 'transcript', resourceId: 'transcript-workday' }] });
  const transcript = item({ resourceType: 'transcript', resourceId: 'transcript-workday', title: 'Workday transcript', content: 'Final proof is still pending.', parentResourceId: 'note-workday' });
  const project = item({ resourceType: 'project', resourceId: 'project-alfa', title: 'Alfa 2026 Catalog', content: 'Catalog launch project.', relationships: [{ relationshipType: 'has_milestone', resourceType: 'milestone', resourceId: 'milestone-alfa' }] });
  const secondProject = item({ resourceType: 'project', resourceId: 'project-watercolor', title: 'Watercolor Exhibition', content: 'Exhibition project.' });
  const milestone = item({ resourceType: 'milestone', resourceId: 'milestone-alfa', title: 'Final proof', content: 'Approve the proof.', projectId: 'project-alfa', relationships: [{ relationshipType: 'belongs_to_project', resourceType: 'project', resourceId: 'project-alfa' }, { relationshipType: 'has_task', resourceType: 'task', resourceId: 'task-alfa' }] });
  const task = item({ resourceType: 'task', resourceId: 'task-alfa', title: 'Approve final proof', content: 'Complete the catalog proof.', projectId: 'project-alfa', horizon: 'today', taskHorizon: 'today', status: 'In Progress' });
  const unrelated = item({ resourceType: 'project', resourceId: 'project-unrelated', title: 'Watercolor Exhibition', content: 'Unrelated project.' });
  const documents = [event, note, transcript, project, secondProject, milestone, task, unrelated];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'Look through my Workday meetings and connect them to my project work.', [], 20, { documents });

  assert.equal(result.mode, 'research');
  assert.equal(result.orchestration.retrievalRounds <= 4, true);
  assert.ok(result.orchestration.objectives.some((objective) => objective.id === 'meetings' && objective.status === 'found'));
  assert.ok(result.orchestration.objectives.some((objective) => objective.id === 'linked-projects'));
  assert.equal(result.items.some((candidate) => candidate.resourceId === 'project-alfa'), true);
  assert.equal(result.items.some((candidate) => candidate.resourceId === 'project-watercolor'), true);
  assert.equal(result.items.some((candidate) => candidate.resourceId === 'project-unrelated'), false);
  assert.equal(result.orchestration.coverage.meetings, 'found');
  assert.equal(result.orchestration.coverage.projects, 'found');
  assert.ok(result.orchestration.provenance.find((entry) => entry.resourceKey === 'project:project-alfa')?.path.length);
  await index.shutdown();
});

test('keeps narrow questions on the quick retrieval path', async () => {
  assert.equal(classifyAskLedgerRetrievalMode('When is Alfa due?'), 'quick');
  assert.equal(classifyAskLedgerRetrievalMode('Show my today tasks.'), 'quick');
  assert.deepEqual(decomposeRetrievalObjectives('Look through my Workday meetings, projects, milestones, tasks and next actions'), [
    { id: 'meetings', purpose: 'Find relevant meetings and calendar evidence', resourceTypes: ['event'], entityQuery: 'Workday', constraints: {}, expandRelationships: true, dependsOn: [], graphRelationshipTypes: ['has_meeting_note', 'linked_note', 'linked_project', 'belongs_to_project', 'has_note', 'has_transcript', 'belongs_to_note'] },
    { id: 'meeting-context', purpose: 'Retrieve meeting notes and transcripts', resourceTypes: ['note', 'transcript'], entityQuery: 'Workday', constraints: {}, expandRelationships: true, dependsOn: ['meetings'], graphRelationshipTypes: ['has_meeting_note', 'linked_note', 'has_transcript', 'belongs_to_note', 'linked_project', 'belongs_to_project'] },
    { id: 'linked-projects', purpose: 'Retrieve projects discovered through meeting evidence', resourceTypes: ['project'], expandRelationships: true, dependsOn: ['meetings', 'meeting-context'], graphRelationshipTypes: ['linked_project', 'belongs_to_project', 'has_milestone', 'has_task', 'has_note', 'has_event', 'has_reminder', 'has_external_resource'] },
    { id: 'project-milestones', purpose: 'Retrieve milestones for discovered projects', resourceTypes: ['milestone'], constraints: {}, expandRelationships: false, dependsOn: ['linked-projects'] },
    { id: 'project-open-tasks', purpose: 'Retrieve open project tasks and horizons', resourceTypes: ['task'], constraints: { openOnly: true }, expandRelationships: false, dependsOn: ['linked-projects'] },
    { id: 'linked-reminders', purpose: 'Retrieve reminders and follow-up context', resourceTypes: ['reminder'], constraints: {}, expandRelationships: false, dependsOn: ['linked-projects'] },
  ]);
});

test('records missing categories while preserving found evidence', async () => {
  const project = item({ resourceType: 'project', resourceId: 'project-alfa', title: 'Alfa', content: 'Project status.' });
  const { orchestrator, index } = await buildOrchestrator([project]);
  const result = await orchestrator.retrieve('workspace-a', 'What is going on with Alfa and what still needs to happen?', [], 20, { documents: [project] });
  assert.equal(result.orchestration.mode, 'research');
  assert.equal(result.orchestration.coverage.projects, 'found');
  assert.equal(result.orchestration.coverage.tasks, 'not_found');
  assert.ok(result.items.some((candidate) => candidate.resourceId === 'project-alfa'));
  await index.shutdown();
});

test('bounds research rounds, objectives, and evidence', async () => {
  const project = item({ resourceType: 'project', resourceId: 'project-a', title: 'Alfa', content: 'Project.' });
  const { orchestrator, index } = await buildOrchestrator([project], { maxRounds: 1, maxObjectives: 2, maxEvidenceResources: 1 });
  const result = await orchestrator.retrieve('workspace-a', 'Look through my meetings, projects, milestones, tasks and reminders and connect everything.', [], 20, { documents: [project] });
  assert.equal(result.orchestration.retrievalRounds <= 1, true);
  assert.equal(result.orchestration.objectives.length <= 2, true);
  assert.equal(result.items.length <= 1, true);
  await index.shutdown();
});

test('runs only the requested integration objective and preserves explicit-link provenance', async () => {
  const project = item({ resourceType: 'project', resourceId: 'project-alfa', title: 'Alfa', content: 'Project.' });
  const slack = item({ resourceType: 'external', resourceId: 'slack-1', title: 'Alfa Slack thread', content: 'Slack discussion about Alfa.', integrationProvider: 'slack', integrationResourceType: 'thread', externalId: 'thread-1', explicitIntegrationLink: true, relationships: [{ relationshipType: 'linked_project', resourceType: 'project', resourceId: 'project-alfa' }] });
  const github = item({ resourceType: 'external', resourceId: 'github-1', title: 'Alfa GitHub PR', content: 'GitHub pull request.', integrationProvider: 'github', integrationResourceType: 'pull_request', externalId: 'pr-1' });
  const documents = [project, slack, github];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'What did Slack say about Alfa?', [], 20, { documents });
  assert.ok(result.items.some((entry) => entry.resourceId === 'slack-1'));
  assert.equal(result.items.some((entry) => entry.resourceId === 'github-1'), false);
  assert.deepEqual(result.integrationRetrieval?.requestedSources, ['slack']);
  assert.equal(result.integrationRetrieval?.explicitLinks, 1);
  await index.shutdown();
});

test('applies resolved conversation project IDs to fresh follow-up retrieval', async () => {
  const alfa = item({ resourceType: 'project', resourceId: 'project-alfa', title: 'Alfa', content: 'Project.' });
  const task = item({ resourceType: 'task', resourceId: 'task-long', title: 'Archive Alfa assets', content: 'Long-term work.', projectId: 'project-alfa', horizon: 'long_term', taskHorizon: 'long_term', status: 'Open' });
  const other = item({ resourceType: 'task', resourceId: 'task-other', title: 'Archive unrelated assets', content: 'Long-term work.', projectId: 'project-other', horizon: 'long_term', taskHorizon: 'long_term', status: 'Open' });
  const documents = [alfa, task, other];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'What about its long-term tasks?', [], 20, { documents, resolvedResourceKeys: ['project:project-alfa'] });
  assert.ok(result.items.some((entry) => entry.resourceId === 'task-long'));
  assert.equal(result.items.some((entry) => entry.resourceId === 'task-other'), false);
  await index.shutdown();
});
