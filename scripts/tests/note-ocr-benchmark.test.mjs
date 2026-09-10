import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreOcr, summarizeOcrResults } from '../note-ocr-benchmark.mjs';

test('scores exact OCR output and normalizes line endings', () => {
  assert.deepEqual(scoreOcr('One  line\r\nTwo', 'One line\nTwo'), {
    characterErrorRate: 0,
    wordErrorRate: 0,
    exactMatch: true,
    expectedCharacters: 12,
    actualCharacters: 12,
    expectedWords: 3,
    actualWords: 3,
  });
});

test('scores empty and missing OCR output safely', () => {
  assert.equal(scoreOcr('', '').exactMatch, true);
  assert.equal(scoreOcr('Expected text', '').characterErrorRate, 1);
  assert.equal(scoreOcr('', 'Unexpected text').wordErrorRate, 1);
});

test('summarizes accuracy and latency by engine', () => {
  assert.deepEqual(summarizeOcrResults([
    { engine: 'apple-vision', expected: 'hello world', actual: 'hello world', durationMs: 20 },
    { engine: 'apple-vision', expected: 'hello world', actual: 'hello word', durationMs: 40 },
    { engine: 'paddleocr', expected: 'hello world', actual: 'hello world', durationMs: 100 },
  ]), [
    { engine: 'apple-vision', samples: 2, exactMatchRate: 0.5, characterErrorRate: 1 / 22, wordErrorRate: 0.25, averageDurationMs: 30 },
    { engine: 'paddleocr', samples: 1, exactMatchRate: 1, characterErrorRate: 0, wordErrorRate: 0, averageDurationMs: 100 },
  ]);
});
