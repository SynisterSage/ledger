import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseTraceFetch } from './request-instrumentation.js';

test('Supabase tracing reports fields, counts, rows, and size without response data', async () => {
  const previousDebug = console.debug;
  const messages = [];
  console.debug = (_label, payload) => messages.push(payload);
  try {
    const fetch = createSupabaseTraceFetch(async () =>
      new Response(JSON.stringify([{ id: '1' }, { id: '2' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const response = await fetch('https://example.supabase.co/rest/v1/notes?select=id%2Ctitle');
    assert.equal((await response.json()).length, 2);
    assert.equal(messages[0].table, 'notes');
    assert.equal(messages[0].selectedFields, 'id,title');
    assert.equal(messages[0].invocationCount, 1);
    assert.equal(messages[0].returnedRowCount, 2);
    assert.ok(messages[0].approximateResponseBytes > 0);
    assert.equal(Object.hasOwn(messages[0], 'body'), false);
  } finally {
    console.debug = previousDebug;
  }
});
