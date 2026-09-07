export type MobilePerformanceEvent = {
  name: string;
  durationMs: number;
  at: number;
  metadata?: Record<string, string | number | boolean | null>;
};

const MAX_EVENTS = 200;
const events: MobilePerformanceEvent[] = [];

export function sanitizeMobilePerformancePath(path: string) {
  return path
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function diagnosticsEnabled() {
  const runtime = globalThis as typeof globalThis & { __DEV__?: boolean };
  return runtime.__DEV__ === true || (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_MOBILE_PERF === '1');
}

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function recordMobilePerformance(name: string, durationMs: number, metadata?: MobilePerformanceEvent['metadata']) {
  if (!diagnosticsEnabled()) return;
  const event = { name, durationMs: Math.round(durationMs), at: Date.now(), metadata };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug(`[Ledger mobile perf] ${name}`, event);
  }
}

export function startMobilePerformance(name: string, metadata?: MobilePerformanceEvent['metadata']) {
  const startedAt = now();
  return (resultMetadata?: MobilePerformanceEvent['metadata']) => {
    recordMobilePerformance(name, now() - startedAt, { ...metadata, ...resultMetadata });
  };
}

export function getMobilePerformanceEvents() {
  return events.slice();
}

export function clearMobilePerformanceEvents() {
  events.length = 0;
}
