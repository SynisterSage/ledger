import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ExternalLink, FileText, HardDrive, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { LedgerEmptyState } from '../Common/LedgerEmptyState';
import {
  ModuleHeaderActionButton,
  ModuleHeaderSegmentedButton,
  ModuleHeaderSegmentedGroup,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import {
  IntegrationProviderMark,
  normalizeIntegrationProvider,
} from '../Common/IntegrationProviderMark';
import { GoogleDriveIcon } from '../Common/GoogleDriveIcon';
import { openAskLedgerWithContext } from '../Common/askLedgerContext';
import type { AskLedgerInitialContext } from '../../types/askLedgerContext';
import type { LocalContextFile } from '../../types/localContextLibrary';

type ExternalReference = {
  id: string;
  provider?: string | null;
  external_url?: string | null;
  external_type?: string | null;
  metadata?: Record<string, unknown> | null;
  access_status?: string | null;
};
type LibraryFilter = 'all' | 'local' | 'connected';
type LibraryItem =
  | { kind: 'local'; file: LocalContextFile }
  | { kind: 'connected'; reference: ExternalReference };
type SelectedItem = LibraryItem & { workspaceId: string };
type LocalPreview =
  | { kind: 'binary'; mimeType: string; dataUrl: string }
  | { kind: 'table'; sheets: Array<{ name: string; headers: string[]; rows: string[][] }> }
  | { kind: 'text'; text: string; readOnly?: boolean }
  | { kind: 'unavailable'; message: string };

const providerLabel = (provider?: string | null) => {
  const value = String(provider ?? '')
    .trim()
    .toLowerCase();
  if (value === 'google_drive') return 'Google Drive';
  if (!value) return 'Connected service';
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
};
const referenceTitle = (reference: ExternalReference) => {
  const metadata = reference.metadata ?? {};
  return String(
    metadata.fileName ??
      metadata.name ??
      metadata.nodeName ??
      metadata.fullName ??
      metadata.title ??
      reference.external_url ??
      'Linked resource'
  );
};
const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
const ConnectedProviderIcon = ({
  provider,
  size = 14,
}: {
  provider?: string | null;
  size?: number;
}) => {
  if (
    String(provider ?? '')
      .toLowerCase()
      .includes('google')
  )
    return <GoogleDriveIcon size={size} />;
  return normalizeIntegrationProvider(provider) ? (
    <IntegrationProviderMark provider={provider} size={size} className="object-contain" />
  ) : (
    <Link2 size={size} />
  );
};

const ConnectedPreview = ({
  reference,
  onOpen,
}: {
  reference: ExternalReference;
  onOpen: () => void;
}) => {
  const metadata = reference.metadata ?? {};
  const provider = String(reference.provider ?? '').toLowerCase();
  const externalUrl = reference.external_url ?? '';
  const providerResourceId = String(metadata.providerResourceId ?? '').trim();
  const embedUrl =
    provider === 'figma' && externalUrl
      ? `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(externalUrl)}`
      : provider === 'google_drive' && providerResourceId
      ? `https://drive.google.com/file/d/${encodeURIComponent(providerResourceId)}/preview`
      : null;
  const github = provider.includes('github');
  const description = String(metadata.description ?? metadata.body ?? '').trim();
  const repo = String(metadata.repositoryFullName ?? metadata.fullName ?? '').trim();
  return (
    <div className="mt-5 w-full overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-left">
      {embedUrl ? (
        <iframe
          title={`Preview of ${referenceTitle(reference)}`}
          src={embedUrl}
          className="h-[min(62vh,680px)] w-full border-0 bg-white"
          allow="fullscreen"
        />
      ) : (
        <div className="p-6">
          <div className="flex items-center gap-3">
            <ConnectedProviderIcon provider={reference.provider} size={20} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                {referenceTitle(reference)}
              </p>
              <p className="text-[11px] text-[var(--ledger-text-muted)]">
                {github ? `GitHub${repo ? ` · ${repo}` : ''}` : providerLabel(reference.provider)}
              </p>
            </div>
          </div>
          {description ? (
            <p className="mt-4 whitespace-pre-wrap text-xs leading-5 text-[var(--ledger-text-secondary)]">
              {description}
            </p>
          ) : (
            <p className="mt-4 text-xs leading-5 text-[var(--ledger-text-muted)]">
              This provider does not expose an embeddable preview for this link.
            </p>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white"
          >
            <ExternalLink size={13} />
            Open original
          </button>
        </div>
      )}
      {embedUrl ? (
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-3 py-2.5">
          <span className="text-[11px] text-[var(--ledger-text-muted)]">
            Live {providerLabel(reference.provider)} preview
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]"
          >
            Open original <ExternalLink size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default function FilesWindow({ focusContext }: { focusContext?: string | null } = {}) {
  const api = useApi();
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const [files, setFiles] = useState<LocalContextFile[]>([]);
  const [references, setReferences] = useState<ExternalReference[]>([]);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'import' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'ask'>('details');
  const [localPreview, setLocalPreview] = useState<LocalPreview | null>(null);
  const [localPreviewLoading, setLocalPreviewLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [tableEditing, setTableEditing] = useState(false);
  const [tableDraft, setTableDraft] = useState<(LocalPreview & { kind: 'table' }) | null>(null);
  const [previewSheetIndex, setPreviewSheetIndex] = useState(0);
  const [revisions, setRevisions] = useState<
    Array<{ id: string; createdAt: string; sizeBytes: number }>
  >([]);
  const [isDragging, setIsDragging] = useState(false);
  const loadRequestRef = useRef(0);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  const activeSelected = selected?.workspaceId === activeWorkspaceId ? selected : null;
  const activeLocalFileId = activeSelected?.kind === 'local' ? activeSelected.file.id : null;
  const focusedMatch = String(focusContext ?? '').match(
    /^focus-file:([^:]+)(?::(page|sheet|row):(.+?))?(?::row:(\d+))?$/
  );
  const focusedFileId = focusedMatch?.[1] ?? null;
  const focusedPage = focusedMatch?.[2] === 'page' ? Number(focusedMatch[3]) : null;
  const focusedSheet =
    focusedMatch?.[2] === 'sheet' ? decodeURIComponent(focusedMatch[3] ?? '') : null;
  const focusedRow =
    focusedMatch?.[2] === 'row'
      ? Number(focusedMatch[3])
      : focusedMatch?.[4]
      ? Number(focusedMatch[4])
      : null;

  const load = useCallback(async () => {
    const workspaceId = activeWorkspaceId;
    if (workspaceId !== activeWorkspaceIdRef.current) return;
    const requestId = ++loadRequestRef.current;
    if (!user?.id || !workspaceId || !window.localContext) {
      setFiles([]);
      setReferences([]);
      setLoadedWorkspaceId(null);
      setLoading(false);
      return;
    }
    setFiles([]);
    setReferences([]);
    setLoadedWorkspaceId(workspaceId);
    setLoading(true);
    setError(null);
    try {
      const [localSummary, connected] = await Promise.all([
        window.localContext.list({ ownerUserId: user.id, workspaceId }),
        api.searchExternalReferences(''),
      ]);
      if (requestId !== loadRequestRef.current || workspaceId !== activeWorkspaceIdRef.current)
        return;
      setFiles(localSummary.files ?? []);
      setReferences(Array.isArray(connected) ? (connected as ExternalReference[]) : []);
      setLoadedWorkspaceId(workspaceId);
    } catch (cause) {
      if (requestId === loadRequestRef.current && workspaceId === activeWorkspaceIdRef.current)
        setError(cause instanceof Error ? cause.message : 'Could not load Files & links.');
    } finally {
      if (requestId === loadRequestRef.current && workspaceId === activeWorkspaceIdRef.current)
        setLoading(false);
    }
  }, [activeWorkspaceId, api, user?.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSelected(null);
  }, [activeWorkspaceId, user?.id]);
  useEffect(() => {
    let canceled = false;
    setLocalPreview(null);
    setEditing(false);
    setTableEditing(false);
    setTableDraft(null);
    setEditText('');
    setPreviewSheetIndex(0);
    setRevisions([]);
    if (
      activeSelected?.kind !== 'local' ||
      !user?.id ||
      !activeWorkspaceId ||
      !window.localContext?.preview
    )
      return;
    setLocalPreviewLoading(true);
    void window.localContext
      .preview({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
      })
      .then((result) => {
        if (!canceled) {
          setLocalPreview(result);
          if (result?.kind === 'text') setEditText(result.text);
        }
      })
      .catch(() => {
        if (!canceled)
          setLocalPreview({
            kind: 'unavailable',
            message: 'Ledger could not preview this file safely.',
          });
      })
      .finally(() => {
        if (!canceled) setLocalPreviewLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [activeLocalFileId, activeSelected?.kind, activeWorkspaceId, user?.id]);

  const visibleItems = useMemo(() => {
    if (loadedWorkspaceId !== activeWorkspaceId) return [];
    const needle = query.trim().toLowerCase();
    const localItems: LibraryItem[] = files
      .filter(() => filter !== 'connected')
      .filter((file) => !needle || file.name.toLowerCase().includes(needle))
      .map((file) => ({ kind: 'local', file }));
    const connectedItems: LibraryItem[] = references
      .filter(() => filter !== 'local')
      .filter(
        (reference) =>
          !needle ||
          `${referenceTitle(reference)} ${providerLabel(reference.provider)}`
            .toLowerCase()
            .includes(needle)
      )
      .map((reference) => ({ kind: 'connected', reference }));
    return [...localItems, ...connectedItems];
  }, [activeWorkspaceId, files, filter, loadedWorkspaceId, query, references]);
  useEffect(() => {
    if (!focusedFileId || !activeWorkspaceId || loadedWorkspaceId !== activeWorkspaceId) return;
    const item = visibleItems.find((candidate) =>
      candidate.kind === 'local'
        ? candidate.file.id === focusedFileId
        : candidate.reference.id === focusedFileId
    );
    if (item) setSelected({ ...item, workspaceId: activeWorkspaceId });
  }, [activeWorkspaceId, focusedFileId, loadedWorkspaceId, visibleItems]);

  const importLocalFiles = async () => {
    if (!user?.id || !activeWorkspaceId || !window.localContext) return;
    setBusy('import');
    setError(null);
    try {
      const result = await window.localContext.importFiles({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
      });
      if (!result.canceled) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import that file.');
    } finally {
      setBusy(null);
    }
  };
  const importDroppedFiles = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => Boolean(filePath));
    if (!paths.length || !user?.id || !activeWorkspaceId || !window.localContext?.importPaths)
      return;
    setBusy('import');
    setError(null);
    try {
      const result = await window.localContext.importPaths({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        paths,
      });
      const first = result.files?.[0];
      if (first) setSelected({ kind: 'local', file: first, workspaceId: activeWorkspaceId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import the dropped file.');
    } finally {
      setBusy(null);
    }
  };
  const removeSelectedLocalFile = async () => {
    if (activeSelected?.kind !== 'local' || !user?.id || !activeWorkspaceId || !window.localContext)
      return;
    if (
      !window.confirm(
        `Remove “${activeSelected.file.name}” from Ledger? The original file will not be deleted.`
      )
    )
      return;
    setBusy('remove');
    try {
      await window.localContext.remove({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
      });
      setSelected(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove that local file.');
    } finally {
      setBusy(null);
    }
  };
  const openSelected = async () => {
    if (!activeSelected) return;
    if (activeSelected.kind === 'local' && user?.id && activeWorkspaceId && window.localContext) {
      const result = await window.localContext.open({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
      });
      if (!result.ok) setError(result.error ?? 'This local file is no longer available.');
    } else if (activeSelected.kind === 'connected' && activeSelected.reference.external_url)
      await window.desktopWindow?.openExternal(activeSelected.reference.external_url);
  };
  const askAboutSelected = (initialQuestion?: string) => {
    if (!activeSelected || !activeWorkspaceId) return;
    const context: AskLedgerInitialContext = {
      resourceType: activeSelected.kind === 'local' ? 'attachment' : 'external',
      resourceId:
        activeSelected.kind === 'local' ? activeSelected.file.id : activeSelected.reference.id,
      title:
        activeSelected.kind === 'local'
          ? activeSelected.file.name
          : referenceTitle(activeSelected.reference),
      workspaceId: activeWorkspaceId,
      ...(initialQuestion ? { initialQuestion } : {}),
    };
    openAskLedgerWithContext(context);
  };
  const saveEditedText = async () => {
    if (
      !activeSelected ||
      activeSelected.kind !== 'local' ||
      !user?.id ||
      !activeWorkspaceId ||
      !window.localContext?.saveText
    )
      return;
    setSaving(true);
    try {
      const updated = await window.localContext.saveText({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
        text: editText,
      });
      setLocalPreview({ kind: 'text', text: editText });
      setSelected({ kind: 'local', file: updated, workspaceId: activeWorkspaceId });
      setEditing(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this file.');
    } finally {
      setSaving(false);
    }
  };
  const saveEditedTable = async () => {
    if (
      !tableDraft ||
      activeSelected?.kind !== 'local' ||
      !user?.id ||
      !activeWorkspaceId ||
      !window.localContext?.saveTable
    )
      return;
    setSaving(true);
    try {
      const updated = await window.localContext.saveTable({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
        sheets: tableDraft.sheets,
      });
      setLocalPreview(tableDraft);
      setSelected({ kind: 'local', file: updated, workspaceId: activeWorkspaceId });
      setTableEditing(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this spreadsheet.');
    } finally {
      setSaving(false);
    }
  };
  const createDocxTextCopy = async () => {
    if (
      activeSelected?.kind !== 'local' ||
      activeSelected.file.extension !== 'docx' ||
      !user?.id ||
      !activeWorkspaceId ||
      !window.localContext?.createTextCopy
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const copy = await window.localContext.createTextCopy({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
      });
      await load();
      setSelected({ kind: 'local', file: copy, workspaceId: activeWorkspaceId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create an editable copy.');
    } finally {
      setSaving(false);
    }
  };
  const loadRevisions = async () => {
    if (
      activeSelected?.kind !== 'local' ||
      !user?.id ||
      !activeWorkspaceId ||
      !window.localContext?.listRevisions
    )
      return;
    try {
      setRevisions(
        await window.localContext.listRevisions({
          ownerUserId: user.id,
          workspaceId: activeWorkspaceId,
          fileId: activeSelected.file.id,
        })
      );
    } catch {
      setRevisions([]);
    }
  };
  const restoreRevision = async (revisionId: string) => {
    if (
      activeSelected?.kind !== 'local' ||
      !user?.id ||
      !activeWorkspaceId ||
      !window.localContext?.restoreRevision
    )
      return;
    setSaving(true);
    try {
      const updated = await window.localContext.restoreRevision({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: activeSelected.file.id,
        revisionId,
      });
      setSelected({ kind: 'local', file: updated, workspaceId: activeWorkspaceId });
      const preview = await window.localContext.preview({
        ownerUserId: user.id,
        workspaceId: activeWorkspaceId,
        fileId: updated.id,
      });
      if (preview?.kind === 'text') {
        setLocalPreview(preview);
        setEditText(preview.text);
      }
      await loadRevisions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this revision.');
    } finally {
      setSaving(false);
    }
  };
  const scopedFileCount = loadedWorkspaceId === activeWorkspaceId ? files.length : 0;
  const scopedReferenceCount = loadedWorkspaceId === activeWorkspaceId ? references.length : 0;
  const subtitle = activeWorkspace?.name
    ? `${activeWorkspace.name} · ${scopedFileCount} local · ${scopedReferenceCount} connected`
    : 'Local context and connected references';

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden rounded-[var(--ledger-window-radius)] bg-[var(--ledger-background)]"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => void importDroppedFiles(event)}
    >
      <ModuleWindowHeader
        eyebrow="Context library"
        title="Files & links"
        subtitle={subtitle}
        icon={<Link2 size={18} className="text-[var(--ledger-accent)]" />}
        onClose={() => void window.desktopWindow?.closeModule('files')}
        onMinimize={() => void window.desktopWindow?.minimizeModule('files')}
        onToggleFullscreen={() => void window.desktopWindow?.toggleModuleFullscreen('files')}
        compact
        showBodyHeader={false}
        viewControls={
          <ModuleHeaderSegmentedGroup compact>
            {(['all', 'local', 'connected'] as const).map((value) => (
              <ModuleHeaderSegmentedButton
                key={value}
                compact
                active={filter === value}
                title={`Show ${
                  value === 'all'
                    ? 'all context'
                    : value === 'local'
                    ? 'local files'
                    : 'connected links'
                }`}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : value === 'local' ? 'On this device' : 'Connected'}
              </ModuleHeaderSegmentedButton>
            ))}
          </ModuleHeaderSegmentedGroup>
        }
        actions={
          <ModuleHeaderActionButton
            title="Import a local file"
            ariaLabel="Import a local file"
            onClick={() => void importLocalFiles()}
            icon={<Plus size={13} />}
            disabled={busy !== null}
          >
            Import local file
          </ModuleHeaderActionButton>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]">
          <div className="border-b border-[color:var(--ledger-border-subtle)] p-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files and links"
              aria-label="Search files and links"
              className="h-8 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-xs text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[var(--ledger-accent)]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading || loadedWorkspaceId !== activeWorkspaceId ? (
              <p className="p-4 text-xs text-[var(--ledger-text-muted)]">Loading context…</p>
            ) : visibleItems.length ? (
              visibleItems.map((item) => {
                const isSelected =
                  activeSelected &&
                  ((item.kind === 'local' &&
                    activeSelected.kind === 'local' &&
                    activeSelected.file.id === item.file.id) ||
                    (item.kind === 'connected' &&
                      activeSelected.kind === 'connected' &&
                      activeSelected.reference.id === item.reference.id));
                const title =
                  item.kind === 'local' ? item.file.name : referenceTitle(item.reference);
                const meta =
                  item.kind === 'local'
                    ? `On this device · ${formatBytes(item.file.sizeBytes)}`
                    : `${providerLabel(item.reference.provider)} · ${
                        item.reference.access_status ?? 'Linked'
                      }`;
                return (
                  <button
                    key={`${item.kind}:${item.kind === 'local' ? item.file.id : item.reference.id}`}
                    type="button"
                    onClick={() =>
                      activeWorkspaceId && setSelected({ ...item, workspaceId: activeWorkspaceId })
                    }
                    className={`flex w-full items-center gap-2.5 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2.5 text-left transition ${
                      isSelected
                        ? 'bg-[color:rgba(255,95,64,0.10)]'
                        : 'hover:bg-[var(--ledger-surface-hover)]'
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-muted)]">
                      {item.kind === 'local' ? (
                        <FileText size={14} />
                      ) : (
                        <ConnectedProviderIcon provider={item.reference.provider} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--ledger-text-primary)]">
                        {title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">
                        {meta}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <LedgerEmptyState
                state="first-use"
                testId="files-empty"
                title="No context yet"
                description={
                  filter === 'connected'
                    ? 'Connect a provider to see links here.'
                    : 'Import a file when it becomes useful to your work.'
                }
                primaryAction={
                  filter !== 'connected'
                    ? { label: 'Import local file', onClick: () => void importLocalFiles() }
                    : undefined
                }
              />
            )}
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--ledger-surface-card)]">
          {error ? (
            <div className="m-5 rounded-lg border border-[color:var(--ledger-danger)]/20 bg-[color:var(--ledger-danger)]/5 px-3 py-2 text-xs text-[var(--ledger-danger)]">
              {error}
            </div>
          ) : null}
          {activeSelected ? (
            <div className="flex min-h-full flex-col">
              <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-6 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                    {activeSelected.kind === 'local'
                      ? activeSelected.file.name
                      : referenceTitle(activeSelected.reference)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                    {activeSelected.kind === 'local'
                      ? activeSelected.file.extension.toUpperCase()
                      : providerLabel(activeSelected.reference.provider)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void openSelected()}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white"
                >
                  <ExternalLink size={13} />
                  {activeSelected.kind === 'local' ? 'Open file' : 'Open original'}
                </button>
                {activeSelected.kind === 'local' &&
                localPreview?.kind === 'text' &&
                !localPreview.readOnly ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    disabled={editing}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] disabled:opacity-50"
                  >
                    Edit
                  </button>
                ) : null}
                {activeSelected.kind === 'local' &&
                activeSelected.file.extension === 'docx' &&
                localPreview?.kind === 'text' ? (
                  <button
                    type="button"
                    onClick={() => void createDocxTextCopy()}
                    disabled={saving}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] disabled:opacity-50"
                  >
                    {saving ? 'Creating…' : 'Save text copy'}
                  </button>
                ) : null}
                {activeSelected.kind === 'local' &&
                localPreview?.kind === 'table' &&
                activeSelected.file.extension === 'xlsx' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTableDraft({
                        kind: 'table',
                        sheets: localPreview.sheets.map((sheet) => ({
                          ...sheet,
                          headers: [...sheet.headers],
                          rows: sheet.rows.map((row) => [...row]),
                        })),
                      });
                      setTableEditing(true);
                    }}
                    disabled={tableEditing}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] disabled:opacity-50"
                  >
                    Edit cells
                  </button>
                ) : null}
              </div>
              <div className="flex flex-1 items-center justify-center bg-[var(--ledger-surface-muted)] p-8">
                <div className="w-full max-w-xl rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-10 text-center shadow-[var(--ledger-shadow)]">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-accent)]">
                    {activeSelected.kind === 'local' ? (
                      <HardDrive size={21} />
                    ) : (
                      <ConnectedProviderIcon
                        provider={activeSelected.reference.provider}
                        size={21}
                      />
                    )}
                  </div>
                  {activeSelected.kind === 'local' && localPreviewLoading ? (
                    <p className="mt-4 text-sm text-[var(--ledger-text-muted)]">Loading preview…</p>
                  ) : activeSelected.kind === 'local' && localPreview?.kind === 'binary' ? (
                    <div className="mt-5 overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-white">
                      {localPreview.mimeType === 'application/pdf' ? (
                        <iframe
                          title={`Preview of ${activeSelected.file.name}`}
                          src={`${localPreview.dataUrl}${
                            focusedPage ? `#page=${focusedPage}` : ''
                          }`}
                          className="h-[min(62vh,680px)] w-full"
                        />
                      ) : (
                        <img
                          src={localPreview.dataUrl}
                          alt={activeSelected.file.name}
                          className="max-h-[min(62vh,680px)] w-full object-contain"
                        />
                      )}
                    </div>
                  ) : activeSelected.kind === 'local' && localPreview?.kind === 'table' ? (
                    <div className="mt-5 w-full overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-left">
                      {localPreview.sheets.length > 1 ? (
                        <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--ledger-border-subtle)] px-2 py-2">
                          {localPreview.sheets.map((sheet, index) => (
                            <button
                              key={sheet.name}
                              type="button"
                              onClick={() => setPreviewSheetIndex(index)}
                              className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] ${
                                previewSheetIndex === index
                                  ? 'bg-[var(--ledger-surface-card)] font-medium text-[var(--ledger-text-primary)]'
                                  : 'text-[var(--ledger-text-muted)]'
                              }`}
                            >
                              {sheet.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {(() => {
                        const activeTable = tableEditing && tableDraft ? tableDraft : localPreview;
                        const sheet =
                          activeTable.sheets[previewSheetIndex] ?? activeTable.sheets[0];
                        return sheet ? (
                          <div className="max-h-[min(62vh,680px)] overflow-auto">
                            <table className="min-w-full border-collapse text-left text-xs">
                              <thead className="sticky top-0 bg-[var(--ledger-surface-card)]">
                                <tr>
                                  {sheet.headers.map((header, index) => (
                                    <th
                                      key={`${header}-${index}`}
                                      className="border-b border-r border-[color:var(--ledger-border-subtle)] px-3 py-2 font-medium text-[var(--ledger-text-primary)]"
                                    >
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sheet.rows.map((row, rowIndex) => (
                                  <tr
                                    key={rowIndex}
                                    className="hover:bg-[var(--ledger-surface-hover)]"
                                  >
                                    {sheet.headers.map((_, columnIndex) => (
                                      <td
                                        key={columnIndex}
                                        className="max-w-64 border-b border-r border-[color:var(--ledger-border-subtle)] px-3 py-2 align-top text-[var(--ledger-text-secondary)]"
                                      >
                                        {tableEditing && tableDraft ? (
                                          <input
                                            value={row[columnIndex] ?? ''}
                                            onChange={(event) =>
                                              setTableDraft((current) =>
                                                current
                                                  ? {
                                                      ...current,
                                                      sheets: current.sheets.map(
                                                        (entry, entryIndex) =>
                                                          entryIndex === previewSheetIndex
                                                            ? {
                                                                ...entry,
                                                                rows: entry.rows.map(
                                                                  (draftRow, draftRowIndex) =>
                                                                    draftRowIndex === rowIndex
                                                                      ? draftRow.map(
                                                                          (cell, cellIndex) =>
                                                                            cellIndex ===
                                                                            columnIndex
                                                                              ? event.target.value
                                                                              : cell
                                                                        )
                                                                      : draftRow
                                                                ),
                                                              }
                                                            : entry
                                                      ),
                                                    }
                                                  : current
                                              )
                                            }
                                            className="w-full min-w-24 bg-transparent text-xs text-[var(--ledger-text-primary)] outline-none"
                                            aria-label={`Edit row ${rowIndex + 1}, column ${
                                              columnIndex + 1
                                            }`}
                                          />
                                        ) : (
                                          row[columnIndex] ?? ''
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {tableEditing && tableDraft ? (
                              <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] p-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTableEditing(false);
                                    setTableDraft(null);
                                  }}
                                  disabled={saving}
                                  className="rounded-md px-2.5 py-1.5 text-xs text-[var(--ledger-text-muted)]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void saveEditedTable()}
                                  disabled={saving}
                                  className="rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {saving ? 'Saving…' : 'Save spreadsheet'}
                                </button>
                              </div>
                            ) : null}
                            {sheet.rows.length === 0 ? (
                              <p className="p-5 text-center text-xs text-[var(--ledger-text-muted)]">
                                This sheet is empty.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="p-5 text-center text-xs text-[var(--ledger-text-muted)]">
                            No sheets available.
                          </p>
                        );
                      })()}
                    </div>
                  ) : activeSelected.kind === 'local' && localPreview?.kind === 'text' ? (
                    <div className="mt-5 max-h-[min(62vh,680px)] overflow-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-4 text-left">
                      {editing ? (
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          className="min-h-[min(62vh,680px)] w-full resize-y bg-transparent font-mono text-xs leading-5 text-[var(--ledger-text-primary)] outline-none"
                          aria-label={`Edit ${activeSelected.file.name}`}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[var(--ledger-text-primary)]">
                          {localPreview.text || 'This file is empty.'}
                        </pre>
                      )}
                      {editing ? (
                        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] pt-3">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(false);
                              setEditText(localPreview.text);
                            }}
                            disabled={saving}
                            className="rounded-md px-2.5 py-1.5 text-xs text-[var(--ledger-text-muted)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEditedText()}
                            disabled={saving}
                            className="rounded-md bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      ) : null}
                      {focusedSheet || focusedRow ? (
                        <p className="mt-3 text-[11px] text-[var(--ledger-accent)]">
                          Citation target: {focusedSheet ? `Sheet ${focusedSheet}` : ''}
                          {focusedRow ? `${focusedSheet ? ' · ' : ''}Row ${focusedRow}` : ''}
                        </p>
                      ) : null}
                      {localPreview.readOnly ? (
                        <p className="mt-4 border-t border-[color:var(--ledger-border-subtle)] pt-3 text-[11px] text-[var(--ledger-text-muted)]">
                          Read-only preview. Open the original to edit.
                        </p>
                      ) : null}
                    </div>
                  ) : activeSelected.kind === 'connected' ? (
                    <ConnectedPreview
                      reference={activeSelected.reference}
                      onOpen={() => void openSelected()}
                    />
                  ) : (
                    <>
                      <p className="mt-4 text-sm font-medium text-[var(--ledger-text-primary)]">
                        {activeSelected.kind === 'local' && localPreview?.kind === 'unavailable'
                          ? 'Preview unavailable'
                          : 'Live preview'}
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--ledger-text-muted)]">
                        {activeSelected.kind === 'local'
                          ? localPreview?.kind === 'unavailable'
                            ? localPreview.message
                            : 'This local file is not available for preview.'
                          : 'A live provider preview will appear here when the connection supports embedding.'}
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 border-t border-[color:var(--ledger-border-subtle)] px-6 py-3 text-xs text-[var(--ledger-text-muted)]">
                <ShieldCheck size={14} className="text-[var(--ledger-accent)]" />
                <span>
                  {activeSelected.kind === 'local'
                    ? `On this device · ${formatBytes(activeSelected.file.sizeBytes)}`
                    : 'Original stays with the connected provider'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              {visibleItems.length ? (
                <div className="w-full max-w-xl rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                        Recent context
                      </p>
                      <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                        Pick up where you left off in this workspace.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void importLocalFiles()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white"
                    >
                      <Plus size={13} />
                      Import
                    </button>
                  </div>
                  <div className="mt-5 divide-y divide-[color:var(--ledger-border-subtle)]">
                    {visibleItems.slice(0, 6).map((item) => (
                      <button
                        key={`${item.kind}:${
                          item.kind === 'local' ? item.file.id : item.reference.id
                        }`}
                        type="button"
                        onClick={() =>
                          activeWorkspaceId &&
                          setSelected({ ...item, workspaceId: activeWorkspaceId })
                        }
                        className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-accent)]">
                          {item.kind === 'local' ? (
                            <HardDrive size={14} />
                          ) : (
                            <ConnectedProviderIcon provider={item.reference.provider} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-[var(--ledger-text-primary)]">
                            {item.kind === 'local'
                              ? item.file.name
                              : referenceTitle(item.reference)}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[var(--ledger-text-muted)]">
                            {item.kind === 'local'
                              ? `On this device · ${formatBytes(item.file.sizeBytes)}`
                              : providerLabel(item.reference.provider)}
                          </span>
                        </span>
                        <ExternalLink
                          size={13}
                          className="shrink-0 text-[var(--ledger-text-muted)]"
                        />
                      </button>
                    ))}
                  </div>
                  <p className="mt-5 border-t border-[color:var(--ledger-border-subtle)] pt-4 text-center text-[11px] text-[var(--ledger-text-muted)]">
                    You can also drag a file anywhere into this window.
                  </p>
                </div>
              ) : (
                <LedgerEmptyState
                  state="first-use"
                  testId="files-detail-empty"
                  title="Choose some context"
                  description="Select a file or link to see where it lives and how Ledger can use it."
                  primaryAction={{
                    label: 'Import local file',
                    onClick: () => void importLocalFiles(),
                  }}
                />
              )}
            </div>
          )}
        </main>
        {activeSelected ? (
          <aside className="hidden w-[280px] shrink-0 border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] lg:block">
            <div className="flex border-b border-[color:var(--ledger-border-subtle)] px-3 pt-2">
              {(['details', 'ask'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setInspectorTab(tab)}
                  className={`border-b-2 px-3 py-2 text-xs font-medium capitalize ${
                    inspectorTab === tab
                      ? 'border-[var(--ledger-accent)] text-[var(--ledger-text-primary)]'
                      : 'border-transparent text-[var(--ledger-text-muted)]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {inspectorTab === 'details' ? (
              <div className="divide-y divide-[color:var(--ledger-border-subtle)] px-4 text-xs">
                <div className="py-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">
                    Details
                  </p>
                  <p className="mt-2 text-[var(--ledger-text-primary)]">
                    {activeSelected.kind === 'local'
                      ? activeSelected.file.extension.toUpperCase()
                      : providerLabel(activeSelected.reference.provider)}
                  </p>
                  <p className="mt-1 text-[var(--ledger-text-muted)]">
                    {activeSelected.kind === 'local'
                      ? formatBytes(activeSelected.file.sizeBytes)
                      : activeSelected.reference.access_status ?? 'Linked'}
                  </p>
                </div>
                <div className="py-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">
                    Workspace
                  </p>
                  <p className="mt-2 text-[var(--ledger-text-primary)]">
                    {activeWorkspace?.name ?? 'Current workspace'}
                  </p>
                </div>
                <div className="py-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">
                    Used with
                  </p>
                  <p className="mt-2 text-[var(--ledger-text-primary)]">
                    {activeSelected.kind === 'local'
                      ? `${activeSelected.file.links.length} Ledger item${
                          activeSelected.file.links.length === 1 ? '' : 's'
                        }`
                      : 'Linked context'}
                  </p>
                </div>
                {activeSelected.kind === 'local' ? (
                  <button
                    type="button"
                    onClick={() => void removeSelectedLocalFile()}
                    disabled={busy !== null}
                    className="mt-4 inline-flex h-8 items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-[var(--ledger-danger)] disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                    Remove local copy
                  </button>
                ) : null}
                {activeSelected.kind === 'local' && !editing ? (
                  <button
                    type="button"
                    onClick={() => void loadRevisions()}
                    className="mt-3 inline-flex h-8 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs text-[var(--ledger-text-secondary)]"
                  >
                    History{revisions.length ? ` · ${revisions.length}` : ''}
                  </button>
                ) : null}
                {activeSelected.kind === 'local' && revisions.length > 0 ? (
                  <div className="mt-3 space-y-1 border-t border-[color:var(--ledger-border-subtle)] pt-3">
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">
                      Previous versions
                    </p>
                    {revisions.slice(0, 5).map((revision) => (
                      <button
                        key={revision.id}
                        type="button"
                        onClick={() => void restoreRevision(revision.id)}
                        disabled={saving}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <span>
                          {new Date(revision.createdAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="text-[var(--ledger-text-muted)]">Restore</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="p-4">
                <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                  Ask about this file
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--ledger-text-muted)]">
                  Open a file-scoped Ask Ledger session with this item as the starting context.
                </p>
                <div className="mt-4 space-y-1.5">
                  <button
                    type="button"
                    onClick={() => askAboutSelected('Summarize this file.')}
                    className="block w-full rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    Summarize this file
                  </button>
                  <button
                    type="button"
                    onClick={() => askAboutSelected('Find the action items in this file.')}
                    className="block w-full rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    Find action items
                  </button>
                  <button
                    type="button"
                    onClick={() => askAboutSelected()}
                    className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white"
                  >
                    Open Ask Ledger
                  </button>
                </div>
              </div>
            )}
          </aside>
        ) : null}
      </div>
      {isDragging ? (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--ledger-accent)] bg-[color:rgba(255,247,237,0.94)]">
          <div className="rounded-lg bg-[var(--ledger-surface-card)] px-6 py-5 text-center shadow-[var(--ledger-shadow)]">
            <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
              Add to Files & links
            </p>
            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
              Stored on this device for {activeWorkspace?.name ?? 'this workspace'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
