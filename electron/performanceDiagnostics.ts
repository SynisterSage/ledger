import type { BrowserWindow } from 'electron';

export type LedgerPerformanceEvent = {
  name: string;
  at: string;
  durationMs?: number;
  windowRole?: string;
  windowId?: number;
  processId?: number;
  details?: Record<string, string | number | boolean | null>;
};

const enabledValue = String(process.env.LEDGER_PERF_DIAGNOSTICS ?? '').toLowerCase();
export const performanceDiagnosticsEnabled = enabledValue === '1' || enabledValue === 'true';

const SLOW_IPC_THRESHOLD_MS = 50;
const MAX_RECENT_EVENTS = 200;
const recentEvents: LedgerPerformanceEvent[] = [];

export const isSlowIpcDuration = (durationMs: number) => durationMs >= SLOW_IPC_THRESHOLD_MS;

export const recordPerformanceEvent = (
  event: Omit<LedgerPerformanceEvent, 'at'>
): LedgerPerformanceEvent | null => {
  if (!performanceDiagnosticsEnabled) return null;
  const recorded: LedgerPerformanceEvent = { ...event, at: new Date().toISOString() };
  recentEvents.push(recorded);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }
  console.info('[ledger-perf]', JSON.stringify(recorded));
  return recorded;
};

export const recordIpcDuration = (
  channel: string,
  durationMs: number,
  window?: BrowserWindow | null,
  details?: Record<string, string | number | boolean | null>
) => {
  if (!performanceDiagnosticsEnabled || !isSlowIpcDuration(durationMs)) return;
  recordPerformanceEvent({
    name: 'ipc.slow',
    durationMs: Math.round(durationMs * 100) / 100,
    windowId: window && !window.isDestroyed() ? window.id : undefined,
    processId: window && !window.isDestroyed() ? window.webContents.getProcessId() : undefined,
    details: { channel, ...details },
  });
};

export const recentPerformanceEvents = () => [...recentEvents];
