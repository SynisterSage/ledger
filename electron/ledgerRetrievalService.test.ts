import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmbeddingIndexService,
  LedgerRetrievalService,
  formatEmbeddingInput,
  type EmbeddingProvider,
} from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { buildRetrievalPlan } from './askLedgerRetrievalPlan.ts';

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-local-model';
  readonly version = 'test-1';
  calls = 0;

  async embed(texts: string[]) {
    this.calls += 1;
    return texts.map((text) => {
      const value = text.toLowerCase();
      return [value.includes('apple') || value.includes('calendar') ? 1 : 0, value.includes('qwen') || value.includes('local ai') ? 1 : 0];
    });
  }
}

const resource = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({
  workspaceId: 'workspace-a',
  resourceType: 'note',
  resourceId: 'note-1',
  title: 'Note',
  content: 'General context.',
  ...overrides,
});

test('formats Nomic query and document inputs consistently', () => {
  assert.equal(formatEmbeddingInput('calendar decisions', 'query', 'nomic-embed-text-v1.5'), 'search_query: calendar decisions');
  assert.equal(formatEmbeddingInput('Calendar\nDecisions', 'document', 'nomic-embed-text-v1.5'), 'search_document: Calendar\nDecisions');
  assert.equal(formatEmbeddingInput('calendar decisions', 'query', 'other-model'), 'calendar decisions');
});

test('combines lexical and local semantic candidates without crossing workspaces', async () => {
  const provider = new FakeEmbeddingProvider();
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceId: 'calendar-note', title: 'Calendar design', content: 'Make the calendar feel more like Apple.' }),
    resource({ resourceId: 'local-ai', title: 'Local AI', content: 'Qwen3 is the current local model.' }),
    resource({ workspaceId: 'workspace-b', resourceId: 'private-calendar', title: 'Private calendar', content: 'Apple calendar notes from another workspace.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'How should the calendar behave?', [
    { type: 'note', id: 'local-ai', title: 'Local AI', match_source: 'title' },
  ]);

  assert.equal(result.items.some((item) => item.resourceId === 'private-calendar'), false);
  assert.equal(result.items[0]?.resourceId, 'calendar-note');
  assert.ok(result.debug[0]?.why.some((reason) => reason.startsWith('semantic:')));
});

test('does not re-embed unchanged chunks and chunks large resources', async () => {
  const provider = new FakeEmbeddingProvider();
  const index = new EmbeddingIndexService(provider);
  const large = resource({ resourceId: 'long-note', content: Array.from({ length: 40 }, (_, index) => `Section ${index}. Calendar planning and follow-up.`).join(' ') });

  const first = await index.replaceWorkspace('workspace-a', [large]);
  const callsAfterFirstIndex = provider.calls;
  const second = await index.replaceWorkspace('workspace-a', [large]);

  assert.ok(first.indexed > 1);
  assert.equal(second.embedded, 0);
  assert.equal(provider.calls, callsAfterFirstIndex);
});

test('does not re-embed when only display timestamps change', async () => {
  const provider = new FakeEmbeddingProvider();
  const index = new EmbeddingIndexService(provider);
  const first = resource({ resourceId: 'timestamped', title: 'Calendar note', content: 'Keep the calendar focused.', updatedAt: '2026-08-20T10:00:00Z' });
  const second = { ...first, updatedAt: '2026-08-21T10:00:00Z' };
  await index.replaceWorkspace('workspace-a', [first]);
  const callsAfterFirstIndex = provider.calls;
  const result = await index.replaceWorkspace('workspace-a', [second]);
  assert.equal(result.embedded, 0);
  assert.equal(provider.calls, callsAfterFirstIndex);
});

test('retrieves from a supplied structured corpus without an indexed workspace', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  const item = resource({ resourceType: 'task', resourceId: 'structured-task', title: 'Submit the catalog', content: 'Open task.', status: 'Not started' });
  const result = await retrieval.retrieve('workspace-a', 'show my tasks', [], 8, {
    documents: [item],
    skipSemantic: true,
    plan: buildRetrievalPlan('show my tasks'),
  });
  assert.equal(result.items[0]?.resourceId, 'structured-task');
  assert.equal(index.documents('workspace-a').length, 0);
});

test('lexical retrieval can return exact evidence when embeddings are unavailable', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [resource({ resourceId: 'project-local-ai', resourceType: 'project', title: 'Local AI', content: 'Planning at 15% progress.' })]);

  const result = await retrieval.retrieve('workspace-a', 'What is the status of Local AI?', [
    { type: 'project', id: 'project-local-ai', title: 'Local AI', match_source: 'title' },
  ]);

  assert.equal(result.items[0]?.resourceId, 'project-local-ai');
});

test('generic attachment retrieval remains bounded and skips repeated embedding timeouts', async () => {
  const provider: EmbeddingProvider = {
    model: 'unavailable-embedding',
    version: 'test',
    calls: 0,
    async embed() {
      this.calls += 1;
      throw new Error('embedding timeout');
    },
  } as EmbeddingProvider & { calls: number };
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  const attachment = resource({ resourceType: 'attachment', resourceId: 'file-a:0', title: 'Class Information.docx', content: 'Course schedule and class policies.' });
  await retrieval.indexAttachments('conversation-a', 'workspace-a', [attachment]);
  const result = await retrieval.retrieve('workspace-a', 'what does this contain', [], 8, {
    conversationId: 'conversation-a',
    attachmentFocus: true,
    skipSemantic: true,
  });
  assert.equal((provider as EmbeddingProvider & { calls: number }).calls, 1);
  assert.equal(result.items[0]?.resourceId, 'file-a:0');
  assert.ok((result.debug[0]?.score ?? 0) > 0.18);
  assert.ok(result.debug[0]?.why.includes('attachment-focus'));
});

test('deadline intent prioritizes dated work and deduplicates chunks by resource', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceId: 'old-note', title: 'Old meeting', content: 'A discussion about deadlines from May.' }),
    resource({ resourceType: 'task', resourceId: 'due-task', title: 'Submit final checks', content: 'Prepare the final submission.', dueAt: '2026-08-18', status: 'Not started' }),
    resource({ resourceType: 'task', resourceId: 'due-task', title: 'Submit final checks', content: 'Prepare the final submission. More details. Another section.', dueAt: '2026-08-18', status: 'Not started' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'when are my project deadlines', [], 20);
  assert.equal(result.items.filter((item) => item.resourceId === 'due-task').length, 1);
  assert.equal(result.items[0]?.resourceId, 'due-task');
  assert.ok(result.debug[0]?.why.includes('due-date'));
});

test('team-member intent prioritizes authoritative team and person resources', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'task', resourceId: 'task', title: 'Team overview message', content: 'Send the team overview.' }),
    resource({ resourceType: 'team', resourceId: 'team', title: 'Design team', content: 'Members: Alex (lead), Sam (member).' }),
    resource({ resourceType: 'person', resourceId: 'alex', title: 'Alex', content: 'Name: Alex. Team: Design team. Role: lead.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'who are my team members', [], 3);
  assert.equal(result.items[0]?.resourceType, 'team');
  assert.equal(result.items[1]?.resourceType, 'person');
  assert.ok(result.debug[0]?.why.includes('team-members-resource'));
});

test('entity policies exclude notes from direct project lookups', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'note', resourceId: 'project-note', title: 'Projects discussion', content: 'We discussed several projects.' }),
    resource({ resourceType: 'project', resourceId: 'project-1', title: 'Local AI', content: 'Status: Planning' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what projects do I have', [], 8);
  assert.deepEqual(result.items.map((item) => item.resourceType), ['project']);
});

test('blocker intent retains project evidence and supporting notes', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'project-1', title: 'Local AI', content: 'Planning.' }),
    resource({ resourceType: 'task', resourceId: 'task-1', title: 'Evaluate runtime', content: 'Blocked by model selection.' }),
    resource({ resourceType: 'note', resourceId: 'note-1', title: 'Local AI decision', content: 'The model decision is still pending.' }),
    resource({ resourceType: 'event', resourceId: 'event-1', title: 'Unrelated meeting', content: 'Calendar details.' }),
  ]);

  const result = await retrieval.retrieve('workspace-a', 'what is blocking Local AI', [], 8);
  assert.equal(result.items.some((item) => item.resourceType === 'project'), true);
  assert.equal(result.items.some((item) => item.resourceType === 'task'), true);
  assert.equal(result.items.some((item) => item.resourceType === 'note'), true);
  assert.equal(result.items.some((item) => item.resourceType === 'event'), false);
});

test('explicit contextual resource outranks unrelated matches', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'context-project', title: 'Mobile calendar', content: 'The mobile calendar project is blocked on testing.' }),
    resource({ resourceType: 'note', resourceId: 'unrelated', title: 'Calendar notes', content: 'General calendar ideas.' }),
  ]);
  const result = await retrieval.retrieve('workspace-a', 'What should I do next?', [], 8, { boostResourceKeys: ['project:context-project'] });
  assert.equal(result.items[0]?.resourceId, 'context-project');
  assert.ok(result.debug[0]?.why.includes('explicit-context'));
});

test('exact project title outranks a semantically or lexically adjacent project', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'alfa-exact', title: 'Alfa 2026 Catalog', content: 'The catalog project.' }),
    resource({ resourceType: 'project', resourceId: 'alfa-adjacent', title: 'Catalog delays and proofs', content: 'Related catalog context.' }),
  ]);
  const plan = buildRetrievalPlan('Tell me about Alfa 2026 Catalog');
  const result = await retrieval.retrieve('workspace-a', plan.semanticQuery, [], 2, { plan });
  assert.equal(result.items[0]?.resourceId, 'alfa-exact');
  assert.equal(result.debug[0]?.exactEntityMatch, true);
  assert.ok(result.debug[0]?.why.includes('exact-title-match'));
  assert.equal(result.hybridRetrieval?.candidateCounts.exact, 1);
  assert.equal(result.hybridRetrieval?.selectedSeeds[0], 'project:alfa-exact');
});

test('exact entity scoring beats a slightly stronger semantic candidate', async () => {
  const provider: EmbeddingProvider = {
    model: 'hybrid-test',
    version: '1',
    async embed(texts) {
      return texts.map((text) => {
        const normalized = text.toLowerCase();
        if (!text.includes('\n')) return [1, 0];
        return normalized.includes('semantic') ? [0.99, 0.1] : normalized.includes('alfa') ? [0.1, 0.99] : [0, 1];
      });
    },
  };
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'exact', title: 'Alfa', content: 'Exact project.' }),
    resource({ resourceType: 'project', resourceId: 'semantic', title: 'Unrelated semantic project', content: 'Semantic context.' }),
  ]);
  const question = 'Tell me about Alfa';
  const result = await retrieval.retrieve('workspace-a', question, [], 2, { plan: buildRetrievalPlan(question) });
  assert.equal(result.items[0]?.resourceId, 'exact');
  assert.ok((result.debug.find((entry) => entry.resourceId === 'semantic')?.semanticScore ?? 0) > (result.debug.find((entry) => entry.resourceId === 'exact')?.semanticScore ?? 0));
});

test('today task retrieval uses horizon as an authoritative structured filter', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'task', resourceId: 'today-task', title: 'Prepare today review', taskHorizon: 'today', horizon: 'today', status: 'Not started' }),
    resource({ resourceType: 'task', resourceId: 'long-task', title: 'Today appears in long-term notes', taskHorizon: 'long_term', horizon: 'long_term', status: 'Not started' }),
  ]);
  const plan = buildRetrievalPlan('Show my today tasks');
  const result = await retrieval.retrieve('workspace-a', plan.semanticQuery, [], 8, { plan });
  assert.deepEqual(result.primaryItems?.map((entry) => entry.resourceId), ['today-task']);
  assert.equal(result.items.some((entry) => entry.resourceId === 'long-task'), false);
  assert.equal(result.debug[0]?.structuredMatch, true);
  assert.equal(result.hybridRetrieval?.candidateCounts.structured, 1);
});

test('long-term tasks and completed project tasks use structured horizon, status, and project filters', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'project', resourceId: 'alfa', title: 'Alfa 2026 Catalog', content: 'Catalog.' }),
    resource({ resourceType: 'task', resourceId: 'long-task', title: 'Long-term catalog plan', projectId: 'alfa', projectName: 'Alfa 2026 Catalog', taskHorizon: 'long_term', horizon: 'long_term', status: 'Not started' }),
    resource({ resourceType: 'task', resourceId: 'completed-task', title: 'Complete catalog handoff', projectId: 'alfa', projectName: 'Alfa 2026 Catalog', taskHorizon: 'today', horizon: 'today', status: 'Completed' }),
    resource({ resourceType: 'task', resourceId: 'other-task', title: 'Complete another project', projectId: 'other', projectName: 'Other project', taskHorizon: 'long_term', horizon: 'long_term', status: 'Completed' }),
  ]);
  const longTerm = await retrieval.retrieve('workspace-a', 'What long-term tasks do I have?', [], 8, { plan: buildRetrievalPlan('What long-term tasks do I have?') });
  assert.deepEqual(longTerm.primaryItems?.map((entry) => entry.resourceId), ['long-task', 'other-task']);
  const completedAlfa = await retrieval.retrieve('workspace-a', 'Show completed Alfa tasks', [], 8, { plan: buildRetrievalPlan('Show completed Alfa tasks') });
  assert.deepEqual(completedAlfa.primaryItems?.map((entry) => entry.resourceId), ['completed-task']);
});

test('overdue retrieval excludes completed tasks and uses due dates', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'task', resourceId: 'overdue-open', title: 'Overdue open task', dueAt: '2026-08-10', status: 'In Progress' }),
    resource({ resourceType: 'task', resourceId: 'overdue-complete', title: 'Overdue completed task', dueAt: '2026-08-10', status: 'Completed' }),
    resource({ resourceType: 'task', resourceId: 'future-task', title: 'Future task', dueAt: '2026-08-30', status: 'Not started' }),
  ]);
  const result = await retrieval.retrieve('workspace-a', 'Show my overdue tasks', [], 8, { plan: buildRetrievalPlan('Show my overdue tasks') });
  assert.deepEqual(result.primaryItems?.map((entry) => entry.resourceId), ['overdue-open']);
});

test('meeting retrieval combines entity and last-week date constraints without project fallback', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'event', resourceId: 'workday-last-week', title: 'Workday meeting', timestamp: '2026-08-10T10:00:00.000Z' }),
    resource({ resourceType: 'event', resourceId: 'workday-this-week', title: 'Workday meeting', timestamp: '2026-08-17T10:00:00.000Z' }),
    resource({ resourceType: 'project', resourceId: 'unrelated-project', title: 'Workday project', content: 'Not a meeting.' }),
  ]);
  const question = 'Find my Workday meetings last week';
  const result = await retrieval.retrieve('workspace-a', question, [], 8, { plan: buildRetrievalPlan(question, new Date('2026-08-18T12:00:00')) });
  assert.equal(result.primaryItems?.some((entry) => entry.resourceId === 'workday-last-week'), true);
  assert.equal(result.primaryItems?.some((entry) => entry.resourceId === 'workday-this-week'), false);
  assert.equal(result.primaryItems?.some((entry) => entry.resourceType === 'project'), false);
  assert.equal(result.hybridRetrieval?.authoritativeZeroMatches, false);
});

test('retrieves unread notifications and Circle activity with structured constraints', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  await index.replaceWorkspace('workspace-a', [
    resource({ resourceType: 'notification', resourceId: 'notification-unread', title: 'Alfa needs attention', content: 'Unread project alert.', projectId: 'project-alfa', read: false, priority: 'high', timestamp: '2026-08-18T10:00:00Z' }),
    resource({ resourceType: 'notification', resourceId: 'notification-read', title: 'Alfa was updated', content: 'Read project alert.', projectId: 'project-alfa', read: true, timestamp: '2026-08-18T09:00:00Z' }),
    resource({ resourceType: 'activity', resourceId: 'circle-activity', title: 'Circle task changed', content: 'Circle teamspace activity for Alfa.', sourceLabel: 'Circle', projectId: 'project-alfa', timestamp: '2026-08-18T08:00:00Z' }),
  ]);
  const unread = await retrieval.retrieve('workspace-a', 'Show my unread notifications', [], 8, { plan: buildRetrievalPlan('Show my unread notifications') });
  assert.deepEqual(unread.primaryItems?.map((entry) => entry.resourceId), ['notification-unread']);
  const circleQuestion = 'What changed in Circle this week?';
  const circle = await retrieval.retrieve('workspace-a', circleQuestion, [], 8, { plan: buildRetrievalPlan(circleQuestion, new Date('2026-08-18T12:00:00')) });
  assert.deepEqual(circle.primaryItems?.map((entry) => entry.resourceId), ['circle-activity']);
});

test('filters team workload to normalized assignee and team relationships', async () => {
  const index = new EmbeddingIndexService();
  const retrieval = new LedgerRetrievalService(index);
  const documents = [
    resource({ resourceType: 'task', resourceId: 'task-sarah', title: 'Review exhibition proof', status: 'Open', assigneeId: 'person-sarah', teamId: 'team-design', relationships: [{ relationshipType: 'assigned_to', resourceType: 'person', resourceId: 'person-sarah' }, { relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: 'team-design' }] }),
    resource({ resourceType: 'task', resourceId: 'task-other', title: 'Unrelated workspace task', status: 'Open', metadata: { assigned_to_user_id: 'person-other', assigned_to_team_id: 'team-other' } }),
  ];
  const result = await retrieval.retrieve('workspace-a', 'Find open team workload', [], 8, {
    plan: {
      ...buildRetrievalPlan('Find open team workload'),
      primaryResourceTypes: ['task'],
      entityQuery: undefined,
      structuredConstraints: { openOnly: true, teamIds: ['team-design'], assigneeIds: ['person-sarah'] },
    },
    documents,
  });
  assert.deepEqual(result.primaryItems?.map((entry) => entry.resourceId), ['task-sarah']);
});
