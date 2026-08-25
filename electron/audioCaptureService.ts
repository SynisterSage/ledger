import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { shell } from 'electron';
import { RecordingSessionStore, type RecordingChunk, type RecordingSource } from './recordingSessionStore';
import { createAudioCaptureAdapter } from './audio-capture/createAudioCaptureAdapter';
import { AudioCaptureError, type AudioCaptureAdapter, type AudioCaptureEvent, type AudioSourceName } from './audio-capture/types';

export type { AudioInputDevice, AudioPermissionState, AudioSourceName } from './audio-capture/types';
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
export type AudioLevelEvent = { source: AudioSourceName; level: number };
export type AudioErrorEvent = { source: AudioSourceName; error: string };

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
  private readonly adapter: AudioCaptureAdapter;
  private activeSession: ActiveSession | null = null;
  private completedDirectories = new Map<string, string>();
  private levelListeners = new Set<(event: AudioLevelEvent) => void>();
  private errorListeners = new Set<(event: AudioErrorEvent) => void>();
  private deviceChangeListeners = new Set<() => void>();
  private readonly sessionStore: RecordingSessionStore;
  private diskTimer: NodeJS.Timeout | null = null;
  private stopInFlight: Promise<AudioCaptureStatus> | null = null;
  private chunkListeners = new Set<(chunk: RecordingChunk) => void>();
  private audioDataListeners = new Set<(event: Extract<AudioCaptureEvent, { type: 'audio-data' }>) => void>();

  constructor(sessionStore = new RecordingSessionStore(), adapter = createAudioCaptureAdapter()) {
    this.sessionStore = sessionStore;
    this.adapter = adapter;
    this.adapter.onEvent((event) => this.handleCaptureEvent(event));
    this.cleanAbandonedDirectories();
  }

  get isActive() { return Boolean(this.activeSession); }

  storagePath() { return this.sessionStore.storageRoot; }

  setRequesterId(requesterId: number) { this.adapter.setRequesterId?.(requesterId); }

  onLevel(listener: (event: AudioLevelEvent) => void) {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  onError(listener: (event: AudioErrorEvent) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onDevicesChanged(listener: () => void) {
    this.deviceChangeListeners.add(listener);
    return () => this.deviceChangeListeners.delete(listener);
  }

  onChunk(listener: (chunk: RecordingChunk) => void) {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  onAudioData(listener: (event: Extract<AudioCaptureEvent, { type: 'audio-data' }>) => void) {
    this.audioDataListeners.add(listener);
    return () => this.audioDataListeners.delete(listener);
  }

  async permissions() {
    return this.adapter.permissions();
  }

  async requestPermissions() {
    return this.adapter.requestPermissions();
  }

  openSystemSettings(area: 'microphone' | 'screen-recording') { return this.adapter.openSystemSettings(area); }

  async devices() {
    return this.adapter.devices();
  }

  async start(input: { noteId: string; workspaceId: string; microphone: boolean; systemAudio: boolean; microphoneDeviceId?: string | null; transcriptOffsetMs?: number }) {
    this.validateIdentity(input.noteId, input.workspaceId);
    if (this.activeSession) {
      if (this.activeSession.noteId === input.noteId) return this.publicStatus();
      throw new Error('Another meeting recording is already active. Return to that meeting note to continue.');
    }
    if (!input.microphone && !input.systemAudio) throw new Error('Select at least one audio source.');
    this.assertDiskSpace();
    const sessionId = randomUUID();
    const directory = this.sessionStore.activeDirectory(sessionId);
    this.sessionStore.start({
      sessionId,
      noteId: input.noteId,
      workspaceId: input.workspaceId,
      kind: 'meeting',
      startedAt: new Date().toISOString(),
      status: 'recording',
      enabledSources: [input.microphone ? 'user_microphone' : null, input.systemAudio ? 'system_audio' : null].filter(Boolean) as RecordingSource[],
      directoryRef: path.relative(this.sessionStore.storageRoot, directory),
      selectedMicrophoneId: input.microphoneDeviceId ?? null,
      transcriptOffsetMs: Number.isFinite(input.transcriptOffsetMs) ? Math.max(0, input.transcriptOffsetMs!) : 0,
    });
    try {
      const capture = await this.adapter.start({ sessionId, directory, microphone: input.microphone, systemAudio: input.systemAudio, microphoneDeviceId: input.microphone ? input.microphoneDeviceId ?? null : null });
      this.activeSession = {
        sessionId,
        noteId: input.noteId,
        workspaceId: input.workspaceId,
        kind: 'meeting',
        directory,
        sources: capture.sources,
        warnings: capture.warnings,
        startedAt: new Date().toISOString(),
        state: 'recording',
        durationSeconds: 0,
        chunkCount: 0,
        queueDepth: 0,
      };
      this.sessionStore.setSources(sessionId, capture.sources.map((source) => source.source));
      this.startDiskMonitor();
      return this.publicStatus();
    } catch (error) {
      this.sessionStore.setStatus(sessionId, 'discarded');
      this.sessionStore.promoteToRecovery(sessionId);
      throw error;
    }
  }

  async testSource(source: AudioSourceName, microphoneDeviceId?: string | null) {
    if (!SOURCE_NAMES.has(source)) throw new Error('Invalid audio source.');
    if (this.activeSession) throw new Error('Stop the current audio test before starting another one.');
    this.assertDiskSpace();
    const sessionId = `test-${randomUUID()}`;
    const directory = this.sessionStore.activeDirectory(sessionId);
    this.sessionStore.start({
      sessionId,
      noteId: null,
      workspaceId: null,
      kind: 'test',
      startedAt: new Date().toISOString(),
      status: 'recording',
      enabledSources: [source],
      directoryRef: path.relative(this.sessionStore.storageRoot, directory),
      selectedMicrophoneId: microphoneDeviceId ?? null,
    });
    let capture;
    try {
      capture = await this.adapter.testSource({ sessionId, directory, microphone: source === 'user_microphone', systemAudio: source === 'system_audio', microphoneDeviceId: source === 'user_microphone' ? microphoneDeviceId ?? null : null });
    } catch (error) {
      this.sessionStore.setStatus(sessionId, 'discarded');
      this.sessionStore.promoteToRecovery(sessionId);
      throw error;
    }
    this.activeSession = {
      sessionId,
      noteId: null,
      workspaceId: null,
      kind: 'test',
      directory,
      sources: capture.sources,
      warnings: capture.warnings,
      startedAt: new Date().toISOString(),
      state: 'recording',
      durationSeconds: 0,
      chunkCount: 0,
      queueDepth: 0,
    };
    this.sessionStore.setSources(sessionId, capture.sources.map((item) => item.source));
    this.startDiskMonitor();
    return this.publicStatus();
  }

  async pause() {
    // Auto-stop and renderer Stop can legitimately converge. Returning the
    // current idle status keeps a stale renderer from surfacing an IPC error.
    if (!this.activeSession) return this.publicStatus();
    await this.adapter.pause();
    this.activeSession!.state = 'paused';
    this.sessionStore.addPause(this.activeSession!.sessionId, new Date().toISOString());
    this.sessionStore.setStatus(this.activeSession!.sessionId, 'paused');
    return this.publicStatus();
  }

  async resume() {
    if (!this.activeSession) return this.publicStatus();
    await this.adapter.resume();
    this.activeSession!.state = 'recording';
    this.sessionStore.endPause(this.activeSession!.sessionId, new Date().toISOString());
    this.sessionStore.setStatus(this.activeSession!.sessionId, 'recording');
    return this.publicStatus();
  }

  async stop() {
    if (this.stopInFlight) return this.stopInFlight;
    const operation = this.finalizeStop();
    this.stopInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.stopInFlight === operation) this.stopInFlight = null;
    }
  }

  async prepareForSuspend() {
    if (!this.activeSession) return;
    await this.adapter.flush?.();
    this.sessionStore.markInterrupted(this.activeSession.sessionId);
  }

  async checkAfterResume() {
    if (!this.activeSession || !this.adapter.checkHealth) return true;
    const sources = await this.adapter.checkHealth();
    const failed = sources.filter((source) => !source.active);
    failed.forEach((source) => {
      this.sessionStore.addSourceError(this.activeSession!.sessionId, source.source, 'Audio capture did not survive system resume.');
      this.activeSession!.sources = this.activeSession!.sources.map((item) => item.source === source.source ? { ...item, active: false } : item);
      this.errorListeners.forEach((listener) => listener({ source: source.source, error: source.source === 'system_audio' ? 'Windows audio capture was interrupted by sleep. Your microphone and existing recording are still available.' : 'Your microphone was disconnected after sleep. System audio is still available.' }));
    });
    return failed.length === 0;
  }

  private async finalizeStop(): Promise<AudioCaptureStatus> {
    if (!this.activeSession) return this.publicStatus();
    const session = this.activeSession;
    this.sessionStore.setStatus(session.sessionId, 'finalizing');
    let response;
    try {
      response = await this.adapter.stop();
    } catch (error) {
      this.sessionStore.setStatus(session.sessionId, 'recovery_required');
      this.sessionStore.promoteToRecovery(session.sessionId);
      throw error instanceof AudioCaptureError ? error : new AudioCaptureError('capture_interrupted', 'Audio capture could not stop. Recoverable audio was preserved.', { cause: error });
    }
    session.state = 'stopped';
    session.durationSeconds = Number(response.durationSeconds) || 0;
    const stored = this.sessionStore.get(session.sessionId);
    if (!stored?.chunks.some((chunk) => chunk.finalized && chunk.sizeBytes > 44)) {
      this.sessionStore.setStatus(session.sessionId, 'recovery_required', session.durationSeconds);
      this.sessionStore.promoteToRecovery(session.sessionId);
      this.activeSession = null;
      this.stopDiskMonitor();
      throw new Error('No usable audio chunks were finalized. The session was preserved for recovery.');
    }
    this.sessionStore.setStatus(session.sessionId, 'ready', session.durationSeconds);
    const completedDirectory = this.sessionStore.promoteToCompleted(session.sessionId);
    this.completedDirectories.set(session.sessionId, completedDirectory);
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
    const directory = this.completedDirectories.get(sessionId) ?? this.sessionStore.directoryFor(session);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('The recording folder is no longer available.');
    const error = await shell.openPath(directory);
    if (error) shell.showItemInFolder(directory);
    return true;
  }

  async play(sessionId: string, source: AudioSourceName) {
    if (!safeId(sessionId) || !SOURCE_NAMES.has(source)) throw new Error('Invalid audio file reference.');
    const directory = this.completedDirectories.get(sessionId) ?? (this.sessionStore.get(sessionId) ? this.sessionStore.directoryFor(this.sessionStore.get(sessionId)!) : null);
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
    const directory = this.sessionStore.directoryFor(session);
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
    const directory = this.sessionStore.directoryFor(session);
    const usableChunks = session.chunks.filter((chunk) => chunk.finalized && fs.existsSync(path.join(directory, chunk.fileName)));
    if (!usableChunks.length) throw new Error('No recoverable audio chunks were found.');
    session.recoveryState = 'inspected';
    this.sessionStore.setStatus(sessionId, 'ready', session.durationSeconds);
    return this.publicSession(sessionId);
  }

  discard(sessionId: string) {
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new Error('Recording session was not found.');
    const directory = this.sessionStore.directoryFor(session);
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
    await this.adapter.shutdown();
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
      selectedMicrophoneId: session.selectedMicrophoneId ?? null,
      finalizationState: session.finalizationState ?? 'recording',
      interruptedAt: session.interruptedAt ?? null,
      transcription: session.transcription ?? null,
      diskAvailableBytes: this.sessionStore.diskSpace().availableBytes,
    };
  }

  private validateIdentity(noteId: string, workspaceId: string) {
    if (!safeId(noteId) || !safeId(workspaceId)) throw new Error('Meeting recording identity is invalid.');
  }

  private handleCaptureEvent(event: AudioCaptureEvent) {
    if (event.type === 'devices-changed') {
      this.deviceChangeListeners.forEach((listener) => listener());
      return;
    }
    if (event.type === 'level') {
      this.levelListeners.forEach((listener) => listener({ source: event.source, level: event.level }));
      return;
    }
    if (event.type === 'audio-data') {
      if (this.activeSession && event.sessionId === this.activeSession.sessionId) this.audioDataListeners.forEach((listener) => listener(event));
      return;
    }
    if (event.type === 'error') {
      if (this.activeSession) {
        this.sessionStore.addSourceError(this.activeSession.sessionId, event.source, event.error);
        this.activeSession.sources = this.activeSession.sources.map((source) => source.source === event.source ? { ...source, active: false } : source);
        if (this.activeSession.sources.every((source) => !source.active)) {
          this.activeSession.state = 'paused';
          this.sessionStore.setStatus(this.activeSession.sessionId, 'paused');
        }
      }
      this.errorListeners.forEach((listener) => listener({ source: event.source, error: event.error }));
      return;
    }
    if (!this.activeSession) return;
    const session = this.activeSession;
    const chunk: RecordingChunk = { ...event, fileName: path.basename(event.fileName) };
    if (chunk.fileName && chunk.sessionId === session.sessionId) {
      this.sessionStore.addChunk(session.sessionId, chunk);
      session.chunkCount = this.sessionStore.get(session.sessionId)?.chunks.length ?? session.chunkCount + 1;
      this.chunkListeners.forEach((listener) => listener(chunk));
    }
  }

  private cleanAbandonedDirectories() {
    try {
      const root = this.sessionStore.storageRoot;
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
