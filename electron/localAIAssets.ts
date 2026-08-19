import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// `electron` resolves to a harmless executable path when these model-layer
// tests run under plain Node. Keep the asset contract testable without a
// running Electron process while using app paths in the real main process.
const electronModule = createRequire(import.meta.url)('electron') as { app?: { getPath(name: string): string; isPackaged?: boolean } };
const appDataPath = () => electronModule.app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-ai-test-data');
const isPackaged = () => Boolean(electronModule.app?.isPackaged);
const resourcesPath = () => process.resourcesPath;

export type LocalAIAssetRole = 'generation' | 'embedding';
export type GenerationTier = 'fast' | 'balanced' | 'powerful';
export type GenerationModelId = 'qwen3-1.7b-q4-k-m' | 'qwen3-4b-q4-k-m' | 'qwen3-4b-thinking-2507-q6-k';
export type GenerationTierResolution = {
  requestedTier: GenerationTier;
  resolvedTier: GenerationTier;
  fallbackReason?: 'requested_uninstalled' | 'no_installed_generation_tier';
};
export const LEGACY_POWERFUL_MODEL_ID = 'qwen3-8b-q4-k-m' as const;
export const LEGACY_MINISTRAL_MODEL_ID = 'ministral-3-8b-instruct-q4-k-m' as const;
export type LocalAIAssetManifest = {
  id: string;
  displayName: string;
  description?: string;
  role: LocalAIAssetRole;
  tier?: GenerationTier;
  modelFamily?: string;
  version: string;
  fileName: string;
  downloadUrl?: string;
  expectedSize?: number;
  sha256?: string;
  minimumRam: number;
  recommendedRam: number;
  contextSize?: number;
  runtimeArgs?: string[];
  maxTokens?: number;
  reasoningMode?: 'off' | 'adaptive' | 'on';
};

export type GenerationModelManifest = LocalAIAssetManifest & {
  role: 'generation';
  tier: GenerationTier;
  modelFamily: string;
};

// Artifact URLs/checksums intentionally come from release configuration. A
// build must not silently ship an unverified or developer-specific model.
// These optional artifacts are pinned to immutable Hugging Face revisions. The
// environment variables remain supported for development/release overrides,
// but production no longer depends on an external .env file to verify them.
const VERIFIED_OPTIONAL_GENERATION_ARTIFACTS = {
  balanced: {
    url: 'https://huggingface.co/ggml-org/Qwen3-4B-GGUF/resolve/2f3b082b1356a6123f7ed71e65aea340da25d53c/Qwen3-4B-Q4_K_M.gguf?download=true',
    size: 2497280640,
    sha256: 'ab27b9bfa375a178d6cba48f3ad892b94b7739659dcc7aae8058ce0ffed6b328',
  },
  powerful: {
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-Thinking-2507-GGUF/resolve/ba7f9bc071caf4788e3d7a5963543cff0149e483/Qwen_Qwen3-4B-Thinking-2507-Q6_K.gguf?download=true',
    size: 3306261216,
    sha256: 'f3f0b80140e7e41d965339fdefd9c98fb1453095cf4077fa587ab9266b627488',
  },
} as const;

const LEGACY_POWERFUL_ARTIFACT = {
  urlFragment: '/Qwen/Qwen3-8B-GGUF/',
  size: 5027783488,
  sha256: 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785',
} as const;
const LEGACY_MINISTRAL_ARTIFACT = {
  urlFragment: '/mistralai/Ministral-3-8B-Instruct-2512-GGUF/',
  size: 5198911904,
  sha256: '33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761',
} as const;
const powerfulUrlOverride = process.env.LEDGER_LOCAL_AI_POWERFUL_URL?.trim();
const powerfulSizeOverride = Number(process.env.LEDGER_LOCAL_AI_POWERFUL_SIZE) || undefined;
const powerfulShaOverride = process.env.LEDGER_LOCAL_AI_POWERFUL_SHA256?.trim().toLowerCase();
const hasLegacyPowerfulOverride = Boolean(
  powerfulUrlOverride?.includes(LEGACY_POWERFUL_ARTIFACT.urlFragment)
  || powerfulSizeOverride === LEGACY_POWERFUL_ARTIFACT.size
  || powerfulShaOverride === LEGACY_POWERFUL_ARTIFACT.sha256
  || powerfulUrlOverride?.includes(LEGACY_MINISTRAL_ARTIFACT.urlFragment)
  || powerfulSizeOverride === LEGACY_MINISTRAL_ARTIFACT.size
  || powerfulShaOverride === LEGACY_MINISTRAL_ARTIFACT.sha256
);
const powerfulArtifact = hasLegacyPowerfulOverride
  ? VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.powerful
  : {
      url: powerfulUrlOverride || VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.powerful.url,
      size: powerfulSizeOverride || VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.powerful.size,
      sha256: powerfulShaOverride || VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.powerful.sha256,
    };

export const GENERATION_MODEL_REGISTRY: GenerationModelManifest[] = [
  {
    id: 'qwen3-1.7b-q4-k-m', tier: 'fast', displayName: 'Qwen3 1.7B', description: 'Fast everyday answers', modelFamily: 'Qwen3', role: 'generation', version: '1',
    fileName: 'qwen3-1.7b-q4_k_m.gguf', downloadUrl: process.env.LEDGER_LOCAL_AI_GENERATION_URL,
    expectedSize: Number(process.env.LEDGER_LOCAL_AI_GENERATION_SIZE) || undefined,
    sha256: process.env.LEDGER_LOCAL_AI_GENERATION_SHA256?.trim().toLowerCase() || undefined,
    minimumRam: 8 * 1024 ** 3, recommendedRam: 16 * 1024 ** 3, contextSize: 4096, runtimeArgs: ['--reasoning', 'off'], reasoningMode: 'off',
  },
  {
    id: 'qwen3-4b-q4-k-m', tier: 'balanced', displayName: 'Qwen3 4B', description: 'Stronger answers for more complex work', modelFamily: 'Qwen3', role: 'generation', version: '1',
    fileName: 'qwen3-4b-q4_k_m.gguf', downloadUrl: process.env.LEDGER_LOCAL_AI_BALANCED_URL || VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.balanced.url,
    expectedSize: Number(process.env.LEDGER_LOCAL_AI_BALANCED_SIZE) || VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.balanced.size,
    sha256: process.env.LEDGER_LOCAL_AI_BALANCED_SHA256?.trim().toLowerCase() || VERIFIED_OPTIONAL_GENERATION_ARTIFACTS.balanced.sha256,
    minimumRam: 12 * 1024 ** 3, recommendedRam: 16 * 1024 ** 3, contextSize: 4096, maxTokens: 512, reasoningMode: 'adaptive',
  },
  {
    id: 'qwen3-4b-thinking-2507-q6-k', tier: 'powerful', displayName: 'Qwen3 4B Thinking', description: 'Takes more time to reason through complex work', modelFamily: 'Qwen3', role: 'generation', version: '2507',
    fileName: 'Qwen_Qwen3-4B-Thinking-2507-Q6_K.gguf', downloadUrl: powerfulArtifact.url,
    expectedSize: powerfulArtifact.size,
    sha256: powerfulArtifact.sha256,
    minimumRam: 8 * 1024 ** 3, recommendedRam: 16 * 1024 ** 3, contextSize: 8192, maxTokens: 4096, runtimeArgs: ['--reasoning', 'on', '--reasoning-format', 'deepseek'], reasoningMode: 'on',
  },
];

const EMBEDDING_MODEL: LocalAIAssetManifest = {
  id: 'ledger-embedding', displayName: 'Ledger semantic search', role: 'embedding', version: '1',
  fileName: 'ledger-embedding.gguf', downloadUrl: process.env.LEDGER_LOCAL_AI_EMBEDDING_URL,
  expectedSize: Number(process.env.LEDGER_LOCAL_AI_EMBEDDING_SIZE) || undefined,
  sha256: process.env.LEDGER_LOCAL_AI_EMBEDDING_SHA256?.trim().toLowerCase() || undefined,
  minimumRam: 4 * 1024 ** 3, recommendedRam: 8 * 1024 ** 3,
};

export const LOCAL_AI_MANIFEST: LocalAIAssetManifest[] = [...GENERATION_MODEL_REGISTRY, EMBEDDING_MODEL];
export const DEFAULT_GENERATION_TIER: GenerationTier = 'fast';
const DEFAULT_GENERATION_MODEL_ID: GenerationModelId = 'qwen3-1.7b-q4-k-m';
const legacyPowerfulModelPaths = (modelId: string) => modelId === LEGACY_POWERFUL_MODEL_ID
  ? [path.join(assetRoot(), 'models', 'generation', LEGACY_POWERFUL_MODEL_ID, 'qwen3-8b-q4_k_m.gguf')]
  : modelId === LEGACY_MINISTRAL_MODEL_ID
    ? [path.join(assetRoot(), 'models', 'generation', LEGACY_MINISTRAL_MODEL_ID, 'Ministral-3-8B-Instruct-2512-Q4_K_M.gguf')]
    : [];

export type LocalAIAssetStatus = LocalAIAssetManifest & {
  installed: boolean;
  downloading: boolean;
  verifying: boolean;
  state: 'not_installed' | 'unavailable' | 'downloading' | 'verifying' | 'installed' | 'failed';
  bytesDownloaded: number;
  totalBytes: number | null;
  progressPercent: number | null;
  installedBytes: number;
  available: boolean;
  error: string | null;
  errorCode?: 'release_metadata_missing' | 'busy' | 'disk_space' | 'download_failed' | 'verification_failed' | 'cancelled';
};

export type LocalAIStatus = {
  generation: LocalAIAssetStatus;
  generationModels: Record<GenerationModelId, LocalAIAssetStatus>;
  selectedGenerationTier: GenerationTier;
  embedding: LocalAIAssetStatus;
  platform: NodeJS.Platform;
  arch: string;
  totalRam: number;
  runtimeAvailable: boolean;
  runtimePath: string | null;
};

const assetRoot = () => path.join(appDataPath(), 'ai');
const modelPath = (asset: LocalAIAssetManifest) => path.join(assetRoot(), 'models', asset.role, asset.role === 'generation' && asset.id !== DEFAULT_GENERATION_MODEL_ID ? asset.id : '', asset.fileName);
const temporaryModelPath = (asset: LocalAIAssetManifest) => `${modelPath(asset)}.${process.pid}.part`;
const selectionPath = () => path.join(assetRoot(), 'metadata', 'generation-selection.json');

export const localAIRuntimeCandidates = () => {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  return [
    process.env.LEDGER_LLAMA_SERVER_PATH?.trim(),
    isPackaged() ? path.join(resourcesPath(), 'local-ai-runtime', `${process.platform}-${process.arch}`, name) : undefined,
    path.join(process.cwd(), 'native', 'local-ai-runtime', `${process.platform}-${process.arch}`, name),
  ].filter((value): value is string => Boolean(value));
};

export const resolveLocalAIRuntime = () => localAIRuntimeCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
export const resolveLocalAIRuntimeVersion = (runtimePath: string) => {
  try {
    const result = spawnSync(runtimePath, ['--version'], { encoding: 'utf8', timeout: 3000 });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`.split('\n')[0]?.trim() || null;
  }
  catch { return null; }
};

export class LocalAIAssetManager {
  private readonly downloads = new Map<string, AbortController>();
  private readonly verifying = new Set<string>();
  private readonly downloadErrors = new Map<string, { code: LocalAIAssetStatus['errorCode']; message: string }>();
  private readonly downloadPromises = new Map<string, Promise<LocalAIStatus>>();
  private generationDownloadId: string | null = null;
  private readonly listeners = new Set<(status: LocalAIStatus) => void>();

  constructor() {
    for (const asset of LOCAL_AI_MANIFEST) fs.mkdirSync(path.dirname(modelPath(asset)), { recursive: true });
    fs.mkdirSync(path.join(assetRoot(), 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(assetRoot(), 'metadata'), { recursive: true });
    for (const asset of LOCAL_AI_MANIFEST) fs.rmSync(temporaryModelPath(asset), { force: true });
  }

  onChange(listener: (status: LocalAIStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  manifest(role: LocalAIAssetRole) { return LOCAL_AI_MANIFEST.find((asset) => asset.role === role)!; }
  getAvailableGenerationModels() { return [...GENERATION_MODEL_REGISTRY]; }
  generationModels() { return this.getAvailableGenerationModels(); }
  generationModel(modelId: string) { return GENERATION_MODEL_REGISTRY.find((asset) => asset.id === modelId); }
  private selectedTier(): GenerationTier {
    try {
      const value = JSON.parse(fs.readFileSync(selectionPath(), 'utf8')) as { tier?: unknown };
      return value.tier === 'fast' || value.tier === 'balanced' || value.tier === 'powerful' ? value.tier : DEFAULT_GENERATION_TIER;
    } catch { return DEFAULT_GENERATION_TIER; }
  }
  getSelectedGenerationTier() {
    return this.getGenerationTierResolution().resolvedTier;
  }
  getGenerationTierResolution(): GenerationTierResolution {
    const requestedTier = this.selectedTier();
    const requestedModel = GENERATION_MODEL_REGISTRY.find((model) => model.tier === requestedTier)!;
    if (this.statusFor(requestedModel).installed) return { requestedTier, resolvedTier: requestedTier };
    const preference: GenerationTier[] = requestedTier === 'powerful'
      ? ['balanced', 'fast']
      : requestedTier === 'balanced'
        ? ['fast']
        : [];
    const fallback = preference.find((tier) => this.statusFor(GENERATION_MODEL_REGISTRY.find((model) => model.tier === tier)!).installed);
    if (!fallback) return { requestedTier, resolvedTier: 'fast', fallbackReason: 'no_installed_generation_tier' };
    try { fs.writeFileSync(selectionPath(), JSON.stringify({ tier: fallback, migratedFrom: requestedTier, updatedAt: new Date().toISOString() }), { mode: 0o600 }); } catch {}
    return { requestedTier, resolvedTier: fallback, fallbackReason: 'requested_uninstalled' };
  }
  getSelectedGenerationModel() {
    const selectedTier = this.getSelectedGenerationTier();
    return GENERATION_MODEL_REGISTRY.find((model) => model.tier === selectedTier) ?? GENERATION_MODEL_REGISTRY[0];
  }
  getGenerationModelPath(modelId: string) {
    const model = this.generationModel(modelId);
    if (!model) throw new Error('Invalid generation model.');
    const override = model.tier === 'fast'
      ? process.env.LEDGER_LOCAL_AI_MODEL_PATH?.trim()
      : model.tier === 'balanced'
        ? process.env.LEDGER_LOCAL_AI_BALANCED_MODEL_PATH?.trim()
        : process.env.LEDGER_LOCAL_AI_POWERFUL_MODEL_PATH?.trim();
    return override ? path.resolve(override) : modelPath(model);
  }
  setSelectedGenerationTier(tier: unknown) {
    if (tier !== 'fast' && tier !== 'balanced' && tier !== 'powerful') throw new Error('Invalid generation tier.');
    const model = GENERATION_MODEL_REGISTRY.find((entry) => entry.tier === tier)!;
    if (!this.statusFor(model).installed) throw new Error(`The ${tier} generation model is not installed.`);
    fs.writeFileSync(selectionPath(), JSON.stringify({ tier, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    this.emit();
    return { tier, modelId: model.id };
  }
  pathFor(role: LocalAIAssetRole) {
    if (role === 'generation') return this.getGenerationModelPath(this.getSelectedGenerationModel().id);
    const asset = this.manifest(role);
    const override = process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL_PATH;
    return override?.trim() ? path.resolve(override) : modelPath(asset);
  }
  private statusFor(asset: LocalAIAssetManifest): LocalAIAssetStatus {
      const downloading = this.downloads.has(asset.id);
      const verifying = this.verifying.has(asset.id);
      const file = asset.role === 'generation' ? this.getGenerationModelPath(asset.id) : this.pathFor(asset.role);
      const progressFile = downloading ? temporaryModelPath(asset) : file;
      let installed = false; let bytesDownloaded = 0; let error: string | null = null;
      try { const stat = fs.statSync(progressFile); bytesDownloaded = stat.size; } catch { bytesDownloaded = 0; }
      const overrideKey = asset.role === 'embedding'
        ? 'LEDGER_LOCAL_AI_EMBEDDING_MODEL_PATH'
        : asset.tier === 'fast'
          ? 'LEDGER_LOCAL_AI_MODEL_PATH'
          : asset.tier === 'balanced'
            ? 'LEDGER_LOCAL_AI_BALANCED_MODEL_PATH'
            : 'LEDGER_LOCAL_AI_POWERFUL_MODEL_PATH';
      const hasOverride = Boolean(process.env[overrideKey]?.trim());
      const hasVerifiedMetadata = Boolean(asset.downloadUrl && asset.expectedSize && asset.sha256);
      let installedBytes = 0;
      try { const stat = fs.statSync(file); installedBytes = stat.isFile() ? stat.size : 0; installed = stat.isFile() && (hasOverride || Boolean(hasVerifiedMetadata && asset.expectedSize && stat.size === asset.expectedSize)); } catch { installed = false; }
      const recordedError = this.downloadErrors.get(asset.id);
      let validationFailed = false;
      if (recordedError) { error = recordedError.message; }
      else if (!installed && fs.existsSync(file) && !hasVerifiedMetadata && !hasOverride) { error = 'This model does not have verified release metadata.'; }
      else if (!installed && fs.existsSync(file)) { validationFailed = true; error = 'The installed model failed its manifest validation.'; }
      const available = hasOverride || hasVerifiedMetadata;
      const state = downloading ? 'downloading' : verifying ? 'verifying' : installed ? 'installed' : recordedError || validationFailed ? (recordedError?.code === 'cancelled' ? 'not_installed' : 'failed') : available ? 'not_installed' : 'unavailable';
      const totalBytes = asset.expectedSize ?? null;
      return { ...asset, installed, downloading, verifying, state, bytesDownloaded, totalBytes, progressPercent: totalBytes ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)) : null, installedBytes, available, error, errorCode: recordedError?.code };
  }
  getGenerationModelStatus(modelId: string) {
    const model = this.generationModel(modelId);
    if (!model) throw new Error('Invalid generation model.');
    return this.statusFor(model);
  }
  status(): LocalAIStatus {
    const generationModels = Object.fromEntries(GENERATION_MODEL_REGISTRY.map((model) => [model.id, this.statusFor(model)])) as Record<GenerationModelId, LocalAIAssetStatus>;
    return { generation: generationModels[DEFAULT_GENERATION_MODEL_ID], generationModels, selectedGenerationTier: this.getSelectedGenerationTier(), embedding: this.statusFor(this.manifest('embedding')), platform: process.platform, arch: process.arch, totalRam: os.totalmem(), runtimeAvailable: Boolean(resolveLocalAIRuntime()), runtimePath: resolveLocalAIRuntime() };
  }
  hardware() { const totalRam = os.totalmem(); return { totalRam, platform: process.platform, arch: process.arch, supported: process.platform === 'darwin' || process.platform === 'win32', recommended: totalRam >= this.manifest('generation').recommendedRam }; }

  async download(role: LocalAIAssetRole) {
    const asset = this.manifest(role);
    return this.downloadManaged(asset);
  }
  async downloadGeneration(modelId: string) {
    const asset = this.generationModel(modelId);
    if (!asset) throw new Error('Invalid generation model.');
    if (this.generationDownloadId && this.generationDownloadId !== asset.id) {
      return { ok: false, state: 'busy' as const, modelId: asset.id, tier: asset.tier, activeModelId: this.generationDownloadId };
    }
    if (!this.isDownloadable(asset)) {
      return { ok: false, state: 'unavailable' as const, modelId: asset.id, tier: asset.tier, expectedSize: asset.expectedSize };
    }
    try {
      return { ok: true as const, status: await this.downloadManaged(asset) };
    } catch (error) {
      return { ok: false, state: 'failed' as const, modelId: asset.id, tier: asset.tier, error: error instanceof Error ? error.message : String(error), status: this.status() };
    }
  }
  private downloadManaged(asset: LocalAIAssetManifest) {
    const existing = this.downloadPromises.get(asset.id);
    if (existing) return existing;
    if (asset.role === 'generation' && this.generationDownloadId && this.generationDownloadId !== asset.id) throw new Error(`Another generation model is currently downloading: ${this.generationDownloadId}.`);
    if (asset.role === 'generation') this.generationDownloadId = asset.id;
    const promise = this.downloadAsset(asset).finally(() => {
      this.downloadPromises.delete(asset.id);
      if (asset.role === 'generation' && this.generationDownloadId === asset.id) this.generationDownloadId = null;
    });
    if (asset.role === 'generation') this.downloadPromises.set(asset.id, promise);
    return promise;
  }
  private isDownloadable(asset: LocalAIAssetManifest) { return Boolean(asset.downloadUrl && asset.sha256 && asset.expectedSize); }
  private async downloadAsset(asset: LocalAIAssetManifest) {
    if (this.downloads.has(asset.id)) return this.status();
    if (this.statusFor(asset).installed) return this.status();
    if (!this.isDownloadable(asset)) { this.downloadErrors.set(asset.id, { code: 'release_metadata_missing', message: 'This Local AI release is missing verified model artifact metadata.' }); this.emit(); throw new Error('This Local AI release is missing verified model artifact metadata.'); }
    const downloadUrl = asset.downloadUrl;
    const expectedSize = asset.expectedSize;
    const sha256 = asset.sha256;
    const free = await fs.promises.statfs(assetRoot());
    if (Number(free.bavail) * Number(free.bsize) < expectedSize! + 256 * 1024 * 1024) { this.downloadErrors.set(asset.id, { code: 'disk_space', message: 'There is not enough disk space for Local AI.' }); this.emit(); throw new Error('There is not enough disk space for Local AI.'); }
    const controller = new AbortController(); this.downloads.set(asset.id, controller); if (asset.role === 'generation') this.generationDownloadId = asset.id; this.downloadErrors.delete(asset.id); this.emit();
    const target = asset.role === 'generation' ? this.getGenerationModelPath(asset.id) : modelPath(asset); const temporary = `${target}.${process.pid}.part`;
    try {
      const response = await fetch(downloadUrl!, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}.`);
      const file = fs.createWriteStream(temporary, { flags: 'w', mode: 0o600 }); const hash = crypto.createHash('sha256'); let bytes = 0;
      const reader = response.body.getReader();
      try { while (true) { const part = await reader.read(); if (part.done) break; const chunk = Buffer.from(part.value); bytes += chunk.length; hash.update(chunk); if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve)); this.emit(); } }
      finally { reader.releaseLock(); await new Promise<void>((resolve, reject) => { file.end((error?: Error | null) => error ? reject(error) : resolve()); }); }
      this.verifying.add(asset.id); this.emit();
      if (bytes !== expectedSize) { this.downloadErrors.set(asset.id, { code: 'verification_failed', message: 'The Local AI download failed expected-size verification.' }); throw new Error('The Local AI download failed expected-size verification.'); }
      if (hash.digest('hex').toLowerCase() !== sha256) { this.downloadErrors.set(asset.id, { code: 'verification_failed', message: 'The Local AI download failed SHA-256 verification.' }); throw new Error('The Local AI download failed SHA-256 verification.'); }
      await fs.promises.rename(temporary, target); await fs.promises.writeFile(path.join(assetRoot(), 'metadata', `${asset.id}.json`), JSON.stringify({ ...asset, installedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      return this.status();
    } catch (error) {
      if (controller.signal.aborted) this.downloadErrors.set(asset.id, { code: 'cancelled', message: 'The Local AI download was cancelled.' });
      else if (!this.downloadErrors.has(asset.id)) this.downloadErrors.set(asset.id, { code: 'download_failed', message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { this.verifying.delete(asset.id); this.downloads.delete(asset.id); this.generationDownloadId = this.generationDownloadId === asset.id ? null : this.generationDownloadId; await fs.promises.rm(temporary, { force: true }).catch(() => undefined); this.emit(); }
  }
  cancel(role: LocalAIAssetRole) { const asset = this.manifest(role); this.downloads.get(asset.id)?.abort(); return this.status(); }
  cancelGenerationDownload(modelId: string) { const asset = this.generationModel(modelId); if (!asset) throw new Error('Invalid generation model.'); this.downloads.get(asset.id)?.abort(); return this.status(); }
  removeLegacyGenerationModel(modelId: string) {
    const paths = legacyPowerfulModelPaths(modelId);
    if (!paths.length) throw new Error('Invalid legacy generation model.');
    paths.forEach((legacyPath) => fs.rmSync(legacyPath, { force: true }));
    fs.rmSync(path.join(assetRoot(), 'metadata', `${modelId}.json`), { force: true });
    return this.status();
  }
  remove(role: LocalAIAssetRole) { const asset = this.manifest(role); if (role === 'generation') throw new Error('The Fast generation model is protected.'); if (this.downloads.has(asset.id)) throw new Error('Cancel the Local AI download before removing it.'); const target = this.pathFor(role); fs.rmSync(target, { force: true }); fs.rmSync(path.join(assetRoot(), 'metadata', `${asset.id}.json`), { force: true }); this.emit(); return this.status(); }
  async removeGeneration(modelId: string) { const asset = this.generationModel(modelId); if (!asset) throw new Error('Invalid generation model.'); if (asset.tier === 'fast') throw new Error('The Fast generation model is protected.'); if (this.downloads.has(asset.id)) { this.downloads.get(asset.id)?.abort(); await this.downloadPromises.get(asset.id)?.catch(() => undefined); } fs.rmSync(this.getGenerationModelPath(modelId), { force: true }); fs.rmSync(path.join(assetRoot(), 'metadata', `${asset.id}.json`), { force: true }); this.downloadErrors.delete(asset.id); this.emit(); return this.status(); }
  private emit() { const value = this.status(); this.listeners.forEach((listener) => listener(value)); }
}
