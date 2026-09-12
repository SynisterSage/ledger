import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'perplexity';

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
const defaultModelFor = (provider: AIProvider) => provider === 'openai' ? 'gpt-5-mini' : provider === 'anthropic' ? 'claude-3-5-haiku-latest' : provider === 'google' ? 'gemini-2.5-flash' : 'sonar-pro';

const isProvider = (value: unknown): value is AIProvider => value === 'openai' || value === 'anthropic';

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
    return (['openai', 'anthropic', 'google', 'perplexity'] as const).map((provider) => ({
      provider,
      connected: Boolean(stored[provider]),
      keySuffix: stored[provider]?.keySuffix ?? null,
      updatedAt: stored[provider]?.updatedAt ?? null,
    }));
  }

  selectedProvider(): 'local' | AIProvider {
    const selected = this.read().selectedProvider;
    return selected === 'openai' || selected === 'anthropic' ? selected : 'local';
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
    return value && typeof value.model === 'string'
      ? value.model
      : defaultModelFor(provider);
  }

  setSelectedModel(provider: AIProvider, model: string) {
    if (!isProvider(provider) || !model.trim() || model.length > 200) throw new Error('Invalid AI model.');
    const stored = this.read();
    const entry = stored[provider];
    if (!entry) throw new Error(`No ${provider} API key is connected.`);
    stored[provider] = { ...entry, model: model.trim() };
    this.write(stored);
    return model.trim();
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
