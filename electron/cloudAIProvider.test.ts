import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudAIProvider } from './cloudAIProvider.ts';

const keys = { get: () => 'test-secret', selectedModel: () => 'test-model', cloudDataConsent: () => true } as never;

test('streams OpenAI visible deltas and never exposes the credential in output', async () => {
  const body = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" Ledger"}}]}\n\ndata: [DONE]\n\n';
  const fakeFetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), { status: 200 });
  const events: any[] = [];
  await new CloudAIProvider(keys, fakeFetch as never).stream('openai', { question: 'q', context: 'c' }, { onEvent: (event) => events.push(event) }, new AbortController().signal, 'request-1');
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['Hello', ' Ledger']);
  assert.equal(events.at(-1)?.type, 'done');
});

test('parses Anthropic and Perplexity streamed text', async () => {
  const cases = [
    ['anthropic', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello Ledger"}}\n\n'],
    ['perplexity', 'data: {"choices":[{"delta":{"content":"Hello Ledger"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'],
  ] as const;
  for (const [provider, body] of cases) {
    const events: any[] = [];
    const fakeFetch = async () => new Response(body, { status: 200 });
    await new CloudAIProvider(keys, fakeFetch as never).stream(provider, { question: 'q', context: 'c' }, { onEvent: (event) => events.push(event) }, new AbortController().signal, provider);
    assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['Hello Ledger']);
    assert.equal(events.at(-1)?.type, 'done');
  }
});

test('parses Kimi streamed text through its OpenAI-compatible response shape', async () => {
  const events: any[] = [];
  const body = 'data: {"choices":[{"delta":{"content":"Hello Kimi"}}]}\n\ndata: [DONE]\n\n';
  const fakeFetch = async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    return new Response(body, { status: 200 });
  };
  const kimiKeys = { get: () => 'test-secret', selectedModel: () => 'kimi-k2.6', cloudDataConsent: () => true } as never;
  await new CloudAIProvider(kimiKeys, fakeFetch as never).stream('kimi', { question: 'q', context: 'c' }, { onEvent: (event) => events.push(event) }, new AbortController().signal, 'kimi');
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['Hello Kimi']);
  assert.equal(events.at(-1)?.type, 'done');
});

test('streams DeepSeek through its OpenAI-compatible endpoint', async () => {
  const events: any[] = [];
  const body = 'data: {"choices":[{"delta":{"content":"Hello DeepSeek"}}]}\n\ndata: [DONE]\n\n';
  const fakeFetch = async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    const requestBody = JSON.parse(String(init?.body)) as { model: string; stream: boolean };
    assert.deepEqual(requestBody, { model: 'deepseek-v4-flash', stream: true, messages: [{ role: 'user', content: 'c' }], max_completion_tokens: 512 });
    return new Response(body, { status: 200 });
  };
  const deepseekKeys = { get: () => 'test-secret', selectedModel: () => 'deepseek-v4-flash', cloudDataConsent: () => true } as never;
  await new CloudAIProvider(deepseekKeys, fakeFetch as never).stream('deepseek', { question: 'q', context: 'c' }, { onEvent: (event) => events.push(event) }, new AbortController().signal, 'deepseek');
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['Hello DeepSeek']);
  assert.equal(events.at(-1)?.type, 'done');
});

test('uses a bounded no-thinking request for Gemini 2.5 Flash and emits its answer', async () => {
  let requestBody: unknown;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden' }, { text: 'Hello Ledger' }] } }] }), { status: 200 });
  };
  const events: any[] = [];
  const googleKeys = { get: () => 'test-secret', selectedModel: () => 'gemini-2.5-flash', cloudDataConsent: () => true } as never;
  await new CloudAIProvider(googleKeys, fakeFetch as never).stream('google', { question: 'q', context: 'c' }, { onEvent: (event) => events.push(event) }, new AbortController().signal, 'google');
  assert.deepEqual((requestBody as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['Hello Ledger']);
  assert.equal(events.at(-1)?.type, 'done');
});
