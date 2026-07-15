import { Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';

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

const toHumanReason = (reason: string | null | undefined, isCurrent: boolean) => {
  if (isCurrent) return 'Current';
  const key = String(reason ?? '')
    .trim()
    .toLowerCase();
  if (!key) return 'Manual version';
  if (key === 'autosave_checkpoint') return 'Autosaved';
  if (key === 'before_edit') return 'Before edit';
  if (key === 'before_restore' || key === 'restore_before') return 'Before restore';
  if (key === 'restore') return 'Restored';
  if (key === 'manual') return 'Manual version';
  if (key === 'created') return 'Created';
  if (key === 'before_destructive_overwrite') return 'Before overwrite';
  return 'Manual version';
};

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
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedVersionId((current) => current ?? versions[0]?.id ?? null);
  }, [isOpen, versions]);

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen, onClose]);

  const selectedVersion = useMemo(() => {
    if (!versions.length) return null;
    if (!selectedVersionId) return versions[0] ?? null;
    return versions.find((version) => version.id === selectedVersionId) ?? versions[0] ?? null;
  }, [selectedVersionId, versions]);

  const selectedIndex = useMemo(() => {
    if (!selectedVersion) return -1;
    return versions.findIndex((version) => version.id === selectedVersion.id);
  }, [selectedVersion, versions]);

  const selectedIsCurrent = selectedIndex === 0;

  if (!isOpen) return null;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    >
      <div className="flex h-[84vh] max-h-[84vh] flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Version history</p>
            <p className="mt-1 truncate text-sm font-semibold text-gray-900">
              {noteTitle || 'Untitled note'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Review and restore previous note snapshots.
            </p>
          </div>
          <ModalCloseButton onClick={onClose} ariaLabel="Close version history" />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-4">
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
            <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
              <div className="min-h-0 h-full rounded-xl border border-gray-200">
                <div className="h-full overflow-y-auto py-1.5">
                  {versions.map((version, index) => {
                    const isSelected = selectedVersion?.id === version.id;
                    const isCurrent = index === 0;
                    const isRestoring = restoringVersionId === version.id;
                    return (
                      <div
                        key={version.id}
                        className={`w-full border-b border-gray-100 px-3 py-2.5 transition last:border-b-0 ${
                          isSelected ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVersionId(version.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-sm font-semibold text-gray-900">
                              {toHumanReason(version.reason, isCurrent)}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {formatVersionStamp(version.created_at)}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => onRestore(version.id)}
                            disabled={isCurrent || isRestoring}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                          >
                            {isRestoring ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <RotateCcw size={11} />
                            )}
                            Restore
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 h-full rounded-xl border border-gray-200 bg-white p-4">
                {selectedVersion ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="border-b border-gray-100 pb-3">
                      <p className="text-xs font-medium text-gray-500">Preview</p>
                      <p className="mt-1 text-base font-semibold text-gray-900">
                        {toHumanReason(selectedVersion.reason, selectedIsCurrent)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatVersionStamp(selectedVersion.created_at)} ·{' '}
                        {resolveActorName(selectedVersion.versioned_by)}
                      </p>
                    </div>

                    <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-sm leading-6 text-gray-700">
                      {previewPlainText(selectedVersion.content_html) ||
                        'No content in this version.'}
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      {selectedIsCurrent ? (
                        <p className="text-xs text-gray-500">This is the current version.</p>
                      ) : (
                        <span className="text-xs text-gray-500">
                          Select restore to recover this snapshot.
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onRestore(selectedVersion.id)}
                        disabled={selectedIsCurrent || restoringVersionId === selectedVersion.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                      >
                        {restoringVersionId === selectedVersion.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        Restore this version
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};
