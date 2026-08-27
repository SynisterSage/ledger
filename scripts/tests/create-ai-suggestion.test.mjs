import assert from 'node:assert/strict';
import test from 'node:test';

const load = async () => import('../../src/utils/createParser/createAiSuggestion.ts');

test('accepts only bounded structured AI suggestions and allowed resources', async () => {
  const { parseAiCreateSuggestion } = await load();
  const result = parseAiCreateSuggestion('{"title":"Follow up","date":"2026-09-01","confidence":"high","relatedResources":[{"type":"project","id":"p1","label":"Alfa"},{"type":"project","id":"p2","label":"Other"}]}', [{ type: 'project', id: 'p1', label: 'Alfa' }]);
  assert.equal(result?.title, 'Follow up');
  assert.deepEqual(result?.relatedResources, [{ type: 'project', id: 'p1', label: 'Alfa' }]);
});

test('rejects malformed or unsupported structured results', async () => {
  const { parseAiCreateSuggestion } = await load();
  assert.equal(parseAiCreateSuggestion('{"title":"x","confidence":"high","date":"not-a-date"}'), null);
  assert.equal(parseAiCreateSuggestion('{"title":"x","confidence":"high","date":"2026-02-31"}'), null);
  assert.equal(parseAiCreateSuggestion('Here is some prose.'), null);
});

test('AI trigger requires contextual or unresolved signals', async () => {
  const { shouldUseCreateAi } = await load();
  assert.equal(shouldUseCreateAi('Dinner Friday at 7', { date: '2026-08-28', time: '19:00' }), false);
  assert.equal(shouldUseCreateAi('Follow up with people from my last meeting next week', {}), true);
});
