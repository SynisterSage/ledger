import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { GenerationTier } from './localAIAssets';

const electronModule = createRequire(import.meta.url)('electron') as { app?: { getPath(name: string): string } };
const GIB = 1024 ** 3;
export const LOCAL_AI_RECOMMENDATION_VERSION = '1';

export type DevicePlatform = 'macos' | 'windows' | 'linux' | 'unknown';
export type DeviceArchitecture = 'apple_silicon' | 'x64' | 'arm64' | 'unknown';
export type MemoryClass = 'low' | 'mid' | 'high' | 'unknown';
export type PerformanceClass = 'entry' | 'mid' | 'high' | 'unknown';
export type RecommendationConfidence = 'high' | 'medium' | 'low';

export type DeviceProbe = {
  platform: NodeJS.Platform;
  arch: string;
  totalMemoryBytes: number | null;
  availableMemoryBytes: number | null;
  logicalCores: number | null;
};

export type LocalAICapability = {
  platform: DevicePlatform;
  architecture: DeviceArchitecture;
  totalMemoryBytes: number | null;
  availableMemoryBytes: number | null;
  logicalCores: number | null;
  memoryClass: MemoryClass;
  performanceClass: PerformanceClass;
  recommendationConfidence: RecommendationConfidence;
  recommendedTier: GenerationTier;
  recommendationReason: string;
  warnings: Partial<Record<GenerationTier, string>>;
  acknowledgedTiers: GenerationTier[];
  recommendationVersion: string;
};

const isTier = (value: unknown): value is GenerationTier => value === 'fast' || value === 'balanced' || value === 'powerful';

export const normalizePlatform = (platform: NodeJS.Platform, arch: string): { platform: DevicePlatform; architecture: DeviceArchitecture } => ({
  platform: platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'unknown',
  architecture: platform === 'darwin' && arch === 'arm64' ? 'apple_silicon' : arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : 'unknown',
});

export const recommendGenerationTier = (probe: DeviceProbe): Omit<LocalAICapability, 'acknowledgedTiers'> => {
  const normalized = normalizePlatform(probe.platform, probe.arch);
  const memoryClass: MemoryClass = probe.totalMemoryBytes === null ? 'unknown' : probe.totalMemoryBytes < 12 * GIB ? 'low' : probe.totalMemoryBytes < 24 * GIB ? 'mid' : 'high';
  const recommendedTier: GenerationTier = memoryClass === 'high' ? 'powerful' : memoryClass === 'mid' ? 'balanced' : 'fast';
  const performanceClass: PerformanceClass = memoryClass === 'unknown' ? 'unknown' : memoryClass === 'high' ? 'high' : memoryClass === 'mid' ? 'mid' : 'entry';
  const recommendationConfidence: RecommendationConfidence = memoryClass === 'unknown' ? 'low' : normalized.platform === 'unknown' || normalized.architecture === 'unknown' ? 'medium' : 'high';
  const warnings: Partial<Record<GenerationTier, string>> = memoryClass === 'low'
    ? { balanced: 'May respond more slowly on this device.', powerful: 'May respond more slowly on this device.' }
    : memoryClass === 'mid'
      ? { powerful: 'May respond more slowly on this device.' }
      : {};
  return {
    ...normalized,
    totalMemoryBytes: probe.totalMemoryBytes,
    availableMemoryBytes: probe.availableMemoryBytes,
    logicalCores: probe.logicalCores,
    memoryClass,
    performanceClass,
    recommendationConfidence,
    recommendedTier,
    recommendationReason: memoryClass === 'unknown' ? 'Hardware details are incomplete; Fast is the baseline recommendation.' : `Based primarily on ${memoryClass === 'low' ? 'available system memory' : 'system memory and device architecture'}.`,
    warnings,
    recommendationVersion: LOCAL_AI_RECOMMENDATION_VERSION,
  };
};

export class LocalAICapabilityService {
  private readonly acknowledgementPath: string;
  private readonly probe: () => DeviceProbe;

  constructor(options: { rootDir?: string; probe?: () => DeviceProbe } = {}) {
    const rootDir = options.rootDir ?? path.join(electronModule.app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-ai-test-data'), 'ai');
    this.acknowledgementPath = path.join(rootDir, 'metadata', 'generation-recommendation-ack.json');
    this.probe = options.probe ?? (() => ({ platform: process.platform, arch: process.arch, totalMemoryBytes: os.totalmem(), availableMemoryBytes: os.freemem(), logicalCores: os.cpus().length || null }));
  }

  private acknowledgements(): GenerationTier[] {
    try {
      const value = JSON.parse(fs.readFileSync(this.acknowledgementPath, 'utf8')) as { version?: unknown; tiers?: unknown };
      return value.version === LOCAL_AI_RECOMMENDATION_VERSION && Array.isArray(value.tiers) ? value.tiers.filter(isTier) : [];
    } catch { return []; }
  }

  getCapability(): LocalAICapability {
    return { ...recommendGenerationTier(this.probe()), acknowledgedTiers: this.acknowledgements() };
  }

  acknowledgeTier(tier: unknown) {
    if (!isTier(tier)) throw new Error('Invalid generation tier.');
    const tiers = [...new Set([...this.acknowledgements(), tier])];
    fs.mkdirSync(path.dirname(this.acknowledgementPath), { recursive: true });
    fs.writeFileSync(this.acknowledgementPath, JSON.stringify({ version: LOCAL_AI_RECOMMENDATION_VERSION, tiers, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    return this.getCapability();
  }
}
