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
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-(--ledger-border-subtle) bg-(--ledger-surface) text-(--ledger-text-secondary) shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-(--ledger-surface-hover) hover:text-(--ledger-text-primary) focus:outline-none focus:ring-2 focus:ring-(--ledger-accent)/20 disabled:cursor-not-allowed disabled:border-(--ledger-border-subtle) disabled:bg-(--ledger-surface-muted) disabled:text-(--ledger-text-muted) disabled:hover:border-(--ledger-border-subtle) disabled:hover:bg-(--ledger-surface-muted) disabled:hover:text-(--ledger-text-muted) ${className}`}
    >
      <X size={16} />
    </button>
  );
};
