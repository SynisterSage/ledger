import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type TranscriptionJobStatus =
  | 'queued'
  | 'preparing'
  | 'transcribing'
  | 'merging'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type LocalTranscriptSegment = {
  id: string;
  audioSource: 'user_microphone' | 'system_audio';
  speakerLabel: 'You' | 'Meeting';
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  segmentOrder: number;
};

export type TranscriptionJob = {
  jobId: string;
  sessionId: string;
  noteId: string;
  workspaceId: string;
  modelId: string;
  status: TranscriptionJobStatus;
  progress: number;
  currentSource: 'user_microphone' | 'system_audio' | null;
  currentChunkSequence: number | null;
  totalChunks: number;
  completedChunks: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  skippedChunks: number[];
  segments: LocalTranscriptSegment[];
};

type StoreFile = { version: 1; jobs: TranscriptionJob[] };

export class TranscriptionJobStore {
  private readonly root = path.join(app.getPath('userData'), 'meeting-transcription');
  private readonly file = path.join(this.root, 'jobs.json');
  private jobs = new Map<string, TranscriptionJob>();

  constructor() {
    fs.mkdirSync(this.root, { recursive: true });
    this.load();
  }

  get storageRoot() { return this.root; }
  get(jobId: string) { return this.jobs.get(jobId) ?? null; }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  active() { return this.list().find((job) => ['queued', 'preparing', 'transcribing', 'merging'].includes(job.status)) ?? null; }

  create(input: Omit<TranscriptionJob, 'createdAt' | 'startedAt' | 'completedAt' | 'error' | 'progress' | 'currentSource' | 'currentChunkSequence' | 'completedChunks' | 'skippedChunks' | 'segments'>) {
    const job: TranscriptionJob = {
      ...input,
      progress: 0,
      currentSource: null,
      currentChunkSequence: null,
      completedChunks: 0,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      skippedChunks: [],
      segments: [],
    };
    this.jobs.set(job.jobId, job);
    this.persist('job_created', job.jobId);
    return job;
  }

  update(jobId: string, patch: Partial<TranscriptionJob>, event = 'job_updated') {
    const job = this.require(jobId);
    Object.assign(job, patch);
    this.persist(event, jobId);
    return job;
  }

  remove(jobId: string) { this.jobs.delete(jobId); this.persist('job_removed', jobId); }

  private require(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Transcription job was not found.');
    return job;
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreFile;
      if (data?.version !== 1 || !Array.isArray(data.jobs)) return;
      data.jobs.forEach((job) => {
        if (!job?.jobId || !job.noteId || !job.workspaceId || !Array.isArray(job.segments)) return;
        if (['preparing', 'transcribing', 'merging'].includes(job.status)) job.status = 'queued';
        this.jobs.set(job.jobId, job);
      });
    } catch {}
  }

  private persist(event: string, jobId?: string) {
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, jobs: this.list() }, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      console.info('[transcription-job]', JSON.stringify({ event, jobId: jobId ?? null, jobCount: this.jobs.size }));
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      console.error('[transcription-job]', JSON.stringify({ event: 'state_write_failed', requestedEvent: event, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }
}
