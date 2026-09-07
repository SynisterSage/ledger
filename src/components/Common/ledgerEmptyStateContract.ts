export const LEDGER_EMPTY_STATE_KINDS = [
  'first-use',
  'no-results',
  'completed',
  'permission',
  'error',
  'offline',
] as const;

export type LedgerEmptyStateKind = (typeof LEDGER_EMPTY_STATE_KINDS)[number];

export const isLedgerEmptyStateKind = (value: string): value is LedgerEmptyStateKind =>
  (LEDGER_EMPTY_STATE_KINDS as readonly string[]).includes(value);
