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

test('retrieves teamspaces, people, and their open workload for Circle questions', async () => {
  const design = item({ resourceType: 'team', resourceId: 'team-design', title: 'Design', content: 'Design teamspace.' });
  const alex = item({ resourceType: 'person', resourceId: 'person-alex', title: 'Alex', content: 'Alex is in the Design team.', teamId: 'team-design', relationships: [{ relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: 'team-design' }] });
  const task = item({ resourceType: 'task', resourceId: 'task-alex', title: 'Prepare design review', content: 'Open task assigned to Alex.', status: 'todo', assigneeId: 'person-alex', teamId: 'team-design', relationships: [{ relationshipType: 'assigned_to', resourceType: 'person', resourceId: 'person-alex' }, { relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: 'team-design' }] });
  const documents = [design, alex, task];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'How are my teamspaces? Does anyone in my circle have tasks?', [], 20, { documents });
  assert.ok(result.orchestration.objectives.some((objective) => objective.id === 'team-workspace-members'));
  assert.ok(result.orchestration.objectives.some((objective) => objective.id === 'team-workload-actions'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'team-design'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'person-alex'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'task-alex'));
  await index.shutdown();
});

test('retrieves notes linked through the referenced team context', async () => {
  const design = item({ resourceType: 'team', resourceId: 'team-design', title: 'Design', content: 'Design teamspace.' });
  const alex = item({ resourceType: 'person', resourceId: 'person-alex', title: 'Alex', content: 'Alex is in the Design team.', teamId: 'team-design', relationships: [{ relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: 'team-design' }] });
  const project = item({ resourceType: 'project', resourceId: 'project-design', title: 'Design launch', content: 'Design work.', teamId: 'team-design', relationships: [{ relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: 'team-design' }] });
  const note = item({ resourceType: 'note', resourceId: 'note-design', title: 'Design handoff', content: 'The team agreed on the handoff sequence.', projectId: 'project-design', projectName: 'Design launch' });
  const unrelated = item({ resourceType: 'note', resourceId: 'note-unrelated', title: 'Personal note', content: 'Unrelated.' });
  const documents = [design, alex, project, note, unrelated];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'What are notes tied with this team?', [], 20, { documents });
  assert.equal(result.mode, 'research');
  assert.ok(result.orchestration.objectives.some((objective) => objective.id === 'team-linked-context'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'note-design'));
  assert.equal(result.items.some((entry) => entry.resourceId === 'note-unrelated'), false);
  await index.shutdown();
});

test('plan my week uses structured weekly, overdue, and completion task scopes', async () => {
  const now = new Date();
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const start = new Date(day); start.setDate(start.getDate() - start.getDay());
  const date = (offset: number) => { const value = new Date(start); value.setDate(value.getDate() + offset); return value.toISOString().slice(0, 10); };
  const openThisWeek = item({ resourceType: 'task', resourceId: 'task-open-week', title: 'Prepare presentation', content: '', dueAt: date(3), status: 'todo' });
  const completedThisWeek = item({ resourceType: 'task', resourceId: 'task-done-week', title: 'Finish outline', content: '', dueAt: date(1), status: 'completed' });
  const overdue = item({ resourceType: 'task', resourceId: 'task-overdue', title: 'Resolve overdue issue', content: '', dueAt: date(-4), status: 'todo' });
  const longPast = item({ resourceType: 'task', resourceId: 'task-old', title: 'Old completed work', content: '', dueAt: date(-30), status: 'completed' });
  const { orchestrator, index } = await buildOrchestrator([openThisWeek, completedThisWeek, overdue, longPast]);
  const result = await orchestrator.retrieve('workspace-a', '', [], 32, { documents: [openThisWeek, completedThisWeek, overdue, longPast], skillId: 'plan_my_week' });
  assert.equal(result.mode, 'research');
  assert.ok(result.items.some((entry) => entry.resourceId === 'task-open-week'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'task-done-week'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'task-overdue'));
  assert.equal(result.items.some((entry) => entry.resourceId === 'task-old'), false);
  assert.equal(result.orchestration.objectives.find((objective) => objective.id === 'week-open-tasks')?.strategy, 'structured');
  await index.shutdown();
});

test('context-bound health and meeting skills expand their selected seeds', async () => {
  const project = item({ resourceType: 'project', resourceId: 'project-health', title: 'Alfa', content: 'In progress.', relationships: [{ relationshipType: 'has_task', resourceType: 'task', resourceId: 'task-health' }] });
  const task = item({ resourceType: 'task', resourceId: 'task-health', title: 'Resolve final proof', content: 'Blocked by review.', projectId: 'project-health', status: 'Open' });
  const event = item({ resourceType: 'event', resourceId: 'event-health', title: 'Alfa review meeting', content: 'Review open work.', relationships: [{ relationshipType: 'linked_note', resourceType: 'note', resourceId: 'note-health' }] });
  const note = item({ resourceType: 'note', resourceId: 'note-health', title: 'Alfa review notes', content: 'Follow up on final proof.', relationships: [{ relationshipType: 'linked_event', resourceType: 'event', resourceId: 'event-health' }] });
  const documents = [project, task, event, note];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const health = await orchestrator.retrieve('workspace-a', '', [], 20, { documents, skillId: 'project_health_check', boostResourceKeys: ['project:project-health'] });
  assert.equal(health.mode, 'research');
  assert.ok(health.items.some((entry) => entry.resourceId === 'project-health'));
  assert.ok(health.items.some((entry) => entry.resourceId === 'task-health'));
  const meeting = await orchestrator.retrieve('workspace-a', '', [], 20, { documents, skillId: 'meeting_follow_up', boostResourceKeys: ['event:event-health'] });
  assert.equal(meeting.mode, 'research');
  assert.ok(meeting.items.some((entry) => entry.resourceId === 'event-health'));
  assert.ok(meeting.items.some((entry) => entry.resourceId === 'note-health'));
  await index.shutdown();
});

test('custom skills retrieve their declared workspace scope instead of parsing instructions as a query', async () => {
  const team = item({ resourceType: 'team', resourceId: 'team-design', title: 'Design', content: 'Design teamspace.' });
  const meeting = item({ resourceType: 'event', resourceId: 'event-design', title: 'Design review', content: 'Review the current work.' });
  const note = item({ resourceType: 'note', resourceId: 'note-design', title: 'Design notes', content: 'Open decisions and follow-ups.' });
  const documents = [team, meeting, note];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'Review team members, meetings, and notes.', [], 20, {
    documents,
    skillId: 'custom-skill-id' as never,
    customSkillResourceTypes: ['team', 'person', 'event', 'note'],
  });
  assert.equal(result.orchestration.objectives[0]?.id, 'custom-skill-context');
  assert.ok(result.items.some((entry) => entry.resourceId === 'team-design'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'event-design'));
  assert.ok(result.items.some((entry) => entry.resourceId === 'note-design'));
  await index.shutdown();
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

test('keeps an explicitly selected project authoritative when the question also asks about meetings', async () => {
  const project = item({ resourceType: 'project', resourceId: 'project-selected', title: 'Watercolor Exhibition', content: 'Exhibition project.', status: 'in_progress' });
  const task = item({ resourceType: 'task', resourceId: 'task-selected', title: 'Confirm gallery venue', content: 'Next action for the exhibition.', projectId: 'project-selected', status: 'open', dueAt: '2026-08-27' });
  const milestone = item({ resourceType: 'milestone', resourceId: 'milestone-selected', title: 'Artwork list', content: 'Finalize the artwork list.', projectId: 'project-selected', status: 'open' });
  const meeting = item({ resourceType: 'event', resourceId: 'event-unrelated', title: 'Team meeting', content: 'General team meeting.' });
  const documents = [project, task, milestone, meeting];
  const { orchestrator, index } = await buildOrchestrator(documents);
  const result = await orchestrator.retrieve('workspace-a', 'What is the next action and status for this project? I have a team meeting soon.', [], 20, {
    documents,
    resolvedResourceKeys: ['project:project-selected'],
  });

  assert.equal(result.items.some((entry) => entry.resourceId === 'project-selected'), true);
  assert.equal(result.items.some((entry) => entry.resourceId === 'task-selected'), true);
  assert.equal(result.items.some((entry) => entry.resourceId === 'milestone-selected'), true);
  assert.equal(result.orchestration.objectives[0]?.id, 'explicit-project');
  await index.shutdown();
});
