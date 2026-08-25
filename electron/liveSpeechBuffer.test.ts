import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveSpeechBuffer } from './liveSpeechBuffer.ts';

const samples = (seconds: number, value: number) => new Float32Array(Math.round(seconds * 16_000)).fill(value);

test('silence is skipped and speech closes after meaningful silence', () => {
  const buffer = new LiveSpeechBuffer({ source: 'system_audio' });
  assert.equal(buffer.push(samples(2, 0), 0).length, 0);
  const windows = buffer.push(samples(0.8, 0.1), 2000);
  assert.equal(windows.length, 0);
  const closed = buffer.push(samples(1, 0), 2800);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].source, 'system_audio');
  assert.ok(closed[0].speechDurationMs >= 700);
  assert.ok(closed[0].startOffsetMs < 2800);
  assert.ok(buffer.takeSkippedSilenceMs() > 0);
});

test('a natural short pause does not split a speech window', () => {
  const buffer = new LiveSpeechBuffer({ source: 'user_microphone' });
  buffer.push(samples(0.8, 0.1), 0);
  buffer.push(samples(0.4, 0), 800);
  buffer.push(samples(0.8, 0.1), 1200);
  assert.equal(buffer.flush().length, 1);
});

test('continuous speech is bounded by the maximum window duration', () => {
  const buffer = new LiveSpeechBuffer({ source: 'user_microphone', maxWindowMs: 1000 });
  const windows = buffer.push(samples(2.2, 0.1), 0);
  assert.ok(windows.length >= 2);
  assert.ok(windows.every((window) => window.endOffsetMs - window.startOffsetMs <= 1100));
});

test('silence-only input never produces a Whisper window', () => {
  const buffer = new LiveSpeechBuffer({ source: 'system_audio' });
  buffer.push(samples(4, 0.001), 0);
  assert.equal(buffer.flush().length, 0);
  assert.ok(buffer.takeSkippedSilenceMs() >= 3900);
});
