import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const electronModule = createRequire(import.meta.url)('electron') as { app?: { getPath(name: string): string } };
const root = () => path.join(electronModule.app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-ai-test-data'), 'ai', 'models', 'vision', 'gemma-3-4b-it');

export const LOCAL_VISION_ASSETS = {
  model: {
    fileName: 'gemma-3-4b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/d0976223747697cb51e056d85c532013931fe52e/gemma-3-4b-it-Q4_K_M.gguf?download=true',
    size: 2489757856,
    sha256: '882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863',
  },
  mmproj: {
    fileName: 'mmproj-model-f16.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/d0976223747697cb51e056d85c532013931fe52e/mmproj-model-f16.gguf?download=true',
    size: 851251104,
    sha256: '8c0fb064b019a6972856aaae2c7e4792858af3ca4561be2dbf649123ba6c40cb',
  },
} as const;

export type LocalVisionAssetStatus = {
  available: boolean;
  downloading: boolean;
  modelPath: string;
  mmprojPath: string;
  modelBytes: number;
  mmprojBytes: number;
  totalBytes: number;
  progressPercent: number;
};

const filePath = (asset: keyof typeof LOCAL_VISION_ASSETS) => path.join(root(), LOCAL_VISION_ASSETS[asset].fileName);
const validFile = (asset: keyof typeof LOCAL_VISION_ASSETS) => {
  try { return fs.statSync(filePath(asset)).size === LOCAL_VISION_ASSETS[asset].size; } catch { return false; }
};

export class LocalVisionAssetManager {
  private downloading = false;
  private controller: AbortController | null = null;
  private readonly listeners = new Set<(status: LocalVisionAssetStatus) => void>();

  onChange(listener: (status: LocalVisionAssetStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit() { const status = this.status(); this.listeners.forEach((listener) => listener(status)); }

  status(): LocalVisionAssetStatus {
    const modelBytes = (() => { try { return fs.statSync(filePath('model')).size; } catch { return 0; } })();
    const mmprojBytes = (() => { try { return fs.statSync(filePath('mmproj')).size; } catch { return 0; } })();
    const totalBytes = LOCAL_VISION_ASSETS.model.size + LOCAL_VISION_ASSETS.mmproj.size;
    return {
      available: validFile('model') && validFile('mmproj'),
      downloading: this.downloading,
      modelPath: filePath('model'),
      mmprojPath: filePath('mmproj'),
      modelBytes,
      mmprojBytes,
      totalBytes,
      progressPercent: Math.min(100, Math.round(((modelBytes + mmprojBytes) / totalBytes) * 100)),
    };
  }

  async download() {
    if (this.downloading) return this.status();
    if (this.status().available) return this.status();
    this.downloading = true;
    this.controller = new AbortController();
    this.emit();
    try {
      await fs.promises.mkdir(root(), { recursive: true });
      for (const key of ['model', 'mmproj'] as const) await this.downloadOne(key);
      return this.status();
    } finally {
      this.downloading = false;
      this.controller = null;
      this.emit();
    }
  }

  cancel() { this.controller?.abort(); return this.status(); }

  private async downloadOne(key: keyof typeof LOCAL_VISION_ASSETS) {
    const asset = LOCAL_VISION_ASSETS[key];
    if (validFile(key)) return;
    const target = filePath(key);
    const temporary = `${target}.${process.pid}.part`;
    const response = await fetch(asset.url, { signal: this.controller?.signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Ledger Vision download failed with HTTP ${response.status}.`);
    const file = fs.createWriteStream(temporary, { flags: 'w', mode: 0o600 });
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    try {
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const chunk = Buffer.from(part.value);
          bytes += chunk.length;
          hash.update(chunk);
          if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve));
          this.emit();
        }
      } finally { reader.releaseLock(); }
      await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => error ? reject(error) : resolve()));
      if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error(`Ledger Vision ${key} failed integrity verification.`);
      await fs.promises.rename(temporary, target);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true });
      throw error;
    }
  }
}
