import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  DEFAULT_GENERATION_TIER,
  GENERATION_MODEL_REGISTRY,
  LocalAIAssetManager,
} from './localAIAssets.ts';

const withModelMetadata = async (modelId: string, content: Buffer, run: (url: string, manager: LocalAIAssetManager) => Promise<void>) => {
  const model = GENERATION_MODEL_REGISTRY.find((entry) => entry.id === modelId)!;
  const previous = { downloadUrl: model.downloadUrl, expectedSize: model.expectedSize, sha256: model.sha256 };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array(content), { status: 200, headers: { 'content-length': String(content.length) } });
  model.downloadUrl = 'https://test.invalid/model.gguf';
  model.expectedSize = content.length;
  model.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const manager = new LocalAIAssetManager();
  try { await run(model.downloadUrl, manager); }
  finally {
    model.downloadUrl = previous.downloadUrl;
    model.expectedSize = previous.expectedSize;
    model.sha256 = previous.sha256;
    globalThis.fetch = previousFetch;
  }
};

test('Fast is the default and tiers resolve to the registered Qwen models', () => {
  const assets = new LocalAIAssetManager();
  assert.equal(DEFAULT_GENERATION_TIER, 'fast');
  assert.equal(assets.getSelectedGenerationTier(), 'fast');
  assert.deepEqual(assets.generationModels().map((model) => [model.tier, model.id]), [
    ['fast', 'qwen3-1.7b-q4-k-m'],
    ['balanced', 'qwen3-4b-q4-k-m'],
    ['powerful', 'qwen3-8b-q4-k-m'],
  ]);
  assert.equal(assets.getSelectedGenerationModel().id, GENERATION_MODEL_REGISTRY[0].id);
});

test('generation model status is independent and embedding remains separate', () => {
  const assets = new LocalAIAssetManager();
  const status = assets.status();
  assert.equal(status.generationModels['qwen3-1.7b-q4-k-m'].role, 'generation');
  assert.equal(status.generationModels['qwen3-4b-q4-k-m'].role, 'generation');
  assert.equal(status.generationModels['qwen3-8b-q4-k-m'].role, 'generation');
  assert.equal(status.embedding.role, 'embedding');
  assert.notEqual(assets.getGenerationModelPath('qwen3-1.7b-q4-k-m'), assets.getGenerationModelPath('qwen3-4b-q4-k-m'));
});

test('invalid model and tier identifiers are rejected, and uninstalled selection is safe', () => {
  const assets = new LocalAIAssetManager();
  assert.throws(() => assets.getGenerationModelPath('/arbitrary/path'), /Invalid generation model/);
  assert.throws(() => assets.getGenerationModelStatus('not-a-model'), /Invalid generation model/);
  assert.throws(() => assets.setSelectedGenerationTier('not-a-tier'), /Invalid generation tier/);
  assert.throws(() => assets.setSelectedGenerationTier('balanced'), /not installed/);
  assert.equal(assets.getSelectedGenerationTier(), 'fast');
});

test('an installed Fast model can be selected and restored from local state', () => {
  const assets = new LocalAIAssetManager();
  const fastPath = assets.getGenerationModelPath('qwen3-1.7b-q4-k-m');
  const previousOverride = process.env.LEDGER_LOCAL_AI_MODEL_PATH;
  process.env.LEDGER_LOCAL_AI_MODEL_PATH = fastPath;
  fs.mkdirSync(fastPath.slice(0, fastPath.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(fastPath, 'test-model');
  try {
    assert.deepEqual(assets.setSelectedGenerationTier('fast'), { tier: 'fast', modelId: 'qwen3-1.7b-q4-k-m' });
    const restored = new LocalAIAssetManager();
    assert.equal(restored.getSelectedGenerationTier(), 'fast');
  } finally {
    fs.rmSync(fastPath, { force: true });
    if (previousOverride === undefined) delete process.env.LEDGER_LOCAL_AI_MODEL_PATH;
    else process.env.LEDGER_LOCAL_AI_MODEL_PATH = previousOverride;
  }
});

test('unverified optional metadata is unavailable and blocks download', async () => {
  const manager = new LocalAIAssetManager();
  const result = await manager.downloadGeneration('qwen3-4b-q4-k-m');
  assert.deepEqual(result, { ok: false, state: 'unavailable', modelId: 'qwen3-4b-q4-k-m', tier: 'balanced', expectedSize: undefined });
  assert.equal(manager.getGenerationModelStatus('qwen3-4b-q4-k-m').state, 'unavailable');
});

test('insufficient disk space fails before fetching an optional model', async () => {
  const model = GENERATION_MODEL_REGISTRY.find((entry) => entry.id === 'qwen3-8b-q4-k-m')!;
  const previous = { downloadUrl: model.downloadUrl, expectedSize: model.expectedSize, sha256: model.sha256 };
  const previousStatfs = fs.promises.statfs;
  model.downloadUrl = 'https://test.invalid/model.gguf'; model.expectedSize = 1024; model.sha256 = '0'.repeat(64);
  fs.promises.statfs = (async () => ({ bavail: 0, bsize: 1 })) as unknown as typeof fs.promises.statfs;
  try {
    const result = await new LocalAIAssetManager().downloadGeneration(model.id);
    assert.equal(result.ok, false);
    assert.equal((result as { status?: { generationModels?: Record<string, { errorCode?: string }> } }).status?.generationModels?.[model.id]?.errorCode, 'disk_space');
  } finally {
    fs.promises.statfs = previousStatfs;
    model.downloadUrl = previous.downloadUrl; model.expectedSize = previous.expectedSize; model.sha256 = previous.sha256;
  }
});

test('verified optional model downloads atomically and does not select itself', async () => {
  const content = Buffer.from('verified-balanced-model');
  await withModelMetadata('qwen3-4b-q4-k-m', content, async (_url, manager) => {
    const result = await manager.downloadGeneration('qwen3-4b-q4-k-m');
    assert.equal(result.ok, true);
    assert.equal(manager.getGenerationModelStatus('qwen3-4b-q4-k-m').state, 'installed');
    assert.equal(manager.getSelectedGenerationTier(), 'fast');
    await manager.removeGeneration('qwen3-4b-q4-k-m');
  });
  await withModelMetadata('qwen3-8b-q4-k-m', Buffer.from('verified-powerful-model'), async (_url, manager) => {
    const result = await manager.downloadGeneration('qwen3-8b-q4-k-m');
    assert.equal(result.ok, true);
    assert.equal(manager.getGenerationModelStatus('qwen3-8b-q4-k-m').state, 'installed');
    await manager.removeGeneration('qwen3-8b-q4-k-m');
  });
});

test('size and checksum mismatches fail closed and clean partial artifacts', async () => {
  const content = Buffer.from('bad-model');
  await withModelMetadata('qwen3-4b-q4-k-m', content, async (_url, manager) => {
    const model = GENERATION_MODEL_REGISTRY.find((entry) => entry.id === 'qwen3-4b-q4-k-m')!;
    model.expectedSize = content.length + 1;
    const sizeFailure = await manager.downloadGeneration(model.id);
    assert.equal(sizeFailure.ok, false);
    assert.equal(manager.getGenerationModelStatus(model.id).state, 'failed');
    model.expectedSize = content.length;
    model.sha256 = '0'.repeat(64);
    const checksumFailure = await manager.downloadGeneration(model.id);
    assert.equal(checksumFailure.ok, false);
    assert.equal(manager.getGenerationModelStatus(model.id).installed, false);
    assert.equal(fs.existsSync(manager.getGenerationModelPath(model.id) + `.${process.pid}.part`), false);
  });
});

test('cancelled download cleans its temporary artifact', async () => {
  const content = Buffer.alloc(1024 * 1024, 7);
  const model = GENERATION_MODEL_REGISTRY.find((entry) => entry.id === 'qwen3-4b-q4-k-m')!;
  const previous = { downloadUrl: model.downloadUrl, expectedSize: model.expectedSize, sha256: model.sha256 };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setTimeout(() => { controller.enqueue(content); controller.close(); }, 100);
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); controller.error(new DOMException('Aborted', 'AbortError')); }, { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-length': String(content.length) } });
  };
  model.downloadUrl = 'https://test.invalid/model.gguf'; model.expectedSize = content.length; model.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const manager = new LocalAIAssetManager();
  try {
    const pending = manager.downloadGeneration(model.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    manager.cancelGenerationDownload(model.id);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(manager.getGenerationModelStatus(model.id).state, 'not_installed');
    assert.equal(fs.existsSync(manager.getGenerationModelPath(model.id) + `.${process.pid}.part`), false);
  } finally {
    model.downloadUrl = previous.downloadUrl; model.expectedSize = previous.expectedSize; model.sha256 = previous.sha256;
    globalThis.fetch = previousFetch;
  }
});
