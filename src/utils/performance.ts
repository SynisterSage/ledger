export type LedgerPerformanceDetails = Record<string, string | number | boolean | null>;

type PerformanceToken = {
  id: number;
  startedAt: number;
};

let nextPerformanceToken = 0;

const safePerformanceName = (name: string) => name.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 100);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const beginLedgerPerformance = (name: string): PerformanceToken => {
  const token = { id: nextPerformanceToken++, startedAt: now() };

  if (typeof performance !== 'undefined') {
    try {
      performance.mark(`ledger:start:${safePerformanceName(name)}:${token.id}`);
    } catch {
      // Performance marks are diagnostic only and must never affect the request.
    }
  }

  return token;
};

export const endLedgerPerformance = (
  token: PerformanceToken,
  name: string,
  details?: LedgerPerformanceDetails
) => {
  const durationMs = Math.max(0, now() - token.startedAt);

  if (typeof performance !== 'undefined') {
    try {
      const safeName = safePerformanceName(name);
      const startMark = `ledger:start:${safeName}:${token.id}`;
      const endMark = `ledger:end:${safeName}:${token.id}`;
      performance.mark(endMark);
      performance.measure(`ledger:${safeName}:${token.id}`, startMark, endMark);
    } catch {
      // Performance marks are diagnostic only and must never affect the request.
    }
  }

  if (typeof window !== 'undefined') {
    window.desktopWindow?.reportPerformance?.({ name, durationMs, details });
  }

  return durationMs;
};
