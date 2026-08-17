import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// `electron` resolves to a harmless executable path when these model-layer
// tests run under plain Node. Keep the asset contract testable without a
// running Electron process while using app paths in the real main process.
const electronModule = createRequire(import.meta.url)('electron') as { app?: { getPath(name: string): string; isPackaged?: boolean } };
const appDataPath = () => electronModule.app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-ai-test-data');
const isPackaged = () => Boolean(electronModule.app?.isPackaged);
const resourcesPath = () => process.resourcesPath;

export type LocalAIAssetRole = 'generation' | 'embedding';
export type LocalAIAssetManifest = {
  id: string;
  displayName: string;
  role: LocalAIAssetRole;
  version: string;
  fileName: string;
  downloadUrl?: string;
  expectedSize?: number;
  sha256?: string;
  minimumRam: number;
  recommendedRam: number;
};

// Artifact URLs/checksums intentionally come from release configuration. A
// build must not silently ship an unverified or developer-specific model.
export const LOCAL_AI_MANIFEST: LocalAIAssetManifest[] = [
  {
    id: 'qwen3-1.7b-q4-k-m', displayName: 'Qwen3 1.7B', role: 'generation', version: '1',
    fileName: 'qwen3-1.7b-q4_k_m.gguf', downloadUrl: process.env.LEDGER_LOCAL_AI_GENERATION_URL,
    expectedSize: Number(process.env.LEDGER_LOCAL_AI_GENERATION_SIZE) || undefined,
    sha256: process.env.LEDGER_LOCAL_AI_GENERATION_SHA256?.trim().toLowerCase() || undefined,
    minimumRam: 8 * 1024 ** 3, recommendedRam: 16 * 1024 ** 3,
  },
  {
    id: 'ledger-embedding', displayName: 'Ledger semantic search', role: 'embedding', version: '1',
    fileName: 'ledger-embedding.gguf', downloadUrl: process.env.LEDGER_LOCAL_AI_EMBEDDING_URL,
    expectedSize: Number(process.env.LEDGER_LOCAL_AI_EMBEDDING_SIZE) || undefined,
    sha256: process.env.LEDGER_LOCAL_AI_EMBEDDING_SHA256?.trim().toLowerCase() || undefined,
    minimumRam: 4 * 1024 ** 3, recommendedRam: 8 * 1024 ** 3,
  },
];

export type LocalAIAssetStatus = LocalAIAssetManifest & {
  installed: boolean; downloading: boolean; bytesDownloaded: number; error: string | null;
};

export type LocalAIStatus = {
  generation: LocalAIAssetStatus;
  embedding: LocalAIAssetStatus;
  platform: NodeJS.Platform;
  arch: string;
  totalRam: number;
  runtimeAvailable: boolean;
  runtimePath: string | null;
};

const assetRoot = () => path.join(appDataPath(), 'ai');
const modelPath = (asset: LocalAIAssetManifest) => path.join(assetRoot(), 'models', asset.role, asset.fileName);

export const localAIRuntimeCandidates = () => {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  return [
    process.env.LEDGER_LLAMA_SERVER_PATH?.trim(),
    isPackaged() ? path.join(resourcesPath(), 'local-ai-runtime', `${process.platform}-${process.arch}`, name) : undefined,
    path.join(process.cwd(), 'native', 'local-ai-runtime', `${process.platform}-${process.arch}`, name),
  ].filter((value): value is string => Boolean(value));
};

export const resolveLocalAIRuntime = () => localAIRuntimeCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;

export class LocalAIAssetManager {
  private readonly downloads = new Map<string, AbortController>();
  private readonly listeners = new Set<(status: LocalAIStatus) => void>();

  constructor() {
    for (const asset of LOCAL_AI_MANIFEST) fs.mkdirSync(path.dirname(modelPath(asset)), { recursive: true });
    fs.mkdirSync(path.join(assetRoot(), 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(assetRoot(), 'metadata'), { recursive: true });
  }

  onChange(listener: (status: LocalAIStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  manifest(role: LocalAIAssetRole) { return LOCAL_AI_MANIFEST.find((asset) => asset.role === role)!; }
  pathFor(role: LocalAIAssetRole) {
    const asset = this.manifest(role);
    const override = role === 'generation' ? process.env.LEDGER_LOCAL_AI_MODEL_PATH : process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL_PATH;
    if (override?.trim()) return path.resolve(override);
    return modelPath(asset);
  }
  status(): LocalAIStatus {
    const read = (asset: LocalAIAssetManifest): LocalAIAssetStatus => {
      const file = this.pathFor(asset.role);
      let installed = false; let bytesDownloaded = 0; let error: string | null = null;
      try { const stat = fs.statSync(file); bytesDownloaded = stat.size; installed = stat.isFile() && (!asset.expectedSize || stat.size === asset.expectedSize); } catch { installed = false; }
      if (!installed && fs.existsSync(file) && !process.env[`LEDGER_LOCAL_AI_${asset.role === 'generation' ? 'MODEL' : 'EMBEDDING_MODEL'}_PATH`]) error = 'The installed model failed its manifest validation.';
      return { ...asset, installed, downloading: this.downloads.has(asset.id), bytesDownloaded, error };
    };
    return { generation: read(this.manifest('generation')), embedding: read(this.manifest('embedding')), platform: process.platform, arch: process.arch, totalRam: os.totalmem(), runtimeAvailable: Boolean(resolveLocalAIRuntime()), runtimePath: resolveLocalAIRuntime() };
  }
  hardware() { const totalRam = os.totalmem(); return { totalRam, platform: process.platform, arch: process.arch, supported: process.platform === 'darwin' || process.platform === 'win32', recommended: totalRam >= this.manifest('generation').recommendedRam }; }

  async download(role: LocalAIAssetRole) {
    const asset = this.manifest(role);
    if (this.downloads.has(asset.id)) return this.status();
    if (!asset.downloadUrl || !asset.sha256 || !asset.expectedSize) throw new Error('This Local AI release is missing verified model artifact metadata.');
    const free = await fs.promises.statfs(assetRoot());
    if (Number(free.bavail) * Number(free.bsize) < asset.expectedSize + 256 * 1024 * 1024) throw new Error('There is not enough disk space for Local AI.');
    const controller = new AbortController(); this.downloads.set(asset.id, controller); this.emit();
    const target = modelPath(asset); const temporary = `${target}.${process.pid}.part`;
    try {
      const response = await fetch(asset.downloadUrl, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}.`);
      const file = fs.createWriteStream(temporary, { flags: 'w', mode: 0o600 }); const hash = crypto.createHash('sha256'); let bytes = 0;
      const reader = response.body.getReader();
      try { while (true) { const part = await reader.read(); if (part.done) break; const chunk = Buffer.from(part.value); bytes += chunk.length; hash.update(chunk); if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve)); this.emit(); } }
      finally { reader.releaseLock(); await new Promise<void>((resolve, reject) => { file.end((error?: Error | null) => error ? reject(error) : resolve()); }); }
      if (bytes !== asset.expectedSize || hash.digest('hex').toLowerCase() !== asset.sha256) throw new Error('The Local AI download failed integrity verification.');
      await fs.promises.rename(temporary, target); await fs.promises.writeFile(path.join(assetRoot(), 'metadata', `${asset.id}.json`), JSON.stringify({ ...asset, installedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      return this.status();
    } finally { this.downloads.delete(asset.id); await fs.promises.rm(temporary, { force: true }).catch(() => undefined); this.emit(); }
  }
  cancel(role: LocalAIAssetRole) { const asset = this.manifest(role); this.downloads.get(asset.id)?.abort(); return this.status(); }
  remove(role: LocalAIAssetRole) { if (this.downloads.has(this.manifest(role).id)) throw new Error('Cancel the Local AI download before removing it.'); fs.rmSync(this.pathFor(role), { force: true }); fs.rmSync(path.join(assetRoot(), 'metadata', `${this.manifest(role).id}.json`), { force: true }); this.emit(); return this.status(); }
  private emit() { const value = this.status(); this.listeners.forEach((listener) => listener(value)); }
}
