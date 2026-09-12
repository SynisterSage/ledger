import type { AIProvider, AIProviderKeyStore } from './aiProviderKeyStore';

export type AIProviderConnectionTest = {
  ok: boolean;
  provider: AIProvider;
  modelCount?: number;
  error?: string;
};
export type AIProviderModels = { ok: boolean; provider: AIProvider; models: string[]; error?: string };

const endpointFor = (provider: AIProvider) => provider === 'openai'
  ? 'https://api.openai.com/v1/models'
  : provider === 'anthropic' ? 'https://api.anthropic.com/v1/models' : provider === 'google' ? 'https://generativelanguage.googleapis.com/v1beta/models' : 'https://api.perplexity.ai/v1/models';

const isTextGenerationModel = (id: string) => !/(embedding|moderation|whisper|tts|dall-e|image|audio|search|rerank)/i.test(id);

/** Validates a stored credential without sending Ledger content. */
export class AIProviderService {
  constructor(private readonly keys: AIProviderKeyStore, private readonly fetcher: typeof fetch = fetch) {}

  async testConnection(provider: AIProvider): Promise<AIProviderConnectionTest> {
    const key = this.keys.get(provider);
    if (!key) return { ok: false, provider, error: `No ${provider} API key is connected.` };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers: Record<string, string> = provider === 'openai' || provider === 'perplexity' ? { Authorization: `Bearer ${key}` } : provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { 'x-goog-api-key': key };
      const response = await this.fetcher(endpointFor(provider), { method: 'GET', headers, signal: controller.signal });
      if (!response.ok) {
        const status = response.status;
        return { ok: false, provider, error: status === 401 || status === 403 ? 'The API key was rejected by the provider.' : `The provider returned HTTP ${status}.` };
      }
      const payload = await response.json() as { data?: unknown[]; models?: unknown[] };
      const models = Array.isArray(payload.data) ? payload.data : payload.models;
      return { ok: true, provider, modelCount: Array.isArray(models) ? models.length : undefined };
    } catch (error) {
      return { ok: false, provider, error: error instanceof DOMException && error.name === 'AbortError' ? 'The provider connection timed out.' : 'Could not reach the provider.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(provider: AIProvider): Promise<AIProviderModels> {
    const key = this.keys.get(provider);
    if (!key) return { ok: false, provider, models: [], error: `No ${provider} API key is connected.` };
    try {
      const headers: Record<string, string> = provider === 'openai' || provider === 'perplexity' ? { Authorization: `Bearer ${key}` } : provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { 'x-goog-api-key': key };
      const response = await this.fetcher(endpointFor(provider), { headers });
      if (!response.ok) return { ok: false, provider, models: [], error: `The provider returned HTTP ${response.status}.` };
      const payload = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown[] }> };
      const models = provider === 'google'
        ? (payload.models ?? []).filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent')).map((item) => typeof item.name === 'string' ? item.name.replace(/^models\//, '') : '').filter(Boolean)
        : (payload.data ?? []).map((item) => typeof item.id === 'string' ? item.id : '').filter((id): id is string => Boolean(id) && isTextGenerationModel(id));
      return { ok: true, provider, models };
    } catch { return { ok: false, provider, models: [], error: 'Could not load models from the provider.' }; }
  }
}
