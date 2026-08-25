import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../../electron/transcriptionService.ts', import.meta.url), 'utf8');
const capture = fs.readFileSync(new URL('../../electron/audioCaptureService.ts', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8');
const nativeBridge = fs.readFileSync(new URL('../../native/LedgerAudioCaptureBridge.swift', import.meta.url), 'utf8');
const recapTest = fs.readFileSync(new URL('./meeting-notes-phase4.test.mjs', import.meta.url), 'utf8');

test('live transcription has an independent audio-data path from archival chunks', () => {
  assert.match(capture, /type: 'audio-data'/);
  assert.match(capture, /onAudioData/);
  assert.match(preload, /liveFrameCount/);
  assert.match(preload, /event: 'audio-data'/);
  assert.match(nativeBridge, /emitAudioData/);
  assert.match(service, /LiveSpeechBuffer/);
  assert.match(service, /ingestAudioData/);
});

test('speech windows use persistent runtime, stable persistence, and independent timestamps', () => {
  assert.match(service, /enqueueSpeechWindow/);
  assert.match(service, /writeTranscriptionWav/);
  assert.match(service, /this\.whisperRuntime\.transcribe/);
  assert.match(service, /startOffsetMs/);
  assert.match(service, /liveWindowRecords/);
  assert.match(service, /speech_window_complete/);
});

test('recording remains authoritative fallback and backlog is bounded by one worker', () => {
  assert.match(service, /validChunks\(session\.sessionId, session\.chunks\)/);
  assert.match(service, /if \(this\.runningJobId\) return/);
  assert.match(service, /isCoveredByLiveWindows/);
  assert.match(service, /flushLiveAudio/);
});

test('stale recap assertion now reflects the Enhance/Transcript lifecycle', () => {
  assert.doesNotMatch(recapTest, /'Recap ✓'/);
  assert.match(recapTest, /'Enhance'/);
  assert.match(recapTest, /'Transcript'/);
});
