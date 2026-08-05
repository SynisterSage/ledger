import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { RecordingSessionStore, type RecordingChunk } from './recordingSessionStore';
import { RECOMMENDED_MODEL, TranscriptionModelManager, stableSegmentId } from './transcriptionModelManager';
import { TranscriptionJobStore, type LocalTranscriptSegment, type TranscriptionJob } from './transcriptionJobStore';

export type TranscriptionProgress = {
  jobId: string;
  noteId: string;
  workspaceId: string;
  status: TranscriptionJob['status'];
  progress: number;
  currentSource: LocalTranscriptSegment['audioSource'] | null;
  currentChunkSequence: number | null;
  completedChunks: number;
  totalChunks: number;
  error: string | null;
};

type RuntimeSegment = { offsets?: { from?: number; to?: number }; timestamps?: { from?: string; to?: string }; text?: string; probability?: number };

export class LocalTranscriptionService {
  readonly modelManager = new TranscriptionModelManager();
  private readonly jobs = new TranscriptionJobStore();
  private readonly sessions: RecordingSessionStore;
  private process: ChildProcess | null = null;
  private cancelRequested = false;
  private progressListeners = new Set<(value: TranscriptionProgress) => void>();

  constructor(sessions = new RecordingSessionStore()) {
    this.sessions = sessions;
    // Incomplete jobs are deliberately returned to queued so startup can resume them.
    setTimeout(() => this.resumePending(), 1000);
  }

  onProgress(listener: (value: TranscriptionProgress) => void) { this.progressListeners.add(listener); return () => this.progressListeners.delete(listener); }
  status(jobId?: string) { return jobId ? this.publicJob(jobId) : this.jobs.list().map((job) => this.publicJob(job.jobId)); }
  modelStatus() { return this.modelManager.status(); }
  async downloadModel() { return this.modelManager.download(); }
  cancelModelDownload() { this.modelManager.cancelDownload(); return this.modelManager.status(); }
  deleteModel() { this.modelManager.delete(); return this.modelManager.status(); }

  async start(input: { sessionId: string; noteId: string; workspaceId: string; force?: boolean }) {
    if (!/^[a-zA-Z0-9_-]{1,180}$/.test(input.sessionId) || !input.noteId || !input.workspaceId) throw new Error('Invalid transcription identity.');
    const session = this.sessions.get(input.sessionId);
    if (!session || session.noteId !== input.noteId || session.workspaceId !== input.workspaceId) throw new Error('The recording session does not belong to this note and workspace.');
    const chunks = this.validChunks(session.sessionId, session.chunks);
    if (!chunks.length) throw new Error('No finalized audio chunks are available for transcription.');
    if (!this.modelManager.status().installed) throw new Error('Install the local Whisper model before starting transcription.');
    if (this.process) throw new Error('Another transcription is already running.');
    const existing = this.jobs.list().find((job) => job.sessionId === input.sessionId && job.status !== 'cancelled');
    const job = existing && !input.force ? existing : this.jobs.create({ jobId: randomUUID(), sessionId: input.sessionId, noteId: input.noteId, workspaceId: input.workspaceId, modelId: RECOMMENDED_MODEL.id, status: 'queued', totalChunks: chunks.length });
    if (job.status === 'complete' && !input.force) return this.publicJob(job.jobId);
    if (input.force) this.updateJob(job.jobId, { status: 'queued', progress: 0, error: null, completedChunks: 0, currentSource: null, currentChunkSequence: null, segments: [], skippedChunks: [], startedAt: null, completedAt: null }, 'job_restarted');
    void this.run(job.jobId);
    return this.publicJob(job.jobId);
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Transcription job was not found.');
    if (this.process) { this.cancelRequested = true; this.process.kill('SIGTERM'); }
    this.updateJob(jobId, { status: 'cancelled', error: 'Transcription cancelled.' }, 'job_cancelled');
    return this.publicJob(jobId);
  }

  results(jobId: string) { return this.jobs.get(jobId)?.segments ?? []; }

  complete(jobId: string, retention: 'delete_after_transcription' | 'retain') {
    const job = this.jobs.get(jobId);
    if (!job || !['merging', 'transcribing'].includes(job.status)) throw new Error('This transcription job is not ready to complete.');
    if (retention === 'delete_after_transcription') this.deleteSessionAudio(job.sessionId);
    this.updateJob(jobId, { status: 'complete', progress: 1, completedAt: new Date().toISOString(), error: null }, 'job_complete');
    return this.publicJob(jobId);
  }

  fail(jobId: string, error: string) { return this.updateJob(jobId, { status: 'failed', error: error.slice(0, 500), completedAt: new Date().toISOString() }, 'job_failed'); }

  async shutdown() { this.cancelRequested = true; this.process?.kill('SIGTERM'); this.process = null; }

  private async run(jobId: string) {
    const job = this.jobs.get(jobId); if (!job) return;
    const session = this.sessions.get(job.sessionId); if (!session) return this.fail(jobId, 'The recording session is no longer available.');
    const chunks = this.validChunks(job.sessionId, session.chunks);
    this.updateJob(jobId, { status: 'preparing', startedAt: new Date().toISOString(), totalChunks: chunks.length, error: null }, 'job_started');
    try {
      const base = Date.parse(session.startedAt);
      for (let index = job.completedChunks; index < chunks.length; index += 1) {
        if (this.cancelRequested || this.jobs.get(jobId)?.status === 'cancelled') return;
        const chunk = chunks[index];
        this.updateJob(jobId, { status: 'transcribing', currentSource: chunk.source, currentChunkSequence: chunk.sequence, progress: index / chunks.length }, 'chunk_started');
        const parsed = await this.transcribeChunk(job, chunk, base);
        const current = this.jobs.get(jobId); if (!current) return;
        const merged = [...current.segments, ...parsed].sort((a, b) => a.startMs - b.startMs || a.audioSource.localeCompare(b.audioSource) || a.segmentOrder - b.segmentOrder);
        this.updateJob(jobId, { segments: dedupeSegments(merged), completedChunks: index + 1, progress: (index + 1) / chunks.length }, 'chunk_complete');
      }
      this.updateJob(jobId, { status: 'merging', progress: 1, currentSource: null, currentChunkSequence: null }, 'job_merging');
      this.emit(jobId);
    } catch (error) {
      if (this.jobs.get(jobId)?.status === 'cancelled') return;
      this.fail(jobId, error instanceof Error ? error.message : String(error));
      this.emit(jobId);
    } finally { this.process = null; this.cancelRequested = false; }
  }

  private transcribeChunk(job: TranscriptionJob, chunk: RecordingChunk, sessionStartedAt: number) {
    const session = this.sessions.get(job.sessionId);
    const directory = session ? this.sessions.directoryFor(session) : '';
    const input = path.join(directory, path.basename(chunk.fileName));
    const outputBase = path.join(this.jobs.storageRoot, `${job.jobId}-${chunk.source}-${chunk.sequence}`);
    const executable = this.runtimePath();
    if (!fs.existsSync(input)) return Promise.reject(new Error(`Audio chunk ${chunk.sequence} is no longer available.`));
    if (isSilentWav(input)) {
      this.updateJob(job.jobId, { skippedChunks: [...job.skippedChunks, chunk.sequence] }, 'silent_chunk_skipped');
      return Promise.resolve([]);
    }
    return new Promise<LocalTranscriptSegment[]>((resolve, reject) => {
      const gpuArgs = process.env.LEDGER_WHISPER_USE_METAL === '1' ? [] : ['-ng'];
      const child = spawn(executable, [...gpuArgs, '-m', this.modelManager.modelPath(), '-f', input, '-l', 'en', '-ojf', '-of', outputBase, '-np'], { stdio: ['ignore', 'ignore', 'pipe'] });
      this.process = child;
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += String(data).slice(-2000); });
      const timeoutMs = process.platform === 'win32' ? 10 * 60 * 1000 : 15 * 60 * 1000;
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Whisper took too long to process an audio chunk. The recording is preserved so you can retry.'));
      }, timeoutMs);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        this.process = null;
        if (this.cancelRequested) return reject(new Error('Transcription cancelled.'));
        if (code !== 0) return reject(new Error(stderr.trim() || `Whisper exited with code ${code ?? 'unknown'}.`));
        try {
          const jsonPath = `${outputBase}.json`;
          const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { transcription?: RuntimeSegment[] };
          fs.rmSync(jsonPath, { force: true });
          const offset = Math.max(0, Date.parse(chunk.startAt) - sessionStartedAt);
          const source = chunk.source;
          const rows = (payload.transcription ?? []).map((item, index) => {
            const text = String(item.text ?? '').replace(/\s+/g, ' ').trim();
            const from = Number(item.offsets?.from ?? 0);
            const to = Number(item.offsets?.to ?? from);
            return { id: stableSegmentId(job.jobId, `${chunk.source}:${chunk.sequence}:${index}`), audioSource: source, speakerLabel: (source === 'user_microphone' ? 'You' : 'Meeting') as 'You' | 'Meeting', startMs: offset + Math.max(0, from), endMs: offset + Math.max(from, to), text, confidence: Number.isFinite(item.probability) ? Math.max(0, Math.min(1, Number(item.probability))) : null, segmentOrder: job.completedChunks + index };
          }).filter((item) => item.text && item.endMs > item.startMs);
          if (!rows.length) this.updateJob(job.jobId, { skippedChunks: [...job.skippedChunks, chunk.sequence] }, 'silent_chunk_skipped');
          resolve(rows);
        } catch (error) { reject(new Error(`Whisper returned invalid output: ${error instanceof Error ? error.message : String(error)}`)); }
      });
    });
  }

  private validChunks(sessionId: string, chunks: RecordingChunk[]) { return chunks.filter((chunk) => chunk.sessionId === sessionId && chunk.finalized && chunk.sizeBytes > 44).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.source.localeCompare(b.source) || a.sequence - b.sequence); }
  private resumePending() {
    if (!this.modelManager.status().installed || this.process) return;
    const pending = this.jobs.list().find((job) => ['queued', 'preparing', 'transcribing', 'merging'].includes(job.status));
    if (pending) void this.run(pending.jobId);
  }
  private runtimePath() {
    const packagedName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const developmentName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const candidates = [process.env.LEDGER_WHISPER_CLI, app.isPackaged ? path.join(process.resourcesPath, packagedName) : path.join(app.getAppPath(), 'native', developmentName)].filter(Boolean) as string[];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error('The local Whisper runtime is not installed in this Ledger build.');
    return found;
  }
  private deleteSessionAudio(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) fs.rmSync(this.sessions.directoryFor(session), { recursive: true, force: true });
  }
  private updateJob(jobId: string, patch: Parameters<TranscriptionJobStore['update']>[1], event: string) {
    const job = this.jobs.update(jobId, patch, event);
    if (job) {
      this.sessions.checkpoint(job.sessionId, { transcription: { jobId: job.jobId, status: job.status, progress: job.progress, segmentCount: job.segments.length } });
      this.emit(jobId);
    }
    return job;
  }
  private publicJob(jobId: string) { const job = this.jobs.get(jobId); if (!job) throw new Error('Transcription job was not found.'); const { segments, ...safe } = job; return { ...safe, segmentCount: segments.length }; }
  private emit(jobId: string) { const job = this.jobs.get(jobId); if (!job) return; this.progressListeners.forEach((listener) => listener({ jobId, noteId: job.noteId, workspaceId: job.workspaceId, status: job.status, progress: job.progress, currentSource: job.currentSource, currentChunkSequence: job.currentChunkSequence, completedChunks: job.completedChunks, totalChunks: job.totalChunks, error: job.error })); }
}

function dedupeSegments(rows: LocalTranscriptSegment[]) {
  const seen = new Set<string>();
  return rows.filter((row) => { const key = `${row.audioSource}:${row.startMs}:${row.endMs}:${row.text.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function isSilentWav(file: string) {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= 44) return true;
    const handle = fs.openSync(file, 'r');
    const sampleBytes = Math.min(stat.size - 44, 16000 * 2 * 5);
    const buffer = Buffer.alloc(sampleBytes);
    fs.readSync(handle, buffer, 0, sampleBytes, 44);
    fs.closeSync(handle);
    let energy = 0;
    let samples = 0;
    for (let offset = 0; offset + 1 < buffer.length; offset += 2) { energy += Math.abs(buffer.readInt16LE(offset)); samples += 1; }
    return samples === 0 || energy / samples < 80;
  } catch { return false; }
}
