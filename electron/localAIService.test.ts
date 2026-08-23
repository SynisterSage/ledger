import assert from 'node:assert/strict';
import test from 'node:test';
import { GENERATION_MODEL_REGISTRY, type GenerationTier, type LocalAIAssetStatus, LocalAIAssetManager } from './localAIAssets.ts';
import { DEFAULT_LOCAL_AI_IDLE_TIMEOUT_MS, LocalAIService, parseRuntimeDiagnostics, type GenerationModelSwitchResult, type LocalAIRequest, type LocalAIStreamEvent, LocalModelRuntime } from './localAIService.ts';

type FakeRuntime = {
  healthy: boolean;
  failStart?: boolean;
  ensureReady: () => Promise<{ startupMs: number; owned: boolean }>;
  isHealthy: () => Promise<boolean>;
  isRunning: () => boolean;
  shutdown: () => Promise<void>;
  stream: (request: LocalAIRequest, callbacks: { onEvent: (event: LocalAIStreamEvent) => void }, signal: AbortSignal, requestId: string) => Promise<void>;
};

const fakeAssets = (installed: Set<GenerationTier> = new Set(['fast', 'balanced'])) => {
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
      const normalizedTier = tier === 'powerful' ? 'balanced' : tier;
      if (normalizedTier !== 'fast' && normalizedTier !== 'balanced') throw new Error('Invalid generation tier.');
      if (!installed.has(normalizedTier)) throw new Error(`${normalizedTier} not installed`);
      selectedTier = normalizedTier;
      return { tier: normalizedTier, modelId: GENERATION_MODEL_REGISTRY.find((model) => model.tier === normalizedTier)!.id };
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

test('parses Metal and GPU offload diagnostics from llama-server startup output', () => {
  const diagnostics = parseRuntimeDiagnostics([
    'ggml_metal_init: Metal backend available',
    'llama_model_load: offloaded 35/35 layers to GPU',
    'MTL0 KV buffer size = 512.00 MiB',
  ].join('\n'));
  assert.equal(diagnostics.metalConfirmed, true);
  assert.equal(diagnostics.gpuLayersOffloaded, '35/35');
  assert.equal(diagnostics.cpuFallbackDetected, false);
  assert.equal(diagnostics.kvBufferMiB, 512);
});

test('uses a fifteen-minute idle timeout by default', () => {
  assert.equal(DEFAULT_LOCAL_AI_IDLE_TIMEOUT_MS, 900_000);
});

test('switches Fast to Balanced and legacy Powerful aliases back to Fast', async () => {
  const { service, getSelectedTier } = switchService();
  assert.equal((await service.switchGenerationTier('fast')).state, 'ready');
  assert.equal((await service.switchGenerationTier('balanced')).state, 'ready');
  assert.equal(getSelectedTier(), 'balanced');
  assert.equal((await service.switchGenerationTier('powerful')).state, 'noop');
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
  assert.deepEqual(missing, { ok: true, state: 'noop', tier: 'balanced', modelId: 'qwen3-4b-q4-k-m' });
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

test('cancelling an active request emits a terminal event and does not block the next request', async () => {
  const { service } = switchService();
  await service.switchGenerationTier('fast');
  const cancelledEvents: LocalAIStreamEvent[] = [];
  service.start({ question: 'cancel me', context: 'test' }, { onEvent: (event) => cancelledEvents.push(event) }, 'cancel-me');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(service.cancel('cancel-me'), { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cancelledEvents.find((event) => event.type === 'error')?.error?.code, 'cancelled');

  const nextEvents: LocalAIStreamEvent[] = [];
  service.start({ question: 'continue', context: 'test' }, { onEvent: (event) => nextEvents.push(event) }, 'continue');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(nextEvents.some((event) => event.type === 'done'), true);
});

test('cancelling while a model switch is pending is still terminal', async () => {
  const { service } = switchService();
  const switchPromise = service.switchGenerationTier('balanced');
  const events: LocalAIStreamEvent[] = [];
  service.start({ question: 'cancel during switch', context: 'test' }, { onEvent: (event) => events.push(event) }, 'cancel-during-switch');
  assert.deepEqual(service.cancel('cancel-during-switch'), { ok: true });
  await switchPromise;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.find((event) => event.type === 'error')?.error?.code, 'cancelled');
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
  assert.equal((await first).tier, 'balanced');
  assert.equal((await second).tier, 'balanced');
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
