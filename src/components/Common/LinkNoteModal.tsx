import { Check, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModalCloseButton } from './ModalCloseButton';
import { ModalOverlay } from './ModalOverlay';

export type LinkableNote = {
  id: string;
  title: string;
  preview: string;
  updated_at?: string | null;
};

type LinkNoteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  notes: LinkableNote[];
  isLoading?: boolean;
  isLinking?: boolean;
  onLink: (noteIds: string[]) => void | Promise<void>;
  title?: string;
  description?: string;
};

export const LinkNoteModal = ({
  isOpen,
  onClose,
  notes,
  isLoading = false,
  isLinking = false,
  onLink,
  title = 'Link note',
  description = 'Attach workspace notes to this context',
}: LinkNoteModalProps) => {
  const [search, setSearch] = useState('');
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setSelectedNoteIds([]);
    }
  }, [isOpen]);

  const filteredNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter((note) =>
      `${note.title} ${note.preview}`.toLowerCase().includes(term)
    );
  }, [notes, search]);

  const close = () => {
    if (isLinking) return;
    onClose();
  };

  const handleLink = async () => {
    if (selectedNoteIds.length === 0 || isLinking) return;
    await onLink(selectedNoteIds);
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={close}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-[420px] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">{title}</p>
          <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">{description}</p>
        </div>
        <ModalCloseButton
          onClick={close}
          ariaLabel={`Close ${title.toLowerCase()} modal`}
          className="shrink-0"
          disabled={isLinking}
        />
      </div>

      <div className="space-y-3 p-5">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search notes"
          autoFocus
          className="w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
        />
        <p className="text-xs text-[var(--ledger-text-muted)]">
          Select one or more notes, then link them here.
        </p>
        <div className="max-h-80 overflow-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]">
          {isLoading ? (
            <p className="p-3 text-sm text-[var(--ledger-text-muted)]">Loading notes…</p>
          ) : filteredNotes.length === 0 ? (
            <p className="p-3 text-sm text-[var(--ledger-text-muted)]">No available notes to link.</p>
          ) : (
            filteredNotes.map((note) => {
              const selected = selectedNoteIds.includes(note.id);
              return (
                <button
                  key={note.id}
                  type="button"
                  disabled={isLinking}
                  onClick={() =>
                    setSelectedNoteIds((current) =>
                      selected
                        ? current.filter((id) => id !== note.id)
                        : [...current, note.id]
                    )
                  }
                  className="flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected
                        ? 'border-[color:var(--ledger-accent)] bg-[color:rgba(255,95,64,0.12)]'
                        : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <Check size={11} className="text-[var(--ledger-accent)]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {note.title}
                    </p>
                    <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                      {note.preview || 'No content'}
                    </p>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
        <p className="text-xs text-[var(--ledger-text-muted)]">{selectedNoteIds.length} selected</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            disabled={isLinking}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={isLinking || selectedNoteIds.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
          >
            {isLinking && <Loader2 size={14} className="animate-spin" />}
            {isLinking
              ? 'Linking…'
              : `Link ${selectedNoteIds.length} note${selectedNoteIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};
