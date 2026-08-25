import assert from 'node:assert/strict';
import test from 'node:test';
import { ZoomSpeakerAttribution } from './zoomSpeakerAttribution.ts';

const segment = (startMs: number, endMs: number, audioSource: 'system_audio' | 'user_microphone' = 'system_audio') => ({ id: `${startMs}`, audioSource, speakerLabel: audioSource === 'user_microphone' ? 'You' as const : 'Meeting' as const, startMs, endMs, text: 'words', confidence: 1, segmentOrder: 0 });

function timeline() {
  const attribution = new ZoomSpeakerAttribution();
  attribution.startSession('session-a', { noteId: 'note-a', workspaceId: 'workspace-a', startedAt: new Date(0).toISOString() });
  attribution.record('session-a', { displayName: 'Sarah Johnson', observedAtMs: 18_000 });
  return attribution;
}

test('clear single speaker interval becomes a known Zoom identity', () => {
  const result = timeline().attribute('session-a', [segment(20_000, 25_000)])[0];
  assert.equal(result.speakerLabel, 'Meeting');
  assert.equal(result.speakerIdentity?.source, 'zoom_accessibility');
});

test('microphone stays You and uncertain intervals stay Meeting', () => {
  const attribution = timeline();
  attribution.record('session-a', { displayName: 'John Smith', observedAtMs: 27_000 });
  assert.equal(attribution.attribute('session-a', [segment(20_000, 25_000, 'user_microphone')])[0].speakerLabel, 'You');
  assert.equal(attribution.attribute('session-a', [segment(25_000, 30_000)])[0].speakerLabel, 'Meeting');
});

test('gaps, cross-session data, and workspace isolation do not attribute', () => {
  const attribution = timeline();
  assert.equal(attribution.attribute('session-b', [segment(20_000, 25_000)])[0].speakerLabel, 'Meeting');
  attribution.clearSession('session-a');
  assert.equal(attribution.attribute('session-a', [segment(20_000, 25_000)])[0].speakerLabel, 'Meeting');
});

test('rapid switches below threshold remain unknown', () => {
  const attribution = timeline();
  attribution.record('session-a', { displayName: 'John Smith', observedAtMs: 22_000 });
  const result = attribution.attribute('session-a', [segment(20_000, 25_000)])[0];
  assert.equal(result.speakerLabel, 'Meeting');
  assert.equal(result.speakerIdentity, undefined);
});

test('duplicate AX events and participant renames stay monotonic', () => {
  const attribution = timeline();
  attribution.record('session-a', { displayName: 'Sarah Johnson', observedAtMs: 18_000 });
  attribution.record('session-a', { displayName: 'Sarah Johnson', observedAtMs: 18_000 });
  attribution.record('session-a', { displayName: 'Sarah J', observedAtMs: 26_000 });
  const entries = attribution.getTimeline('session-a');
  assert.deepEqual(entries.map(({ displayName, startMs, endMs }) => ({ displayName, startMs, endMs })), [
    { displayName: 'Sarah Johnson', startMs: 18_000, endMs: 26_000 },
    { displayName: 'Sarah J', startMs: 26_000, endMs: null },
  ]);
  assert.equal(attribution.record('session-a', { displayName: 'late', observedAtMs: 10_000 }), false);
});

test('ambiguous signal, helper-like failure, and cleanup degrade to Meeting', () => {
  const attribution = timeline();
  assert.equal(attribution.record('session-a', { displayName: 'Shared room', observedAtMs: 20_000, ambiguous: true }), false);
  assert.equal(attribution.attribute('session-a', [segment(20_000, 25_000)])[0].speakerLabel, 'Meeting');
  attribution.clearSession('session-a');
  assert.equal(attribution.getTimeline('session-a').length, 0);
  assert.equal(attribution.attribute('session-a', [segment(20_000, 25_000)])[0].speakerLabel, 'Meeting');
});

test('long meetings remain bounded', () => {
  const attribution = timeline();
  for (let index = 0; index < 10_050; index += 1) attribution.record('session-a', { displayName: `Person ${index}`, observedAtMs: 20_000 + index * 1000 });
  assert.ok(attribution.getTimeline('session-a').length <= 10_000);
});
