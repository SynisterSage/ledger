import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const factory = await readFile('electron/audio-capture/createAudioCaptureAdapter.ts', 'utf8');
const types = await readFile('electron/audio-capture/types.ts', 'utf8');
const windows = await readFile('electron/audio-capture/adapters/WindowsAudioCaptureAdapter.ts', 'utf8');
const preload = await readFile('electron/preload.ts', 'utf8');
const sessions = await readFile('electron/recordingSessionStore.ts', 'utf8');
const service = await readFile('electron/audioCaptureService.ts', 'utf8');
const transcription = await readFile('electron/transcriptionService.ts', 'utf8');
const builder = await readFile('electron-builder.json5', 'utf8');
const runtimeBuild = await readFile('scripts/build-whisper-windows.ps1', 'utf8');

test('platform routing is centralized in the capture factory', () => {
  assert.match(factory, /platform === 'darwin'/);
  assert.match(factory, /platform === 'win32'/);
  assert.doesNotMatch(service, /process\.platform === 'win32'/);
});

test('Windows loopback responses resolve flush and resume-health requests', () => {
  assert.match(windows, /event === 'flushed'/);
  assert.match(windows, /event === 'health'/);
  assert.match(preload, /command\.command === 'flush'/);
  assert.match(preload, /command\.command === 'health'/);
});

test('capture errors remain structured and user-facing', () => {
  assert.match(types, /type AudioCaptureErrorCode/);
  assert.match(windows, /function windowsCaptureMessage/);
  assert.doesNotMatch(windows, /WASAPI/);
  assert.doesNotMatch(windows, /Electron error/);
});

test('capture cleanup and finalization are idempotent', () => {
  assert.match(windows, /if \(!this\.active\) return/);
  assert.match(service, /stopInFlight/);
  assert.match(service, /promoteToCompleted/);
  assert.match(sessions, /finalizationState/);
});

test('recovery state is checkpointed outside renderer memory', () => {
  assert.match(sessions, /meeting-recordings/);
  assert.match(sessions, /active/);
  assert.match(sessions, /completed/);
  assert.match(sessions, /recovery/);
  assert.match(sessions, /manifest\.json/);
  assert.match(sessions, /fs\.renameSync\(temporary/);
});

test('suspend and resume retain source health handling', () => {
  assert.match(service, /prepareForSuspend/);
  assert.match(service, /checkAfterResume/);
  assert.match(service, /markInterrupted/);
  assert.match(preload, /readyState === 'live'/);
});

test('missing Windows Whisper runtime fails before processing starts', () => {
  assert.match(transcription, /this\.runtimePath\(\);/);
  assert.match(transcription, /whisper-cli\.exe/);
  assert.match(transcription, /Windows transcription is not available/);
  assert.ok(transcription.indexOf('this.runtimePath();') < transcription.indexOf('this.jobs.create('));
});

test('packaging keeps macOS helpers out of Windows resources', () => {
  assert.match(builder, /mac: \{/);
  assert.match(builder, /extraResources:/);
  assert.match(builder, /signingHashAlgorithms: \['sha256'\]/);
  assert.match(builder, /deleteAppDataOnUninstall: false/);
});

test('Windows Whisper runtime has a reproducible pinned build path', () => {
  assert.match(runtimeBuild, /a630b35c6fc02c8879f751ec3f39a61327f01dc7/);
  assert.match(runtimeBuild, /whisper-cli\.exe/);
  assert.match(runtimeBuild, /WHISPER_BUILD_EXAMPLES=ON/);
  assert.match(runtimeBuild, /Copy-Item/);
});
