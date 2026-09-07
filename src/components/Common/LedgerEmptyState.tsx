import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LedgerEmptyStateKind } from './ledgerEmptyStateContract';

export { isLedgerEmptyStateKind } from './ledgerEmptyStateContract';
export type { LedgerEmptyStateKind } from './ledgerEmptyStateContract';
export type LedgerEmptyStateSize = 'compact' | 'default';

export type LedgerEmptyStateAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type LedgerEmptyStateProps = {
  state: LedgerEmptyStateKind;
  title: string;
  description: string;
  icon?: LucideIcon;
  primaryAction?: LedgerEmptyStateAction;
  secondaryAction?: LedgerEmptyStateAction;
  size?: LedgerEmptyStateSize;
  testId: string;
  className?: string;
  children?: ReactNode;
};

const kindRole = (state: LedgerEmptyStateKind): 'status' | 'alert' =>
  state === 'error' || state === 'offline' ? 'alert' : 'status';

export const LedgerEmptyState = ({
  state,
  title,
  description,
  icon: Icon,
  primaryAction,
  secondaryAction,
  size = 'default',
  testId,
  className = '',
  children,
}: LedgerEmptyStateProps) => {
  const compact = size === 'compact';
  const hasActions = Boolean(primaryAction || secondaryAction);

  return (
    <section
      data-testid={testId}
      data-empty-state={state}
      aria-labelledby={`${testId}-title`}
      role={kindRole(state)}
      className={`flex w-full items-center justify-center ${compact ? 'px-3 py-5' : 'px-5 py-10'} ${className}`}
    >
      <div className={`${compact ? 'max-w-xs' : 'max-w-sm'} text-center`}>
        {Icon ? (
          <span
            aria-hidden="true"
            className={`mx-auto flex items-center justify-center rounded-lg border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-muted)] ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}
          >
            <Icon size={compact ? 15 : 18} strokeWidth={1.8} />
          </span>
        ) : null}
        <h2
          id={`${testId}-title`}
          className={`${Icon ? 'mt-3' : ''} ${compact ? 'text-xs' : 'text-sm'} font-medium text-[var(--ledger-text-primary)]`}
        >
          {title}
        </h2>
        <p className={`${compact ? 'mt-1 text-[11px]' : 'mt-1.5 text-xs'} leading-5 text-[var(--ledger-text-muted)]`}>
          {description}
        </p>
        {hasActions ? (
          <div className="mx-auto mt-3 flex w-fit max-w-full flex-wrap items-center justify-center gap-2">
            {primaryAction ? (
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                className="mx-auto inline-flex h-8 items-center justify-center rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ledger-accent)]/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {primaryAction.label}
              </button>
            ) : null}
            {secondaryAction ? (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                disabled={secondaryAction.disabled}
                className="mx-auto inline-flex h-8 items-center justify-center rounded-md px-2.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ledger-accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {secondaryAction.label}
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
};
