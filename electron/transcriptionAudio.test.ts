import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeWavForTranscription } from './transcriptionAudio.ts';

function writeFloat32StereoWav(filePath: string) {
  const sampleRate = 48_000;
  const frames = sampleRate;
  const dataLength = frames * 2 * 4;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataLength, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2 * 4, 28); buffer.writeUInt16LE(8, 32); buffer.writeUInt16LE(32, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataLength, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin(frame / 20) * 0.25;
    buffer.writeFloatLE(value, 44 + frame * 8); buffer.writeFloatLE(value * 0.5, 48 + frame * 8);
  }
  fs.writeFileSync(filePath, buffer);
}

test('normalizes transcription input without modifying the original and reuses the cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-transcription-audio-'));
  const original = path.join(root, 'system.wav');
  writeFloat32StereoWav(original);
  const before = fs.readFileSync(original);

  const first = normalizeWavForTranscription(original, root);
  const second = normalizeWavForTranscription(original, root);
  const normalized = fs.readFileSync(first.path);

  assert.equal(first.converted, true);
  assert.equal(second.path, first.path);
  assert.deepEqual(fs.readFileSync(original), before);
  assert.equal(normalized.toString('ascii', 0, 4), 'RIFF');
  assert.equal(normalized.readUInt16LE(20), 1);
  assert.equal(normalized.readUInt16LE(22), 1);
  assert.equal(normalized.readUInt32LE(24), 16_000);
  assert.equal(normalized.readUInt16LE(34), 16);
  assert.equal(normalized.readUInt32LE(40), 16_000 * 2);
});
