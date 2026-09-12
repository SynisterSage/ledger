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
