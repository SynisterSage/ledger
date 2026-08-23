export type LensCacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type LensCacheEntry<T> = {
  fingerprint: string;
  result: T;
  cachedAt: number;
};

type SerializedLensCacheEntry<T> = LensCacheEntry<T> | {
  fingerprint: string;
  result: T;
};

export type LensCacheOptions = {
  storageKey: string;
  maxEntries?: number;
  maxAgeMs?: number;
  storage?: LensCacheStorage | null;
  now?: () => number;
};

const defaultStorage = (): LensCacheStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export class LensCache<T> {
  private readonly entries = new Map<string, LensCacheEntry<T>>();
  private readonly storageKey: string;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private readonly storage: LensCacheStorage | null;
  private readonly now: () => number;

  constructor(options: LensCacheOptions) {
    this.storageKey = options.storageKey;
    this.maxEntries = options.maxEntries ?? 32;
    this.maxAgeMs = options.maxAgeMs ?? 30 * 60 * 1000;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.hydrate();
  }

  private hydrate() {
    if (!this.storage) return;
    try {
      const stored = this.storage.getItem(this.storageKey);
      const parsed = stored ? JSON.parse(stored) as unknown : null;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[1] || typeof item[1] !== 'object') continue;
        const entry = item[1] as SerializedLensCacheEntry<T>;
        if (typeof entry.fingerprint !== 'string' || !('result' in entry)) continue;
        const cachedAt = 'cachedAt' in entry && typeof entry.cachedAt === 'number' ? entry.cachedAt : this.now();
        if (this.now() - cachedAt > this.maxAgeMs) continue;
        this.entries.set(item[0], { fingerprint: entry.fingerprint, result: entry.result, cachedAt });
      }
      this.trim(false);
    } catch {
      // Cache data is an optimization. Malformed or unavailable storage is safe to ignore.
    }
  }

  private persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(Array.from(this.entries.entries())));
    } catch {
      // Keep the in-memory cache usable if storage is unavailable or full.
    }
  }

  private trim(persist = true) {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.cachedAt > this.maxAgeMs) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    if (persist) this.persist();
  }

  get(key: string, fingerprint: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.cachedAt > this.maxAgeMs || entry.fingerprint !== fingerprint) {
      if (this.now() - entry.cachedAt > this.maxAgeMs) {
        this.entries.delete(key);
        this.persist();
      }
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(key: string, fingerprint: string, result: T) {
    this.entries.delete(key);
    this.entries.set(key, { fingerprint, result, cachedAt: this.now() });
    this.trim();
  }

  invalidate(key: string) {
    this.entries.delete(key);
    this.persist();
  }

  clear() {
    this.entries.clear();
    this.persist();
  }

  get size() {
    return this.entries.size;
  }
}
