import { ReactNode } from 'react';

export interface CreateSmartFieldProps {
  icon?: ReactNode;
  label: string;
  value?: string;
  emptyLabel?: string;
  onActivate: () => void;
  active?: boolean;
  disabled?: boolean;
  error?: boolean;
}

export const CreateSmartField = ({
  icon,
  label,
  value,
  emptyLabel = `Add ${label.toLowerCase()}`,
  onActivate,
  active = false,
  disabled = false,
  error = false,
}: CreateSmartFieldProps) => (
  <button
    type="button"
    onClick={onActivate}
    disabled={disabled}
    aria-label={`${label}, ${value || emptyLabel}`}
    aria-pressed={active}
    className={`mr-2 inline-flex min-h-9 items-center gap-2 rounded-[var(--ledger-control-radius)] border px-3 text-left text-xs transition focus:outline-none focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60 ${
      error
        ? 'border-red-500/70 text-red-600'
        : active
        ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
        : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
    } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
  >
    {icon ? <span className="shrink-0 text-[var(--ledger-text-muted)]">{icon}</span> : null}
    <span className={value ? 'font-medium' : 'text-[var(--ledger-text-muted)]'}>{value || `+ ${emptyLabel}`}</span>
  </button>
);
