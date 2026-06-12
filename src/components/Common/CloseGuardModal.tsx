import { useEffect } from 'react';
import { ModalCloseButton } from './ModalCloseButton';
import { ModalOverlay } from './ModalOverlay';

type CloseGuardModalProps = {
  isOpen: boolean;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
  title?: string;
  message?: string;
  onCancel: () => void;
  onRetrySaveAndClose?: () => void;
  onCloseWithoutSaving?: () => void;
};

export const CloseGuardModal = ({
  isOpen,
  isSaving = false,
  hasUnsavedChanges = false,
  title,
  message,
  onCancel,
  onRetrySaveAndClose,
  onCloseWithoutSaving,
}: CloseGuardModalProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const resolvedTitle = title ?? (isSaving ? 'Saving in progress' : 'Unsaved changes');
  const resolvedMessage =
    message ??
    (isSaving
      ? 'Ledger is still saving your changes. Please wait before closing this window.'
      : 'Your latest changes have not been saved yet.');

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onCancel}
      classNameContainer="w-full max-w-lg overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] p-5 shadow-[0_24px_70px_rgba(17,24,39,0.12)]"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold text-[var(--ledger-text-primary)]">{resolvedTitle}</h3>
        <ModalCloseButton onClick={onCancel} ariaLabel="Close dialog" />
      </div>
      <p className="mt-2 text-sm text-[var(--ledger-text-secondary)]">{resolvedMessage}</p>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 whitespace-nowrap rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3.5 py-2 text-sm font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]"
        >
          Keep open
        </button>
        {!isSaving && hasUnsavedChanges && onCloseWithoutSaving && (
          <button
            type="button"
            onClick={onCloseWithoutSaving}
            className="shrink-0 whitespace-nowrap rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3.5 py-2 text-sm font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]"
          >
            Close without saving
          </button>
        )}
        {!isSaving && hasUnsavedChanges && onRetrySaveAndClose && (
          <button
            type="button"
            onClick={onRetrySaveAndClose}
            className="shrink-0 whitespace-nowrap rounded-full bg-[var(--ledger-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--ledger-accent-hover)]"
          >
            Retry save & close
          </button>
        )}
      </div>
    </ModalOverlay>
  );
};
