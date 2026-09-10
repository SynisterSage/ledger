import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNoteOcrResult } from './index.ts';

test('accepts a normalized Apple Vision result', () => {
  assert.deepEqual(parseNoteOcrResult({
    text: 'First line\nSecond line',
    lines: [
      { text: 'First line', confidence: 0.98, boundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 } },
      { text: 'Second line', confidence: 0.91 },
    ],
    engine: 'apple-vision',
    language: 'en-US',
    durationMs: 42,
  }), {
    text: 'First line\nSecond line',
    lines: [
      { text: 'First line', confidence: 0.98, boundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 } },
      { text: 'Second line', confidence: 0.91 },
    ],
    engine: 'apple-vision',
    language: 'en-US',
    durationMs: 42,
  });
});

test('rejects invalid provider output before Lexical insertion', () => {
  assert.equal(parseNoteOcrResult({ text: 'bad', lines: [{ text: 'bad', confidence: 1.2 }], engine: 'paddleocr' }), null);
  assert.equal(parseNoteOcrResult({ text: 'bad', lines: [{ text: 'bad', boundingBox: { x: 0, y: 0, width: 2, height: 1 } }], engine: 'paddleocr' }), null);
  assert.equal(parseNoteOcrResult({ text: 'bad', lines: [], engine: 'unknown' }), null);
});

test('allows empty text so the UI can show a no-text state', () => {
  assert.deepEqual(parseNoteOcrResult({ text: '', lines: [], engine: 'paddleocr' }), {
    text: '',
    lines: [],
    engine: 'paddleocr',
  });
});
