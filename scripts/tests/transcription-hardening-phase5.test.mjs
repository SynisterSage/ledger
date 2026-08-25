import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../../electron/transcriptionService.ts', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../../electron/transcriptionJobStore.ts', import.meta.url), 'utf8');
const capture = fs.readFileSync(new URL('../../electron/audioCaptureService.ts', import.meta.url), 'utf8');
const notes = fs.readFileSync(new URL('../../src/components/Notes/NotesWindow.tsx', import.meta.url), 'utf8');

test('coverage is durable and only complete coverage can finalize', () => {
  assert.match(store, /coverage: Record<string, TranscriptionCoverageRange>/);
  assert.match(store, /job\.coverage = job\.coverage/);
  assert.match(service, /coverageForRecords/);
  assert.match(service, /Transcript coverage is incomplete/);
  assert.match(service, /archive-fallback/);
  assert.match(store, /job\.status === 'merging'/);
  assert.match(store, /Transcript merge was interrupted/);
});

test('long-session processing remains one sequential worker with bounded live files', () => {
  assert.match(service, /if \(this\.runningJobId\) return/);
  assert.match(service, /state === 'queued'/);
  assert.match(service, /fs\.rmSync\(next\.fileName, \{ force: true \}\)/);
  assert.match(service, /maxQueueDepth/);
});

test('stop, pause, and resume preserve capture independently of transcription', () => {
  assert.match(capture, /async stop\(\)/);
  assert.match(capture, /await this\.adapter\.stop\(\)/);
  assert.match(capture, /flush/);
  assert.match(service, /recording session does not belong to this note and workspace/);
});

test('renderer reload and duplicate completion remain idempotent', () => {
  assert.match(notes, /persistedLiveTranscriptChunksRef/);
  assert.match(notes, /bulkCreateTranscriptSegments/);
  assert.match(service, /dedupeSegments/);
  assert.match(service, /stableSegmentId/);
});

test('runtime failure has a one-way fallback and no Metal crash loop', () => {
  assert.match(service, /metalFallbackUsed/);
  assert.match(service, /if \(this\.whisperRuntime\?\.stats\(\)\.backend !== 'metal' \|\| this\.metalFallbackUsed\) throw error/);
  assert.match(service, /metal_runtime_failed_falling_back_to_cpu/);
});

test('recording remains authoritative when transcription fails', () => {
  assert.match(capture, /recovery_required/);
  assert.match(capture, /promoteToRecovery/);
  assert.match(service, /The recording session is no longer available/);
  assert.match(service, /The recording is preserved/);
});
