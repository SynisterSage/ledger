import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { RecordingSessionStore, type RecordingChunk } from './recordingSessionStore';
import { RECOMMENDED_MODEL, TranscriptionModelManager, stableSegmentId } from './transcriptionModelManager';
import { TranscriptionJobStore, type LocalTranscriptSegment, type TranscriptionChunkRecord, type TranscriptionJob, type TranscriptionWindowRecord, type TranscriptionCoverageRange } from './transcriptionJobStore';
import { decodeFloat32Base64, normalizeWavForTranscription, resampleToMono16k, writeTranscriptionWav } from './transcriptionAudio';
import { PersistentWhisperRuntime } from './whisperRuntime';
import { LiveSpeechBuffer, type SpeechWindow } from './liveSpeechBuffer';
import { mergeCoverage } from './transcriptionCoverage';
import { ZoomSpeakerAttribution } from './zoomSpeakerAttribution';

export type TranscriptionProgress = { jobId: string; sessionId: string; noteId: string; workspaceId: string; status: TranscriptionJob['status']; progress: number; currentSource: LocalTranscriptSegment['audioSource'] | null; currentChunkSequence: number | null; completedChunks: number; totalChunks: number; queueDepth: number; error: string | null };
export type TranscriptionSegmentsEvent = { jobId: string; sessionId: string; noteId: string; workspaceId: string; chunkKey: string; source: RecordingChunk['source']; sequence: number; finalizedAt: string | null; segments: LocalTranscriptSegment[]; metrics: { audioDurationSeconds: number; queueWaitMs: number; preprocessingMs: number; runtimeStartupMs: number; whisperWallMs: number; finalizedToVisibleMs: number; rtf: number; queueDepth: number; speechWindowDurationMs: number; silenceSkippedMs: number; captureToWindowFinalizedMs: number; windowToWhisperStartMs: number; overlapMs: number; dedupEvents: number } };
type RuntimeSegment = { offsets?: { from?: number; to?: number }; text?: string; probability?: number };
type TranscriptionWorkItem = { key: string; source: RecordingChunk['source']; sequence: number; fileName: string; startAt: string; endAt: string | null; durationSeconds: number; finalized: boolean; identity: string; liveWindow?: TranscriptionWindowRecord };
type TranscribedChunk = { rows: LocalTranscriptSegment[]; preprocessingMs: number; runtimeStartupMs: number; whisperWallMs: number; runtimeMode: 'persistent' | 'cli' };
type MeetingMetrics = { audioDurationSeconds: number; chunks: number; liveWindows: number; archivalFallbackWindows: number; inferenceMs: number; preprocessingMs: number; rtfs: number[]; visibleLatenciesMs: number[]; silenceSkippedMs: number; speechWindowMs: number; maxQueueDepth: number; failures: number; retries: number; recoveryFallbacks: number };
type LiveSessionState = { sessionStartedAt: number; transcriptOffsetMs: number; buffers: Record<RecordingChunk['source'], LiveSpeechBuffer>; nextSequence: Record<RecordingChunk['source'], number>; skippedSilenceMs: number; windows: number; dedupEvents: number };
const chunkKey = (chunk: Pick<RecordingChunk, 'source' | 'sequence'>) => `${chunk.source}:${chunk.sequence}`;

export class LocalTranscriptionService {
  readonly modelManager = new TranscriptionModelManager();
  private readonly jobs = new TranscriptionJobStore();
  private readonly sessions: RecordingSessionStore;
  private process: ChildProcess | null = null;
  private processJobId: string | null = null;
  private runningJobId: string | null = null;
  private cancelRequested = false;
  private whisperRuntime: PersistentWhisperRuntime | null;
  private readonly cpuWhisperRuntime: PersistentWhisperRuntime | null;
  private metalFallbackUsed = false;
  private readonly meetingMetrics = new Map<string, MeetingMetrics>();
  private readonly liveSessions = new Map<string, LiveSessionState>();
  private readonly stopStartedAt = new Map<string, number>();
  private progressListeners = new Set<(value: TranscriptionProgress) => void>();
  private segmentListeners = new Set<(value: TranscriptionSegmentsEvent) => void>();

  constructor(sessions = new RecordingSessionStore(), private readonly zoomAttribution?: ZoomSpeakerAttribution) {
    this.sessions = sessions;
    const log = (event: string, detail?: Record<string, unknown>) => console.info('[transcription]', JSON.stringify({ event, ...detail }));
    const cpuServer = this.serverPath('cpu');
    const metalServer = this.serverPath('metal');
    this.cpuWhisperRuntime = cpuServer ? new PersistentWhisperRuntime(cpuServer, this.modelManager.modelPath(), log, 'cpu') : null;
    const wantsMetal = process.env.LEDGER_WHISPER_BACKEND === 'metal';
    if (wantsMetal && metalServer) this.whisperRuntime = new PersistentWhisperRuntime(metalServer, this.modelManager.modelPath(), log, 'metal');
    else {
      this.whisperRuntime = this.cpuWhisperRuntime;
      if (wantsMetal) log('metal_unavailable_using_cpu', { requestedBackend: 'metal', cpuAvailable: Boolean(this.cpuWhisperRuntime) });
    }
    setTimeout(() => this.resumePending(), 1000);
  }
  onProgress(listener: (value: TranscriptionProgress) => void) { this.progressListeners.add(listener); return () => this.progressListeners.delete(listener); }
  onSegments(listener: (value: TranscriptionSegmentsEvent) => void) { this.segmentListeners.add(listener); return () => this.segmentListeners.delete(listener); }
  status(jobId?: string) { return jobId ? this.publicJob(jobId) : this.jobs.list().map((job) => this.publicJob(job.jobId)); }
  modelStatus() { return this.modelManager.status(); }
  async downloadModel() { return this.modelManager.download(); }
  cancelModelDownload() { this.modelManager.cancelDownload(); return this.modelManager.status(); }
  deleteModel() { this.modelManager.delete(); return this.modelManager.status(); }
  resumePendingJobs() { this.resumePending(); }

  async prepare(input: { sessionId: string; noteId: string; workspaceId: string }) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.noteId !== input.noteId || session.workspaceId !== input.workspaceId) throw new Error('The recording session does not belong to this note and workspace.');
    if (!this.modelManager.status().installed) throw new Error('Install the local Whisper model before preparing transcription.');
    if (!this.whisperRuntime?.available) return { mode: 'cli' as const, runtimeStartupMs: 0, startupCount: 0 };
    let runtimeStartupMs: number;
    try { runtimeStartupMs = await this.whisperRuntime.start(); }
    catch (error) {
      await this.fallbackToCpu(error);
      if (!this.whisperRuntime) return { mode: 'cli' as const, runtimeStartupMs: 0, startupCount: 0 };
      runtimeStartupMs = await this.whisperRuntime.start();
    }
    return { mode: 'persistent' as const, runtimeStartupMs, ...this.whisperRuntime.stats() };
  }

  ingestAudioData(event: { sessionId: string; source: RecordingChunk['source']; sampleRate: number; channels: number; format: 'f32le-interleaved'; data: string; capturedAt: string; durationSeconds: number }) {
    const session = this.sessions.get(event.sessionId);
    if (!session || session.kind !== 'meeting' || !session.noteId || !session.workspaceId) return;
    let state = this.liveSessions.get(event.sessionId);
    if (!state) {
      state = { sessionStartedAt: Date.parse(session.startedAt), transcriptOffsetMs: Math.max(0, session.transcriptOffsetMs ?? 0), buffers: { user_microphone: new LiveSpeechBuffer({ source: 'user_microphone' }), system_audio: new LiveSpeechBuffer({ source: 'system_audio' }) }, nextSequence: { user_microphone: 0, system_audio: 0 }, skippedSilenceMs: 0, windows: 0, dedupEvents: 0 };
      this.liveSessions.set(event.sessionId, state);
    }
    try {
      const samples = resampleToMono16k(decodeFloat32Base64(event.data), event.channels, event.sampleRate);
      const endOffsetMs = Math.max(0, Date.parse(event.capturedAt) - state.sessionStartedAt);
      const startOffsetMs = Math.max(0, endOffsetMs - samples.length * 1000 / 16_000);
      const buffer = state.buffers[event.source];
      const windows = buffer.push(samples, startOffsetMs);
      state.skippedSilenceMs += buffer.takeSkippedSilenceMs();
      windows.forEach((window) => { state!.windows += 1; this.enqueueSpeechWindow(session, state!, window); });
    } catch (error) {
      console.warn('[transcription]', JSON.stringify({ event: 'live_audio_decode_failed', sessionId: event.sessionId, source: event.source, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  flushLiveAudio(sessionId: string) {
    const state = this.liveSessions.get(sessionId);
    const session = this.sessions.get(sessionId);
    if (!state || !session) return;
    (['user_microphone', 'system_audio'] as const).forEach((source) => state!.buffers[source].flush().forEach((window) => { state!.windows += 1; this.enqueueSpeechWindow(session!, state!, window); }));
  }

  private enqueueSpeechWindow(session: NonNullable<ReturnType<RecordingSessionStore['get']>>, state: LiveSessionState, window: SpeechWindow) {
    if (!session.noteId || !session.workspaceId) return;
    this.runtimePath();
    let job = this.jobs.list().find((candidate) => candidate.sessionId === session.sessionId && candidate.status !== 'cancelled');
    if (!job) job = this.jobs.create({ jobId: randomUUID(), sessionId: session.sessionId, noteId: session.noteId, workspaceId: session.workspaceId, modelId: RECOMMENDED_MODEL.id, status: 'queued', totalChunks: 0 });
    const sequence = state.nextSequence[window.source];
    state.nextSequence[window.source] += 1;
    const key = `live:${window.source}:${sequence}`;
    const filePath = path.join(this.jobs.storageRoot, 'live-audio', `${job.jobId}-${window.source}-${sequence}.wav`);
    writeTranscriptionWav(filePath, window.samples);
    const startAt = new Date(state.sessionStartedAt + state.transcriptOffsetMs + window.startOffsetMs).toISOString();
    const endAt = new Date(state.sessionStartedAt + state.transcriptOffsetMs + window.endOffsetMs).toISOString();
    const record: TranscriptionWindowRecord = { key, kind: 'live-window', sessionId: session.sessionId, noteId: session.noteId, workspaceId: session.workspaceId, audioSource: window.source, sequence, filePath, startAt, endAt, durationSeconds: window.samples.length / 16_000, finalized: true, state: 'queued', queuedAt: new Date().toISOString(), processingAt: null, completedAt: null, failedAt: null, error: null, speechDurationMs: window.speechDurationMs, silenceSkippedMs: window.silenceSkippedMs, overlapMs: window.overlapMs };
    this.updateJob(job.jobId, { liveWindowRecords: { ...job.liveWindowRecords, [key]: record }, totalChunks: job.totalChunks + 1, error: null }, 'speech_window_enqueued');
    if (this.modelManager.status().installed) void this.run(job.jobId);
    const meeting = this.meetingMetrics.get(job.jobId) ?? emptyMeetingMetrics();
    meeting.liveWindows += 1;
    meeting.silenceSkippedMs += window.silenceSkippedMs; meeting.speechWindowMs += window.samples.length * 1000 / 16_000; meeting.maxQueueDepth = Math.max(meeting.maxQueueDepth, this.queuedCount({ ...(job.chunkRecords ?? {}), ...(job.liveWindowRecords ?? {}) })); this.meetingMetrics.set(job.jobId, meeting);
    console.info('[transcription]', JSON.stringify({ event: 'speech_window', sessionId: session.sessionId, source: window.source, sequence, startOffsetMs: window.startOffsetMs, endOffsetMs: window.endOffsetMs, speechDurationMs: window.speechDurationMs, silenceSkippedMs: window.silenceSkippedMs, queueDepth: this.queuedCount(job.chunkRecords) }));
  }

  enqueueFinalizedChunk(chunk: RecordingChunk) {
    const session = this.sessions.get(chunk.sessionId);
    if (!session || session.kind !== 'meeting' || !session.noteId || !session.workspaceId || !chunk.finalized) return null;
    this.runtimePath();
    const key = chunkKey(chunk);
    let job = this.jobs.list().find((candidate) => candidate.sessionId === chunk.sessionId && candidate.status !== 'cancelled');
    if (!job) job = this.jobs.create({ jobId: randomUUID(), sessionId: session.sessionId, noteId: session.noteId, workspaceId: session.workspaceId, modelId: RECOMMENDED_MODEL.id, status: 'queued', totalChunks: 0 });
    if (job.noteId !== session.noteId || job.workspaceId !== session.workspaceId) throw new Error('The finalized audio chunk does not belong to the transcription job workspace.');
    if (!job.chunkRecords[key]) {
      const record = this.recordFor(session, chunk, key);
      this.updateJob(job.jobId, { chunkRecords: { ...job.chunkRecords, [key]: record }, totalChunks: Object.keys(job.chunkRecords).length + 1, error: null }, 'chunk_enqueued');
      job = this.jobs.get(job.jobId)!;
    } else if (job.chunkRecords[key].state === 'failed') {
      const record = { ...job.chunkRecords[key], state: 'queued' as const, queuedAt: new Date().toISOString(), error: null, failedAt: null };
      this.updateJob(job.jobId, { chunkRecords: { ...job.chunkRecords, [key]: record }, error: null }, 'chunk_requeued');
    }
    if (this.modelManager.status().installed) void this.run(job.jobId); else console.warn('[transcription]', JSON.stringify({ event: 'chunk_waiting_for_model', jobId: job.jobId, chunkKey: key }));
    return this.publicJob(job.jobId);
  }

  async start(input: { sessionId: string; noteId: string; workspaceId: string; force?: boolean }) {
    if (!/^[a-zA-Z0-9_-]{1,180}$/.test(input.sessionId) || !input.noteId || !input.workspaceId) throw new Error('Invalid transcription identity.');
    const session = this.sessions.get(input.sessionId);
    if (!session || session.noteId !== input.noteId || session.workspaceId !== input.workspaceId) throw new Error('The recording session does not belong to this note and workspace.');
    if (!this.modelManager.status().installed) throw new Error('Install the local Whisper model before starting transcription.');
    this.runtimePath();
    let job = this.jobs.list().find((candidate) => candidate.sessionId === input.sessionId && candidate.status !== 'cancelled');
    if (job?.status === 'complete' && !input.force) return this.publicJob(job.jobId);
    if (input.force && job) {
      const records = Object.fromEntries(Object.entries(job.chunkRecords).map(([key, record]) => [key, record.state === 'failed' ? { ...record, state: 'queued' as const, queuedAt: new Date().toISOString(), error: null, failedAt: null } : record]));
      const liveWindowRecords = Object.fromEntries(Object.entries(job.liveWindowRecords ?? {}).map(([key, record]) => [key, record.state === 'failed' ? { ...record, state: 'queued' as const, queuedAt: new Date().toISOString(), error: null, failedAt: null } : record]));
      this.updateJob(job.jobId, { status: 'queued', progress: 0, error: null, finalizing: true, chunkRecords: records, liveWindowRecords }, 'job_restarted');
      job = this.jobs.get(job.jobId)!;
    }
    if (!job) {
      const chunks = this.validChunks(session.sessionId, session.chunks);
      if (!chunks.length) throw new Error('No finalized audio chunks are available for transcription.');
      job = this.jobs.create({ jobId: randomUUID(), sessionId: input.sessionId, noteId: input.noteId, workspaceId: input.workspaceId, modelId: RECOMMENDED_MODEL.id, status: 'queued', totalChunks: chunks.length });
    }
    const records = this.syncChunkRecords(job, session);
    this.stopStartedAt.set(job.jobId, Date.now());
    this.updateJob(job.jobId, { finalizing: true, chunkRecords: records, totalChunks: Object.keys(records).length + Object.keys(job.liveWindowRecords ?? {}).length }, 'job_finalization_requested');
    void this.run(job.jobId);
    return this.publicJob(job.jobId);
  }

  cancel(jobId: string) { const job = this.jobs.get(jobId); if (!job) throw new Error('Transcription job was not found.'); if (this.process && (!this.processJobId || this.processJobId === jobId)) { this.cancelRequested = true; this.process.kill('SIGTERM'); } this.whisperRuntime?.cancelCurrent(); this.updateJob(jobId, { status: 'cancelled', error: 'Transcription cancelled.' }, 'job_cancelled'); return this.publicJob(jobId); }
  results(jobId: string) { return this.jobs.get(jobId)?.segments ?? []; }
  complete(jobId: string, retention: 'delete_after_transcription' | 'retain') { const job = this.jobs.get(jobId); if (!job || !['merging', 'transcribing'].includes(job.status)) throw new Error('This transcription job is not ready to complete.'); const coverage = Object.values(job.coverage ?? {}); if (coverage.some((range) => range.state === 'pending' || range.state === 'failed')) throw new Error('Transcript coverage is incomplete. The recording is preserved so the missing ranges can be retried.'); if (retention === 'delete_after_transcription') this.deleteSessionAudio(job.sessionId); this.updateJob(jobId, { status: 'complete', progress: 1, completedAt: new Date().toISOString(), error: null }, 'job_complete'); return this.publicJob(jobId); }
  fail(jobId: string, error: string) { return this.updateJob(jobId, { status: 'failed', error: error.slice(0, 500), completedAt: new Date().toISOString() }, 'job_failed'); }
  async shutdown() { this.cancelRequested = true; this.process?.kill('SIGTERM'); await this.whisperRuntime?.stop(); this.process = null; this.processJobId = null; this.runningJobId = null; }

  private async run(jobId: string) {
    if (this.runningJobId) return;
    this.runningJobId = jobId;
    try {
      let job = this.jobs.get(jobId); if (!job) return;
      if (!job.startedAt) this.updateJob(jobId, { status: 'preparing', startedAt: new Date().toISOString() }, 'job_started');
      while (true) {
        job = this.jobs.get(jobId); if (!job || this.cancelRequested || job.status === 'cancelled') return;
        const session = this.sessions.get(job.sessionId); if (!session) { this.fail(jobId, 'The recording session is no longer available.'); return; }
        const records = this.syncChunkRecords(job, session);
        const liveRecords = job.liveWindowRecords ?? {};
        if (JSON.stringify(records) !== JSON.stringify(job.chunkRecords)) { this.updateJob(jobId, { chunkRecords: records, totalChunks: Object.keys(records).length + Object.keys(liveRecords).length }, 'chunk_inventory_updated'); job = this.jobs.get(jobId)!; }
        const refreshedLiveRecords = job.liveWindowRecords ?? {};
        const liveNext = Object.values(refreshedLiveRecords).filter((record) => record.state === 'queued').sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.sequence - b.sequence)[0];
        const archiveNext = this.validChunks(session.sessionId, session.chunks).find((chunk) => records[chunkKey(chunk)]?.state === 'queued');
        const next: TranscriptionWorkItem | null = liveNext ? { key: liveNext.key, source: liveNext.audioSource, sequence: liveNext.sequence, fileName: liveNext.filePath, startAt: liveNext.startAt, endAt: liveNext.endAt, durationSeconds: liveNext.durationSeconds, finalized: liveNext.finalized, identity: `window:${liveNext.key}`, liveWindow: liveNext } : archiveNext ? { key: chunkKey(archiveNext), source: archiveNext.source, sequence: archiveNext.sequence, fileName: archiveNext.fileName, startAt: archiveNext.startAt, endAt: archiveNext.endAt, durationSeconds: archiveNext.durationSeconds, finalized: archiveNext.finalized, identity: `chunk:${chunkKey(archiveNext)}` } : null;
        if (!next) {
          const hasFailures = [...Object.values(records), ...Object.values(refreshedLiveRecords)].some((record) => record.state === 'failed');
          if (job.finalizing) {
            if (hasFailures) this.updateJob(jobId, { status: 'failed', error: 'One or more audio chunks failed. Retry transcription to process only failed chunks.' }, 'job_failed_chunks');
            else {
              const meeting = this.meetingMetrics.get(jobId) ?? emptyMeetingMetrics(); const sortedRtfs = [...meeting.rtfs].sort((a, b) => a - b); const sortedLatencies = [...meeting.visibleLatenciesMs].sort((a, b) => a - b); const percentile = (values: number[], p: number) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;
              const coverage = Object.values(job.coverage ?? {});
              console.info('[transcription]', JSON.stringify({ event: 'meeting_metrics', jobId, sessionId: session.sessionId, totalAudioDurationSeconds: meeting.audioDurationSeconds, totalChunks: meeting.chunks, liveWindows: meeting.liveWindows, archivalFallbackWindows: meeting.archivalFallbackWindows, totalInferenceMs: meeting.inferenceMs, totalPreprocessingMs: meeting.preprocessingMs, averageRtf: meeting.rtfs.length ? meeting.rtfs.reduce((sum, value) => sum + value, 0) / meeting.rtfs.length : 0, p95Rtf: percentile(sortedRtfs, 0.95), medianVisibleLatencyMs: percentile(sortedLatencies, 0.5), p95VisibleLatencyMs: percentile(sortedLatencies, 0.95), silenceSkippedMs: meeting.silenceSkippedMs, silenceSkippedPercentage: meeting.silenceSkippedMs / Math.max(1, meeting.silenceSkippedMs + meeting.speechWindowMs) * 100, maxQueueDepth: meeting.maxQueueDepth, failures: meeting.failures, retries: meeting.retries, recoveryFallbacks: meeting.recoveryFallbacks, coverage: { covered: coverage.filter((range) => range.state === 'covered').length, pending: coverage.filter((range) => range.state === 'pending').length, failed: coverage.filter((range) => range.state === 'failed').length }, stopToTranscriptFinalizedMs: this.stopStartedAt.has(jobId) ? Date.now() - this.stopStartedAt.get(jobId)! : null, runtime: this.whisperRuntime?.stats() ?? { startupCount: 0, healthy: false } }));
              this.updateJob(jobId, { status: 'merging', progress: 1, currentSource: null, currentChunkSequence: null }, 'job_merging');
            }
          } else this.updateJob(jobId, { status: 'queued', currentSource: null, currentChunkSequence: null }, 'worker_idle');
          return;
        }
        const key = next.key; const currentRecord = next.liveWindow ? refreshedLiveRecords[key] : records[key]; const processingAt = new Date().toISOString();
        const processingRecord = { ...currentRecord, state: 'processing' as const, processingAt };
        const processingPatch = next.liveWindow ? { liveWindowRecords: { ...refreshedLiveRecords, [key]: processingRecord } } : { chunkRecords: { ...records, [key]: processingRecord } };
        this.updateJob(jobId, { ...processingPatch, status: 'transcribing', currentSource: next.source, currentChunkSequence: next.sequence, progress: this.progress({ ...records, ...refreshedLiveRecords }) }, 'chunk_started');
        try {
          const parsed = await this.transcribeWorkItem(job, next, Date.parse(session.startedAt));
          const attributedRows = this.zoomAttribution?.attribute(session.sessionId, parsed.rows) ?? parsed.rows;
          const attributedParsed = { ...parsed, rows: attributedRows };
          const latest = this.jobs.get(jobId); if (!latest) return;
          const completedRecord = { ...processingRecord, state: 'completed' as const, completedAt: new Date().toISOString(), error: null };
          const updatedRecords = { ...latest.chunkRecords, ...(next.liveWindow ? {} : { [key]: completedRecord }) };
          const updatedLiveRecords = { ...(latest.liveWindowRecords ?? {}), ...(next.liveWindow ? { [key]: completedRecord } : {}) };
          const merged = [...latest.segments, ...attributedRows].sort((a, b) => a.startMs - b.startMs || a.audioSource.localeCompare(b.audioSource) || a.segmentOrder - b.segmentOrder);
          const deduped = dedupeSegments(merged);
          const visibleRows = attributedRows.filter((row) => deduped.some((candidate) => candidate.id === row.id) && !latest.segments.some((previous) => areDuplicateSegments(previous, row)));
          const coverage = this.coverageForRecords(updatedRecords, updatedLiveRecords);
          this.updateJob(jobId, { segments: deduped, chunkRecords: updatedRecords, liveWindowRecords: updatedLiveRecords, coverage, completedChunks: this.completedCount({ ...updatedRecords, ...updatedLiveRecords }), progress: this.progress({ ...updatedRecords, ...updatedLiveRecords }), error: null }, next.liveWindow ? 'speech_window_complete' : 'chunk_complete');
          if (next.liveWindow) fs.rmSync(next.fileName, { force: true });
          const audioDuration = Math.max(0.001, Number(next.durationSeconds) || 0); const queueDepth = this.queuedCount({ ...updatedRecords, ...updatedLiveRecords }); const queueWaitMs = Math.max(0, Date.parse(processingAt) - Date.parse(currentRecord.queuedAt)); const metrics = { audioDurationSeconds: audioDuration, queueWaitMs, preprocessingMs: parsed.preprocessingMs, runtimeStartupMs: parsed.runtimeStartupMs, whisperWallMs: parsed.whisperWallMs, finalizedToVisibleMs: next.endAt ? Math.max(0, Date.now() - Date.parse(next.endAt)) : 0, rtf: parsed.whisperWallMs / 1000 / audioDuration, queueDepth, speechWindowDurationMs: next.liveWindow ? audioDuration * 1000 : 0, silenceSkippedMs: next.liveWindow?.silenceSkippedMs ?? 0, captureToWindowFinalizedMs: next.liveWindow?.endAt ? Math.max(0, Date.parse(processingAt) - Date.parse(next.liveWindow.endAt)) : 0, windowToWhisperStartMs: next.liveWindow ? queueWaitMs : 0, overlapMs: next.liveWindow?.overlapMs ?? 0, dedupEvents: 0 };
          const meeting = this.meetingMetrics.get(jobId) ?? emptyMeetingMetrics();
          meeting.audioDurationSeconds += audioDuration; meeting.chunks += 1; if (next.liveWindow) meeting.liveWindows = Math.max(meeting.liveWindows, 1); else meeting.archivalFallbackWindows += 1; meeting.inferenceMs += parsed.whisperWallMs; meeting.preprocessingMs += parsed.preprocessingMs; meeting.rtfs.push(metrics.rtf); meeting.visibleLatenciesMs.push(metrics.finalizedToVisibleMs); meeting.maxQueueDepth = Math.max(meeting.maxQueueDepth, queueDepth); this.meetingMetrics.set(jobId, meeting);
          console.info('[transcription]', JSON.stringify({ event: 'chunk_metrics', jobId, sessionId: session.sessionId, source: next.source, sequence: next.sequence, runtimeMode: parsed.runtimeMode, finalizedAt: currentRecord.queuedAt, ...metrics }));
          if (visibleRows.length) this.emitSegments(jobId, session, next, visibleRows, { ...metrics, dedupEvents: Math.max(0, attributedParsed.rows.length - visibleRows.length) });
        } catch (error) {
          const latest = this.jobs.get(jobId); if (!latest) return; const message = error instanceof Error ? error.message : String(error); const failedRecord = { ...processingRecord, state: 'failed' as const, failedAt: new Date().toISOString(), error: message.slice(0, 500) };
          const failedRecords = next.liveWindow ? { ...(latest.liveWindowRecords ?? {}), [key]: failedRecord } : latest.chunkRecords;
          const failedChunks = next.liveWindow ? latest.chunkRecords : { ...latest.chunkRecords, [key]: failedRecord };
          this.updateJob(jobId, next.liveWindow ? { liveWindowRecords: failedRecords, coverage: this.coverageForRecords(failedChunks, failedRecords), error: message.slice(0, 500) } : { chunkRecords: failedChunks, coverage: this.coverageForRecords(failedChunks, latest.liveWindowRecords ?? {}), error: message.slice(0, 500) }, next.liveWindow ? 'speech_window_failed' : 'chunk_failed');
          const meeting = this.meetingMetrics.get(jobId) ?? emptyMeetingMetrics(); meeting.failures += 1; meeting.retries += 1; if (!next.liveWindow && job.finalizing) meeting.recoveryFallbacks += 1; this.meetingMetrics.set(jobId, meeting);
          console.error('[transcription]', JSON.stringify({ event: 'chunk_failed', jobId, sessionId: session.sessionId, source: next.source, sequence: next.sequence, error: message }));
        }
      }
    } finally { if (this.processJobId === jobId) { this.process = null; this.processJobId = null; } if (this.runningJobId === jobId) this.runningJobId = null; this.cancelRequested = false; }
  }

  private async transcribeWorkItem(job: TranscriptionJob, chunk: TranscriptionWorkItem, sessionStartedAt: number): Promise<TranscribedChunk> {
    const session = this.sessions.get(job.sessionId);
    const directory = session ? this.sessions.directoryFor(session) : '';
    const input = path.isAbsolute(chunk.fileName) ? chunk.fileName : path.join(directory, path.basename(chunk.fileName));
    if (!fs.existsSync(input)) throw new Error(`Audio chunk ${chunk.sequence} is no longer available.`);
    if (isSilentWav(input)) return { rows: [], preprocessingMs: 0, runtimeStartupMs: 0, whisperWallMs: 0, runtimeMode: this.whisperRuntime?.available ? 'persistent' : 'cli' };

    let transcriptionInput = input;
    let preprocessingMs = 0;
    try {
      const normalized = normalizeWavForTranscription(input, this.jobs.storageRoot);
      transcriptionInput = normalized.path;
      preprocessingMs = normalized.preprocessingMs;
    } catch (error) {
      console.warn('[transcription]', JSON.stringify({ event: 'audio_normalization_failed', jobId: job.jobId, source: chunk.source, sequence: chunk.sequence, error: error instanceof Error ? error.message : String(error) }));
    }

    const offset = Math.max(0, Date.parse(chunk.startAt) - sessionStartedAt) + Math.max(0, session?.transcriptOffsetMs ?? 0);
    if (this.whisperRuntime?.available) {
      let result: Awaited<ReturnType<PersistentWhisperRuntime['transcribe']>>;
      try { result = await this.whisperRuntime.transcribe(transcriptionInput); }
      catch (error) {
        await this.fallbackToCpu(error);
        if (!this.whisperRuntime?.available) throw error;
        result = await this.whisperRuntime.transcribe(transcriptionInput);
      }
      const rows = result.segments.map((item, index) => {
        const text = String(item.text ?? '').replace(/\s+/g, ' ').trim();
        const from = Math.max(0, Number(item.start ?? 0) * 1000);
        const to = Math.max(from, Number(item.end ?? item.start ?? 0) * 1000);
        const confidence = Number.isFinite(item.no_speech_prob) ? 1 - Number(item.no_speech_prob) : null;
        return { id: stableSegmentId(job.jobId, `${chunk.identity}:${index}`), audioSource: chunk.source, speakerLabel: (chunk.source === 'user_microphone' ? 'You' : 'Meeting') as 'You' | 'Meeting', startMs: offset + from, endMs: offset + to, text, confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)), segmentOrder: job.completedChunks + index };
      }).filter((item) => item.text && item.endMs > item.startMs);
      return { rows, preprocessingMs, runtimeStartupMs: result.runtimeStartupMs, whisperWallMs: result.inferenceWallMs, runtimeMode: 'persistent' };
    }

    return this.transcribeWithCli(job, chunk, transcriptionInput, offset, preprocessingMs);
  }

  private transcribeWithCli(job: TranscriptionJob, chunk: TranscriptionWorkItem, input: string, offset: number, preprocessingMs: number): Promise<TranscribedChunk> {
    const outputBase = path.join(this.jobs.storageRoot, `${job.jobId}-${chunk.source}-${chunk.sequence}`);
    const executable = this.cliPath();
    return new Promise<TranscribedChunk>((resolve, reject) => {
      const started = Date.now(); const gpuArgs = ['-ng']; const child = spawn(executable, [...gpuArgs, '-m', this.modelManager.modelPath(), '-f', input, '-l', 'en', '-ojf', '-of', outputBase, '-np'], { stdio: ['ignore', 'ignore', 'pipe'] });
      this.process = child; this.processJobId = job.jobId; let stderr = ''; child.stderr.on('data', (data) => { stderr += String(data).slice(-2000); }); const timeout = setTimeout(() => { child.kill(); reject(new Error('Whisper took too long to process an audio chunk. The recording is preserved so you can retry.')); }, process.platform === 'win32' ? 5 * 60 * 1000 : 15 * 60 * 1000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); }); child.once('exit', (code) => { clearTimeout(timeout); if (this.process === child) { this.process = null; this.processJobId = null; } if (this.cancelRequested) return reject(new Error('Transcription cancelled.')); if (code !== 0) return reject(new Error(stderr.trim() || `Whisper exited with code ${code ?? 'unknown'}.`)); try {
        const jsonPath = `${outputBase}.json`; const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { transcription?: RuntimeSegment[] }; fs.rmSync(jsonPath, { force: true });
        const rows = (payload.transcription ?? []).map((item, index) => { const text = String(item.text ?? '').replace(/\s+/g, ' ').trim(); const from = Number(item.offsets?.from ?? 0); const to = Number(item.offsets?.to ?? from); return { id: stableSegmentId(job.jobId, `${chunk.identity}:${index}`), audioSource: chunk.source, speakerLabel: (chunk.source === 'user_microphone' ? 'You' : 'Meeting') as 'You' | 'Meeting', startMs: offset + Math.max(0, from), endMs: offset + Math.max(from, to), text, confidence: Number.isFinite(item.probability) ? Math.max(0, Math.min(1, Number(item.probability))) : null, segmentOrder: job.completedChunks + index }; }).filter((item) => item.text && item.endMs > item.startMs);
        resolve({ rows, preprocessingMs, runtimeStartupMs: 0, whisperWallMs: Date.now() - started, runtimeMode: 'cli' });
      } catch (error) { reject(new Error(`Whisper returned invalid output: ${error instanceof Error ? error.message : String(error)}`)); } });
    });
  }

  private recordFor(session: NonNullable<ReturnType<RecordingSessionStore['get']>>, chunk: RecordingChunk, key: string): TranscriptionChunkRecord { return { key, sessionId: session.sessionId, noteId: session.noteId!, workspaceId: session.workspaceId!, audioSource: chunk.source, sequence: chunk.sequence, filePath: path.join(this.sessions.directoryFor(session), path.basename(chunk.fileName)), startAt: chunk.startAt, endAt: chunk.endAt, durationSeconds: chunk.durationSeconds, finalized: chunk.finalized, state: 'queued', queuedAt: new Date().toISOString(), processingAt: null, completedAt: null, failedAt: null, error: null }; }
  private syncChunkRecords(job: TranscriptionJob, session: NonNullable<ReturnType<RecordingSessionStore['get']>>) {
    const records = { ...(job.chunkRecords ?? {}) };
    const completedWindows = Object.values(job.liveWindowRecords ?? {}).filter((record) => record.state === 'completed');
    const chunks = this.validChunks(session.sessionId, session.chunks);
    chunks.forEach((chunk) => {
      const key = chunkKey(chunk);
      const covered = this.isCoveredByLiveWindows(chunk, completedWindows);
      if (!records[key]) records[key] = { ...this.recordFor(session, chunk, key), ...(covered ? { state: 'completed' as const, completedAt: new Date().toISOString() } : {}) };
      else if (records[key].state !== 'completed' && covered) records[key] = { ...records[key], state: 'completed', completedAt: new Date().toISOString(), error: null };
      else if (records[key].state !== 'completed') records[key] = { ...records[key], filePath: path.join(this.sessions.directoryFor(session), path.basename(chunk.fileName)) };
    });
    return records;
  }
  private isCoveredByLiveWindows(chunk: RecordingChunk, windows: TranscriptionWindowRecord[]) {
    const start = Date.parse(chunk.startAt); const end = Date.parse(chunk.endAt ?? chunk.startAt) || start + Math.round(chunk.durationSeconds * 1000);
    const ranges = windows.filter((window) => window.audioSource === chunk.source).map((window) => [Date.parse(window.startAt), Date.parse(window.endAt ?? window.startAt)] as const).filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from).sort((a, b) => a[0] - b[0]);
    let cursor = start;
    for (const [from, to] of ranges) { if (from > cursor + 120) return false; cursor = Math.max(cursor, to); if (cursor >= end - 120) return true; }
    return cursor >= end - 120;
  }
  private coverageForRecords(records: Record<string, TranscriptionChunkRecord>, liveRecords: Record<string, TranscriptionWindowRecord>) {
    const ranges: TranscriptionCoverageRange[] = [...Object.values(records).map((record) => ({ key: record.key, audioSource: record.audioSource, startAt: record.startAt, endAt: record.endAt, state: record.state === 'completed' ? 'covered' as const : record.state === 'failed' ? 'failed' as const : 'pending' as const, kind: 'archive-fallback' as const })), ...Object.values(liveRecords).map((record) => ({ key: record.key, audioSource: record.audioSource, startAt: record.startAt, endAt: record.endAt, state: record.state === 'completed' ? 'covered' as const : record.state === 'failed' ? 'failed' as const : 'pending' as const, kind: 'live-window' as const }))];
    const merged = mergeCoverage(ranges.map((range) => ({ key: range.key, source: range.audioSource, startMs: Date.parse(range.startAt), endMs: Date.parse(range.endAt ?? range.startAt), state: range.state, kind: range.kind }))).map((range) => ({ key: range.key, audioSource: range.source, startAt: new Date(range.startMs).toISOString(), endAt: new Date(range.endMs).toISOString(), state: range.state, kind: range.kind }));
    return Object.fromEntries(merged.map((range) => [`${range.audioSource}:${range.startAt}:${range.endAt}:${range.kind}`, range]));
  }
  private progress(records: Record<string, TranscriptionChunkRecord>) { const total = Object.keys(records).length; return total ? this.completedCount(records) / total : 0; }
  private completedCount(records: Record<string, TranscriptionChunkRecord>) { return Object.values(records).filter((record) => record.state === 'completed').length; }
  private queuedCount(records: Record<string, TranscriptionChunkRecord>) { return Object.values(records).filter((record) => record.state === 'queued' || record.state === 'processing').length; }
  private validChunks(sessionId: string, chunks: RecordingChunk[]) { return chunks.filter((chunk) => chunk.sessionId === sessionId && chunk.finalized && chunk.sizeBytes > 44).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.source.localeCompare(b.source) || a.sequence - b.sequence); }
  private resumePending() { if (!this.modelManager.status().installed || this.runningJobId) return; const pending = this.jobs.list().find((job) => ['queued', 'preparing', 'transcribing', 'merging'].includes(job.status)); if (pending) void this.run(pending.jobId); }
  private async fallbackToCpu(error: unknown) {
    if (this.whisperRuntime?.stats().backend !== 'metal' || this.metalFallbackUsed) throw error;
    this.metalFallbackUsed = true;
    console.warn('[transcription]', JSON.stringify({ event: 'metal_runtime_failed_falling_back_to_cpu', error: error instanceof Error ? error.message : String(error) }));
    await this.whisperRuntime.stop();
    if (!this.cpuWhisperRuntime) throw error;
    this.whisperRuntime = this.cpuWhisperRuntime;
    await this.whisperRuntime.start();
  }
  private runtimePath() { return this.serverPath('cpu') ?? this.serverPath('metal') ?? this.cliPath(); }
  private serverPath(backend: 'cpu' | 'metal' = 'cpu') { const name = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'; const metalName = process.platform === 'win32' ? 'whisper-server-metal.exe' : 'whisper-server-metal'; const candidates = backend === 'metal' ? [process.env.LEDGER_WHISPER_SERVER_METAL, app.isPackaged ? path.join(process.resourcesPath, metalName) : path.join(app.getAppPath(), 'native', metalName)] : [process.env.LEDGER_WHISPER_SERVER_CPU, process.env.LEDGER_WHISPER_SERVER, app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), 'native', name)]; return (candidates.filter(Boolean) as string[]).find((candidate) => fs.existsSync(candidate)) ?? null; }
  private cliPath() { const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'; const candidates = [process.env.LEDGER_WHISPER_CLI, app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), 'native', name)].filter(Boolean) as string[]; const found = candidates.find((candidate) => fs.existsSync(candidate)); if (!found) throw new Error(process.platform === 'win32' ? 'Windows transcription is not available in this Ledger build yet. The Windows Whisper runtime (whisper-cli.exe) is missing.' : 'The local Whisper runtime is not installed in this Ledger build.'); return found; }
  private deleteSessionAudio(sessionId: string) { const session = this.sessions.get(sessionId); if (session) fs.rmSync(this.sessions.directoryFor(session), { recursive: true, force: true }); }
  private updateJob(jobId: string, patch: Parameters<TranscriptionJobStore['update']>[1], event: string) { const job = this.jobs.update(jobId, patch, event); if (job) { this.sessions.checkpoint(job.sessionId, { transcription: { jobId: job.jobId, status: job.status, progress: job.progress, segmentCount: job.segments.length } }); this.emit(jobId); } return job; }
  private publicJob(jobId: string) { const job = this.jobs.get(jobId); if (!job) throw new Error('Transcription job was not found.'); const { segments, chunkRecords, liveWindowRecords, ...safe } = job; return { ...safe, queueDepth: this.queuedCount({ ...(chunkRecords ?? {}), ...(liveWindowRecords ?? {}) }), segmentCount: segments.length }; }
  private emitSegments(jobId: string, session: NonNullable<ReturnType<RecordingSessionStore['get']>>, chunk: TranscriptionWorkItem, segments: LocalTranscriptSegment[], metrics: TranscriptionSegmentsEvent['metrics']) { const event = { jobId, sessionId: session.sessionId, noteId: session.noteId!, workspaceId: session.workspaceId!, chunkKey: chunk.key, source: chunk.source, sequence: chunk.sequence, finalizedAt: chunk.endAt, segments, metrics }; this.segmentListeners.forEach((listener) => listener(event)); }
  private emit(jobId: string) { const job = this.jobs.get(jobId); if (!job) return; const records = { ...(job.chunkRecords ?? {}), ...(job.liveWindowRecords ?? {}) }; this.progressListeners.forEach((listener) => listener({ jobId, sessionId: job.sessionId, noteId: job.noteId, workspaceId: job.workspaceId, status: job.status, progress: job.progress, currentSource: job.currentSource, currentChunkSequence: job.currentChunkSequence, completedChunks: job.completedChunks, totalChunks: job.totalChunks, queueDepth: this.queuedCount(records), error: job.error })); }
}

function dedupeSegments(rows: LocalTranscriptSegment[]) {
  const result: LocalTranscriptSegment[] = [];
  for (const row of rows) {
    const duplicateIndex = result.findIndex((previous) => areDuplicateSegments(previous, row));
    if (duplicateIndex < 0) {
      result.push(row);
      continue;
    }
    // Keep the richer boundary transcription when two overlapping windows
    // produce the same utterance with slightly different timestamps/text.
    if (row.text.length > result[duplicateIndex].text.length) result[duplicateIndex] = row;
  }
  return result;
}

function areDuplicateSegments(left: LocalTranscriptSegment, right: LocalTranscriptSegment) {
  if (left.audioSource !== right.audioSource) return false;
  const leftText = normalizeTranscriptText(left.text);
  const rightText = normalizeTranscriptText(right.text);
  if (!leftText || !rightText) return false;
  const startsNear = Math.abs(left.startMs - right.startMs) <= 1200;
  const overlaps = left.startMs <= right.endMs && right.startMs <= left.endMs;
  if (!startsNear && !overlaps) return false;
  const leftWords = new Set(leftText.split(' '));
  const rightWords = new Set(rightText.split(' '));
  if (leftText === rightText) return true;
  // Avoid treating a legitimate one-word acknowledgement as a duplicate of
  // a nearby longer utterance; overlap containment is only reliable for a
  // phrase with at least two words.
  if (leftWords.size >= 2 && rightWords.size >= 2) {
    const contains = (longer: string, shorter: string) => longer === shorter || longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`) || longer.includes(` ${shorter} `);
    if (contains(leftText, rightText) || contains(rightText, leftText)) return true;
  }
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared >= 4 && shared / Math.max(1, Math.min(leftWords.size, rightWords.size)) >= 0.75;
}

function normalizeTranscriptText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim();
}
function emptyMeetingMetrics(): MeetingMetrics { return { audioDurationSeconds: 0, chunks: 0, liveWindows: 0, archivalFallbackWindows: 0, inferenceMs: 0, preprocessingMs: 0, rtfs: [], visibleLatenciesMs: [], silenceSkippedMs: 0, speechWindowMs: 0, maxQueueDepth: 0, failures: 0, retries: 0, recoveryFallbacks: 0 }; }
function isSilentWav(file: string) { try { const stat = fs.statSync(file); if (stat.size <= 44) return true; const handle = fs.openSync(file, 'r'); const sampleBytes = Math.min(stat.size - 44, 16000 * 2 * 5); const buffer = Buffer.alloc(sampleBytes); fs.readSync(handle, buffer, 0, sampleBytes, 44); fs.closeSync(handle); let energy = 0; let samples = 0; for (let offset = 0; offset + 1 < buffer.length; offset += 2) { energy += Math.abs(buffer.readInt16LE(offset)); samples += 1; } return samples === 0 || energy / samples < 80; } catch { return false; } }
