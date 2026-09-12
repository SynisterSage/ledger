import type { AIProvider, AIProviderKeyStore } from './aiProviderKeyStore';
import type { LocalAIRequest, LocalAIStreamEvent } from './localAIService';

type StreamCallbacks = { onEvent: (event: LocalAIStreamEvent) => void };

export class CloudAIProvider {
  private readonly keys: AIProviderKeyStore;
  private readonly fetcher: typeof fetch;

  constructor(keys: AIProviderKeyStore, fetcher: typeof fetch = fetch) {
    this.keys = keys;
    this.fetcher = fetcher;
  }

  async stream(provider: AIProvider, request: LocalAIRequest, callbacks: StreamCallbacks, signal: AbortSignal, requestId: string) {
    const key = this.keys.get(provider);
    if (!key) throw new Error(`No ${provider} API key is connected.`);
    if (!this.keys.cloudDataConsent()) throw new Error('Cloud AI is not enabled. Allow relevant Ledger context to leave this device in Settings.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 90_000);
    try {
      const model = this.keys.selectedModel(provider);
      const body = provider === 'openai' || provider === 'perplexity'
        ? { model, stream: true, messages: [{ role: 'user', content: request.context }], max_completion_tokens: request.generationBudget ?? 512 }
        : provider === 'anthropic'
          ? { model, stream: true, max_tokens: request.generationBudget ?? 512, messages: [{ role: 'user', content: request.context }] }
          : { contents: [{ role: 'user', parts: [{ text: request.context }] }], generationConfig: { maxOutputTokens: request.generationBudget ?? 512 } };
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (provider === 'openai' || provider === 'perplexity') headers.Authorization = `Bearer ${key}`;
      else if (provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
      else headers['x-goog-api-key'] = key;
      const endpoint = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : provider === 'google' ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse` : 'https://api.perplexity.ai/chat/completions';
      const response = await this.fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`The provider returned HTTP ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let visibleChars = 0;
      const consume = (line: string) => {
        if (!line.startsWith('data:')) return;
        const value = line.slice(5).trim();
        if (!value || value === '[DONE]') return;
        try {
          const event = JSON.parse(value) as any;
          const text = provider === 'openai' || provider === 'perplexity' ? event.choices?.[0]?.delta?.content : provider === 'anthropic' ? event.delta?.text : event.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text === 'string' && text) { visibleChars += text.length; callbacks.onEvent({ type: 'delta', requestId, text }); }
        } catch { /* Ignore non-JSON keepalive frames. */ }
      };
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        lines.forEach(consume);
      }
      if (buffer) consume(buffer);
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: 0, visibleContentChars: visibleChars, generationBudget: request.generationBudget } });
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }
}
