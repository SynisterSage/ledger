import * as SecureStore from 'expo-secure-store';

export type MobileAIProvider = 'openai' | 'anthropic' | 'google' | 'perplexity' | 'kimi' | 'deepseek';
export type MobileAISelection = MobileAIProvider | null;

export type MobileAIProviderState = {
  provider: MobileAIProvider;
  connected: boolean;
  keySuffix: string | null;
  model: string;
};

export const MOBILE_AI_PROVIDERS: Array<{ id: MobileAIProvider; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
];

const STORAGE_KEY = 'ledger.mobile.ask-ledger.ai.v1';
const defaultModelFor = (provider: MobileAIProvider) => provider === 'openai'
  ? 'gpt-5-mini'
  : provider === 'anthropic'
  ? 'claude-3-5-haiku-latest'
  : provider === 'google'
  ? 'gemini-3.5-flash-lite'
  : provider === 'perplexity'
  ? 'sonar-pro'
  : provider === 'kimi'
  ? 'kimi-k2.6'
  : 'deepseek-v4-flash';

const isTextGenerationModel = (id: string) => !/(embedding|moderation|whisper|tts|dall-e|image|audio|search|rerank)/i.test(id);
const isSupportedGenerationModel = (provider: MobileAIProvider, id: string) => {
  if (!isTextGenerationModel(id)) return false;
  if (provider === 'openai') return /^(gpt-|o[1-9]-|chatgpt-)/i.test(id) && !/(realtime|audio|image|search|computer-use)/i.test(id);
  if (provider === 'anthropic') return /^claude-/i.test(id);
  if (provider === 'perplexity') return /^(sonar|pplx-)/i.test(id);
  if (provider === 'kimi') return /^kimi-/i.test(id);
  if (provider === 'deepseek') return /^deepseek-/i.test(id);
  return /^gemini-/i.test(id);
};

type StoredState = {
  selected: MobileAISelection;
  cloudConsent: boolean;
  providers: Partial<Record<MobileAIProvider, { apiKey: string; model: string; keySuffix: string }>>;
};

const emptyState = (): StoredState => ({ selected: null, cloudConsent: false, providers: {} });

async function readState(): Promise<StoredState> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const selected: MobileAISelection = (parsed.selected as string | undefined) === 'local'
      ? null
      : MOBILE_AI_PROVIDERS.some((item) => item.id === parsed.selected)
      ? parsed.selected as MobileAISelection
      : null;
    return {
      selected,
      cloudConsent: parsed.cloudConsent === true,
      providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
    };
  } catch {
    return emptyState();
  }
}

async function writeState(state: StoredState) {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(state));
}

async function fetchProvider(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (externalSignal?.aborted) controller.abort();
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('The provider connection timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function providerError(response: Response, provider: MobileAIProvider, model?: string) {
  let detail = '';
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown } | string; message?: unknown };
    detail = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.error?.message === 'string'
      ? payload.error.message
      : typeof payload.message === 'string'
      ? payload.message
      : '';
  } catch {
    // Some providers return an empty or non-JSON error body.
  }
  const safeDetail = detail.replace(/[\r\n]+/g, ' ').slice(0, 240);
  return `The ${provider} provider returned HTTP ${response.status}${model ? ` for ${model}` : ''}${safeDetail ? `: ${safeDetail}` : '.'}`;
}

export async function getMobileAISettings() {
  const state = await readState();
  return {
    selected: state.selected,
    cloudConsent: state.cloudConsent,
    providers: MOBILE_AI_PROVIDERS.map(({ id }) => ({
      provider: id,
      connected: Boolean(state.providers[id]?.apiKey),
      keySuffix: state.providers[id]?.keySuffix ?? null,
      model: state.providers[id]?.model || defaultModelFor(id),
    })),
  } satisfies { selected: MobileAISelection; cloudConsent: boolean; providers: MobileAIProviderState[] };
}

export async function setMobileAICloudConsent(enabled: boolean) {
  const state = await readState();
  state.cloudConsent = enabled;
  if (!enabled) state.selected = null;
  await writeState(state);
  return getMobileAISettings();
}

export async function selectMobileAIProvider(provider: MobileAIProvider) {
  const state = await readState();
  if (!state.cloudConsent) {
    throw new Error('Enable cloud AI consent before selecting a provider.');
  }
  if (!state.providers[provider]?.apiKey) {
    throw new Error(`Connect ${provider} before selecting it.`);
  }
  state.selected = provider;
  await writeState(state);
  return getMobileAISettings();
}

export async function setMobileAIKey(provider: MobileAIProvider, apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 12 || normalized.length > 512) throw new Error('Enter a valid API key.');
  const state = await readState();
  state.providers[provider] = {
    apiKey: normalized,
    model: state.providers[provider]?.model || defaultModelFor(provider),
    keySuffix: normalized.slice(-4),
  };
  await writeState(state);
  return getMobileAISettings();
}

export async function removeMobileAIKey(provider: MobileAIProvider) {
  const state = await readState();
  delete state.providers[provider];
  if (state.selected === provider) state.selected = null;
  await writeState(state);
  return getMobileAISettings();
}

function providerModelsEndpoint(provider: MobileAIProvider) {
  return provider === 'openai'
    ? 'https://api.openai.com/v1/models'
    : provider === 'anthropic'
    ? 'https://api.anthropic.com/v1/models'
    : provider === 'google'
    ? 'https://generativelanguage.googleapis.com/v1beta/models'
    : provider === 'perplexity'
    ? 'https://api.perplexity.ai/v1/models'
    : provider === 'kimi'
    ? 'https://api.moonshot.ai/v1/models'
    : 'https://api.deepseek.com/models';
}

function providerHeaders(provider: MobileAIProvider, apiKey: string): Record<string, string> {
  return provider === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : provider === 'google'
    ? { 'x-goog-api-key': apiKey }
    : { Authorization: `Bearer ${apiKey}` };
}

export async function listMobileAIModels(provider: MobileAIProvider) {
  const state = await readState();
  const apiKey = state.providers[provider]?.apiKey;
  if (!apiKey) throw new Error(`No ${provider} API key is connected.`);
  const response = await fetchProvider(providerModelsEndpoint(provider), { headers: providerHeaders(provider, apiKey) }, 15_000);
  if (!response.ok) throw new Error(await providerError(response, provider));
  const payload = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown[] }> };
  const models = provider === 'google'
    ? (payload.models ?? [])
      .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))
      .map((item) => typeof item.name === 'string' ? item.name.replace(/^models\//, '') : '')
    : (payload.data ?? []).map((item) => typeof item.id === 'string' ? item.id : '');
  const uniqueModels = [...new Set(models.filter((id): id is string => Boolean(id) && isSupportedGenerationModel(provider, id)))];
  const lowCostFirst = (id: string) => /(?:nano|mini|flash|haiku|small|lite)/i.test(id) ? 0 : 1;
  uniqueModels.sort((left, right) => lowCostFirst(left) - lowCostFirst(right) || left.localeCompare(right));
  return uniqueModels;
}

export async function setMobileAIModel(provider: MobileAIProvider, model: string) {
  const normalized = model.replace(/^models\//, '').trim();
  if (!normalized || !isSupportedGenerationModel(provider, normalized)) throw new Error(`Choose a supported text model for ${provider}.`);
  const state = await readState();
  const entry = state.providers[provider];
  if (!entry) throw new Error(`No ${provider} API key is connected.`);
  state.providers[provider] = { ...entry, model: normalized };
  await writeState(state);
  return getMobileAISettings();
}

export async function testMobileAIProvider(provider: MobileAIProvider) {
  const state = await readState();
  const apiKey = state.providers[provider]?.apiKey;
  if (!apiKey) return { ok: false, error: `No ${provider} API key is connected.` };

  const endpoint = providerModelsEndpoint(provider);
  const headers = providerHeaders(provider, apiKey);

  try {
    const response = await fetchProvider(endpoint, { headers }, 15_000);
    if (!response.ok) {
      return { ok: false, error: response.status === 401 || response.status === 403 ? 'The API key was rejected by the provider.' : await providerError(response, provider) };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the provider.' };
  }
}

export async function generateMobileAIResponse(
  question: string,
  context: string,
  options: { signal?: AbortSignal; onDelta?: (text: string) => void } = {},
) {
  const state = await readState();
  if (!state.selected) throw new Error('Connect a BYOP provider in Settings before asking Ledger.');
  if (!state.cloudConsent) throw new Error('Enable cloud AI consent in Settings before asking Ledger.');
  const provider = state.selected;
  const entry = state.providers[provider];
  if (!entry?.apiKey) throw new Error(`Connect ${provider} in Settings before asking Ledger.`);
  const model = entry.model || defaultModelFor(provider);
  const prompt = `You are Ask Ledger, a calm accountability assistant. Answer only from the Ledger context below. If the context does not support an answer, say so clearly. Do not invent tasks, dates, projects, or events. This is a read-only conversation; do not claim to have changed Ledger data.\n\nLedger context:\n${context}\n\nUser question:\n${question.trim()}`;
  const endpoint = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : provider === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : provider === 'google'
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    : provider === 'perplexity'
    ? 'https://api.perplexity.ai/chat/completions'
    : provider === 'kimi'
    ? 'https://api.moonshot.ai/v1/chat/completions'
    : 'https://api.deepseek.com/chat/completions';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider === 'google') headers['x-goog-api-key'] = entry.apiKey;
  else if (provider === 'anthropic') {
    headers['x-api-key'] = entry.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.Authorization = `Bearer ${entry.apiKey}`;
  const body = provider === 'google'
    ? { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 512 } }
    : provider === 'anthropic'
    ? { model, max_tokens: 512, messages: [{ role: 'user', content: prompt }] }
    : { model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 512 };
  const response = await fetchProvider(endpoint, { method: 'POST', headers, body: JSON.stringify(body) }, 120_000, options.signal);
  if (!response.ok) throw new Error(await providerError(response, provider, model));
  let answer = '';
  const readPayloadAnswer = (payload: any) => provider === 'google'
    ? payload.candidates?.[0]?.content?.parts?.map((part: { text?: unknown }) => typeof part.text === 'string' ? part.text : '').join('')
    : provider === 'anthropic'
    ? payload.content?.map((part: { text?: unknown }) => typeof part.text === 'string' ? part.text : '').join('')
    : payload.choices?.[0]?.message?.content;

  if (provider !== 'google' && response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const value = line.slice(5).trim();
      if (!value || value === '[DONE]') return;
      try {
        const payload = JSON.parse(value) as any;
        const text = provider === 'anthropic'
          ? payload.delta?.text
          : payload.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) {
          answer += text;
          options.onDelta?.(text);
        }
      } catch {
        // Ignore keepalive or incomplete frames.
      }
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
  } else {
    const payload = await response.json() as any;
    answer = readPayloadAnswer(payload);
    if (answer) options.onDelta?.(answer);
  }
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('The provider returned an empty answer.');
  return answer.trim();
}
