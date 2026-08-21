import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalAIBenchmarkHarness, scoreBenchmarkOutput } from './localAIBenchmark.ts';

test('benchmark scoring separates grounding, abstention, and required structure', () => {
  const score = scoreBenchmarkOutput('Status: In progress\nBlockers: Runtime startup is blocked.', { requiredFacts: ['In progress'], forbiddenClaims: ['owner is'], requiredSections: ['Status', 'Blockers'] });
  assert.equal(score.factualCorrectness, 1);
  assert.equal(score.requiredStructure, 1);
  assert.equal(score.passed, true);
  assert.equal(scoreBenchmarkOutput('The customer renewal date is tomorrow.', { expectAbstention: true }).passed, false);
});

test('harness prepares each case once and replays the frozen prompt across installed tiers', async () => {
  const prompts: string[] = [];
  const switches: string[] = [];
  const model = (tier: string) => ({ tier, id: `${tier}-model`, version: '1', fileName: `${tier}.gguf` });
  const assets = {
    getSelectedGenerationTier: () => 'fast',
    getSelectedGenerationModel: () => model('fast'),
    getAvailableGenerationModels: () => ['fast', 'balanced'].map(model),
    getGenerationModelStatus: () => ({ installed: true, installedBytes: 100 }),
  } as any;
  const localAI = {
    switchGenerationTier: async (tier: string) => { switches.push(tier); return { ok: true, state: 'ready', tier, modelId: `${tier}-model`, startupMs: 3 }; },
    start: (_request: { context: string }, callbacks: { onEvent: (event: any) => void }) => { prompts.push(_request.context); callbacks.onEvent({ type: 'delta', text: 'grounded answer' }); callbacks.onEvent({ type: 'done', metrics: { totalMs: 4, firstTokenMs: 2, tokensPerSecond: 5 } }); return 'benchmark-request'; },
  } as any;
  let preparations = 0;
  const askLedger = { prepareBenchmarkCase: async () => { preparations += 1; return { prompt: 'frozen production prompt', estimatedTokens: 12, sources: [], contextItems: [] }; } } as any;
  const harness = new LocalAIBenchmarkHarness(askLedger, localAI, assets);
  const report = await harness.run([{ id: 'case-1', category: 'grounding', workspaceId: 'workspace', question: 'Question', documents: [], lexicalResults: [], expectation: { requiredFacts: ['grounded'] } }]);
  assert.equal(preparations, 1);
  assert.equal(report.results.filter((result) => !result.error).length, 2);
  assert.deepEqual(prompts, ['frozen production prompt', 'frozen production prompt']);
  assert.deepEqual(switches, ['fast', 'balanced', 'fast']);
});
