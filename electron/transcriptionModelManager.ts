import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { app } from 'electron';

export const RECOMMENDED_MODEL = {
  id: 'ggml-base.en',
  label: 'Whisper base English',
  fileName: 'ggml-base.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true',
  approximateBytes: 148_000_000,
  description: 'A practical English model with a good speed/accuracy balance on Apple Silicon.',
};

export type ModelStatus = {
  installed: boolean;
  downloading: boolean;
  modelId: string;
  label: string;
  approximateBytes: number;
  bytesDownloaded: number;
  downloadSpeedBytesPerSecond: number;
  estimatedSecondsRemaining: number | null;
  error: string | null;
};

export class TranscriptionModelManager {
  private readonly root = path.join(app.getPath('userData'), 'models', 'whisper');
  private downloadRequest: ClientRequest | null = null;
  private downloadStartedAt = 0;
  private statusValue: ModelStatus = this.readStatus();
  private listeners = new Set<(status: ModelStatus) => void>();

  constructor() { fs.mkdirSync(this.root, { recursive: true }); }

  onChange(listener: (status: ModelStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  status() { return { ...this.statusValue, installed: this.isInstalled() }; }
  modelPath() { return path.join(this.root, RECOMMENDED_MODEL.fileName); }

  async download() {
    if (this.statusValue.downloading) return this.status();
    const temporary = `${this.modelPath()}.${process.pid}.download`;
    this.downloadStartedAt = Date.now();
    this.statusValue = { ...this.status(), downloading: true, bytesDownloaded: 0, downloadSpeedBytesPerSecond: 0, estimatedSecondsRemaining: null, error: null };
    this.emit();
    await new Promise<void>((resolve, reject) => {
      const request = https.get(RECOMMENDED_MODEL.url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          this.downloadRequest = null;
          void this.downloadFrom(response.headers.location, temporary).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) { reject(new Error(`Model download failed with HTTP ${response.statusCode ?? 'unknown'}.`)); return; }
        this.writeResponse(response, temporary, resolve, reject);
      });
      this.downloadRequest = request;
      request.once('error', reject);
    }).then(() => {
      fs.renameSync(temporary, this.modelPath());
      if (!this.isInstalled()) throw new Error('The downloaded Whisper model failed validation.');
      this.statusValue = { ...this.status(), downloading: false, bytesDownloaded: fs.statSync(this.modelPath()).size, estimatedSecondsRemaining: 0, error: null };
      this.emit();
    }).catch((error) => {
      try { fs.rmSync(temporary, { force: true }); } catch {}
    this.statusValue = { ...this.status(), downloading: false, estimatedSecondsRemaining: null, error: error instanceof Error ? error.message : String(error) };
      this.emit();
      throw error;
    }).finally(() => { this.downloadRequest = null; });
    return this.status();
  }

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

  private async downloadFrom(url: string, temporary: string) {
    await new Promise<void>((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) { reject(new Error(`Model download failed with HTTP ${response.statusCode ?? 'unknown'}.`)); return; }
        this.writeResponse(response, temporary, resolve, reject);
      });
      this.downloadRequest = request;
      request.once('error', reject);
    });
  }

  private writeResponse(response: IncomingMessage, temporary: string, resolve: () => void, reject: (error: Error) => void) {
    const file = fs.createWriteStream(temporary, { mode: 0o600 });
    let bytes = 0;
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
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
    file.on('finish', () => { file.close(); resolve(); });
    response.pipe(file);
  }

  private isInstalled() {
    try {
      const stat = fs.statSync(this.modelPath());
      if (!stat.isFile() || stat.size < 100_000_000) return false;
      const header = Buffer.alloc(4);
      const handle = fs.openSync(this.modelPath(), 'r');
      fs.readSync(handle, header, 0, 4, 0);
      fs.closeSync(handle);
      return header.toString('ascii') === 'lmgg';
    } catch { return false; }
  }

  private readStatus(): ModelStatus {
    return { installed: false, downloading: false, modelId: RECOMMENDED_MODEL.id, label: RECOMMENDED_MODEL.label, approximateBytes: RECOMMENDED_MODEL.approximateBytes, bytesDownloaded: 0, downloadSpeedBytesPerSecond: 0, estimatedSecondsRemaining: null, error: null };
  }

  private emit() { const value = this.status(); this.listeners.forEach((listener) => listener(value)); }
}

export const stableSegmentId = (jobId: string, key: number | string) => {
  const hash = crypto.createHash('sha256').update(`${jobId}:${key}`).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
};
