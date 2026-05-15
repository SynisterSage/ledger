import { useEffect } from 'react';

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
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-gray-900/20 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900">{resolvedTitle}</h3>
        <p className="mt-2 text-sm text-gray-600">{resolvedMessage}</p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Keep open
          </button>
          {!isSaving && hasUnsavedChanges && onCloseWithoutSaving && (
            <button
              type="button"
              onClick={onCloseWithoutSaving}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close without saving
            </button>
          )}
          {!isSaving && hasUnsavedChanges && onRetrySaveAndClose && (
            <button
              type="button"
              onClick={onRetrySaveAndClose}
              className="rounded-lg bg-[#FF5F40] px-3 py-2 text-sm font-medium text-white hover:bg-[#E54E30]"
            >
              Retry save & close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
