import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import electron from 'electron';

const app = (electron as unknown as { app?: { getPath(name: string): string } }).app;

export const RECOMMENDED_MODEL = {
  id: 'ggml-base.en',
  label: 'Whisper base English',
  fileName: 'ggml-base.en.bin',
  // Pin the artifact so a future upstream model replacement cannot make an
  // existing release reject or silently accept a different model.
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin?download=true',
  expectedBytes: 147_964_211,
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  approximateBytes: 147_964_211,
  description: 'A practical English model with a good speed/accuracy balance on Apple Silicon.',
};

export type ModelStatus = {
  installed: boolean;
  downloading: boolean;
  modelId: string;
  label: string;
  expectedBytes: number;
  sha256: string;
  approximateBytes: number;
  bytesDownloaded: number;
  downloadSpeedBytesPerSecond: number;
  estimatedSecondsRemaining: number | null;
  error: string | null;
};

export class TranscriptionModelManager {
  private readonly root = path.join(app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-whisper-test-data'), 'models', 'whisper');
  private downloadRequest: ClientRequest | null = null;
  private downloadPromise: Promise<ModelStatus> | null = null;
  private downloadStartedAt = 0;
  private statusValue: ModelStatus = this.readStatus();
  private listeners = new Set<(status: ModelStatus) => void>();

  constructor() { fs.mkdirSync(this.root, { recursive: true }); }

  onChange(listener: (status: ModelStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  status() { return { ...this.statusValue, installed: this.isInstalled() }; }
  modelPath() { return path.join(this.root, RECOMMENDED_MODEL.fileName); }

  async download() {
    if (this.downloadPromise) return this.downloadPromise;
    if (this.status().installed) return this.status();
    this.downloadPromise = this.performDownload().finally(() => {
      this.downloadPromise = null;
      this.downloadRequest = null;
    });
    return this.downloadPromise;
  }

  private async performDownload() {
    const temporary = `${this.modelPath()}.${process.pid}.download`;
    await fs.promises.mkdir(this.root, { recursive: true });
    await fs.promises.rm(temporary, { force: true });
    this.downloadStartedAt = Date.now();
    this.statusValue = { ...this.status(), downloading: true, bytesDownloaded: 0, downloadSpeedBytesPerSecond: 0, estimatedSecondsRemaining: null, error: null };
    this.emit();
    try {
      const result = await this.downloadFrom(this.RECOMMENDED_URL, temporary);
      if (result.bytes !== RECOMMENDED_MODEL.expectedBytes) throw new Error('The Whisper download failed expected-size verification.');
      if (result.sha256 !== RECOMMENDED_MODEL.sha256) throw new Error('The Whisper download failed SHA-256 verification.');
      await fs.promises.rename(temporary, this.modelPath());
      if (!this.isInstalled()) throw new Error('The downloaded Whisper model failed validation.');
      this.statusValue = { ...this.status(), downloading: false, bytesDownloaded: RECOMMENDED_MODEL.expectedBytes, estimatedSecondsRemaining: 0, error: null };
      this.emit();
      return this.status();
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      this.statusValue = { ...this.status(), downloading: false, estimatedSecondsRemaining: null, error: error instanceof Error ? error.message : String(error) };
      this.emit();
      throw error;
    }
  }

  private readonly RECOMMENDED_URL = RECOMMENDED_MODEL.url;

  cancelDownload() {
    this.downloadRequest?.destroy(new Error('Model download cancelled.'));
    this.downloadRequest = null;
    this.statusValue = { ...this.status(), downloading: false, estimatedSecondsRemaining: null, error: 'Model download cancelled.' };
    this.emit();
  }

  delete() {
    if (this.statusValue.downloading) throw new Error('Stop the model download before deleting the model.');
    fs.rmSync(this.modelPath(), { force: true });
    this.statusValue = { ...this.status(), installed: false, error: null, bytesDownloaded: 0, downloadSpeedBytesPerSecond: 0, estimatedSecondsRemaining: null };
    this.emit();
  }

  private async downloadFrom(url: string, temporary: string, redirectCount = 0): Promise<{ bytes: number; sha256: string }> {
    if (redirectCount > 5) throw new Error('The Whisper download followed too many redirects.');
    return new Promise<{ bytes: number; sha256: string }>((resolve, reject) => {
      const request = https.get(new URL(url), (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          this.downloadRequest = null;
          void this.downloadFrom(new URL(response.headers.location, url).toString(), temporary, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) { reject(new Error(`Model download failed with HTTP ${response.statusCode ?? 'unknown'}.`)); return; }
        this.writeResponse(response, temporary, resolve, reject);
      });
      this.downloadRequest = request;
      request.once('error', reject);
    });
  }

  private writeResponse(response: IncomingMessage, temporary: string, resolve: (result: { bytes: number; sha256: string }) => void, reject: (error: Error) => void) {
    const file = fs.createWriteStream(temporary, { flags: 'w', mode: 0o600 });
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      hash.update(chunk);
      const elapsedSeconds = Math.max(0.25, (Date.now() - this.downloadStartedAt) / 1000);
      const speed = bytes / elapsedSeconds;
      const remaining = Math.max(0, this.statusValue.approximateBytes - bytes);
      this.statusValue = {
        ...this.status(),
        bytesDownloaded: bytes,
        downloadSpeedBytesPerSecond: speed,
        estimatedSecondsRemaining: speed > 0 ? remaining / speed : null,
      };
      this.emit();
    });
    response.on('error', (error) => { file.destroy(); reject(error instanceof Error ? error : new Error(String(error))); });
    file.on('error', reject);
    file.on('finish', () => { file.close((error) => error ? reject(error) : resolve({ bytes, sha256: hash.digest('hex').toLowerCase() })); });
    response.pipe(file);
  }

  private isInstalled() {
    try {
      const stat = fs.statSync(this.modelPath());
      if (!stat.isFile() || stat.size !== RECOMMENDED_MODEL.expectedBytes) return false;
      const header = Buffer.alloc(4);
      const handle = fs.openSync(this.modelPath(), 'r');
      fs.readSync(handle, header, 0, 4, 0);
      fs.closeSync(handle);
      return header.toString('ascii') === 'lmgg';
    } catch { return false; }
  }

  private readStatus(): ModelStatus {
    return { installed: false, downloading: false, modelId: RECOMMENDED_MODEL.id, label: RECOMMENDED_MODEL.label, expectedBytes: RECOMMENDED_MODEL.expectedBytes, sha256: RECOMMENDED_MODEL.sha256, approximateBytes: RECOMMENDED_MODEL.approximateBytes, bytesDownloaded: 0, downloadSpeedBytesPerSecond: 0, estimatedSecondsRemaining: null, error: null };
  }

  private emit() { const value = this.status(); this.listeners.forEach((listener) => listener(value)); }
}

export const stableSegmentId = (jobId: string, key: number | string) => {
  const hash = crypto.createHash('sha256').update(`${jobId}:${key}`).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
};
