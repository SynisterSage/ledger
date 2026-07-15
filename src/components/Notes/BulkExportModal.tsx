import { useState, useCallback, useEffect, useMemo } from 'react';
import { Download, Loader2, Check } from 'lucide-react';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';

interface BulkExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: 'pdf' | 'png' | 'html' | 'txt', selectedIds: Set<string>) => Promise<void>;
  notes: Array<{ id: string; title: string; mode?: 'text' | 'mind_map' }>;
  isMindMapOnly?: boolean;
}

export const BulkExportModal = ({
  isOpen,
  onClose,
  onExport,
  notes,
  isMindMapOnly = false,
}: BulkExportModalProps) => {
  const relevantNotes = useMemo(
    () => (isMindMapOnly ? notes.filter((n) => n.mode === 'mind_map') : notes),
    [isMindMapOnly, notes]
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(relevantNotes.map((n) => n.id))
  );
  const [format, setFormat] = useState<'pdf' | 'png' | 'html' | 'txt'>(
    isMindMapOnly ? 'pdf' : 'pdf'
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const selectedRelevantCount = relevantNotes.reduce(
    (count, note) => (selectedIds.has(note.id) ? count + 1 : count),
    0
  );

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(new Set(relevantNotes.map((note) => note.id)));
    setFormat(isMindMapOnly ? 'pdf' : 'pdf');
    setExportStatus('idle');
  }, [isOpen, isMindMapOnly, relevantNotes]);

  const handleSelectAll = useCallback(() => {
    if (selectedRelevantCount === relevantNotes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(relevantNotes.map((n) => n.id)));
    }
  }, [relevantNotes, selectedRelevantCount]);

  const handleToggleNote = useCallback((noteId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  const handleExport = async () => {
    const filteredSelectedIds = new Set(
      relevantNotes.filter((note) => selectedIds.has(note.id)).map((note) => note.id)
    );
    if (filteredSelectedIds.size === 0) return;
    setIsExporting(true);
    setExportStatus('idle');
    try {
      await onExport(format, filteredSelectedIds);
      setExportStatus('success');
      setTimeout(() => {
        onClose();
        setExportStatus('idle');
      }, 1500);
    } catch (error) {
      console.error('Export failed:', error);
      setExportStatus('error');
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const formatOptions = isMindMapOnly
    ? (['pdf', 'png', 'txt'] as const)
    : (['pdf', 'txt', 'html'] as const);

  const formatLabels: Record<string, string> = {
    pdf: 'PDF',
    png: 'PNG',
    txt: 'Text',
    html: 'HTML',
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdropClick={!isExporting}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-md overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Download size={17} className="text-[var(--ledger-accent)]" />
            <h2 className="text-[15px] font-semibold text-[var(--ledger-text-primary)]">
              Export {isMindMapOnly ? 'Mind Maps' : 'Notes'}
            </h2>
          </div>
          <ModalCloseButton
            onClick={onClose}
            ariaLabel="Close export modal"
            disabled={isExporting}
          />
        </div>

        {/* Content */}
        <div className="space-y-3.5 px-5 py-4">
          {/* Format selection */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--ledger-text-secondary)]">
              Export format
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {formatOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setFormat(opt)}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
                    format === opt
                      ? 'bg-[var(--ledger-accent)] text-white'
                      : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  {formatLabels[opt]}
                </button>
              ))}
            </div>
          </div>

          {/* Notes selection */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--ledger-text-secondary)]">
                Select {isMindMapOnly ? 'mind maps' : 'notes'} ({selectedRelevantCount} of{' '}
                {relevantNotes.length})
              </label>
              <button
                onClick={handleSelectAll}
                className="text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
              >
                {selectedRelevantCount === relevantNotes.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]">
              {relevantNotes.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">
                  No {isMindMapOnly ? 'mind maps' : 'notes'} available
                </div>
              ) : (
                relevantNotes.map((note) => (
                  <label
                    key={note.id}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(note.id)}
                      onChange={() => handleToggleNote(note.id)}
                      className="h-3.5 w-3.5 rounded border-[color:var(--ledger-border-strong)] [accent-color:var(--ledger-accent-soft)] focus:ring-[var(--ledger-accent-soft)]"
                    />
                    <span className="flex-1 truncate text-[13px] text-[var(--ledger-text-primary)]">
                      {note.title || 'Untitled'}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Status message */}
          {exportStatus === 'success' && (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-success)]">
              <Check size={16} />
              Export complete! Downloading ZIP archive...
            </div>
          )}
          {exportStatus === 'error' && (
            <div className="rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs text-[var(--ledger-danger)]">
              Export failed. Please try again.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="flex-1 rounded-lg border border-[color:var(--ledger-border-subtle)] px-4 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || selectedRelevantCount === 0}
            aria-busy={isExporting}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--ledger-accent)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Preparing ZIP...
              </>
            ) : (
              <>
                <Download size={16} />
                Export ({selectedRelevantCount})
              </>
            )}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};
