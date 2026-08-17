import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeSearchResults,
  normalizeSearchTerm,
  scoreSearchResult,
  truncateSearchPreview,
} from './search-contract.js';

test('search scoring prioritizes exact and title matches over content matches', () => {
  assert.equal(scoreSearchResult('OAuth', 'oauth'), 0);
  assert.equal(scoreSearchResult('OAuth callback', 'oauth'), 1);
  assert.equal(scoreSearchResult('Auth flow', 'oauth', 'OAuth appears in the body'), 4);
  assert.equal(scoreSearchResult('Meeting', 'oauth', 'OAuth appears in transcript', true), 3);
});

test('search normalization and previews stay bounded', () => {
  assert.equal(normalizeSearchTerm('  Launch  Plan '), 'launch  plan');
  assert.equal(truncateSearchPreview('one\n two\tthree', 40), 'one two three');
  assert.equal(truncateSearchPreview('abcdefghij', 6), 'abcde…');
});

test('search deduplication keeps the strongest representation of an object', () => {
  const result = dedupeSearchResults([
    { type: 'note', id: 'note-1', title: 'Meeting', score: 4 },
    { type: 'note', id: 'note-1', title: 'Meeting', score: 1, context_label: 'Meeting note' },
    { type: 'external_reference', id: 'ref-1', title: 'Design', score: 2 },
    { type: 'external_reference', id: 'ref-1', title: 'Design', score: 3 },
    { type: 'meeting_metadata', id: 'note-2', note_id: 'note-2', title: 'Details', score: 2 },
    { type: 'note', id: 'note-2', title: 'Meeting note', score: 1, context_label: 'Meeting note' },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result.find((item) => item.type === 'note')?.context_label, 'Meeting note');
});
