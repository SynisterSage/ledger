import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageStatus, mergeCoverage, missingCoverage, type CoverageRange } from './transcriptionCoverage.ts';

const range = (key: string, startMs: number, endMs: number, state: CoverageRange['state'] = 'covered', source: CoverageRange['source'] = 'user_microphone'): CoverageRange => ({ key, source, startMs, endMs, state, kind: 'live-window' });

test('long-session coverage merges adjacent windows without timestamp drift', () => {
  const windows = Array.from({ length: 1800 }, (_, index) => range(`w-${index}`, index * 3000, (index + 1) * 3000));
  const merged = mergeCoverage(windows);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].startMs, 0);
  assert.equal(merged[0].endMs, 5_400_000);
});

test('coverage reconciliation returns only missing archival ranges', () => {
  const covered = [range('a', 0, 10_000), range('b', 20_000, 30_000)];
  assert.deepEqual(missingCoverage(0, 30_000, covered, 'user_microphone'), [[10_000, 20_000]]);
});

test('coverage keeps mic and system audio independent', () => {
  const merged = mergeCoverage([range('mic', 0, 30_000), range('system', 0, 30_000, 'covered', 'system_audio')]);
  assert.equal(merged.length, 2);
  assert.deepEqual(new Set(merged.map((item) => item.source)), new Set(['user_microphone', 'system_audio']));
});

test('pending and failed ranges cannot be mistaken for complete coverage', () => {
  const status = coverageStatus([range('done', 0, 1000), range('pending', 1000, 2000, 'pending'), range('failed', 2000, 3000, 'failed')]);
  assert.equal(status.covered.length, 1);
  assert.equal(status.pending.length, 1);
  assert.equal(status.failed.length, 1);
});
