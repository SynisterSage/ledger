import { X } from 'lucide-react';

type ModalCloseButtonProps = {
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

export const ModalCloseButton = ({
  onClick,
  ariaLabel = 'Close modal',
  className = '',
  disabled = false,
}: ModalCloseButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--ledger-accent)]/20 disabled:cursor-not-allowed disabled:border-[color:var(--ledger-border-subtle)] disabled:bg-[var(--ledger-surface-muted)] disabled:text-[var(--ledger-text-muted)] disabled:hover:border-[color:var(--ledger-border-subtle)] disabled:hover:bg-[var(--ledger-surface-muted)] disabled:hover:text-[var(--ledger-text-muted)] ${className}`}
    >
      <X size={16} />
    </button>
  );
};
