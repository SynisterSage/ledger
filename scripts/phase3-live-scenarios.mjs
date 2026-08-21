import { randomUUID } from 'node:crypto';
import { createAskLedgerService } from '../electron/askLedgerService.ts';
import { LocalAIAssetManager } from '../electron/localAIAssets.ts';
import { createLocalAIService } from '../electron/localAIService.ts';
import { getAskLedgerSkill } from '../electron/askLedgerSkills.ts';

const workspaceId = 'phase3-live-workspace';
const documents = [
  { workspaceId, resourceType: 'project', resourceId: 'project-1', title: 'Ledger release', content: 'The Ledger release is In progress and 40% complete. The next priority is measuring local AI latency.', status: 'In progress', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-1', title: 'Measure runtime startup', content: 'Measure runtime startup and confirm Metal offload.', status: 'Blocked', dueAt: '2026-08-22T12:00:00Z', projectId: 'project-1', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-2', title: 'Run grounded scenarios', content: 'Run simple, grounded, research, and cancellation scenarios.', status: 'Not started', dueAt: '2026-08-23T12:00:00Z', projectId: 'project-1', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'event', resourceId: 'event-1', title: 'Release review', content: 'Review the release measurements and decide next actions.', startAt: '2026-08-21T15:00:00Z', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'note-1', title: 'Latency notes', content: 'Balanced uses Ministral 3B Q8. Powerful is reserved for complex reasoning.', updatedAt: '2026-08-20T12:00:00Z' },
];
const lexicalResults = documents.map((item) => ({ type: item.resourceType, id: item.resourceId, title: item.title, match_source: 'phase3-fixture' }));
const cases = [
  { name: 'normal-grounded', workspaceId, question: 'What is the current status of the Ledger release?', documents, lexicalResults },
  { name: 'plan-my-week', workspaceId, question: 'Plan my week.', documents, lexicalResults, skillId: 'plan_my_week', skillDefinition: getAskLedgerSkill('plan_my_week') },
];

const assets = new LocalAIAssetManager();
const localAI = createLocalAIService(assets);
const askLedger = createAskLedgerService(localAI, assets);
await localAI.switchGenerationTier('balanced');

const runCase = (request, cancelAfterMs) => new Promise((resolve) => {
  const requestId = randomUUID();
  const events = [];
  let cancelled = false;
  const timer = cancelAfterMs ? setTimeout(() => { cancelled = askLedger.cancel(requestId); console.log(JSON.stringify({ scenario: 'cancel-requested', requestId, cancelResult: cancelled, atMs: cancelAfterMs })); }, cancelAfterMs) : undefined;
  askLedger.start({ ...request, requestId, messageId: requestId }, { onEvent: (event) => {
    events.push(event);
    if (event.type === 'done' || event.type === 'error') {
      if (timer) clearTimeout(timer);
      resolve({ requestId, cancelled, eventTypes: events.map((entry) => entry.type), done: event.type === 'done' ? event : undefined, error: event.type === 'error' ? event.error : undefined });
    }
  }});
});

const scenarioCases = process.argv.includes('--normal-only') ? [cases[0]] : process.argv.includes('--cancel-only') ? [] : cases;
for (const request of scenarioCases) {
  const result = await runCase(request);
  console.log(JSON.stringify({ scenario: request.name, ...result }));
}
if (!process.argv.includes('--normal-only')) {
  const cancelled = await runCase({ ...cases[1], question: 'Give me a detailed plan for every task, event, and risk this week.' }, 5000);
  console.log(JSON.stringify({ scenario: 'cancel-during-generation', ...cancelled }));
}
await askLedger.shutdown();
