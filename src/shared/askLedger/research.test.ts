import assert from 'node:assert/strict';
import test from 'node:test';
import { isExternalResearchQuestion, normalizeResearchCitations } from './research.ts';

test('detects explicit web research without treating every workspace lookup as web research', () => {
  assert.equal(isExternalResearchQuestion('Research this online'), true);
  assert.equal(isExternalResearchQuestion('What are my latest tasks?'), true);
  assert.equal(isExternalResearchQuestion('What tasks are in my project?'), false);
});

test('normalizes, deduplicates, validates, and bounds research citations', () => {
  const citations = normalizeResearchCitations([
    'https://example.com/a',
    { url: 'https://example.com/a', title: 'Duplicate' },
    { url: 'https://example.com/b', title: 'Source B' },
    'javascript:alert(1)',
  ]);
  assert.deepEqual(citations, [
    { url: 'https://example.com/a' },
    { url: 'https://example.com/b', title: 'Source B' },
  ]);
});
