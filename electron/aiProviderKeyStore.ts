import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'perplexity' | 'kimi' | 'deepseek';

export type AIProviderConnection = {
  provider: AIProvider;
  connected: boolean;
  keySuffix: string | null;
  updatedAt: string | null;
};

type StoredProviderKey = {
  encrypted: string;
  keySuffix: string;
  updatedAt: string;
  model?: string;
};

type StoredKeysFile = Partial<Record<AIProvider, StoredProviderKey>> & { selectedProvider?: 'local' | AIProvider; cloudDataConsent?: boolean };
const defaultModelFor = (provider: AIProvider) => provider === 'openai' ? 'gpt-5-mini' : provider === 'anthropic' ? 'claude-3-5-haiku-latest' : provider === 'google' ? 'gemini-3.5-flash-lite' : provider === 'perplexity' ? 'sonar-pro' : provider === 'kimi' ? 'kimi-k2.6' : 'deepseek-v4-flash';

const normalizeSelectedModel = (provider: AIProvider, model: string) => {
  const normalized = model.replace(/^models\//, '').trim();
  // Google retired this model for new users. Keep existing installations from
  // repeatedly sending requests to an endpoint that now returns HTTP 404.
  if (provider === 'google' && normalized.toLowerCase() === 'gemini-2.5-flash-lite') return 'gemini-3.5-flash-lite';
  return normalized;
};

const hasSupportedModelName = (provider: AIProvider, model: string) => {
  const normalized = model.replace(/^models\//, '').trim();
  if (provider === 'openai' && (/(?:^|[-.])(?:preview|instruct|turbo|davinci|babbage|ada|curie)(?:$|[-.])/i.test(normalized) || /^gpt-(?:3\.5|4(?:$|-turbo))/i.test(normalized) || /(?:realtime|transcrib|tts|audio|image|search|computer-use)/i.test(normalized))) return false;
  if (provider === 'google') return /^gemini-/i.test(normalized);
  if (provider === 'openai') return /^(gpt-|o[1-9]-|chatgpt-)/i.test(normalized) && !/(image|audio|realtime|transcrib|tts)/i.test(normalized);
  if (provider === 'anthropic') return /^claude-/i.test(normalized);
  if (provider === 'perplexity') return /^(sonar|pplx-)/i.test(normalized);
  if (provider === 'kimi') return /^kimi-/i.test(normalized);
  return /^deepseek-/i.test(normalized);
};

const isProvider = (value: unknown): value is AIProvider => value === 'openai' || value === 'anthropic' || value === 'google' || value === 'perplexity' || value === 'kimi' || value === 'deepseek';

/**
 * Stores BYOK credentials in the operating system-backed Electron safeStorage
 * envelope. The renderer only receives connection metadata, never the secret.
 */
export class AIProviderKeyStore {
  private readonly filePath: string;

  constructor(userDataRoot: string, private readonly crypto = safeStorage) {
    this.filePath = path.join(userDataRoot, 'ai-provider-keys.json');
  }

  list(): AIProviderConnection[] {
    const stored = this.read();
    return (['openai', 'anthropic', 'google', 'perplexity', 'kimi', 'deepseek'] as const).map((provider) => ({
      provider,
      connected: Boolean(stored[provider]),
      keySuffix: stored[provider]?.keySuffix ?? null,
      updatedAt: stored[provider]?.updatedAt ?? null,
    }));
  }

  selectedProvider(): 'local' | AIProvider {
    const selected = this.read().selectedProvider;
    return isProvider(selected) ? selected : 'local';
  }

  setSelectedProvider(provider: 'local' | AIProvider) {
    if (provider !== 'local' && !isProvider(provider)) throw new Error('Unsupported AI provider.');
    if (provider !== 'local' && !this.cloudDataConsent()) throw new Error('Enable cloud AI consent before selecting a cloud provider.');
    const stored = this.read();
    stored.selectedProvider = provider;
    this.write(stored);
    return provider;
  }

  cloudDataConsent(): boolean { return this.read().cloudDataConsent === true; }

  setCloudDataConsent(enabled: boolean) {
    const stored = this.read();
    stored.cloudDataConsent = enabled === true;
    if (!stored.cloudDataConsent && stored.selectedProvider !== 'local') stored.selectedProvider = 'local';
    this.write(stored);
    return stored.cloudDataConsent;
  }

  selectedModel(provider: AIProvider): string {
    const value = this.read()[provider];
    const model = value && typeof value.model === 'string' ? value.model : undefined;
    const normalized = model ? normalizeSelectedModel(provider, model) : '';
    return normalized && hasSupportedModelName(provider, normalized) ? normalized : defaultModelFor(provider);
  }

  setSelectedModel(provider: AIProvider, model: string) {
    if (!isProvider(provider) || !model.trim() || model.length > 200) throw new Error('Invalid AI model.');
    if (!hasSupportedModelName(provider, model)) throw new Error(`Choose a supported text model for ${provider}.`);
    const stored = this.read();
    const entry = stored[provider];
    if (!entry) throw new Error(`No ${provider} API key is connected.`);
    const normalized = normalizeSelectedModel(provider, model);
    stored[provider] = { ...entry, model: normalized };
    this.write(stored);
    return normalized;
  }

  async set(provider: AIProvider, apiKey: string): Promise<AIProviderConnection> {
    if (!isProvider(provider)) throw new Error('Unsupported AI provider.');
    const normalized = apiKey.trim();
    if (normalized.length < 12 || normalized.length > 512) throw new Error('Enter a valid API key.');
    if (!this.crypto.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
    const stored = this.read();
    const updatedAt = new Date().toISOString();
    stored[provider] = {
      encrypted: this.crypto.encryptString(normalized).toString('base64'),
      keySuffix: normalized.slice(-4),
      updatedAt,
    };
    this.write(stored);
    return { provider, connected: true, keySuffix: normalized.slice(-4), updatedAt };
  }

  remove(provider: AIProvider): AIProviderConnection {
    if (!isProvider(provider)) throw new Error('Unsupported AI provider.');
    const stored = this.read();
    delete stored[provider];
    this.write(stored);
    return { provider, connected: false, keySuffix: null, updatedAt: null };
  }

  /** Main-process use only. Never expose this through preload. */
  get(provider: AIProvider): string | null {
    const entry = this.read()[provider];
    if (!entry) return null;
    if (!this.crypto.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
    return this.crypto.decryptString(Buffer.from(entry.encrypted, 'base64'));
  }

  private read(): StoredKeysFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Partial<Record<AIProvider, StoredProviderKey>>;
    } catch {
      return {};
    }
  }

  private write(value: StoredKeysFile) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }
}
