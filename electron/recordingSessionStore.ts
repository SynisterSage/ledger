import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type RecordingSource = 'user_microphone' | 'system_audio';
export type RecordingSessionStatus =
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'ready'
  | 'recovery_required'
  | 'discarded';
export type RecordingFinalizationState = 'recording' | 'finalizing' | 'completed' | 'recovery-needed' | 'failed';

export type RecordingChunk = {
  id: string;
  sessionId: string;
  source: RecordingSource;
  sequence: number;
  startAt: string;
  endAt: string | null;
  durationSeconds: number;
  fileName: string;
  finalized: boolean;
  sizeBytes: number;
  sha256?: string;
};

export type RecordingSession = {
  sessionId: string;
  noteId: string | null;
  workspaceId: string | null;
  kind: 'meeting' | 'test';
  startedAt: string;
  lastActivityAt: string;
  status: RecordingSessionStatus;
  enabledSources: RecordingSource[];
  directoryRef: string;
  chunks: RecordingChunk[];
  pauseIntervals: Array<{ startedAt: string; endedAt: string | null }>;
  sourceErrors: Array<{ source: RecordingSource; at: string; error: string }>;
  recoveryState: 'none' | 'required' | 'inspected' | 'discarded';
  durationSeconds: number;
  warnings: string[];
  selectedMicrophoneId?: string | null;
  transcriptOffsetMs?: number;
  finalizationState?: RecordingFinalizationState;
  interruptedAt?: string | null;
  transcription?: { jobId: string | null; status: string | null; progress: number; segmentCount: number };
};

type StoreFile = { version: 1; sessions: RecordingSession[] };

const RECOVERY_STATUSES = new Set<RecordingSessionStatus>(['recording', 'paused', 'finalizing']);
const sourceSet = new Set<RecordingSource>(['user_microphone', 'system_audio']);

export class RecordingSessionStore {
  private readonly root: string;
  private readonly file: string;
  private sessions = new Map<string, RecordingSession>();

  constructor() {
    this.root = path.join(app.getPath('userData'), 'meeting-recordings');
    this.file = path.join(this.root, 'sessions.json');
    fs.mkdirSync(this.root, { recursive: true });
    for (const folder of ['active', 'completed', 'recovery']) fs.mkdirSync(path.join(this.root, folder), { recursive: true });
    this.load();
  }

  get storageRoot() { return this.root; }
  activeDirectory(sessionId: string) { return path.join(this.root, 'active', sessionId); }
  completedDirectory(sessionId: string) { return path.join(this.root, 'completed', sessionId); }
  recoveryDirectory(sessionId: string) { return path.join(this.root, 'recovery', sessionId); }
  directoryFor(session: RecordingSession) {
    const ref = session.directoryRef;
    return path.isAbsolute(ref) ? ref : path.join(this.root, ref);
  }

  get(sessionId: string) { return this.sessions.get(sessionId) ?? null; }

  list() { return [...this.sessions.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)); }

  recoveries() { return this.list().filter((session) => session.recoveryState === 'required'); }

  start(input: Omit<RecordingSession, 'lastActivityAt' | 'chunks' | 'pauseIntervals' | 'sourceErrors' | 'recoveryState' | 'durationSeconds' | 'warnings'>) {
    const now = new Date().toISOString();
    const session: RecordingSession = {
      ...input,
      lastActivityAt: now,
      chunks: [],
      pauseIntervals: [],
      sourceErrors: [],
      recoveryState: 'none',
      durationSeconds: 0,
      warnings: [],
      finalizationState: 'recording',
      transcription: { jobId: null, status: null, progress: 0, segmentCount: 0 },
    };
    this.sessions.set(session.sessionId, session);
    this.persist('session_started', session.sessionId);
    return session;
  }

  touch(sessionId: string) {
    const session = this.require(sessionId);
    session.lastActivityAt = new Date().toISOString();
    this.persist('session_activity', sessionId);
  }

  setSources(sessionId: string, sources: RecordingSource[]) {
    const session = this.require(sessionId);
    session.enabledSources = sources.filter((source) => sourceSet.has(source));
    session.lastActivityAt = new Date().toISOString();
    this.persist('sources_started', sessionId);
  }

  setStatus(sessionId: string, status: RecordingSessionStatus, durationSeconds?: number) {
    const session = this.require(sessionId);
    session.status = status;
    session.lastActivityAt = new Date().toISOString();
    if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) session.durationSeconds = Math.max(0, durationSeconds);
    if (status === 'recovery_required') session.recoveryState = 'required';
    if (status === 'discarded') session.recoveryState = 'discarded';
    session.finalizationState = status === 'finalizing' ? 'finalizing' : status === 'ready' ? 'completed' : status === 'recovery_required' ? 'recovery-needed' : status === 'discarded' ? 'failed' : session.finalizationState ?? 'recording';
    this.persist(`session_${status}`, sessionId);
  }

  checkpoint(sessionId: string, patch: Partial<Pick<RecordingSession, 'selectedMicrophoneId' | 'interruptedAt' | 'transcription'>>) {
    const session = this.require(sessionId);
    Object.assign(session, patch);
    session.lastActivityAt = new Date().toISOString();
    this.persist('checkpoint', sessionId);
  }

  markInterrupted(sessionId: string) {
    this.checkpoint(sessionId, { interruptedAt: new Date().toISOString() });
  }

  promoteToCompleted(sessionId: string) {
    const session = this.require(sessionId);
    const current = this.directoryFor(session);
    const target = this.completedDirectory(sessionId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (current !== target && fs.existsSync(current)) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(current, target);
    }
    session.directoryRef = path.relative(this.root, target);
    this.persist('recording_completed', sessionId);
    return target;
  }

  promoteToRecovery(sessionId: string) {
    const session = this.require(sessionId);
    const current = this.directoryFor(session);
    const target = this.recoveryDirectory(sessionId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (current !== target && fs.existsSync(current)) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(current, target);
    }
    session.directoryRef = path.relative(this.root, target);
    this.persist('recording_recovery', sessionId);
    return target;
  }

  addPause(sessionId: string, startedAt: string) {
    const session = this.require(sessionId);
    session.pauseIntervals.push({ startedAt, endedAt: null });
    session.lastActivityAt = new Date().toISOString();
    this.persist('session_paused', sessionId);
  }

  endPause(sessionId: string, endedAt: string) {
    const session = this.require(sessionId);
    const interval = [...session.pauseIntervals].reverse().find((item) => !item.endedAt);
    if (interval) interval.endedAt = endedAt;
    session.lastActivityAt = endedAt;
    this.persist('session_resumed', sessionId);
  }

  addChunk(sessionId: string, chunk: RecordingChunk) {
    const session = this.require(sessionId);
    if (!sourceSet.has(chunk.source) || chunk.sessionId !== sessionId) return;
    const existing = session.chunks.findIndex((item) => item.id === chunk.id);
    if (existing >= 0) session.chunks[existing] = chunk;
    else session.chunks.push(chunk);
    session.chunks.sort((a, b) => a.source.localeCompare(b.source) || a.sequence - b.sequence);
    session.lastActivityAt = new Date().toISOString();
    this.persist('chunk_finalized', sessionId);
  }

  addSourceError(sessionId: string, source: RecordingSource, error: string) {
    const session = this.require(sessionId);
    session.sourceErrors.push({ source, at: new Date().toISOString(), error: error.slice(0, 500) });
    session.warnings.push(`${source === 'user_microphone' ? 'Microphone' : 'System audio'}: ${error.slice(0, 300)}`);
    session.lastActivityAt = new Date().toISOString();
    this.persist('source_failure', sessionId);
  }

  markInspected(sessionId: string) {
    const session = this.require(sessionId);
    if (session.recoveryState === 'required') session.recoveryState = 'inspected';
    this.persist('recovery_inspected', sessionId);
  }

  remove(sessionId: string) {
    const existing = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (existing) {
      try { fs.rmSync(path.join(this.directoryFor(existing), 'manifest.json'), { force: true }); } catch {}
    }
    this.persist('session_removed', sessionId);
  }

  removeChunks(sessionId: string, source: RecordingSource) {
    const session = this.require(sessionId);
    session.chunks = session.chunks.filter((chunk) => chunk.source !== source);
    session.enabledSources = session.enabledSources.filter((item) => item !== source);
    session.lastActivityAt = new Date().toISOString();
    this.persist('source_audio_removed', sessionId);
  }

  diskSpace() {
    try {
      const stats = fs.statfsSync(this.root);
      return { availableBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
    } catch {
      return { availableBytes: Number.POSITIVE_INFINITY, totalBytes: Number.POSITIVE_INFINITY };
    }
  }

  private require(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session was not found.');
    return session;
  }

  private load() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreFile;
      if (value?.version !== 1 || !Array.isArray(value.sessions)) return;
      for (const session of value.sessions) {
        if (!session?.sessionId || !Array.isArray(session.enabledSources)) continue;
        if (RECOVERY_STATUSES.has(session.status)) {
          session.status = 'recovery_required';
          session.recoveryState = 'required';
          session.finalizationState = 'recovery-needed';
          const active = this.activeDirectory(session.sessionId);
          const recovery = this.recoveryDirectory(session.sessionId);
          try {
            const previous = path.isAbsolute(session.directoryRef) ? session.directoryRef : path.join(this.root, session.directoryRef);
            const source = fs.existsSync(previous) ? previous : active;
            if (source !== recovery && fs.existsSync(source) && !fs.existsSync(recovery)) fs.renameSync(source, recovery);
            session.directoryRef = path.relative(this.root, recovery);
          } catch {}
        }
        this.sessions.set(session.sessionId, session);
      }
      if (this.recoveries().length) this.persist('recovery_required');
    } catch {}
  }

  private persist(event: string, sessionId?: string) {
    const data: StoreFile = { version: 1, sessions: this.list() };
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      for (const session of data.sessions) this.writeManifest(session);
      console.info('[recording-session]', JSON.stringify({ event, sessionId: sessionId ?? null, sessionCount: data.sessions.length }));
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      console.error('[recording-session]', JSON.stringify({ event: 'state_write_failed', requestedEvent: event, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }

  private writeManifest(session: RecordingSession) {
    const directory = this.directoryFor(session);
    const manifest = path.join(directory, 'manifest.json');
    const temporary = `${manifest}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({
        version: 1,
        sessionId: session.sessionId,
        noteId: session.noteId,
        workspaceId: session.workspaceId,
        kind: session.kind,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        chunks: session.chunks,
        pauseIntervals: session.pauseIntervals,
        enabledSources: session.enabledSources,
        selectedMicrophoneId: session.selectedMicrophoneId ?? null,
        sourceErrors: session.sourceErrors,
        warnings: session.warnings,
        durationSeconds: session.durationSeconds,
        finalizationState: session.finalizationState ?? 'recording',
        interruptedAt: session.interruptedAt ?? null,
        transcription: session.transcription ?? null,
        status: session.status,
      }, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, manifest);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      console.error('[recording-session]', JSON.stringify({ event: 'manifest_write_failed', sessionId: session.sessionId, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }
}
