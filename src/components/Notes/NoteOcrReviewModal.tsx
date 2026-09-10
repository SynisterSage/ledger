import { Loader2, ScanText } from 'lucide-react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import type { NoteOcrResult } from '../../../packages/note-ocr-contract/index';

type Props = {
  result: NoteOcrResult | null;
  isLoading: boolean;
  error: string | null;
  text: string;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onInsert: () => void;
};

export const NoteOcrReviewModal = ({ result, isLoading, error, text, onTextChange, onClose, onInsert }: Props) => (
  <ModalOverlay
    isOpen
    onClose={onClose}
    backdropBorderRadius="inherit"
    disablePortal
    manageWindowChrome={false}
    classNameContainer="w-full max-w-[620px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
  >
    <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)] text-[var(--ledger-accent)]"><ScanText size={16} /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ledger-text-primary)]">Scan text from image</h2>
          <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Review the local transcription before inserting it into this note.</p>
        </div>
      </div>
      <ModalCloseButton onClick={onClose} ariaLabel="Close OCR review" />
    </div>
    <div className="space-y-3 px-5 py-4">
      {isLoading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--ledger-text-muted)]"><Loader2 size={15} className="animate-spin" />Reading image locally…</div>
      ) : error ? (
        <p className="min-h-24 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-3 text-sm text-[var(--ledger-danger)]">{error}</p>
      ) : (
        <>
          <label className="block text-[11px] font-medium text-[var(--ledger-text-muted)]" htmlFor="note-ocr-review-text">Extracted text</label>
          <textarea id="note-ocr-review-text" value={text} onChange={(event) => onTextChange(event.target.value)} autoFocus className="min-h-56 w-full resize-y rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 py-2 text-sm leading-6 text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-accent)]" placeholder="No text recognized" />
          {result && <p className="text-[11px] text-[var(--ledger-text-muted)]">Processed locally with {result.engine === 'paddleocr' ? 'PaddleOCR' : 'Apple Vision'}.</p>}
        </>
      )}
    </div>
    <div className="flex justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
      <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button>
      <button type="button" onClick={onInsert} disabled={isLoading || Boolean(error) || !text.trim()} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-45">Insert into note</button>
    </div>
  </ModalOverlay>
);
