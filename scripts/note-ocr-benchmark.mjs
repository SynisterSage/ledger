#!/usr/bin/env node

import fs from 'node:fs';

const usage = () => {
  console.error('Usage: node scripts/note-ocr-benchmark.mjs <results.jsonl>');
  console.error('Each line must contain: {"id":"...","expected":"...","actual":"...","engine":"...","durationMs":123}');
};

const normalize = (value) => String(value ?? '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/[ \t]*\n[ \t]*/g, '\n')
  .trim();

const levenshtein = (left, right) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : Math.min(diagonal + 1, previous[column] + 1, previous[column - 1] + 1);
      diagonal = above;
    }
  }
  return previous[right.length];
};

export const scoreOcr = (expected, actual) => {
  const expectedText = normalize(expected);
  const actualText = normalize(actual);
  const expectedWords = expectedText ? expectedText.split(/\s+/) : [];
  const actualWords = actualText ? actualText.split(/\s+/) : [];
  const characterDistance = levenshtein(expectedText, actualText);
  const wordDistance = levenshtein(expectedWords, actualWords);
  return {
    characterErrorRate: expectedText ? characterDistance / expectedText.length : actualText ? 1 : 0,
    wordErrorRate: expectedWords.length ? wordDistance / expectedWords.length : actualWords.length ? 1 : 0,
    exactMatch: expectedText === actualText,
    expectedCharacters: expectedText.length,
    actualCharacters: actualText.length,
    expectedWords: expectedWords.length,
    actualWords: actualWords.length,
  };
};

export const summarizeOcrResults = (rows) => {
  const byEngine = new Map();
  for (const row of rows) {
    const engine = String(row.engine ?? 'unknown');
    const score = scoreOcr(row.expected, row.actual);
    const current = byEngine.get(engine) ?? { engine, samples: 0, exactMatches: 0, characterDistance: 0, expectedCharacters: 0, wordDistance: 0, expectedWords: 0, durations: [] };
    current.samples += 1;
    current.exactMatches += score.exactMatch ? 1 : 0;
    current.characterDistance += levenshtein(normalize(row.expected), normalize(row.actual));
    current.expectedCharacters += score.expectedCharacters;
    current.wordDistance += levenshtein(normalize(row.expected).split(/\s+/).filter(Boolean), normalize(row.actual).split(/\s+/).filter(Boolean));
    current.expectedWords += score.expectedWords;
    if (Number.isFinite(row.durationMs) && row.durationMs >= 0) current.durations.push(row.durationMs);
    byEngine.set(engine, current);
  }
  return [...byEngine.values()].map((summary) => ({
    engine: summary.engine,
    samples: summary.samples,
    exactMatchRate: summary.samples ? summary.exactMatches / summary.samples : 0,
    characterErrorRate: summary.expectedCharacters ? summary.characterDistance / summary.expectedCharacters : 0,
    wordErrorRate: summary.expectedWords ? summary.wordDistance / summary.expectedWords : 0,
    averageDurationMs: summary.durations.length ? summary.durations.reduce((total, value) => total + value, 0) / summary.durations.length : null,
  }));
};

if (process.argv[1] && process.argv[1].endsWith('note-ocr-benchmark.mjs')) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    usage();
    process.exitCode = 1;
  } else {
    const rows = fs.readFileSync(inputPath, 'utf8').split('\n').map((line, index) => {
      if (!line.trim()) return null;
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== 'object' || typeof value.expected !== 'string' || typeof value.actual !== 'string') throw new Error('expected and actual must be strings');
        return value;
      } catch (error) {
        throw new Error(`Invalid JSONL row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }).filter(Boolean);
    console.table(summarizeOcrResults(rows).map((row) => ({
      engine: row.engine,
      samples: row.samples,
      exact: `${(row.exactMatchRate * 100).toFixed(1)}%`,
      cer: `${(row.characterErrorRate * 100).toFixed(1)}%`,
      wer: `${(row.wordErrorRate * 100).toFixed(1)}%`,
      averageMs: row.averageDurationMs === null ? 'n/a' : Math.round(row.averageDurationMs),
    })));
  }
}
