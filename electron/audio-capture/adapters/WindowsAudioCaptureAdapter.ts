import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, shell, webContents } from 'electron';
import { AudioCaptureError, type AudioCaptureAdapter, type AudioCaptureEvent, type AudioCaptureStartOptions, type AudioCaptureSession, type AudioDeviceInfo, type AudioPermissionStatus, type AudioCaptureStopResult, type AudioSourceName } from '../types';

  type WindowsEvent = {
  event: 'started' | 'paused' | 'resumed' | 'stopped' | 'error' | 'level' | 'devices-changed' | 'flushed' | 'health';
  sessionId: string;
  sources?: AudioCaptureSession['sources'];
  warnings?: AudioCaptureSession['warnings'];
  devices?: AudioDeviceInfo['devices'];
  outputDevice?: AudioDeviceInfo['outputDevice'];
  durationSeconds?: number;
  source?: AudioSourceName;
  level?: number;
  healthy?: boolean;
  error?: string;
  code?: string;
};
type Pending = { resolve: (value: WindowsEvent) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };

const unsupported = () => new AudioCaptureError('platform_unsupported', 'Windows audio capture is unavailable on this platform.');

/** Bridges renderer MediaStreams into the shared main-process WAV/chunk pipeline. */
export class WindowsAudioCaptureAdapter implements AudioCaptureAdapter {
  private requesterId: number | null = null;
  private active: { sessionId: string; directory: string } | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: AudioCaptureEvent) => void>();
  private readonly onRendererEvent = (_event: Electron.IpcMainEvent, value: WindowsEvent) => this.handleRendererEvent(value);

  constructor() {
    ipcMain.on('meeting-audio:windows-event', this.onRendererEvent);
    ipcMain.handle('meeting-audio:windows-chunk', (_event, value: { sessionId?: unknown; source?: unknown; sequence?: unknown; startAt?: unknown; endAt?: unknown; durationSeconds?: unknown; data?: unknown }) => this.handleChunk(value));
  }

  isSupported() { return process.platform === 'win32'; }
  setRequesterId(requesterId: number) { this.requesterId = requesterId; }

  async permissions(): Promise<AudioPermissionStatus> {
    if (!this.isSupported()) return { microphone: 'unavailable', systemAudio: 'unavailable' };
    const response = await this.command('permissions');
    return this.permissionResult(response);
  }

  async requestPermissions(): Promise<AudioPermissionStatus> {
    if (!this.isSupported()) return { microphone: 'unavailable', systemAudio: 'unavailable' };
    const response = await this.command('request-permissions');
    return this.permissionResult(response);
  }

  async openSystemSettings(area: 'microphone' | 'screen-recording') {
    if (!this.isSupported()) return false;
    await shell.openExternal(area === 'microphone' ? 'ms-settings:privacy-microphone' : 'ms-settings:privacy-microphone');
    return true;
  }

  async devices(): Promise<AudioDeviceInfo> {
    if (!this.isSupported()) return { devices: [], outputDevice: null };
    const response = await this.command('devices');
    return { devices: response.devices ?? [], outputDevice: response.outputDevice ?? null };
  }

  start(options: AudioCaptureStartOptions) { return this.begin(options); }
  testSource(options: AudioCaptureStartOptions) { return this.begin(options); }

  async pause() {
    await this.command('pause');
  }

  async resume() {
    await this.command('resume');
  }

  async stop(): Promise<AudioCaptureStopResult> {
    if (!this.active) return { durationSeconds: 0 };
    const response = await this.command('stop');
    this.active = null;
    return { durationSeconds: Number(response.durationSeconds) || 0 };
  }

  async flush() {
    if (this.active) await this.command('flush');
  }

  async checkHealth() {
    if (!this.active) return [];
    const response = await this.command('health');
    return Array.isArray(response.sources) ? response.sources : [];
  }

  onEvent(listener: (event: AudioCaptureEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async shutdown() {
    try { await this.stop(); } catch {}
    this.pending.forEach((pending) => { clearTimeout(pending.timeout); pending.reject(new AudioCaptureError('capture_interrupted', 'Windows audio capture was shut down.')); });
    this.pending.clear();
    ipcMain.off('meeting-audio:windows-event', this.onRendererEvent);
  }

  private async begin(options: AudioCaptureStartOptions): Promise<AudioCaptureSession> {
    if (!this.isSupported()) throw unsupported();
    if (this.active) throw new AudioCaptureError('already_recording', 'Another audio capture session is already active.');
    if (this.requesterId === null) throw new AudioCaptureError('capture_initialization_failed', 'The Windows capture window is unavailable.');
    const target = webContents.fromId(this.requesterId);
    if (!target || target.isDestroyed()) throw new AudioCaptureError('capture_initialization_failed', 'The Windows capture window is unavailable.');
    this.active = { sessionId: options.sessionId, directory: options.directory };
    try {
      const response = await this.command('start', { sessionId: options.sessionId, microphone: options.microphone, systemAudio: options.systemAudio, microphoneDeviceId: options.microphoneDeviceId ?? null });
      const sources = Array.isArray(response.sources) ? response.sources : [];
      if (!sources.length) throw new AudioCaptureError('capture_initialization_failed', 'Windows returned no usable audio sources.');
      return { sessionId: options.sessionId, sources, warnings: Array.isArray(response.warnings) ? response.warnings : [] };
    } catch (error) {
      this.active = null;
      throw error;
    }
  }

  private command(command: string, payload: Record<string, unknown> = {}) {
    if (this.requesterId === null) return Promise.reject(new AudioCaptureError('capture_initialization_failed', 'The Windows capture window is unavailable.'));
    const target = webContents.fromId(this.requesterId);
    if (!target || target.isDestroyed()) return Promise.reject(new AudioCaptureError('capture_interrupted', 'The Windows capture window closed.'));
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const promise = new Promise<WindowsEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new AudioCaptureError('capture_initialization_failed', 'Windows audio capture did not respond.'));
      }, 20_000);
      this.pending.set(requestId, { resolve, reject, timeout });
    });
    target.send('meeting-audio:windows-command', { command, requestId, sessionId: this.active?.sessionId ?? payload.sessionId ?? requestId, ...payload });
    return promise;
  }

  private handleRendererEvent(value: WindowsEvent) {
    if (!value) return;
    if (value.event === 'devices-changed') {
      this.emit({ type: 'devices-changed' });
      return;
    }
    if (typeof value.sessionId !== 'string') return;
    if (value.event === 'started' || value.event === 'paused' || value.event === 'resumed' || value.event === 'stopped' || value.event === 'error' || value.event === 'flushed' || value.event === 'health') {
      const requestId = (value as WindowsEvent & { requestId?: string }).requestId;
      if (requestId) {
        const pending = this.pending.get(requestId);
        if (pending) { this.pending.delete(requestId); clearTimeout(pending.timeout); if (value.event === 'error') pending.reject(this.toError(value)); else pending.resolve(value); }
      }
      if (value.event === 'error' && !requestId) this.emitError(value);
      if (value.event === 'stopped') this.active = null;
      return;
    }
    if (value.event === 'level' && value.source) this.emit({ type: 'level', source: value.source, level: Math.max(0, Math.min(1, Number(value.level) || 0)) });
  }

  private async handleChunk(value: { sessionId?: unknown; source?: unknown; sequence?: unknown; startAt?: unknown; endAt?: unknown; durationSeconds?: unknown; data?: unknown }) {
    if (!this.active || value.sessionId !== this.active.sessionId || (value.source !== 'user_microphone' && value.source !== 'system_audio')) throw new AudioCaptureError('invalid_request', 'Invalid Windows audio chunk.');
    if (!(value.data instanceof ArrayBuffer) && !ArrayBuffer.isView(value.data)) throw new AudioCaptureError('invalid_request', 'Windows audio chunk data is invalid.');
    const sequence = Number(value.sequence) || 0;
    const fileName = `windows-${value.source}-${String(sequence).padStart(6, '0')}.wav`;
    const filePath = path.join(this.active.directory, fileName);
    fs.mkdirSync(this.active.directory, { recursive: true });
    const bytes = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength);
    fs.writeFileSync(filePath, bytes);
    this.emit({ type: 'chunk-finalized', id: `${this.active.sessionId}-${value.source}-${sequence}`, sessionId: this.active.sessionId, source: value.source, sequence, startAt: String(value.startAt || new Date().toISOString()), endAt: value.endAt ? String(value.endAt) : null, durationSeconds: Math.max(0, Number(value.durationSeconds) || 0), fileName, sizeBytes: bytes.byteLength, finalized: true });
    return { ok: true };
  }

  private permissionResult(value: WindowsEvent & { microphone?: string; systemAudio?: string }): AudioPermissionStatus {
    const normalize = (item: unknown) => item === 'granted' || item === 'denied' || item === 'restricted' || item === 'requires_restart' || item === 'unavailable' ? item : 'not_requested';
    return { microphone: normalize(value.microphone), systemAudio: normalize(value.systemAudio) } as AudioPermissionStatus;
  }

  private emitError(value: WindowsEvent) { this.emit({ type: 'error', source: value.source || 'system_audio', error: windowsCaptureMessage(value.code, value.source), code: value.code as any }); }
  private toError(value: WindowsEvent) { return new AudioCaptureError((value.code as any) || 'capture_initialization_failed', windowsCaptureMessage(value.code, value.source), { source: value.source }); }
  private emit(event: AudioCaptureEvent) { this.listeners.forEach((listener) => listener(event)); }
}

function windowsCaptureMessage(code: string | undefined, source: AudioSourceName | undefined) {
  if (code === 'microphone_permission_denied') return 'Ledger cannot access your microphone. Enable microphone access for Ledger in Windows Settings, then try again.';
  if (code === 'no_microphone_available') return 'No usable microphone is available. Connect a microphone and try again.';
  if (code === 'display_capture_denied' || code === 'windows_loopback_unavailable' || code === 'no_output_device_available') return 'Ledger could not capture Windows audio. Confirm that an output device is active and try again.';
  if (code === 'device_disconnected' && source === 'user_microphone') return 'Your microphone was disconnected. System audio is still being recorded.';
  if (code === 'device_disconnected' && source === 'system_audio') return 'Windows audio capture stopped. Your microphone and existing recording are still available.';
  if (code === 'empty_audio_stream') return 'Windows did not provide a usable audio stream. Confirm your microphone and output device, then try again.';
  return 'Windows audio capture could not start. Check your microphone and output device, then try again.';
}
