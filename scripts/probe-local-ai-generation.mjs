#!/usr/bin/env node

// Development-only probe. It deliberately reports stream metadata only and
// never prints model reasoning or visible answer text.
const port = Number(process.env.LEDGER_LOCAL_AI_PORT || 39281);
const url = `http://127.0.0.1:${port}/v1/chat/completions`;

const probe = async (label, maxTokens) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stream: true,
      max_tokens: maxTokens,
      n_predict: maxTokens,
      temperature: 0.2,
      top_p: 0.95,
      top_k: 40,
      min_p: 0.05,
      reasoning_budget: Math.min(2048, Math.max(768, maxTokens - 512)),
      reasoning_format: 'deepseek',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
  if (!response.ok || !response.body) {
    console.log(JSON.stringify({ label, status: response.status, failureReason: 'runtime_failure' }));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reasoningChunks = 0;
  let reasoningTokens = 0;
  let contentChunks = 0;
  let visibleContentChars = 0;
  let finishReason = null;
  let predictedTokens;
  let timings;
  const startedAt = Date.now();
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    const choice = chunk.choices?.[0];
    const reasoning = choice?.delta?.reasoning_content;
    const content = choice?.delta?.content;
    if (typeof reasoning === 'string' && reasoning.length) {
      reasoningChunks += 1;
      reasoningTokens += reasoning.trim().split(/\s+/).filter(Boolean).length;
    }
    if (typeof content === 'string' && content.length) {
      contentChunks += 1;
      visibleContentChars += content.length;
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (typeof chunk.usage?.completion_tokens === 'number') predictedTokens = chunk.usage.completion_tokens;
    if (chunk.timings) timings = chunk.timings;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(consume);
  }
  console.log(JSON.stringify({ label, maxTokens, reasoningFormat: 'deepseek', reasoningChunks, reasoningTokens, contentChunks, visibleContentChars, finishReason, predictedTokens, timings, elapsedMs: Date.now() - startedAt }));
};

try {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  if (!health.ok) throw new Error(`health_${health.status}`);
  await probe('exact_current_parameters', 4096);
  await probe('larger_generation_allowance', 8192);
} catch (error) {
  console.error(JSON.stringify({ failureReason: 'runtime_unavailable', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
