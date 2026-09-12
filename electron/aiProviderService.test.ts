import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderService } from './aiProviderService.ts';

const keys = { get: () => 'test-secret' } as never;

test('lists current OpenAI text models while retaining lower-cost variants', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ data: [
    { id: 'gpt-5' },
    { id: 'gpt-5-mini' },
    { id: 'gpt-5-nano' },
    { id: 'gpt-4.1-mini' },
    { id: 'gpt-4-turbo' },
    { id: 'gpt-3.5-turbo' },
    { id: 'gpt-5-realtime' },
    { id: 'text-embedding-3-small' },
  ] }), { status: 200 });
  const result = await new AIProviderService(keys, fakeFetch as never).listModels('openai');
  assert.deepEqual(result.models, ['gpt-4.1-mini', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5']);
});

test('lists Kimi text models without applying OpenAI-specific filtering', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ data: [{ id: 'kimi-k2.6' }, { id: 'kimi-k3' }] }), { status: 200 });
  const result = await new AIProviderService(keys, fakeFetch as never).listModels('kimi');
  assert.deepEqual(result.models, ['kimi-k2.6', 'kimi-k3']);
});
