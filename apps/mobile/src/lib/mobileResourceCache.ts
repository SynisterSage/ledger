import { recordMobilePerformance } from './mobilePerformance';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const entries = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 30_000;

export function readMobileResource<T>(key: string): T | null {
  const entry = entries.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry.value;
}

export function invalidateMobileResource(key: string) {
  entries.delete(key);
}

export function writeMobileResource<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS) {
  entries.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateMobileResourcePrefix(prefix: string) {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

export function getMobileResource<T>(
  key: string,
  loader: () => Promise<T>,
  options: { force?: boolean; ttlMs?: number } = {},
): Promise<T> {
  const existing = entries.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();
  if (!options.force && existing && existing.expiresAt > now) {
    recordMobilePerformance('cache.hit', 0, { resource: key.split(':', 2).join(':') });
    return Promise.resolve(existing.value);
  }

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = loader().then((value) => {
    recordMobilePerformance('cache.miss', 0, { resource: key.split(':', 2).join(':') });
    entries.set(key, { value, expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS) });
    return value;
  }).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, request);
  return request;
}
