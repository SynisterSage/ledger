import type { AIProvider, AIProviderKeyStore } from './aiProviderKeyStore';
import type { LocalAIRequest, LocalAIStreamEvent } from './localAIService';

type StreamCallbacks = { onEvent: (event: LocalAIStreamEvent) => void };

export class CloudAIError extends Error {
  readonly code: 'request_timeout' | 'malformed_response';

  constructor(code: 'request_timeout' | 'malformed_response', message: string) {
    super(message);
    this.name = 'CloudAIError';
    this.code = code;
  }
}

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
    const model = this.keys.selectedModel(provider).replace(/^models\//, '');
    const startedAt = Date.now();
    let phase = 'waiting for response headers';
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timeoutMs = request.timeoutMs ?? 120_000;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const googleThinkingConfig = model.startsWith('gemini-2.5-flash')
        ? { thinkingBudget: 0 }
        : model.startsWith('gemini-3')
          ? { thinkingLevel: 'low' }
          : undefined;
      const body = provider === 'openai' || provider === 'perplexity' || provider === 'kimi'
        ? { model, stream: true, messages: [{ role: 'user', content: request.context }], max_completion_tokens: request.generationBudget ?? 512 }
        : provider === 'anthropic'
          ? { model, stream: true, max_tokens: request.generationBudget ?? 512, messages: [{ role: 'user', content: request.context }] }
          : {
              contents: [{ role: 'user', parts: [{ text: request.context }] }],
              generationConfig: {
                maxOutputTokens: request.generationBudget ?? 256,
                ...(googleThinkingConfig ? { thinkingConfig: googleThinkingConfig } : {}),
              },
            };
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (provider === 'google') headers.accept = 'application/json';
      if (provider === 'openai' || provider === 'perplexity' || provider === 'kimi') headers.Authorization = `Bearer ${key}`;
      else if (provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
      else headers['x-goog-api-key'] = key;
      const endpoint = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : provider === 'google' ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` : provider === 'perplexity' ? 'https://api.perplexity.ai/chat/completions' : 'https://api.moonshot.ai/v1/chat/completions';
      const response = await this.fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      phase = 'reading response body';
      if (!response.ok || !response.body) {
        let detail = '';
        try {
          const payload = await response.clone().json() as { error?: { message?: unknown } | string };
          detail = typeof payload.error === 'string' ? payload.error : typeof payload.error?.message === 'string' ? payload.error.message : '';
        } catch { /* Some providers return an empty/non-JSON error body. */ }
        throw new Error(`The ${provider} provider returned HTTP ${response.status} for ${model}${detail ? `: ${detail}` : '.'}`);
      }
      let visibleChars = 0;
      if (provider === 'google') {
        const payload = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }>; promptFeedback?: { blockReason?: string } };
        const text = (payload.candidates?.[0]?.content?.parts ?? [])
          .map((part) => !part.thought && typeof part?.text === 'string' ? part.text : '')
          .join('');
        if (!text.trim()) throw new CloudAIError('malformed_response', `Google returned no answer for ${model} (${payload.promptFeedback?.blockReason ?? payload.candidates?.[0]?.finishReason ?? 'empty response'}).`);
        if (text) { visibleChars += text.length; callbacks.onEvent({ type: 'delta', requestId, text }); }
        callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: Date.now() - startedAt, visibleContentChars: visibleChars, generationBudget: request.generationBudget, finishReason: payload.candidates?.[0]?.finishReason ?? null } });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason: string | null = null;
      const consume = (line: string) => {
        if (!line.startsWith('data:')) return;
        const value = line.slice(5).trim();
        if (!value || value === '[DONE]') return;
        try {
          const event = JSON.parse(value) as any;
          finishReason = event.choices?.[0]?.finish_reason ?? event.stop_reason ?? finishReason;
          const text = provider === 'openai' || provider === 'perplexity' || provider === 'kimi'
            ? event.choices?.[0]?.delta?.content
            : provider === 'anthropic'
              ? event.delta?.text
              : (event.candidates?.[0]?.content?.parts ?? [])
                .map((part: { text?: unknown }) => typeof part?.text === 'string' ? part.text : '')
                .join('');
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
      if (!visibleChars) throw new CloudAIError('malformed_response', `${provider} returned no answer for ${model}${finishReason ? ` (${finishReason})` : ''}.`);
      callbacks.onEvent({ type: 'done', requestId, metrics: { totalMs: Date.now() - startedAt, visibleContentChars: visibleChars, generationBudget: request.generationBudget, finishReason } });
    } catch (error) {
      if (timedOut && !signal.aborted) {
        throw new CloudAIError('request_timeout', `${provider} (${model}) timed out after ${Math.round((Date.now() - startedAt) / 1000)} seconds while ${phase}.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }
}
