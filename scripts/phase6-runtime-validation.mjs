import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { scoreBenchmarkOutput } from '../electron/localAIBenchmark.ts';
import { getAskLedgerSkill } from '../electron/askLedgerSkills.ts';
import { createAskLedgerService } from '../electron/askLedgerService.ts';
import { LocalAIAssetManager } from '../electron/localAIAssets.ts';
import { createLocalAIService } from '../electron/localAIService.ts';
import { AskLedgerPerformanceTrace } from '../electron/askLedgerPerformance.ts';

const workspaceId = 'phase6-runtime-validation';
const documents = [
  { workspaceId, resourceType: 'project', resourceId: 'project-release', title: 'Ledger release', content: 'The Ledger release is In progress and 40% complete. The next priority is validating local AI performance.', status: 'In progress', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-runtime', title: 'Validate runtime configuration', content: 'Compare the current 8K four-slot runtime with the 4K single-slot candidate on the same workloads.', status: 'In progress', dueAt: '2026-08-22T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-memory', title: 'Measure memory pressure', content: 'Check unified memory, swap, and whether embedding and generation runtimes can remain resident safely.', status: 'Not started', dueAt: '2026-08-23T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-quality', title: 'Compare answer quality', content: 'Verify grounding, completeness, contradiction handling, and truncation under both runtime configurations.', status: 'Not started', dueAt: '2026-08-24T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'event', resourceId: 'event-review', title: 'Runtime review', content: 'Review A/B timings and decide the safe 8 GB production configuration.', startAt: '2026-08-21T15:00:00Z', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'note-baseline', title: 'Phase 4 baseline', content: 'Normal grounded visible time was about 7.9 seconds and total time about 28.9 seconds. Plan my week visible time was about 6.3 seconds and total time about 50.8 seconds.', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'milestone', resourceId: 'milestone-config', title: 'Choose 8 GB runtime', content: 'Select current, candidate, or hybrid context sizing after repeated performance and memory measurements.', status: 'Not started', dueAt: '2026-08-25T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
];
const fixtureFor = (types) => {
  const selected = documents.filter((item) => types.includes(item.resourceType));
  return { workspaceId, documents: selected, lexicalResults: selected.map((item) => ({ type: item.resourceType, id: item.resourceId, title: item.title, match_source: 'phase6-fixture' })) };
};
const cases = [
  { id: 'normal-grounded', category: 'normal-grounded', question: 'What is the current status of the Ledger release?', ...fixtureFor(['project']), expectation: { requiredFacts: ['In progress', '40%'] } },
  { id: 'short-grounded', category: 'short-grounded', question: 'What is blocked?', ...fixtureFor(['task']), expectation: { requiredFacts: ['runtime configuration'] } },
  { id: 'plan-my-week', category: 'skill', question: 'Plan my week.', ...fixtureFor(['task', 'milestone', 'event']), skillId: 'plan_my_week', skillDefinition: getAskLedgerSkill('plan_my_week'), expectation: { requiredFacts: ['runtime', 'memory'] } },
  { id: 'multi-resource', category: 'multi-resource', question: 'Assess the release across its project, tasks, milestone, event, and notes. What matters next?', ...fixtureFor(['project', 'task', 'milestone', 'event', 'note']), expectation: { requiredFacts: ['release', 'next'] } },
];

const allConfigurations = [
  { id: 'A-current-8k-4slot', contextSize: 8192, runtimeArgs: ['--n-gpu-layers', 'all', '--no-mmproj', '--reasoning', 'off'] },
  { id: 'B-candidate-4k-1slot', contextSize: 4096, runtimeArgs: ['--n-gpu-layers', 'all', '--no-mmproj', '--reasoning', 'off', '--parallel', '1'] },
];
const configurations = process.env.LEDGER_PHASE6_CONFIG
  ? allConfigurations.filter((configuration) => configuration.id.startsWith(process.env.LEDGER_PHASE6_CONFIG))
  : allConfigurations;
const repeats = Number(process.env.LEDGER_PHASE6_REPEATS || 2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const estimateTokens = (value) => Math.ceil(String(value ?? '').length / 4);

const memorySample = () => {
  let pressure = null;
  let swap = null;
  try {
    const value = execFileSync('memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    pressure = value.match(/free percentage:\s*(\d+)%/i)?.[1] ? Number(value.match(/free percentage:\s*(\d+)%/i)[1]) : null;
  } catch {}
  try {
    const value = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8', timeout: 2000 }).trim();
    swap = { raw: value, usedMiB: value.match(/used\s*=\s*([\d.]+)M/i)?.[1] ? Number(value.match(/used\s*=\s*([\d.]+)M/i)[1]) : null };
  } catch {}
  let runtimeRssMiB = null;
  try {
    const value = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8', timeout: 2000 });
    const matches = value.split('\n').filter((line) => /llama-server.*(?:39281|39282)/.test(line)).map((line) => Number(line.trim().split(/\s+/, 1)[0])).filter(Number.isFinite);
    if (matches.length) runtimeRssMiB = matches.reduce((sum, rss) => sum + rss, 0) / 1024;
  } catch {}
  return { systemFreePercent: pressure, swap, processRssMiB: process.memoryUsage().rss / 1024 / 1024, runtimeRssMiB };
};

const waitForCompletion = (events) => new Promise((resolve) => {
  const finish = () => events.some((event) => event.type === 'done' || event.type === 'error');
  if (finish()) return resolve();
  const timer = setInterval(() => { if (finish()) { clearInterval(timer); resolve(); } }, 20);
});

const runPrompt = async (localAI, prepared, benchmarkCase, configId, run) => {
  const trace = new AskLedgerPerformanceTrace({ requestId: randomUUID(), route: 'phase6_validation', requestedTier: 'balanced', loadedTier: 'balanced', modelId: 'ministral-3b-q8' });
  const events = [];
  const samples = [memorySample()];
  const sampler = setInterval(() => samples.push(memorySample()), 1000);
  const started = performance.now();
  const requestId = localAI.start({ question: benchmarkCase.question, context: prepared.prompt, generationBudget: benchmarkCase.skillId ? 512 : 384, reasoningSignals: { hasSkill: Boolean(benchmarkCase.skillId), answerDepth: benchmarkCase.skillId ? 'detailed' : 'standard', generationDepth: benchmarkCase.skillId ? 'deep' : 'standard' }, performance: trace }, { onEvent: (event) => events.push(event) }, randomUUID());
  await waitForCompletion(events);
  clearInterval(sampler);
  samples.push(memorySample());
  const done = events.find((event) => event.type === 'done');
  const error = events.find((event) => event.type === 'error');
  const output = events.filter((event) => event.type === 'delta').map((event) => event.text ?? '').join('').trim();
  const performanceSnapshot = done?.metrics?.performance ?? trace.snapshot();
  const actualPromptTokens = numberOrNull(performanceSnapshot.promptTokens);
  const generationBudget = numberOrNull(performanceSnapshot.generationBudget) ?? (benchmarkCase.skillId ? 512 : 384);
  const conversationTokens = estimateTokens((benchmarkCase.conversation?.previousQuestion ?? '') + (benchmarkCase.conversation?.previousAnswer ?? ''));
  const evidenceTokens = prepared.estimatedTokens;
  const questionTokens = estimateTokens(benchmarkCase.question);
  const systemTokens = actualPromptTokens === null ? Math.max(0, estimateTokens(prepared.prompt) - evidenceTokens - questionTokens - conversationTokens) : Math.max(0, actualPromptTokens - evidenceTokens - questionTokens - conversationTokens);
  const score = error ? null : scoreBenchmarkOutput(output, benchmarkCase.expectation);
  return { configId, caseId: benchmarkCase.id, run, requestId, error: error?.error, score, prompt: { systemTokens, questionTokens, evidenceTokens, conversationTokens, totalPromptTokens: actualPromptTokens ?? estimateTokens(prepared.prompt), generationBudget, remainingContextHeadroom: actualPromptTokens === null ? null : configurationContextSize(configId) - actualPromptTokens - generationBudget }, metrics: { ...done?.metrics, performance: performanceSnapshot, totalMs: performance.now() - started }, memory: { initial: samples[0], peakProcessRssMiB: Math.max(...samples.map((sample) => sample.processRssMiB)), peakRuntimeRssMiB: Math.max(...samples.map((sample) => sample.runtimeRssMiB ?? 0)) || null, minimumSystemFreePercent: Math.min(...samples.map((sample) => sample.systemFreePercent ?? 100)), maximumSwapUsedMiB: Math.max(...samples.map((sample) => sample.swap?.usedMiB ?? 0)) }, outputLength: output.length, output };
};

const configurationContextSize = (configId) => configurations.find((configuration) => configuration.id === configId)?.contextSize ?? 0;

const assets = new LocalAIAssetManager();
const prepAI = createLocalAIService(assets, { contextSize: 4096, runtimeArgs: allConfigurations[1].runtimeArgs });
const prepLedger = createAskLedgerService(prepAI, assets);
const prepared = new Map();
for (const benchmarkCase of cases) {
  const frozen = await prepLedger.prepareBenchmarkCase(benchmarkCase);
  if (process.env.LEDGER_PHASE6_DEBUG === '1') console.error('phase6 prepared', benchmarkCase.id, benchmarkCase.documents?.length, frozen.estimatedTokens, frozen.contextItems.length);
  prepared.set(benchmarkCase.id, frozen);
}
if (process.env.LEDGER_PHASE6_DEBUG === '1') {
  const probe = await prepLedger.prepareBenchmarkCase({ workspaceId, question: 'What is the current status of the Ledger release?', documents: [{ workspaceId, resourceType: 'project', resourceId: 'probe', title: 'Ledger release', content: 'The Ledger release is In progress and 40% complete.', status: 'In progress', updatedAt: '2026-08-20T12:00:00Z' }], lexicalResults: [{ type: 'project', id: 'probe', title: 'Ledger release' }] });
  console.error('phase6 probe', probe.estimatedTokens, probe.contextItems.length);
}
await prepAI.shutdown();

const results = [];
for (const configuration of configurations) {
  const localAI = createLocalAIService(assets, configuration);
  const switchResult = await localAI.switchGenerationTier('balanced');
  if (!switchResult.ok) throw new Error(`Could not start ${configuration.id}: ${switchResult.state}`);
  for (const benchmarkCase of cases) {
    for (let run = 1; run <= repeats; run += 1) {
      results.push(await runPrompt(localAI, prepared.get(benchmarkCase.id), benchmarkCase, configuration.id, run));
      await sleep(300);
    }
  }
  await localAI.shutdown();
}

const summary = configurations.map((configuration) => {
  const entries = results.filter((result) => result.configId === configuration.id && !result.error);
  const metric = (key) => average(entries.map((entry) => numberOrNull(entry.metrics?.performance?.[key] ?? entry.metrics?.[key])).filter((value) => value !== null));
  return { configId: configuration.id, runs: entries.length, averageTTFTMs: metric('firstTokenMs'), averageVisibleTTFTMs: metric('firstForwardedDeltaMs'), averagePromptEvalMs: metric('promptEvalMs'), averagePromptTokensPerSecond: metric('promptTokensPerSecond'), averageGenerationMs: metric('generationMs'), averageTokensPerSecond: metric('tokensPerSecond'), averageTotalMs: metric('totalMs'), minimumSystemFreePercent: Math.min(...entries.map((entry) => entry.memory.minimumSystemFreePercent)), maximumSwapUsedMiB: Math.max(...entries.map((entry) => entry.memory.maximumSwapUsedMiB)), scorePassRate: entries.length ? entries.filter((entry) => entry.score?.passed === true).length / entries.length : null };
});
console.log(JSON.stringify({ phase: 6, repeats, configurations, cases: cases.map((item) => ({ id: item.id, category: item.category, estimatedPromptTokens: prepared.get(item.id)?.estimatedTokens ?? null, sources: prepared.get(item.id)?.sources ?? [], contextItems: prepared.get(item.id)?.contextItems?.map((contextItem) => `${contextItem.resourceType}:${contextItem.resourceId}`) ?? [], prompt: process.env.LEDGER_PHASE6_INCLUDE_PROMPTS === '1' ? prepared.get(item.id)?.prompt : undefined })), results, summary }, null, 2));
