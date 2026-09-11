import { ScanText } from 'lucide-react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import type { NoteOcrResult } from '../../../packages/note-ocr-contract/index';

type Props = {
  result: NoteOcrResult | null;
  isLoading: boolean;
  error: string | null;
  text: string;
  stage: 'selecting' | 'preparing' | 'converting' | 'recognizing' | 'complete' | null;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onInsert: () => void;
  visionAvailable?: boolean;
  visionDownloading?: boolean;
  visionProgress?: number;
  visionTotalBytes?: number;
  onInstallVision?: () => void;
  onCancelVisionDownload?: () => void;
  onChooseImage?: () => void;
  onMinimize?: () => void;
  visionInstalled?: boolean;
};

const stageDetails = {
  selecting: { progress: 8, title: 'Choose an image', detail: 'Select the note you want Ledger to read.' },
  preparing: { progress: 22, title: 'Preparing image', detail: 'Checking the selected image locally.' },
  converting: { progress: 45, title: 'Preparing HEIC image', detail: 'Rendering a local preview so text recognition receives the visible image.' },
  recognizing: { progress: 72, title: 'Recognizing text locally', detail: 'Ledger is reading the image on this device.' },
  complete: { progress: 100, title: 'Text ready', detail: 'Review the transcription before inserting it.' },
} as const;

const formatBytes = (bytes?: number) => {
  if (!bytes) return null;
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
};

export const NoteOcrReviewModal = ({ result, isLoading, error, text, stage, onTextChange, onClose, onInsert, visionAvailable = true, visionDownloading = false, visionProgress = 0, visionTotalBytes, onInstallVision, onCancelVisionDownload, onChooseImage, onMinimize, visionInstalled = false }: Props) => {
  const progress = stage ? stageDetails[stage] : stageDetails.preparing;
  return (
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
      <div className="flex shrink-0 items-center gap-1">
        {onMinimize && <button type="button" onClick={onMinimize} aria-label="Minimize OCR download" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><span className="text-lg leading-none">−</span></button>}
        <ModalCloseButton onClick={onClose} ariaLabel="Close OCR review" />
      </div>
    </div>
    <div className="space-y-3 px-5 py-4">
      {isLoading ? (
        <div className="flex min-h-40 flex-col justify-center gap-3 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-4">
          <div className="flex items-baseline justify-between gap-3"><p className="text-sm font-medium text-[var(--ledger-text-primary)]">{progress.title}</p><span className="text-xs tabular-nums text-[var(--ledger-text-muted)]">{progress.progress}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]" role="progressbar" aria-label="OCR progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.progress}><div className="h-full rounded-full bg-[var(--ledger-accent)] transition-[width] duration-300" style={{ width: `${progress.progress}%` }} /></div>
          <p className="text-xs leading-5 text-[var(--ledger-text-muted)]">{progress.detail}</p>
        </div>
      ) : error ? (
        <div className="space-y-3 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-4">
          <p className="text-sm text-[var(--ledger-danger)]">{error}</p>
          {!visionAvailable && onInstallVision && (
            <div className="space-y-3 border-t border-[color:var(--ledger-border-subtle)] pt-3">
              <div>
                <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Install Ledger Vision</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ledger-text-muted)]">A one-time local model download is required for reliable image transcription{formatBytes(visionTotalBytes) ? ` (${formatBytes(visionTotalBytes)})` : ''}.</p>
              </div>
              {visionDownloading ? (
                <>
                  <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-[var(--ledger-text-muted)]">Downloading model</span><span className="text-xs tabular-nums text-[var(--ledger-text-muted)]">{visionProgress}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]" role="progressbar" aria-label="Ledger Vision download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={visionProgress}><div className="h-full rounded-full bg-[var(--ledger-accent)] transition-[width] duration-300" style={{ width: `${visionProgress}%` }} /></div>
                  <button type="button" onClick={onCancelVisionDownload} className="rounded-lg border border-[color:var(--ledger-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel download</button>
                </>
              ) : <button type="button" onClick={onInstallVision} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white">Install Ledger Vision</button>}
            </div>
          )}
        </div>
      ) : visionInstalled ? (
        <div className="space-y-3 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-4">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Ledger Vision is ready.</p>
          <p className="text-xs leading-5 text-[var(--ledger-text-muted)]">Choose an image to begin local transcription.</p>
          {onChooseImage && <button type="button" onClick={onChooseImage} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white">Choose image</button>}
        </div>
      ) : (
        <>
          <label className="block text-[11px] font-medium text-[var(--ledger-text-muted)]" htmlFor="note-ocr-review-text">Extracted text</label>
          <textarea id="note-ocr-review-text" value={text} onChange={(event) => onTextChange(event.target.value)} autoFocus className="min-h-56 w-full resize-y rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 py-2 text-sm leading-6 text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-accent)]" placeholder="No text recognized" />
          {result && <p className="text-[11px] text-[var(--ledger-text-muted)]">Processed locally with {result.engine === 'paddleocr' ? 'PaddleOCR' : result.engine === 'local-vision' ? 'Ledger Vision' : 'Apple Vision'}.</p>}
        </>
      )}
    </div>
    <div className="flex justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
      <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">{visionDownloading ? 'Minimize' : 'Cancel'}</button>
      <button type="button" onClick={onInsert} disabled={isLoading || Boolean(error) || !text.trim()} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-45">Insert into note</button>
    </div>
  </ModalOverlay>
  );
};
