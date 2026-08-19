import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import type { AskLedgerBenchmarkCaseRequest } from './askLedgerService.ts';

export type AskLedgerEvaluationCategory = 'simple_facts' | 'resource_understanding' | 'meeting_intelligence' | 'cross_resource_research' | 'task_intelligence' | 'attention' | 'integration_context' | 'missing_uncertain_evidence';

export type AskLedgerEvaluationExpectation = {
  primaryResourceKeys?: string[];
  contextResourceKeys?: string[];
  forbiddenResourceKeys?: string[];
  requiredCoverage?: string[];
  requiredAnswerFacts?: string[];
  forbiddenClaims?: string[];
  expectedUnavailable?: string[];
  maxEvidenceResources?: number;
};

export type AskLedgerEvaluationCase = AskLedgerBenchmarkCaseRequest & {
  id: string;
  category: AskLedgerEvaluationCategory;
  expectation: AskLedgerEvaluationExpectation;
};

const workspaceId = 'ask-ledger-evaluation-workspace';
const project = (resourceId: string, title: string, status: string, content: string): AskLedgerContextItem => ({ workspaceId, resourceType: 'project', resourceId, title, content, status, projectId: resourceId, projectName: title, updatedAt: '2026-08-18T12:00:00Z' });
const projects = {
  alfa: project('project-alfa', 'Alfa 2026 Catalog', 'In Progress', 'Catalog closeout is underway.'),
  watercolor: project('project-watercolor', 'Watercolor Exhibition', 'In Progress', 'The exhibition is moving into asset review.'),
  irrelevant: project('project-unrelated', 'Unrelated Garden Plans', 'Not Started', 'A separate personal project.'),
};
const milestone = (resourceId: string, title: string, projectId: string, status = 'In Progress'): AskLedgerContextItem => ({ workspaceId, resourceType: 'milestone', resourceId, title, content: `${title} milestone.`, projectId, projectName: projects[projectId === 'project-alfa' ? 'alfa' : 'watercolor'].title, status, dueAt: '2026-08-22', updatedAt: '2026-08-18T10:00:00Z' });
const task = (resourceId: string, title: string, projectId: string, fields: Partial<AskLedgerContextItem> = {}): AskLedgerContextItem => ({ workspaceId, resourceType: 'task', resourceId, title, content: `${title} task.`, projectId, projectName: projects[projectId === 'project-alfa' ? 'alfa' : 'watercolor'].title, status: 'Open', updatedAt: '2026-08-18T09:00:00Z', ...fields });

export const createAskLedgerEvaluationDocuments = (): AskLedgerContextItem[] => [
  projects.alfa, projects.watercolor, projects.irrelevant,
  milestone('milestone-final-production', 'Final Production', 'project-alfa'),
  milestone('milestone-watercolor-assets', 'Asset Review', 'project-watercolor', 'Not Started'),
  task('task-review-proof', 'Review Final Proof', 'project-alfa', { milestoneId: 'milestone-final-production', dueAt: '2026-08-18', horizon: 'today', taskHorizon: 'today', priority: 'high' }),
  task('task-archive-assets', 'Archive Final Assets', 'project-alfa', { milestoneId: 'milestone-final-production', horizon: 'long_term', taskHorizon: 'long_term', dueAt: '2026-09-05' }),
  task('task-overdue-copy', 'Resolve Outstanding Copy', 'project-alfa', { status: 'Open', dueAt: '2026-08-15', horizon: 'today', taskHorizon: 'today', priority: 'high' }),
  task('task-completed-proof', 'Send Approved Proof', 'project-alfa', { status: 'Completed', dueAt: '2026-08-10', horizon: 'today', taskHorizon: 'today' }),
  task('task-watercolor-assets', 'Review Watercolor Assets', 'project-watercolor', { milestoneId: 'milestone-watercolor-assets', horizon: 'today', taskHorizon: 'today', dueAt: '2026-08-19' }),
  task('task-watercolor-longterm', 'Plan Exhibition Outreach', 'project-watercolor', { horizon: 'long_term', taskHorizon: 'long_term', dueAt: '2026-09-12' }),
  { workspaceId, resourceType: 'note', resourceId: 'note-workday', title: 'Workday Meeting — Alfa and Watercolor', content: 'Discussed final proof review for Alfa. Watercolor asset review is next. The team is waiting on final writing.', projectId: 'project-alfa', projectName: projects.alfa.title, updatedAt: '2026-08-17T16:00:00Z', parentResourceId: 'event-workday' },
  { workspaceId, resourceType: 'transcript', resourceId: 'transcript-workday-1', title: 'Workday transcript — final writing', content: 'Final writing is still outstanding before proof review can finish.', noteId: 'note-workday', parentResourceId: 'note-workday', updatedAt: '2026-08-17T16:05:00Z' },
  { workspaceId, resourceType: 'event', resourceId: 'event-workday', title: 'Workday Meeting — Aug 17', content: 'Workday meeting about current project work.', projectId: 'project-alfa', noteId: 'note-workday', timestamp: '2026-08-17T15:00:00Z', updatedAt: '2026-08-17T16:00:00Z' },
  { workspaceId, resourceType: 'reminder', resourceId: 'reminder-proof', title: 'Send final version for review', content: 'Reminder to send the final version.', projectId: 'project-alfa', dueAt: '2026-08-18T17:00:00Z', updatedAt: '2026-08-18T08:00:00Z' },
  { workspaceId, resourceType: 'notification', resourceId: 'notification-proof', title: 'Review Final Proof is overdue', content: 'You were notified that Review Final Proof is overdue.', projectId: 'project-alfa', read: false, priority: 'high', createdAt: '2026-08-18T08:30:00Z', updatedAt: '2026-08-18T08:30:00Z', metadata: { dedupeKey: 'task:task-overdue-copy' } },
  { workspaceId, resourceType: 'activity', resourceId: 'activity-alfa', title: 'Alfa milestone changed', content: 'Final Production moved to In Progress.', projectId: 'project-alfa', activityType: 'status_changed', createdAt: '2026-08-18T07:00:00Z', updatedAt: '2026-08-18T07:00:00Z' },
  { workspaceId, resourceType: 'activity', resourceId: 'activity-circle', title: 'Circle design alert', content: 'Design teamspace asset review needs attention.', teamId: 'team-design', sourceLabel: 'Circle', priority: 'high', createdAt: '2026-08-18T06:00:00Z', updatedAt: '2026-08-18T06:00:00Z' },
  { workspaceId, resourceType: 'external', resourceId: 'slack-alfa', title: 'Slack #catalog — final writing', content: 'Slack discussion says final writing is still outstanding.', integrationProvider: 'slack', integrationResourceType: 'message', externalId: 'slack-msg-1', explicitIntegrationLink: true, projectId: 'project-alfa', updatedAt: '2026-08-18T11:00:00Z' },
  { workspaceId, resourceType: 'external', resourceId: 'github-alfa', title: 'GitHub PR #142 — catalog export fixes', content: 'Open pull request for catalog export fixes.', integrationProvider: 'github', integrationResourceType: 'pull_request', externalId: 'github-pr-142', explicitIntegrationLink: true, projectId: 'project-alfa', status: 'Open', updatedAt: '2026-08-18T11:30:00Z' },
  { workspaceId, resourceType: 'external', resourceId: 'figma-watercolor', title: 'Figma — Watercolor Exhibition Layout', content: 'Watercolor exhibition layout design.', integrationProvider: 'figma', integrationResourceType: 'file', externalId: 'figma-file-1', explicitIntegrationLink: true, projectId: 'project-watercolor', updatedAt: '2026-08-17T11:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'note-irrelevant', title: 'Garden meeting notes', content: 'Unrelated notes about garden plans.', projectId: 'project-unrelated', updatedAt: '2026-08-18T12:30:00Z' },
];

const docs = createAskLedgerEvaluationDocuments();
const evaluationKeyAliases: Record<string, string> = {
  'project:alfa': 'project:project-alfa', 'project:watercolor': 'project:project-watercolor', 'project:unrelated': 'project:project-unrelated',
  'milestone:final-production': 'milestone:milestone-final-production', 'milestone:watercolor-assets': 'milestone:milestone-watercolor-assets',
  'task:review-proof': 'task:task-review-proof', 'task:archive-assets': 'task:task-archive-assets', 'task:overdue-copy': 'task:task-overdue-copy', 'task:completed-proof': 'task:task-completed-proof', 'task:watercolor-assets': 'task:task-watercolor-assets', 'task:watercolor-longterm': 'task:task-watercolor-longterm',
  'event:workday': 'event:event-workday', 'note:workday': 'note:note-workday', 'transcript:workday-1': 'transcript:transcript-workday-1', 'reminder:proof': 'reminder:reminder-proof', 'notification:proof': 'notification:notification-proof', 'activity:alfa': 'activity:activity-alfa', 'activity:circle': 'activity:activity-circle',
};
const canonicalKeys = (keys?: string[]) => keys?.map((key) => evaluationKeyAliases[key] ?? key);
const expectations = (base: AskLedgerEvaluationExpectation, sourceDocuments = docs) => ({ workspaceId, documents: sourceDocuments, lexicalResults: sourceDocuments.map((item) => ({ type: item.resourceType, id: item.resourceId, title: item.title, match_source: 'evaluation-fixture' })), expectation: { ...base, primaryResourceKeys: canonicalKeys(base.primaryResourceKeys), contextResourceKeys: canonicalKeys(base.contextResourceKeys), forbiddenResourceKeys: canonicalKeys(base.forbiddenResourceKeys) } });

export const createAskLedgerEvaluationCases = (): AskLedgerEvaluationCase[] => [
  ...[
    ['fact-due', 'When is Alfa due?', ['task:review-proof'], ['task:review-proof']],
    ['fact-owner', 'Who owns this task?', ['task:review-proof'], []],
    ['fact-milestone', 'What milestone is Review Final Proof part of?', ['milestone:final-production'], [], ['milestone:final-production']],
    ['fact-today', 'Show my today tasks.', ['task:review-proof', 'task:overdue-copy'], ['task:archive-assets']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, contextResourceKeys]) => ({ id: id as string, category: 'simple_facts' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], contextResourceKeys: contextResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[] }) })),
  ...[
    ['project-alfa', "What's going on with Alfa?", ['project:alfa'], ['project:unrelated'], ['projects', 'milestones', 'tasks']],
    ['project-watercolor', 'Summarize Watercolor.', ['project:watercolor'], ['project:unrelated'], ['projects', 'milestones', 'tasks']],
    ['project-next', 'What still needs to happen for this project?', ['project:alfa', 'task:review-proof'], ['project:unrelated'], ['projects', 'tasks']],
    ['project-status', 'Review my projects and tell me what is blocked.', ['project:alfa', 'task:overdue-copy'], ['project:unrelated'], ['projects', 'tasks']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, requiredCoverage]) => ({ id: id as string, category: 'resource_understanding' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: requiredCoverage as string[] }) })),
  ...[
    ['meeting-latest', 'Summarize my latest Workday meeting.', ['event:workday'], [], ['note:workday']],
    ['meeting-decisions', 'What decisions came out of the Workday meetings?', ['note:workday'], [], ['transcript:workday-1']],
    ['meeting-followups', "What follow-ups came from yesterday's meeting?", ['event:workday'], [], ['task:review-proof']],
    ['meeting-project-link', 'Connect the Workday meeting to its project work.', ['event:workday', 'project:alfa', 'task:review-proof'], ['project:unrelated']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, contextResourceKeys]) => ({ id: id as string, category: 'meeting_intelligence' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], contextResourceKeys: contextResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: ['meetings', 'notes'] }) })),
  ...[
    ['research-meetings-projects', 'Look through my Workday meetings and connect them to my current projects.', ['event:workday', 'note:workday', 'project:alfa'], ['project:unrelated'], ['meetings', 'projects', 'tasks']],
    ['research-project-state', 'Tell me where my projects stand, including milestones and open work.', ['project:alfa', 'project:watercolor', 'milestone:final-production', 'task:review-proof'], ['project:unrelated'], ['projects', 'milestones', 'tasks']],
    ['research-week', 'What have I been working on this week?', ['task:review-proof', 'event:workday', 'activity:alfa'], ['project:unrelated'], ['tasks', 'meetings', 'activity']],
    ['research-tying-summary', 'Look through my meetings, projects, milestones, tasks and next actions and give me a tying summary.', ['event:workday', 'project:alfa', 'milestone:final-production', 'task:review-proof'], ['project:unrelated'], ['meetings', 'projects', 'milestones', 'tasks']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, requiredCoverage]) => ({ id: id as string, category: 'cross_resource_research' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: requiredCoverage as string[] }) })),
  ...[
    ['task-focus', 'What should I focus on today?', ['task:review-proof', 'task:overdue-copy'], ['task:archive-assets']],
    ['task-long-term', 'What long-term work is building up?', ['task:archive-assets', 'task:watercolor-longterm'], ['task:review-proof']],
    ['task-overdue', 'What is overdue?', ['task:overdue-copy'], ['task:completed-proof']],
    ['task-blocked', 'What am I blocked on?', ['task:overdue-copy', 'task:review-proof'], []],
    ['task-completed', 'What did I complete recently?', ['task:completed-proof'], ['task:overdue-copy']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys]) => ({ id: id as string, category: 'task_intelligence' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: ['tasks'] }) })),
  ...[
    ['attention-now', 'What needs my attention?', ['notification:proof', 'task:overdue-copy'], [], ['activity:circle']],
    ['attention-away', 'What changed while I was away?', ['activity:alfa', 'notification:proof'], [], ['activity', 'notifications']],
    ['attention-circle', 'Anything important happen in Circle?', ['activity:circle'], [], ['activity']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, requiredCoverage]) => ({ id: id as string, category: 'attention' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: requiredCoverage as string[] }) })),
  ...[
    ['integration-slack', 'What did Slack say about Alfa?', ['external:slack-alfa'], ['external:figma-watercolor'], ['external']],
    ['integration-github', 'Are there GitHub resources connected to this project?', ['external:github-alfa'], ['external:figma-watercolor'], ['external']],
    ['integration-figma', 'Find the Figma context linked to Watercolor.', ['external:figma-watercolor'], ['external:github-alfa'], ['external']],
    ['integration-mixed', 'Give me an update on Alfa across Ledger, Slack and GitHub.', ['project:alfa', 'external:slack-alfa', 'external:github-alfa'], ['external:figma-watercolor'], ['projects', 'external']],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, requiredCoverage]) => ({ id: id as string, category: 'integration_context' as const, question: question as string, ...expectations({ primaryResourceKeys: primaryResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: requiredCoverage as string[] }) })),
  ...[
    ['missing-reminders', 'Show reminders for Garden Plans.', [], ['project:alfa', 'task:review-proof'], ['reminders']],
    ['missing-github', 'What happened in GitHub about the missing client project?', [], [], ['external']],
    ['conflicting-state', 'What is the current status of Alfa?', ['project:alfa', 'task:review-proof'], [], ['projects', 'tasks']],
    ['no-results', 'What is happening with the Moonbase project?', [], ['project:alfa', 'project:watercolor'], []],
  ].map(([id, question, primaryResourceKeys, forbiddenResourceKeys, requiredCoverage]) => {
    const expectation = { primaryResourceKeys: primaryResourceKeys as string[], forbiddenResourceKeys: forbiddenResourceKeys as string[], requiredCoverage: requiredCoverage as string[], expectedUnavailable: id === 'missing-github' ? ['github'] : undefined };
    return { id: id as string, category: 'missing_uncertain_evidence' as const, question: question as string, ...(id === 'missing-github' ? expectations(expectation, docs.filter((item) => item.integrationProvider !== 'github')) : expectations(expectation)) };
  }),
];

export const ASK_LEDGER_EVALUATION_CASE_COUNT = 32;
