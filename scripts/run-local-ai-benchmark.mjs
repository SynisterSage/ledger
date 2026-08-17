import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAskLedgerService } from '../electron/askLedgerService.ts';
import { LocalAIBenchmarkHarness } from '../electron/localAIBenchmark.ts';
import { LocalAIAssetManager } from '../electron/localAIAssets.ts';
import { createLocalAIService } from '../electron/localAIService.ts';
import { getAskLedgerSkill } from '../electron/askLedgerSkills.ts';

const workspaceId = 'benchmark-workspace';
const project = { workspaceId, resourceType: 'project', resourceId: 'project-ledger', title: 'Ledger model tiers', content: 'The tier validation project is 40% complete. Current priority is comparing grounded quality before release.', status: 'In progress', projectId: 'project-ledger', projectName: 'Ledger model tiers', updatedAt: '2026-08-15T12:00:00Z' };
const blockedTask = { workspaceId, resourceType: 'task', resourceId: 'task-runtime', title: 'Measure runtime startup', content: 'Blocked while the pinned runtime build is being prepared.', status: 'Blocked', projectId: 'project-ledger', projectName: 'Ledger model tiers', dueAt: '2026-08-22T12:00:00Z', updatedAt: '2026-08-15T12:00:00Z' };
const currentNote = { workspaceId, resourceType: 'note', resourceId: 'note-current', title: 'Current benchmark notes', content: 'Balanced is installed for testing. Powerful has not been approved for production and should not be described as ready.', projectId: 'project-ledger', projectName: 'Ledger model tiers', updatedAt: '2026-08-16T12:00:00Z' };
const staleNote = { workspaceId, resourceType: 'note', resourceId: 'note-stale', title: 'Older benchmark notes', content: 'Powerful looked promising in an early local experiment.', projectId: 'project-ledger', projectName: 'Ledger model tiers', updatedAt: '2026-07-01T12:00:00Z' };
const attachment = { workspaceId, resourceType: 'attachment', resourceId: 'attachment-brief', title: 'Model validation brief.pdf', content: 'The brief requires measuring factuality, abstention, time to first token, and memory impact.', attachmentSource: { attachmentId: 'attachment-brief', fileName: 'model-validation-brief.pdf', pageNumber: 2 }, updatedAt: '2026-08-16T10:00:00Z' };
const documents = [project, blockedTask, currentNote, staleNote, attachment];
const lexical = documents.map((item) => ({ type: item.resourceType, id: item.resourceId, title: item.title, match_source: 'benchmark-fixture' }));
const projectContext = { resourceType: 'project', resourceId: project.resourceId, title: project.title };
const noteContext = { resourceType: 'note', resourceId: currentNote.resourceId, title: currentNote.title };

const customSkill = { id: 'custom_release_readiness', name: 'Release readiness review', description: 'Review release readiness from the supplied evidence.', icon: 'ListChecks', instructions: 'Separate confirmed evidence, open risks, and next actions. Cite only supplied facts. Do not invent owners or dates. End with a short recommendation.', supportedContextTypes: ['project'], allowedContextTypes: ['project', 'task', 'note', 'attachment'], allowedActions: [], requiresContext: true, requiresConfirmation: false, outputSections: ['Confirmed evidence', 'Open risks', 'Next actions', 'Recommendation'] };
const cases = [
  { id: 'simple-status', category: 'simple_grounded_qa', workspaceId, question: 'What is the status of the tier validation project?', documents, lexicalResults: lexical, expectation: { requiredFacts: ['40% complete', 'In progress'], forbiddenClaims: ['approved for production'] } },
  { id: 'cross-resource-synthesis', category: 'cross_resource_synthesis', workspaceId, question: 'What is blocking this project and what should happen next?', documents, lexicalResults: lexical, explicitContext: projectContext, expectation: { requiredFacts: ['runtime', 'Blocked'], forbiddenClaims: ['owner is'] } },
  { id: 'stale-context', category: 'conflicting_stale_context', workspaceId, question: 'What is the current position on Powerful?', documents, lexicalResults: lexical, explicitContext: projectContext, expectation: { requiredFacts: ['not been approved', 'current'], forbiddenClaims: ['ready for production'] } },
  { id: 'abstention', category: 'abstention', workspaceId, question: 'What was the customer renewal date?', documents, lexicalResults: [], expectation: { expectAbstention: true } },
  { id: 'follow-up', category: 'follow_up', workspaceId, question: 'Which task should happen first?', documents, lexicalResults: lexical, conversation: { previousQuestion: 'What is blocking this project?', previousAnswer: 'Runtime startup measurement is blocked.', previousSources: [{ resourceType: 'task', resourceId: blockedTask.resourceId, title: blockedTask.title }] }, expectation: { requiredFacts: ['runtime'] } },
  { id: 'meeting-follow-up', category: 'skill', workspaceId, question: 'Prepare a follow-up from this project review.', documents, lexicalResults: lexical, skillId: 'meeting_follow_up', skillDefinition: getAskLedgerSkill('meeting_follow_up'), explicitContext: { resourceType: 'event', resourceId: 'event-review', title: 'Tier review meeting' }, expectation: { requiredSections: ['Action items', 'Follow-ups'] } },
  { id: 'project-health', category: 'skill', workspaceId, question: 'Check this project.', documents, lexicalResults: lexical, skillId: 'project_health_check', skillDefinition: getAskLedgerSkill('project_health_check'), explicitContext: projectContext, expectation: { requiredSections: ['Status', 'Blockers', 'Next steps'] } },
  { id: 'plan-week', category: 'skill', workspaceId, question: 'Plan my week.', documents, lexicalResults: lexical, skillId: 'plan_my_week', skillDefinition: getAskLedgerSkill('plan_my_week'), expectation: { requiredSections: ['Focus this week', 'Deadlines and commitments'] } },
  { id: 'turn-notes-into-tasks', category: 'skill', workspaceId, question: 'Turn this note into tasks.', documents, lexicalResults: lexical, skillId: 'turn_notes_into_tasks', skillDefinition: getAskLedgerSkill('turn_notes_into_tasks'), explicitContext: noteContext, expectation: { requiredSections: ['Action items'] } },
  { id: 'prepare-meeting', category: 'skill', workspaceId, question: 'Prepare me for this meeting.', documents, lexicalResults: lexical, skillId: 'prepare_for_meeting', skillDefinition: getAskLedgerSkill('prepare_for_meeting'), explicitContext: { resourceType: 'event', resourceId: 'event-review', title: 'Tier review meeting' }, expectation: { requiredSections: ['Discussion points'] } },
  { id: 'custom-skill', category: 'custom_skill', workspaceId, question: 'Review release readiness.', documents, lexicalResults: lexical, skillDefinition: customSkill, explicitContext: projectContext, expectation: { requiredSections: ['Confirmed evidence', 'Open risks', 'Next actions', 'Recommendation'] } },
  { id: 'attachment-synthesis', category: 'attachment', workspaceId, question: 'What does the validation brief require, and how does it relate to this project?', documents, lexicalResults: lexical, explicitContext: projectContext, expectation: { requiredFacts: ['factuality', 'time to first token'] } },
];

const outputPath = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'artifacts', 'local-ai-benchmark', 'report.json');
const assets = new LocalAIAssetManager();
const localAI = createLocalAIService(assets);
const askLedger = createAskLedgerService(localAI, assets);
const harness = new LocalAIBenchmarkHarness(askLedger, localAI, assets);

try {
  const report = await harness.run(cases);
  await harness.writeReport(report, outputPath);
  console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await askLedger.shutdown().catch(() => undefined);
}

