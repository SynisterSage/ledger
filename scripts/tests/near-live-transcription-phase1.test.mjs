import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const capture = read('electron/audioCaptureService.ts');
const service = read('electron/transcriptionService.ts');
const main = read('electron/main.ts');
const notes = read('src/components/Notes/NotesWindow.tsx');

test('finalized capture chunks are published to the transcription worker', () => {
  assert.match(capture, /onChunk\(listener: \(chunk: RecordingChunk\)/);
  assert.match(capture, /this\.chunkListeners\.forEach\(\(listener\) => listener\(chunk\)\)/);
  assert.match(main, /meetingAudioCaptureService\.onChunk\(\(chunk\) =>/);
  assert.match(main, /localTranscriptionService\.enqueueFinalizedChunk\(chunk\)/);
});

test('phase 1 tracks chunk identity and processes one worker at a time', () => {
  assert.match(service, /chunkRecords/);
  assert.match(service, /state: 'queued'/);
  assert.match(service, /state: 'processing'/);
  assert.match(service, /state: 'completed'/);
  assert.match(service, /state: 'failed'/);
  assert.match(service, /if \(this\.runningJobId\) return/);
  assert.match(service, /this\.validChunks\(session\.sessionId, session\.chunks\)\.find/);
});

test('stable segments are emitted incrementally and persisted through the existing API', () => {
  assert.match(service, /onSegments\(/);
  assert.match(service, /this\.emitSegments\(jobId, session, next, parsed\.rows/);
  assert.match(main, /meeting-transcription:segments/);
  assert.match(notes, /transcription\.onSegments\(/);
  assert.match(notes, /api\.bulkCreateTranscriptSegments\(event\.noteId/);
});

test('Stop finalizes an existing incremental job instead of resetting completed work', () => {
  const stop = notes.slice(notes.indexOf('const stopMeeting'));
  assert.ok(stop.indexOf('window.meetingAudio.stop()') < stop.indexOf('window.meetingTranscription.start('));
  assert.match(service, /state === 'failed' \? \{ \.\.\.record, state: 'queued'/);
  assert.doesNotMatch(service, /segments: \[\], skippedChunks: \[\], startedAt: null/);
});

test('CPU Whisper remains the default and VAD/Metal are not enabled by this phase', () => {
  assert.match(service, /const gpuArgs = \['-ng'\]/);
  assert.doesNotMatch(service, /LEDGER_WHISPER_USE_METAL/);
  assert.doesNotMatch(service, /--vad/);
});
