import { Loader2, RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';

type VersionRow = {
  id: string;
  title: string;
  created_at: string;
  reason?: string | null;
  versioned_by?: string | null;
  content_html?: string | null;
};

type VersionHistoryModalProps = {
  isOpen: boolean;
  noteTitle: string;
  versions: VersionRow[];
  isLoading: boolean;
  restoringVersionId: string | null;
  onClose: () => void;
  onRestore: (versionId: string) => void;
  resolveActorName: (userId: string | null | undefined) => string;
};

const previewPlainText = (html: string | null | undefined) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatVersionStamp = (value: string) =>
  new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const VersionHistoryModal = ({
  isOpen,
  noteTitle,
  versions,
  isLoading,
  restoringVersionId,
  onClose,
  onRestore,
  resolveActorName,
}: VersionHistoryModalProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-220 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[84vh] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Version history
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-gray-900">
              {noteTitle || 'Untitled note'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            aria-label="Close version history"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[calc(84vh-70px)] overflow-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 size={18} className="animate-spin" />
              <span className="ml-2 text-sm">Loading versions…</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
              No versions available yet.
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((version, index) => {
                const preview = previewPlainText(version.content_html);
                const isRestoring = restoringVersionId === version.id;
                return (
                  <div
                    key={version.id}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {index === 0 ? 'Current snapshot' : `Version ${versions.length - index}`}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {formatVersionStamp(version.created_at)} ·{' '}
                          {resolveActorName(version.versioned_by)} · {version.reason || 'update'}
                        </p>
                        <p className="mt-1 truncate text-xs text-gray-600">
                          {preview || 'No content preview'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRestore(version.id)}
                        disabled={isRestoring}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        {isRestoring ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        Restore
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
