import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LocalAICapabilityService,
  normalizePlatform,
  recommendGenerationTier,
} from './localAICapabilityService.ts';

const probe = (totalMemoryBytes: number | null, platform: NodeJS.Platform = 'darwin', arch = 'arm64') => ({
  platform, arch, totalMemoryBytes, availableMemoryBytes: totalMemoryBytes, logicalCores: 8,
});

test('conservative capability rules recommend Fast on low memory and Balanced otherwise', () => {
  assert.equal(recommendGenerationTier(probe(8 * 1024 ** 3)).recommendedTier, 'fast');
  assert.equal(recommendGenerationTier(probe(16 * 1024 ** 3)).recommendedTier, 'balanced');
  assert.equal(recommendGenerationTier(probe(32 * 1024 ** 3)).recommendedTier, 'balanced');
});

test('unknown hardware falls back to Fast without confident warnings', () => {
  const capability = recommendGenerationTier(probe(null, 'freebsd', 'mips'));
  assert.equal(capability.recommendedTier, 'fast');
  assert.equal(capability.memoryClass, 'unknown');
  assert.equal(capability.recommendationConfidence, 'low');
  assert.deepEqual(capability.warnings, {});
});

test('macOS Apple Silicon and Windows x64 normalize to the shared contract', () => {
  assert.deepEqual(normalizePlatform('darwin', 'arm64'), { platform: 'macos', architecture: 'apple_silicon' });
  assert.deepEqual(normalizePlatform('win32', 'x64'), { platform: 'windows', architecture: 'x64' });
});

test('tier acknowledgement persists locally and rejects invalid renderer input', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-ai-capability-'));
  try {
    const service = new LocalAICapabilityService({ rootDir, probe: () => probe(16 * 1024 ** 3, 'win32', 'x64') });
    assert.deepEqual(service.getCapability().acknowledgedTiers, []);
    assert.throws(() => service.acknowledgeTier('/arbitrary/path'), /Invalid generation tier/);
    assert.deepEqual(service.acknowledgeTier('balanced').acknowledgedTiers, ['balanced']);
    const restored = new LocalAICapabilityService({ rootDir, probe: () => probe(16 * 1024 ** 3, 'win32', 'x64') });
    assert.deepEqual(restored.getCapability().acknowledgedTiers, ['balanced']);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
