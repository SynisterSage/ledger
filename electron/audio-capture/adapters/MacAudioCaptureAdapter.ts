import { spawn } from 'node:child_process';
import { app, desktopCapturer, shell, systemPreferences } from 'electron';
import path from 'node:path';
import { AudioCaptureError, type AudioCaptureAdapter, type AudioCaptureEvent, type AudioCaptureStartOptions, type AudioCaptureSession, type AudioDeviceInfo, type AudioPermissionState, type AudioPermissionStatus, type AudioCaptureStopResult, type NativeAudioBridge, type AudioSourceName } from '../types';

type BridgeResponse = Record<string, any> & { ok?: boolean; event?: string; code?: string };
type BridgeRequest = { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };

const SOURCE_NAMES = new Set<AudioSourceName>(['user_microphone', 'system_audio']);

export class MacAudioCaptureAdapter implements AudioCaptureAdapter {
  private bridge: NativeAudioBridge | null = null;
  private bridgeBuffer = '';
  private bridgeQueue: Promise<unknown> = Promise.resolve();
  private currentRequest: BridgeRequest | null = null;
  private listeners = new Set<(event: AudioCaptureEvent) => void>();

  isSupported() { return process.platform === 'darwin'; }

  async permissions(): Promise<AudioPermissionStatus> {
    const response = await this.invoke({ command: 'permission-status' });
    return {
      microphone: this.permissionState(this.microphonePermission() ?? response.microphone),
      systemAudio: this.permissionState(this.screenPermission() ?? response.systemAudio),
    };
  }

  async requestPermissions(): Promise<AudioPermissionStatus> {
    if (!this.isSupported()) throw this.platformError();
    await systemPreferences.askForMediaAccess('microphone');
    await this.touchScreenCapturePermission();
    return this.permissions();
  }

  async openSystemSettings(area: 'microphone' | 'screen-recording') {
    if (!this.isSupported()) return false;
    const target = area === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture';
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${target}`);
    return true;
  }

  async devices(): Promise<AudioDeviceInfo> {
    const response = await this.invoke({ command: 'devices' });
    return {
      devices: Array.isArray(response.devices)
        ? response.devices.filter((device) => device && typeof device.id === 'string' && typeof device.name === 'string').map((device) => ({
          id: device.id,
          name: device.name,
          kind: 'input' as const,
          available: device.available !== false,
          isBluetooth: device.isBluetooth === true,
          isDefault: device.isDefault === true,
          isOutputDefault: device.isOutputDefault === true,
          channelCount: Number(device.channelCount) || 1,
        }))
        : [],
      outputDevice: response.outputDevice && typeof response.outputDevice.id === 'string'
        ? { id: response.outputDevice.id, name: String(response.outputDevice.name || 'Current output'), isBluetooth: response.outputDevice.isBluetooth === true }
        : null,
    };
  }

  async start(options: AudioCaptureStartOptions) { return this.startCapture({ ...options, command: 'start' }); }
  async testSource(options: AudioCaptureStartOptions) { return this.startCapture({ ...options, command: 'test-source' }); }

  async pause() { await this.expectOk(this.invoke({ command: 'pause' }), 'Audio capture could not pause.'); }
  async resume() { await this.expectOk(this.invoke({ command: 'resume' }), 'Audio capture could not resume.'); }

  async stop(): Promise<AudioCaptureStopResult> {
    const response = await this.expectOk(this.invoke({ command: 'stop' }), 'Audio capture could not stop.');
    return { durationSeconds: Number(response.durationSeconds) || 0, startedAt: response.startedAt, endedAt: response.endedAt };
  }

  onEvent(listener: (event: AudioCaptureEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async shutdown() {
    const bridge = this.bridge;
    this.bridge = null;
    this.bridgeBuffer = '';
    this.currentRequest && this.rejectBridgeRequest(new AudioCaptureError('capture_interrupted', 'The macOS audio capture helper was stopped.'));
    if (bridge) {
      bridge.stdin.end();
      bridge.kill();
    }
  }

  private async startCapture(options: AudioCaptureStartOptions & { command: 'start' | 'test-source' }): Promise<AudioCaptureSession> {
    const response = await this.expectOk(this.invoke(options), 'Audio capture could not start.');
    return { sessionId: options.sessionId, sources: this.normalizeSources(response.sources), warnings: this.normalizeWarnings(response.warnings) };
  }

  private expectOk(request: Promise<BridgeResponse>, fallback: string) {
    return request.then((response) => {
      if (!response.ok) throw this.errorFromResponse(response, fallback);
      return response;
    });
  }

  private errorFromResponse(response: BridgeResponse, fallback: string) {
    const code = String(response.code || 'unknown');
    const message = String(response.error || fallback);
    const mapped = code === 'no_sources' || code === 'no_sources_started'
      ? /microphone/i.test(message) && /permission|denied/i.test(message)
        ? 'microphone_permission_denied'
        : /system audio/i.test(message) && /permission|denied/i.test(message)
          ? 'system_audio_permission_denied'
          : 'capture_initialization_failed'
      : code === 'directory_failed'
        ? 'storage_failed'
        : code === 'device_unavailable'
          ? 'no_microphone_available'
          : code === 'already_recording'
            ? 'already_recording'
            : code === 'invalid_state'
              ? 'invalid_state'
              : 'capture_initialization_failed';
    return new AudioCaptureError(mapped, message);
  }

  private bridgePath() { return app.isPackaged ? path.join(process.resourcesPath, 'LedgerAudioCaptureBridge') : path.join(app.getAppPath(), 'native', 'LedgerAudioCaptureBridge'); }

  private ensureBridge() {
    if (!this.isSupported()) throw this.platformError();
    if (this.bridge && !this.bridge.killed) return;
    const child = spawn(this.bridgePath(), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.bridge = child;
    child.stdout.on('data', (chunk) => this.handleBridgeOutput(String(chunk)));
    child.stderr.on('data', (chunk) => console.warn('[audio-capture]', String(chunk).trim()));
    child.once('error', (error) => this.rejectBridgeRequest(new AudioCaptureError('capture_interrupted', 'The macOS audio capture helper could not start.', { cause: error })));
    child.once('exit', () => { this.bridge = null; this.rejectBridgeRequest(new AudioCaptureError('capture_interrupted', 'The macOS audio capture helper exited.')); });
  }

  private invoke(payload: Record<string, unknown>): Promise<BridgeResponse> {
    const run = async () => {
      this.ensureBridge();
      return await new Promise<BridgeResponse>((resolve, reject) => {
        if (!this.bridge?.stdin.writable) { reject(new AudioCaptureError('capture_interrupted', 'The macOS audio capture helper is unavailable.')); return; }
        const timeout = setTimeout(() => {
          if (this.currentRequest?.timeout !== timeout) return;
          this.currentRequest = null;
          const helper = this.bridge;
          this.bridge = null;
          helper?.kill();
          reject(new AudioCaptureError('capture_interrupted', 'The macOS audio capture helper timed out. The meeting controls were unlocked; try again after checking audio permissions.'));
        }, 15_000);
        this.currentRequest = { resolve, reject, timeout };
        this.bridge.stdin.write(`${JSON.stringify(payload)}\n`);
      });
    };
    const next = this.bridgeQueue.then(run, run);
    this.bridgeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private handleBridgeOutput(chunk: string) {
    this.bridgeBuffer += chunk;
    const lines = this.bridgeBuffer.split(/\r?\n/);
    this.bridgeBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let payload: BridgeResponse;
      try { payload = JSON.parse(line); } catch { continue; }
      if (payload.event === 'level' && SOURCE_NAMES.has(payload.source)) {
        this.emit({ type: 'level', source: payload.source, level: Math.max(0, Math.min(1, Number(payload.level) || 0)) });
      } else if (payload.event === 'error' && SOURCE_NAMES.has(payload.source)) {
        this.emit({ type: 'error', source: payload.source, error: String(payload.error || 'Audio capture failed.'), code: payload.code as any });
      } else if (payload.event === 'chunk-finalized' && SOURCE_NAMES.has(payload.source)) {
        this.emit({ type: 'chunk-finalized', id: String(payload.id), sessionId: String(payload.sessionId), source: payload.source, sequence: Number(payload.sequence) || 0, startAt: String(payload.startAt || ''), endAt: payload.endAt ? String(payload.endAt) : null, durationSeconds: Math.max(0, Number(payload.durationSeconds) || 0), fileName: path.basename(String(payload.fileName || '')), sizeBytes: Number(payload.sizeBytes) || 0, finalized: payload.finalized !== false });
      } else if (this.currentRequest) {
        const request = this.currentRequest;
        this.currentRequest = null;
        clearTimeout(request.timeout);
        request.resolve(payload);
      }
    }
  }

  private emit(event: AudioCaptureEvent) { this.listeners.forEach((listener) => listener(event)); }
  private rejectBridgeRequest(error: Error) { if (!this.currentRequest) return; const request = this.currentRequest; this.currentRequest = null; clearTimeout(request.timeout); request.reject(error); }
  private platformError() { return new AudioCaptureError('platform_unsupported', 'Meeting audio capture is unavailable on this platform.'); }
  private permissionState(value: unknown): AudioPermissionState { return value === 'granted' || value === 'denied' || value === 'restricted' || value === 'requires_restart' || value === 'unavailable' ? value : 'not_requested'; }
  private microphonePermission() { if (!this.isSupported()) return null; try { const status = systemPreferences.getMediaAccessStatus('microphone'); return status === 'not-determined' ? 'not_requested' : status as AudioPermissionState; } catch { return null; } }
  private screenPermission() { if (!this.isSupported()) return null; try { const status = systemPreferences.getMediaAccessStatus('screen'); return status === 'not-determined' ? 'not_requested' : status as AudioPermissionState; } catch { return null; } }
  private async touchScreenCapturePermission() { if (!this.isSupported()) return; try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false }); } catch {} }
  private normalizeSources(value: unknown) { return Array.isArray(value) ? value.filter((item) => item && SOURCE_NAMES.has(item.source)).map((item) => ({ source: item.source, sampleRate: Number(item.sampleRate) || 16_000, channels: Number(item.channels) || 1, active: item.active !== false })) : []; }
  private normalizeWarnings(value: unknown) { return Array.isArray(value) ? value.filter((item) => item && SOURCE_NAMES.has(item.source) && typeof item.error === 'string').map((item) => ({ source: item.source, error: item.error })) : []; }
}
