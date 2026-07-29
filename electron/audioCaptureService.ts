import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, shell } from 'electron';
import { RecordingSessionStore, type RecordingChunk, type RecordingSource } from './recordingSessionStore';

export type AudioPermissionState =
  | 'not_requested'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'requires_restart'
  | 'unavailable';

export type AudioSourceName = 'user_microphone' | 'system_audio';
export type AudioCaptureState = 'idle' | 'recording' | 'paused' | 'stopped';

export type AudioCaptureStatus = {
  state: AudioCaptureState;
  sessionId: string | null;
  noteId: string | null;
  workspaceId: string | null;
  kind: 'meeting' | 'test' | null;
  sources: Array<{
    source: AudioSourceName;
    sampleRate: number;
    channels: number;
    active: boolean;
  }>;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  warnings: Array<{ source: AudioSourceName; error: string }>;
  chunkCount: number;
  queueDepth: number;
  diskAvailableBytes: number;
};
export type AudioInputDevice = {
  id: string;
  name: string;
  kind: 'input';
  available: boolean;
  isBluetooth: boolean;
  isDefault: boolean;
  isOutputDefault: boolean;
  channelCount: number;
};

export type AudioLevelEvent = { source: AudioSourceName; level: number };
export type AudioErrorEvent = { source: AudioSourceName; error: string };

type BridgeResponse = Record<string, any> & { ok?: boolean; event?: string };
type BridgeRequest = {
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};
type ActiveSession = {
  sessionId: string;
  noteId: string | null;
  workspaceId: string | null;
  kind: 'meeting' | 'test';
  directory: string;
  sources: AudioCaptureStatus['sources'];
  warnings: AudioCaptureStatus['warnings'];
  startedAt: string;
  state: AudioCaptureState;
  durationSeconds: number;
  chunkCount: number;
  queueDepth: number;
};

const SOURCE_NAMES = new Set<AudioSourceName>(['user_microphone', 'system_audio']);
const safeId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(value);

export class MeetingAudioCaptureService {
  private bridge: ChildProcessWithoutNullStreams | null = null;
  private bridgeBuffer = '';
  private bridgeQueue: Promise<unknown> = Promise.resolve();
  private currentRequest: BridgeRequest | null = null;
  private activeSession: ActiveSession | null = null;
  private completedDirectories = new Map<string, string>();
  private levelListeners = new Set<(event: AudioLevelEvent) => void>();
  private errorListeners = new Set<(event: AudioErrorEvent) => void>();
  private readonly sessionStore: RecordingSessionStore;
  private diskTimer: NodeJS.Timeout | null = null;

  constructor(sessionStore = new RecordingSessionStore()) {
    this.sessionStore = sessionStore;
    this.cleanAbandonedDirectories();
  }

  get isActive() { return Boolean(this.activeSession); }

  onLevel(listener: (event: AudioLevelEvent) => void) {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  onError(listener: (event: AudioErrorEvent) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async permissions() {
    const response = await this.invoke({ command: 'permission-status' });
    return {
      microphone: this.permissionState(response.microphone),
      systemAudio: this.permissionState(response.systemAudio),
    };
  }

  async requestPermissions() {
    const response = await this.invoke({ command: 'request-permissions' });
    return {
      microphone: this.permissionState(response.microphone),
      systemAudio: this.permissionState(response.systemAudio),
    };
  }

  async devices() {
    const response = await this.invoke({ command: 'devices' });
    return {
      devices: Array.isArray(response.devices) ? response.devices.filter((device) => device && typeof device.id === 'string' && typeof device.name === 'string').map((device) => ({
        id: device.id,
        name: device.name,
        kind: 'input' as const,
        available: device.available !== false,
        isBluetooth: device.isBluetooth === true,
        isDefault: device.isDefault === true,
        isOutputDefault: device.isOutputDefault === true,
        channelCount: Number(device.channelCount) || 1,
      })) as AudioInputDevice[] : [],
      outputDevice: response.outputDevice && typeof response.outputDevice.id === 'string' ? {
        id: response.outputDevice.id,
        name: String(response.outputDevice.name || 'Current output'),
        isBluetooth: response.outputDevice.isBluetooth === true,
      } : null,
    };
  }

  async start(input: { noteId: string; workspaceId: string; microphone: boolean; systemAudio: boolean; microphoneDeviceId?: string | null }) {
    this.validateIdentity(input.noteId, input.workspaceId);
    if (this.activeSession) {
      if (this.activeSession.noteId === input.noteId) return this.publicStatus();
      throw new Error('Another meeting recording is already active. Return to that meeting note to continue.');
    }
    if (!input.microphone && !input.systemAudio) throw new Error('Select at least one audio source.');
    this.assertDiskSpace();
    const sessionId = randomUUID();
    const directory = path.join(app.getPath('temp'), 'ledger-meeting-audio', sessionId);
    this.sessionStore.start({
      sessionId,
      noteId: input.noteId,
      workspaceId: input.workspaceId,
      kind: 'meeting',
      startedAt: new Date().toISOString(),
      status: 'recording',
      enabledSources: [input.microphone ? 'user_microphone' : null, input.systemAudio ? 'system_audio' : null].filter(Boolean) as RecordingSource[],
      directoryRef: sessionId,
    });
    let response: BridgeResponse;
    try {
      response = await this.invoke({ command: 'start', sessionId, directory, microphone: input.microphone, systemAudio: input.systemAudio, microphoneDeviceId: input.microphone ? input.microphoneDeviceId ?? null : null });
    } catch (error) {
      this.sessionStore.setStatus(sessionId, 'discarded');
      throw error;
    }
    if (!response.ok) {
      this.sessionStore.setStatus(sessionId, 'discarded');
      throw new Error(response.error || 'Audio capture could not start.');
    }
    const startedAt = new Date().toISOString();
    this.activeSession = {
      sessionId,
      noteId: input.noteId,
      workspaceId: input.workspaceId,
      kind: 'meeting',
      directory,
      sources: this.normalizeSources(response.sources),
      warnings: this.normalizeWarnings(response.warnings),
      startedAt,
      state: 'recording',
      durationSeconds: 0,
      chunkCount: 0,
      queueDepth: 0,
    };
    this.sessionStore.setSources(sessionId, this.normalizeSources(response.sources).map((source) => source.source));
    this.startDiskMonitor();
    return this.publicStatus();
  }

  async testSource(source: AudioSourceName, microphoneDeviceId?: string | null) {
    if (!SOURCE_NAMES.has(source)) throw new Error('Invalid audio source.');
    if (this.activeSession) throw new Error('Stop the current audio test before starting another one.');
    this.assertDiskSpace();
    const sessionId = `test-${randomUUID()}`;
    const directory = path.join(app.getPath('temp'), 'ledger-meeting-audio', sessionId);
    this.sessionStore.start({
      sessionId,
      noteId: null,
      workspaceId: null,
      kind: 'test',
      startedAt: new Date().toISOString(),
      status: 'recording',
      enabledSources: [source],
      directoryRef: sessionId,
    });
    const response = await this.invoke({ command: 'test-source', sessionId, directory, microphone: source === 'user_microphone', systemAudio: source === 'system_audio', microphoneDeviceId: source === 'user_microphone' ? microphoneDeviceId ?? null : null });
    if (!response.ok) {
      this.sessionStore.setStatus(sessionId, 'discarded');
      throw new Error(response.error || 'Audio test could not start.');
    }
    this.activeSession = {
      sessionId,
      noteId: null,
      workspaceId: null,
      kind: 'test',
      directory,
      sources: this.normalizeSources(response.sources),
      warnings: this.normalizeWarnings(response.warnings),
      startedAt: new Date().toISOString(),
      state: 'recording',
      durationSeconds: 0,
      chunkCount: 0,
      queueDepth: 0,
    };
    this.sessionStore.setSources(sessionId, this.normalizeSources(response.sources).map((item) => item.source));
    this.startDiskMonitor();
    return this.publicStatus();
  }

  async pause() {
    this.requireActive();
    const response = await this.invoke({ command: 'pause' });
    if (!response.ok) throw new Error(response.error || 'Audio capture could not pause.');
    this.activeSession!.state = 'paused';
    this.sessionStore.addPause(this.activeSession!.sessionId, new Date().toISOString());
    this.sessionStore.setStatus(this.activeSession!.sessionId, 'paused');
    return this.publicStatus();
  }

  async resume() {
    this.requireActive();
    const response = await this.invoke({ command: 'resume' });
    if (!response.ok) throw new Error(response.error || 'Audio capture could not resume.');
    this.activeSession!.state = 'recording';
    this.sessionStore.endPause(this.activeSession!.sessionId, new Date().toISOString());
    this.sessionStore.setStatus(this.activeSession!.sessionId, 'recording');
    return this.publicStatus();
  }

  async stop() {
    if (!this.activeSession) return this.publicStatus();
    const session = this.activeSession;
    this.sessionStore.setStatus(session.sessionId, 'finalizing');
    const response = await this.invoke({ command: 'stop' });
    if (!response.ok) {
      this.sessionStore.setStatus(session.sessionId, 'recovery_required');
      throw new Error(response.error || 'Audio capture could not stop. Recoverable audio was preserved.');
    }
    session.state = 'stopped';
    session.durationSeconds = Number(response.durationSeconds) || 0;
    const stored = this.sessionStore.get(session.sessionId);
    if (!stored?.chunks.some((chunk) => chunk.finalized && chunk.sizeBytes > 44)) {
      this.sessionStore.setStatus(session.sessionId, 'recovery_required', session.durationSeconds);
      this.activeSession = null;
      this.stopDiskMonitor();
      throw new Error('No usable audio chunks were finalized. The session was preserved for recovery.');
    }
    this.sessionStore.setStatus(session.sessionId, 'ready', session.durationSeconds);
    this.completedDirectories.set(session.sessionId, session.directory);
    this.activeSession = null;
    this.stopDiskMonitor();
    return {
      ...this.publicStatus(),
      sessionId: session.sessionId,
      kind: session.kind,
      noteId: session.noteId,
      workspaceId: session.workspaceId,
      startedAt: response.startedAt || session.startedAt,
      endedAt: response.endedAt || new Date().toISOString(),
      durationSeconds: session.durationSeconds,
      sources: session.sources,
      warnings: session.warnings,
      chunkCount: session.chunkCount,
      queueDepth: 0,
      diskAvailableBytes: this.sessionStore.diskSpace().availableBytes,
    } satisfies AudioCaptureStatus;
  }

  status() { return this.publicStatus(); }

  async reveal(sessionId: string) {
    if (!safeId(sessionId)) throw new Error('Invalid recording session.');
    const session = this.sessionStore.get(sessionId);
    if (!session || session.kind !== 'meeting' || !session.noteId || !session.workspaceId) {
      throw new Error('That meeting recording is not available for this workspace.');
    }
    const directory = this.completedDirectories.get(sessionId) ?? path.join(app.getPath('temp'), 'ledger-meeting-audio', session.directoryRef);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('The recording folder is no longer available.');
    const error = await shell.openPath(directory);
    if (error) shell.showItemInFolder(directory);
    return true;
  }

  async play(sessionId: string, source: AudioSourceName) {
    if (!safeId(sessionId) || !SOURCE_NAMES.has(source)) throw new Error('Invalid audio file reference.');
    const directory = this.completedDirectories.get(sessionId) ?? (this.sessionStore.get(sessionId) ? path.join(app.getPath('temp'), 'ledger-meeting-audio', sessionId) : null);
    const firstChunk = this.sessionStore.get(sessionId)?.chunks.find((chunk) => chunk.source === source);
    const file = directory && firstChunk ? path.join(directory, firstChunk.fileName) : null;
    if (!file || !fs.existsSync(file)) throw new Error('The requested temporary recording file is not available.');
    const error = await shell.openPath(file);
    if (error) throw new Error('The audio file could not be opened.');
    return true;
  }

  deleteAudio(sessionId: string, source?: AudioSourceName) {
    if (!safeId(sessionId) || (source && !SOURCE_NAMES.has(source))) throw new Error('Invalid audio file reference.');
    if (this.activeSession?.sessionId === sessionId) throw new Error('Active recording audio cannot be deleted.');
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new Error('That temporary recording is no longer available.');
    const directory = path.join(app.getPath('temp'), 'ledger-meeting-audio', session.directoryRef);
    const targets = session.chunks.filter((chunk) => !source || chunk.source === source);
    targets.forEach((chunk) => fs.rmSync(path.join(directory, chunk.fileName), { force: true }));
    if (source) this.sessionStore.removeChunks(sessionId, source);
    else { fs.rmSync(directory, { recursive: true, force: true }); this.sessionStore.remove(sessionId); }
    return { ok: true };
  }

  recoveries() {
    return this.sessionStore.recoveries().map((session) => ({ ...session, directoryRef: session.directoryRef, diskAvailableBytes: this.sessionStore.diskSpace().availableBytes }));
  }

  async recover(sessionId: string, noteId: string, workspaceId: string) {
    const session = this.sessionStore.get(sessionId);
    if (!session || session.recoveryState !== 'required' || session.noteId !== noteId || session.workspaceId !== workspaceId) throw new Error('This recording cannot be attached to the requested note or workspace.');
    const directory = path.join(app.getPath('temp'), 'ledger-meeting-audio', session.directoryRef);
    const usableChunks = session.chunks.filter((chunk) => chunk.finalized && fs.existsSync(path.join(directory, chunk.fileName)));
    if (!usableChunks.length) throw new Error('No recoverable audio chunks were found.');
    session.recoveryState = 'inspected';
    this.sessionStore.setStatus(sessionId, 'ready', session.durationSeconds);
    return this.publicSession(sessionId);
  }

  discard(sessionId: string) {
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new Error('Recording session was not found.');
    const directory = path.join(app.getPath('temp'), 'ledger-meeting-audio', session.directoryRef);
    fs.rmSync(directory, { recursive: true, force: true });
    this.sessionStore.setStatus(sessionId, 'discarded');
    this.sessionStore.remove(sessionId);
    return { ok: true };
  }

  inspect(sessionId?: string) {
    return sessionId ? this.publicSession(sessionId) : this.sessionStore.list().map((session) => this.publicSession(session.sessionId));
  }

  async shutdown() {
    try { if (this.activeSession) await this.stop(); } catch {}
    this.stopDiskMonitor();
    if (this.bridge) {
      this.bridge.stdin.end();
      this.bridge.kill();
      this.bridge = null;
    }
  }

  private publicStatus(): AudioCaptureStatus {
    const session = this.activeSession;
    return {
      state: session?.state ?? 'idle',
      sessionId: session?.sessionId ?? null,
      noteId: session?.noteId ?? null,
      workspaceId: session?.workspaceId ?? null,
      kind: session?.kind ?? null,
      sources: session?.sources ?? [],
      startedAt: session?.startedAt ?? null,
      endedAt: null,
      durationSeconds: session?.durationSeconds ?? 0,
      warnings: session?.warnings ?? [],
      chunkCount: session?.chunkCount ?? 0,
      queueDepth: session?.queueDepth ?? 0,
      diskAvailableBytes: this.sessionStore.diskSpace().availableBytes,
    };
  }

  private publicSession(sessionId: string) {
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new Error('Recording session was not found.');
    return {
      sessionId: session.sessionId,
      noteId: session.noteId,
      workspaceId: session.workspaceId,
      kind: session.kind,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      status: session.status,
      enabledSources: session.enabledSources,
      chunkCount: session.chunks.length,
      chunks: session.chunks.map((chunk) => ({ ...chunk, fileName: path.basename(chunk.fileName) })),
      pauseIntervals: session.pauseIntervals,
      sourceErrors: session.sourceErrors,
      recoveryState: session.recoveryState,
      durationSeconds: session.durationSeconds,
      warnings: session.warnings,
      diskAvailableBytes: this.sessionStore.diskSpace().availableBytes,
    };
  }

  private validateIdentity(noteId: string, workspaceId: string) {
    if (!safeId(noteId) || !safeId(workspaceId)) throw new Error('Meeting recording identity is invalid.');
  }

  private requireActive() { if (!this.activeSession) throw new Error('No audio capture session is active.'); }

  private permissionState(value: unknown): AudioPermissionState {
    return value === 'granted' || value === 'denied' || value === 'restricted' || value === 'requires_restart' || value === 'unavailable' ? value : 'not_requested';
  }

  private normalizeSources(value: unknown): AudioCaptureStatus['sources'] {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && SOURCE_NAMES.has(item.source)).map((item) => ({ source: item.source, sampleRate: Number(item.sampleRate) || 16_000, channels: Number(item.channels) || 1, active: item.active !== false }));
  }

  private normalizeWarnings(value: unknown): AudioCaptureStatus['warnings'] {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && SOURCE_NAMES.has(item.source) && typeof item.error === 'string').map((item) => ({ source: item.source, error: item.error }));
  }

  private bridgePath() { return app.isPackaged ? path.join(process.resourcesPath, 'LedgerAudioCaptureBridge') : path.join(app.getAppPath(), 'native', 'LedgerAudioCaptureBridge'); }

  private ensureBridge() {
    if (process.platform !== 'darwin') throw new Error('Meeting audio capture requires the packaged macOS Ledger app.');
    if (this.bridge && !this.bridge.killed) return;
    const child = spawn(this.bridgePath(), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.bridge = child;
    child.stdout.on('data', (chunk) => this.handleBridgeOutput(String(chunk)));
    child.stderr.on('data', (chunk) => console.warn('[audio-capture]', String(chunk).trim()));
    child.once('error', (error) => this.rejectBridgeRequest(error));
    child.once('exit', () => { this.bridge = null; this.rejectBridgeRequest(new Error('The macOS audio capture helper exited.')); });
  }

  private invoke(payload: Record<string, unknown>): Promise<BridgeResponse> {
    const run = async () => {
      this.ensureBridge();
      return await new Promise<BridgeResponse>((resolve, reject) => {
        if (!this.bridge?.stdin.writable) { reject(new Error('The macOS audio capture helper is unavailable.')); return; }
        const timeout = setTimeout(() => {
          if (this.currentRequest?.timeout !== timeout) return;
          this.currentRequest = null;
          const helper = this.bridge;
          this.bridge = null;
          helper?.kill();
          reject(new Error('The macOS audio capture helper timed out. The meeting controls were unlocked; try again after checking audio permissions.'));
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
        const level = Math.max(0, Math.min(1, Number(payload.level) || 0));
        this.levelListeners.forEach((listener) => listener({ source: payload.source, level }));
      } else if (payload.event === 'error' && SOURCE_NAMES.has(payload.source)) {
        if (this.activeSession) {
          const message = String(payload.error || 'Audio capture failed.');
          this.sessionStore.addSourceError(this.activeSession.sessionId, payload.source, message);
          this.activeSession.sources = this.activeSession.sources.map((source) => source.source === payload.source ? { ...source, active: false } : source);
          if (this.activeSession.sources.every((source) => !source.active)) {
            this.activeSession.state = 'paused';
            this.sessionStore.setStatus(this.activeSession.sessionId, 'paused');
          }
        }
        this.errorListeners.forEach((listener) => listener({ source: payload.source, error: String(payload.error || 'Audio capture failed.') }));
      } else if (payload.event === 'chunk-finalized' && SOURCE_NAMES.has(payload.source) && this.activeSession) {
        const session = this.activeSession;
        const chunk: RecordingChunk = {
          id: String(payload.id),
          sessionId: session.sessionId,
          source: payload.source,
          sequence: Number(payload.sequence) || 0,
          startAt: String(payload.startAt || session.startedAt),
          endAt: payload.endAt ? String(payload.endAt) : null,
          durationSeconds: Math.max(0, Number(payload.durationSeconds) || 0),
          fileName: path.basename(String(payload.fileName || '')),
          finalized: payload.finalized !== false,
          sizeBytes: Number(payload.sizeBytes) || 0,
        };
        if (chunk.fileName) {
          this.sessionStore.addChunk(session.sessionId, chunk);
          session.chunkCount = this.sessionStore.get(session.sessionId)?.chunks.length ?? session.chunkCount + 1;
        }
      } else if (this.currentRequest) {
        const request = this.currentRequest;
        this.currentRequest = null;
        clearTimeout(request.timeout);
        request.resolve(payload);
      }
    }
  }

  private rejectBridgeRequest(error: Error) {
    if (!this.currentRequest) return;
    const request = this.currentRequest;
    this.currentRequest = null;
    clearTimeout(request.timeout);
    request.reject(error);
  }

  private cleanAbandonedDirectories() {
    try {
      const root = path.join(app.getPath('temp'), 'ledger-meeting-audio');
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        const age = Date.now() - fs.statSync(target).mtimeMs;
        const tracked = this.sessionStore.get(entry.name);
        if (entry.isDirectory() && age > 24 * 60 * 60 * 1000 && !tracked && entry.name.startsWith('test-')) fs.rmSync(target, { recursive: true, force: true });
      }
    } catch {}
  }

  private assertDiskSpace() {
    const { availableBytes } = this.sessionStore.diskSpace();
    if (availableBytes < 100 * 1024 * 1024) throw new Error('Ledger needs at least 100 MB of free space before recording.');
  }

  private startDiskMonitor() {
    this.stopDiskMonitor();
    this.diskTimer = setInterval(() => {
      if (!this.activeSession) return;
      const availableBytes = this.sessionStore.diskSpace().availableBytes;
      if (availableBytes < 100 * 1024 * 1024) {
        this.errorListeners.forEach((listener) => listener({ source: 'user_microphone', error: 'Ledger stopped recording because available disk space is critically low.' }));
        void this.stop().catch(() => undefined);
      } else if (availableBytes < 500 * 1024 * 1024) {
        this.errorListeners.forEach((listener) => listener({ source: 'user_microphone', error: 'Available disk space is low. Ledger will stop before storage is exhausted.' }));
      }
    }, 5000);
  }

  private stopDiskMonitor() {
    if (this.diskTimer) clearInterval(this.diskTimer);
    this.diskTimer = null;
  }
}
