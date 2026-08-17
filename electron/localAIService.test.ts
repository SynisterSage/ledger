import assert from 'node:assert/strict';
import test from 'node:test';
import { GENERATION_MODEL_REGISTRY, type GenerationTier, type LocalAIAssetStatus, LocalAIAssetManager } from './localAIAssets.ts';
import { LocalAIService, type GenerationModelSwitchResult, type LocalAIRequest, type LocalAIStreamEvent, LocalModelRuntime } from './localAIService.ts';

type FakeRuntime = {
  healthy: boolean;
  failStart?: boolean;
  ensureReady: () => Promise<{ startupMs: number; owned: boolean }>;
  isHealthy: () => Promise<boolean>;
  isRunning: () => boolean;
  shutdown: () => Promise<void>;
  stream: (request: LocalAIRequest, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, signal: AbortSignal, requestId: string) => Promise<void>;
};

const fakeAssets = (installed: Set<GenerationTier> = new Set(['fast', 'balanced', 'powerful'])) => {
  let selectedTier: GenerationTier = 'fast';
  const embedding = { id: 'ledger-embedding', role: 'embedding', installed: true } as LocalAIAssetStatus;
  const assets = {
    getAvailableGenerationModels: () => [...GENERATION_MODEL_REGISTRY],
    generationModel: (modelId: string) => GENERATION_MODEL_REGISTRY.find((model) => model.id === modelId),
    getSelectedGenerationModel: () => GENERATION_MODEL_REGISTRY.find((model) => model.tier === selectedTier)!,
    getSelectedGenerationTier: () => selectedTier,
    getGenerationModelStatus: (modelId: string) => {
      const model = GENERATION_MODEL_REGISTRY.find((entry) => entry.id === modelId)!;
      return { ...model, installed: installed.has(model.tier), downloading: false, verifying: false, bytesDownloaded: 0, error: null } as LocalAIAssetStatus;
    },
    setSelectedGenerationTier: (tier: unknown) => {
      if (tier !== 'fast' && tier !== 'balanced' && tier !== 'powerful') throw new Error('Invalid generation tier.');
      if (!installed.has(tier)) throw new Error(`${tier} not installed`);
      selectedTier = tier;
      return { tier, modelId: GENERATION_MODEL_REGISTRY.find((model) => model.tier === tier)!.id };
    },
    getGenerationModelPath: (modelId: string) => `/managed/${modelId}.gguf`,
    removeGeneration: async (modelId: string) => ({ generationModelRemoved: modelId }),
  } as unknown as LocalAIAssetManager;
  return { assets, getSelectedTier: () => selectedTier, embedding };
};

const runtimeFactoryFor = (runtimes: FakeRuntime[], failures = new Set<string>()) => (modelId: string) => {
  const runtime: FakeRuntime = {
    healthy: false,
    failStart: failures.has(modelId),
    ensureReady: async () => {
      if (runtime.failStart) throw new Error(`failed to start ${modelId}`);
      runtime.healthy = true;
      return { startupMs: 3, owned: true };
    },
    isHealthy: async () => runtime.healthy,
    isRunning: () => runtime.healthy,
    shutdown: async () => { runtime.healthy = false; },
    stream: async (_request, callbacks, signal, requestId) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
      });
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 1 } });
    },
  };
  runtimes.push(runtime);
  return runtime as unknown as LocalModelRuntime;
};

const switchService = (installed?: Set<GenerationTier>, failures?: Set<string>) => {
  const fixture = fakeAssets(installed);
  const runtimes: FakeRuntime[] = [];
  const service = new LocalAIService(fixture.assets, runtimeFactoryFor(runtimes, failures));
  return { ...fixture, service, runtimes };
};

test('switches Fast to Balanced to Powerful and back to Fast', async () => {
  const { service, getSelectedTier } = switchService();
  assert.equal((await service.switchGenerationTier('fast')).state, 'ready');
  assert.equal((await service.switchGenerationTier('balanced')).state, 'ready');
  assert.equal(getSelectedTier(), 'balanced');
  assert.equal((await service.switchGenerationTier('powerful')).state, 'ready');
  assert.equal((await service.switchGenerationTier('fast')).state, 'ready');
  assert.equal(getSelectedTier(), 'fast');
});

test('same-tier request is a healthy no-op', async () => {
  const { service } = switchService();
  await service.switchGenerationTier('fast');
  assert.equal((await service.switchGenerationTier('fast')).state, 'noop');
});

test('cold runtime starts the selected installed tier directly and uninstalled targets require download', async () => {
  const { service, runtimes } = switchService(new Set(['fast', 'balanced']));
  const result = await service.switchGenerationTier('balanced');
  assert.equal(result.state, 'ready');
  assert.equal(runtimes.length, 2); // constructor creates Fast; switch starts Balanced without starting Fast
  const missing = await service.switchGenerationTier('powerful');
  assert.deepEqual(missing, { ok: false, state: 'requires_download', tier: 'powerful', modelId: 'qwen3-8b-q4-k-m', expectedSize: undefined });
});

test('active generation is cancelled before the runtime is switched', async () => {
  const { service, runtimes } = switchService();
  await service.switchGenerationTier('fast');
  const events: LocalAIStreamEvent[] = [];
  service.start({ question: 'test', context: 'test' }, { onEvent: (event) => events.push(event) }, 'active-request');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await service.switchGenerationTier('balanced')).state, 'ready');
  assert.equal(runtimes[0]?.healthy, false);
  assert.equal(events.some((event) => event.type === 'error'), true);
});

test('generation requested during a switch waits without deadlocking', async () => {
  const { service } = switchService();
  const switchPromise = service.switchGenerationTier('balanced');
  const events: LocalAIStreamEvent[] = [];
  service.start({ question: 'during switch', context: 'test' }, { onEvent: (event) => events.push(event) }, 'during-switch');
  assert.equal((await switchPromise).state, 'ready');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(events.some((event) => event.type === 'done'), true);
});

test('selected tier survives idle shutdown and restarts the same model', async () => {
  const { service, getSelectedTier, runtimes } = switchService();
  await service.switchGenerationTier('balanced');
  await runtimes.at(-1)!.shutdown();
  assert.equal(getSelectedTier(), 'balanced');
  assert.equal(service.getGenerationRuntimeState().ready, false);
  assert.equal((await service.switchGenerationTier('balanced')).state, 'ready');
  assert.equal(getSelectedTier(), 'balanced');
});

test('failed target startup does not persist a fake ready state and recovers the prior runtime', async () => {
  const { service, getSelectedTier, runtimes } = switchService(undefined, new Set(['qwen3-4b-q4-k-m']));
  await service.switchGenerationTier('fast');
  const result = await service.switchGenerationTier('balanced');
  assert.equal(result.state, 'failed');
  assert.equal(getSelectedTier(), 'fast');
  assert.equal(service.getGenerationRuntimeState().loadedTier, 'fast');
  assert.equal(service.getGenerationRuntimeState().ready, true);
  assert.equal(runtimes.length, 4); // initial Fast, first Fast, failed Balanced, recovered Fast
});

test('only one switch operation runs at a time and invalid tiers are rejected', async () => {
  const { service } = switchService();
  const first = service.switchGenerationTier('balanced');
  const second = service.switchGenerationTier('powerful');
  assert.equal(first, second);
  assert.equal((await first).tier, 'balanced');
  await assert.rejects(service.switchGenerationTier('invalid'), /Invalid generation tier/);
});

test('switching generation does not invoke embedding management', async () => {
  const fixture = switchService();
  let embeddingTouched = false;
  const original = fixture.assets.getGenerationModelStatus;
  fixture.assets.getGenerationModelStatus = ((modelId: string) => original(modelId)) as typeof original;
  const result: GenerationModelSwitchResult = await fixture.service.switchGenerationTier('balanced');
  assert.equal(result.ok, true);
  assert.equal(embeddingTouched, false);
  assert.equal(fixture.embedding.installed, true);
});

test('removing the active optional model switches to Fast before removal', async () => {
  const fixture = switchService();
  await fixture.service.switchGenerationTier('balanced');
  const result = await fixture.service.removeGenerationModel('qwen3-4b-q4-k-m');
  assert.equal(result.ok, true);
  assert.equal(fixture.getSelectedTier(), 'fast');
  assert.deepEqual((result as { status: unknown }).status, { generationModelRemoved: 'qwen3-4b-q4-k-m' });
});
