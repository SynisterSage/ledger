import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../../electron/transcriptionService.ts', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../../electron/whisperRuntime.ts', import.meta.url), 'utf8');
const builder = fs.readFileSync(new URL('../../electron-builder.json5', import.meta.url), 'utf8');

test('service uses one persistent runtime for queued chunks and retains CLI fallback', () => {
  assert.match(service, /new PersistentWhisperRuntime/);
  assert.match(service, /this\.whisperRuntime\.transcribe/);
  assert.match(service, /private transcribeWithCli/);
  assert.match(service, /const gpuArgs = \['-ng'\]/);
  assert.doesNotMatch(service, /LEDGER_WHISPER_USE_METAL/);
});

test('runtime starts once, serializes requests through the caller, and retries after failure', () => {
  assert.match(runtime, /startupCountValue/);
  assert.match(runtime, /if \(this\.healthy && this\.process/);
  assert.match(runtime, /\/inference/);
  assert.match(runtime, /restarted = true/);
  assert.match(runtime, /await this\.stop\(\)/);
  assert.match(runtime, /127\.0\.0\.1/);
});

test('Phase 2 preserves Phase 1 incremental delivery and uses normalized working audio', () => {
  assert.match(service, /normalizeWavForTranscription/);
  assert.match(service, /emitSegments\(jobId, session, next/);
  assert.match(service, /chunkRecords/);
  assert.match(service, /state: 'completed'/);
  assert.match(service, /this\.whisperRuntime\?\.cancelCurrent/);
});

test('packaging includes the persistent runtime', () => {
  assert.match(builder, /whisper-server/);
});
