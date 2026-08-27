import { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ModalCloseButton } from './ModalCloseButton';
import { ModalOverlay } from './ModalOverlay';

interface CreateModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  busyLabel?: string;
  closeLabel: string;
  children: ReactNode;
  contentClassName?: string;
  classNameContainer?: string;
}

export const CreateModalShell = ({
  isOpen,
  onClose,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryBusy = false,
  busyLabel = 'Saving...',
  closeLabel,
  children,
  contentClassName = 'space-y-4 px-5 py-5',
  classNameContainer = 'w-full max-w-[620px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]',
}: CreateModalShellProps) => (
  <ModalOverlay
    isOpen={isOpen}
    onClose={onClose}
    backdropBorderRadius="inherit"
    disablePortal
    manageWindowChrome={false}
    classNameContainer={classNameContainer}
  >
    <div className="flex max-h-[calc(100vh-2rem)] flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">{title}</p>
          <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">{subtitle}</p>
        </div>
        <ModalCloseButton
          onClick={onClose}
          ariaLabel={closeLabel}
          className="shrink-0"
          disabled={primaryBusy}
        />
      </div>
      <div className={`min-h-0 overflow-y-auto ${contentClassName}`}>{children}</div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={primaryBusy}
          className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled || primaryBusy}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
        >
          {primaryBusy ? busyLabel : primaryLabel}
        </button>
      </div>
    </div>
  </ModalOverlay>
);

export const CreateFieldRow = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>{children}</div>;

export const CreateSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-3 border-t border-[color:var(--ledger-border-subtle)] pt-4">
    <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">{title}</p>
    {children}
  </section>
);

export const CreateMoreOptions = ({
  expanded,
  onToggle,
  label,
  accessibleLabel,
  contentId,
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
  accessibleLabel?: string;
  contentId?: string;
}) => {
  const panelId = `create-more-options-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="border-t border-[color:var(--ledger-border-subtle)] pt-3">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId ?? panelId}
        aria-label={expanded ? `Hide ${accessibleLabel ?? label}` : accessibleLabel ?? `Show ${label}`}
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
      >
        {expanded ? `Hide ${label.toLowerCase()}` : label}
        {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
    </div>
  );
};
