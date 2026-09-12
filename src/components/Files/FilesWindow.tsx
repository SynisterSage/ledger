import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Link2,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useSidebar } from '../../context/SidebarContext';
import {
  modulePaneSizing,
  clampPaneWidth,
  getPaneWidthForViewport,
} from '../../config/modulePaneSizes';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { useApi } from '../../hooks/useApi';
import { LedgerEmptyState } from '../Common/LedgerEmptyState';
import { ContextMenu } from '../Common/ContextMenu';
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
import { AskLedgerPanel, type AskLedgerSession } from '../Common/AskLedgerPanel';
import { SkeletonCompactRow } from '../Common/Skeleton';
import { routeForCalendarEvent, routeForCalendarReminder, routeForNote, routeForProject, usePlatform } from '../../platform';
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
type LocalFileContextMenu = { x: number; y: number };
type LinkedTargetDetail = {
  targetType: LocalContextFile['links'][number]['targetType'];
  targetId: string;
  title: string;
};
type LocalPreview =
  | { kind: 'binary'; mimeType: string; dataUrl: string; fileUrl?: string }
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
const LocalFileIcon = ({ extension, size = 14, className }: { extension: string; size?: number; className?: string }) => {
  const normalized = extension.toLowerCase();
  const Icon = normalized === 'pdf'
    ? FileType
    : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(normalized)
    ? FileImage
    : ['csv', 'xlsx'].includes(normalized)
    ? FileSpreadsheet
    : ['txt', 'md'].includes(normalized)
    ? FileCode
    : FileText;
  return <Icon size={size} className={className} aria-hidden="true" />;
};
const unsupportedFileTypeMessage =
  'That file type is not supported yet. Add a PDF, image (PNG, JPG, JPEG, WEBP, or GIF), Word document, text or Markdown file, CSV, or Excel file.';
const formatImportError = (cause: unknown, fallback: string) => {
  const message = cause instanceof Error ? cause.message : '';
  return /Unsupported local file type/i.test(message) ? unsupportedFileTypeMessage : message || fallback;
};
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

const FilesContentSkeleton = () => (
  <div
    className="flex h-full min-h-full items-center justify-center bg-[var(--ledger-surface-card)] p-8"
    aria-label="Loading files and links"
    role="status"
  >
    <div className="w-full max-w-xl rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)] animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-28 rounded bg-[var(--ledger-surface-hover)]" />
          <div className="h-3 w-56 rounded bg-[var(--ledger-surface-hover)]" />
        </div>
        <div className="h-8 w-20 rounded-md bg-[var(--ledger-surface-hover)]" />
      </div>
      <div className="mt-5 divide-y divide-[color:var(--ledger-border-subtle)]">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 py-2.5">
            <div className="h-8 w-8 shrink-0 rounded-md bg-[var(--ledger-surface-hover)]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div
                className={`h-3 rounded bg-[var(--ledger-surface-hover)] ${
                  index % 2 ? 'w-3/5' : 'w-4/5'
                }`}
              />
              <div className="h-2.5 w-2/5 rounded bg-[var(--ledger-surface-hover)]" />
            </div>
            <div className="h-3 w-3 rounded bg-[var(--ledger-surface-hover)]" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default function FilesWindow({ focusContext }: { focusContext?: string | null } = {}) {
  const api = useApi();
  const platform = usePlatform();
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const { workspaceShellLayout, reduceMotion } = useSidebar();
  const viewportWidth = useViewportWidth();
  const [files, setFiles] = useState<LocalContextFile[]>([]);
  const [references, setReferences] = useState<ExternalReference[]>([]);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'import' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'ask'>('details');
  const [askSession, setAskSession] = useState<AskLedgerSession | null>(null);
  const [askSessionLoading, setAskSessionLoading] = useState(false);
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
  const [linkedTargetDetails, setLinkedTargetDetails] = useState<LinkedTargetDetail[]>([]);
  const [linkedTargetDetailsLoading, setLinkedTargetDetailsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.files.left)
  );
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.files.right)
  );
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(() => viewportWidth < 760);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(true);
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [localFileContextMenu, setLocalFileContextMenu] = useState<LocalFileContextMenu | null>(null);
  const localSelectionAnchorRef = useRef<string | null>(null);
  const askSessionIdsRef = useRef(new Map<string, string>());
  const loadRequestRef = useRef(0);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  const activeSelected = selected?.workspaceId === activeWorkspaceId ? selected : null;
  const activeLocalFileId = activeSelected?.kind === 'local' ? activeSelected.file.id : null;
  const activeAskResource = activeSelected
    ? {
        resourceType: activeSelected.kind === 'local' ? 'attachment' : 'external',
        resourceId: activeSelected.kind === 'local' ? activeSelected.file.id : activeSelected.reference.id,
        title: activeSelected.kind === 'local' ? activeSelected.file.name : referenceTitle(activeSelected.reference),
      } as const
    : null;
  const activeAskResourceKey = activeAskResource
    ? `${activeAskResource.resourceType}:${activeAskResource.resourceId}`
    : null;
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

  const selectedLocalFiles = useMemo(
    () => files.filter((file) => bulkSelectedIds.has(file.id)),
    [bulkSelectedIds, files]
  );

  useEffect(() => {
    setLeftPaneWidth((current) => clampPaneWidth(current, viewportWidth, modulePaneSizing.files.left));
    setRightPaneWidth((current) => clampPaneWidth(current, viewportWidth, modulePaneSizing.files.right));
    if (viewportWidth < 760) setIsLeftPaneCollapsed(true);
  }, [viewportWidth]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(null), 6500);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!isResizingLeftPane) return;
    const handleMove = (event: MouseEvent) => {
      setLeftPaneWidth(clampPaneWidth(event.clientX, viewportWidth, modulePaneSizing.files.left));
    };
    const handleUp = () => setIsResizingLeftPane(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingLeftPane, viewportWidth]);

  useEffect(() => {
    if (!isResizingRightPane) return;
    const handleMove = (event: MouseEvent) => {
      setRightPaneWidth(clampPaneWidth(window.innerWidth - event.clientX, viewportWidth, modulePaneSizing.files.right));
    };
    const handleUp = () => setIsResizingRightPane(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingRightPane, viewportWidth]);

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
    setBulkSelectedIds(new Set());
    localSelectionAnchorRef.current = null;
  }, [activeWorkspaceId, user?.id]);
  useEffect(() => {
    let canceled = false;
    if (!activeWorkspaceId || !user?.id || !activeAskResource || !activeAskResourceKey) {
      setAskSession(null);
      setAskSessionLoading(false);
      return;
    }
    setAskSession(null);
    setAskSessionLoading(true);
    const restore = async () => {
      let restored: AskLedgerSession | null = null;
      const knownId = askSessionIdsRef.current.get(activeAskResourceKey);
      if (knownId) {
        const [cloudResult, localResult] = await Promise.allSettled([
          api.getAskLedgerSession(activeWorkspaceId, knownId) as Promise<{ session?: AskLedgerSession }>,
          window.localAskSessions?.get({ userId: user.id, workspaceId: activeWorkspaceId, sessionId: knownId }),
        ]);
        if (cloudResult.status === 'fulfilled' && cloudResult.value?.session)
          restored = cloudResult.value.session;
        if (localResult.status === 'fulfilled' && localResult.value?.session)
          restored = { ...localResult.value.session, privacyScope: 'device' } as AskLedgerSession;
      } else {
        const [cloudResult, localResult] = await Promise.allSettled([
          api.getAskLedgerSessions(activeWorkspaceId, 50) as Promise<{ sessions?: AskLedgerSession[] }>,
          window.localAskSessions?.list({ userId: user.id, workspaceId: activeWorkspaceId, limit: 50 }),
        ]);
        const cloudSessions = cloudResult.status === 'fulfilled' && Array.isArray(cloudResult.value?.sessions)
          ? cloudResult.value.sessions
          : [];
        const localSessions = localResult.status === 'fulfilled' && Array.isArray(localResult.value?.sessions)
          ? localResult.value.sessions.map((session) => ({ ...session, privacyScope: 'device' as const }) as AskLedgerSession)
          : [];
        restored = [...cloudSessions, ...localSessions]
          .filter((session) =>
            (session.initialContext?.resourceType === activeAskResource.resourceType &&
              session.initialContext?.resourceId === activeAskResource.resourceId) ||
            (activeAskResource.resourceType === 'attachment' &&
              session.messages.some((message) =>
                message.attachments?.some(
                  (attachment) =>
                    attachment.kind === 'file' &&
                    attachment.attachment.localFileId === activeAskResource.resourceId
                )
              ))
          )
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
      }
      if (canceled) return;
      if (restored) askSessionIdsRef.current.set(activeAskResourceKey, restored.id);
      setAskSession(restored);
      setAskSessionLoading(false);
    };
    void restore();
    return () => {
      canceled = true;
    };
  }, [activeAskResourceKey, activeAskResource?.resourceId, activeAskResource?.resourceType, activeWorkspaceId, api, user?.id]);
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

  useEffect(() => {
    let canceled = false;
    const links = activeSelected?.kind === 'local' ? activeSelected.file.links : [];
    if (!links.length || !activeWorkspaceId) {
      setLinkedTargetDetails([]);
      setLinkedTargetDetailsLoading(false);
      return;
    }
    setLinkedTargetDetailsLoading(true);
    const loadLinkedTargets = async () => {
      try {
        const types = new Set(links.map((link) => link.targetType));
        const [notes, projects, events, reminders] = await Promise.all([
          types.has('note') ? api.getNotes() : Promise.resolve([]),
          types.has('project') ? api.getProjects({ includeCompleted: true }) : Promise.resolve([]),
          types.has('event') ? api.getEvents() : Promise.resolve([]),
          types.has('reminder') ? api.getReminders() : Promise.resolve([]),
        ]);
        const records = {
          note: Array.isArray(notes) ? notes : [],
          project: Array.isArray(projects) ? projects : [],
          event: Array.isArray(events) ? events : [],
          reminder: Array.isArray(reminders) ? reminders : [],
        } as const;
        const details = links.map((link) => {
          const record = link.targetType === 'ask_session'
            ? null
            : records[link.targetType]?.find((item) => String((item as { id?: string }).id) === link.targetId);
          const title = record
            ? String((record as { title?: string; name?: string }).title ?? (record as { name?: string }).name ?? link.targetId)
            : link.targetType === 'ask_session'
            ? 'Ask Ledger session'
            : link.targetId;
          return { targetType: link.targetType, targetId: link.targetId, title };
        });
        if (!canceled) setLinkedTargetDetails(details);
      } catch {
        if (!canceled) setLinkedTargetDetails(links.map((link) => ({
          targetType: link.targetType,
          targetId: link.targetId,
          title: link.targetType === 'ask_session' ? 'Ask Ledger session' : link.targetId,
        })));
      } finally {
        if (!canceled) setLinkedTargetDetailsLoading(false);
      }
    };
    void loadLinkedTargets();
    return () => {
      canceled = true;
    };
  }, [activeSelected?.kind, activeSelected?.kind === 'local' ? activeSelected.file.id : null, api, activeWorkspaceId]);

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
      setError(formatImportError(cause, 'Could not import that file.'));
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
      setError(formatImportError(cause, 'Could not import the dropped file.'));
    } finally {
      setBusy(null);
    }
  };
  const selectLocalFile = (file: LocalContextFile, shiftKey: boolean, additive: boolean) => {
    const localItems = visibleItems.filter(
      (item): item is Extract<LibraryItem, { kind: 'local' }> => item.kind === 'local'
    );
    const anchorIndex = localSelectionAnchorRef.current
      ? localItems.findIndex((item) => item.file.id === localSelectionAnchorRef.current)
      : -1;
    const clickedIndex = localItems.findIndex((item) => item.file.id === file.id);
    if (shiftKey && anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      setBulkSelectedIds(new Set(localItems.slice(start, end + 1).map((item) => item.file.id)));
    } else if (additive) {
      setBulkSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(file.id)) next.delete(file.id);
        else next.add(file.id);
        return next;
      });
      localSelectionAnchorRef.current = file.id;
    } else {
      setBulkSelectedIds(new Set([file.id]));
      localSelectionAnchorRef.current = file.id;
    }
    if (activeWorkspaceId) setSelected({ kind: 'local', file, workspaceId: activeWorkspaceId });
  };
  const removeLocalFiles = async (filesToRemove: LocalContextFile[]) => {
    if (!user?.id || !activeWorkspaceId || !window.localContext || !filesToRemove.length) return;
    const noun = filesToRemove.length === 1 ? 'local copy' : 'local copies';
    if (
      !window.confirm(
        `Remove ${filesToRemove.length === 1 ? `“${filesToRemove[0].name}”` : `${filesToRemove.length} files`} from Ledger? The original files will not be deleted.`
      )
    )
      return;
    setBusy('remove');
    try {
      for (const file of filesToRemove) {
        await window.localContext.remove({
          ownerUserId: user.id,
          workspaceId: activeWorkspaceId,
          fileId: file.id,
        });
      }
      if (activeSelected?.kind === 'local' && filesToRemove.some((file) => file.id === activeSelected.file.id))
        setSelected(null);
      setBulkSelectedIds(new Set());
      localSelectionAnchorRef.current = null;
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not remove the selected ${noun}.`);
    } finally {
      setBusy(null);
    }
  };
  const removeLocalFile = async (file: LocalContextFile) => {
    if (!user?.id || !activeWorkspaceId || !window.localContext)
      return;
    await removeLocalFiles([file]);
  };
  const removeSelectedLocalFile = async () => {
    if (activeSelected?.kind !== 'local') return;
    await removeLocalFile(activeSelected.file);
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
  const openLinkedTarget = (target: LinkedTargetDetail) => {
    if (!activeWorkspaceId) return;
    const route = target.targetType === 'note'
      ? routeForNote(activeWorkspaceId, target.targetId)
      : target.targetType === 'project'
      ? routeForProject(activeWorkspaceId, target.targetId)
      : target.targetType === 'event'
      ? routeForCalendarEvent(activeWorkspaceId, target.targetId)
      : target.targetType === 'reminder'
      ? routeForCalendarReminder(activeWorkspaceId, target.targetId)
      : null;
    if (route) platform.navigation.openRoute(route);
  };
  const linkedTargetLabel = (targetType: LinkedTargetDetail['targetType']) =>
    targetType === 'ask_session'
      ? 'Ask Ledger'
      : targetType === 'note'
      ? 'Note'
      : targetType === 'project'
      ? 'Project'
      : targetType === 'event'
      ? 'Event'
      : 'Reminder';
  const scopedFileCount = loadedWorkspaceId === activeWorkspaceId ? files.length : 0;
  const scopedReferenceCount = loadedWorkspaceId === activeWorkspaceId ? references.length : 0;
  const subtitle = activeWorkspace?.name
    ? `${activeWorkspace.name} · ${scopedFileCount} local · ${scopedReferenceCount} connected`
    : 'Local context and connected references';

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden rounded-[var(--ledger-window-radius)] bg-[var(--ledger-background)]"
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
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
      <div
        className="relative flex min-h-0 flex-1 overflow-hidden"
        data-reduce-motion={reduceMotion ? 'true' : 'false'}
      >
        {!isLeftPaneCollapsed ? (
          <>
          <aside className="ledger-pane-surface ledger-pane-left flex shrink-0 flex-col overflow-hidden border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]" style={{ width: `${leftPaneWidth}px` }}>
            <div className={`${viewportWidth < modulePaneSizing.files.left.compactBreakpoint ? 'p-3' : 'p-4'} border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--ledger-text-muted)]">
                  {bulkSelectedIds.size > 1
                    ? `${bulkSelectedIds.size} files selected`
                    : 'Files & links'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsLeftPaneCollapsed(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                  aria-label="Hide left panel"
                  title="Hide left panel"
                >
                  <ChevronLeft size={13} />
                </button>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files and links"
                aria-label="Search files and links"
                className="h-8 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-xs text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[var(--ledger-accent)]"
              />
            </div>
            <div className="ledger-pane-scrollbar min-h-0 flex-1 overflow-auto p-2.5 space-y-1">
              {loading || loadedWorkspaceId !== activeWorkspaceId ? (
                Array.from({ length: 7 }).map((_, index) => <SkeletonCompactRow key={index} />)
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
                      key={`${item.kind}:${
                        item.kind === 'local' ? item.file.id : item.reference.id
                      }`}
                      type="button"
                      onClick={(event) => {
                        if (item.kind === 'local') {
                          selectLocalFile(item.file, event.shiftKey, event.metaKey || event.ctrlKey);
                        } else {
                          setBulkSelectedIds(new Set());
                          localSelectionAnchorRef.current = null;
                          if (activeWorkspaceId) setSelected({ ...item, workspaceId: activeWorkspaceId });
                        }
                      }}
                      onContextMenu={(event) => {
                        if (item.kind !== 'local') return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (!bulkSelectedIds.has(item.file.id)) {
                          setBulkSelectedIds(new Set([item.file.id]));
                          localSelectionAnchorRef.current = item.file.id;
                          if (activeWorkspaceId)
                            setSelected({ kind: 'local', file: item.file, workspaceId: activeWorkspaceId });
                        }
                        setLocalFileContextMenu({ x: event.clientX, y: event.clientY });
                      }}
                      className={`group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-left transition ${
                        isSelected
                          ? 'bg-[var(--ledger-surface-hover)]'
                          : item.kind === 'local' && bulkSelectedIds.has(item.file.id)
                          ? 'bg-[var(--ledger-surface-hover)]'
                          : 'bg-transparent hover:bg-[var(--ledger-surface-hover)]'
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-muted)]">
                        {item.kind === 'local' ? (
                          <LocalFileIcon extension={item.file.extension} />
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
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={(event) => {
              event.preventDefault();
              setIsResizingLeftPane(true);
            }}
            className={`w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--ledger-surface-hover)] ${isResizingLeftPane ? 'bg-[var(--ledger-border-strong)]' : ''}`}
            title="Drag to resize left panel"
          />
          </>
        ) : (
          <div className="ledger-pane-toggle absolute left-2 top-4 z-30">
            <button
              type="button"
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
              aria-label="Show left panel"
              title="Show left panel"
            >
              <ChevronRight size={14} strokeWidth={2.25} />
            </button>
            </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--ledger-surface-card)]">
          {error ? (
            <div
              className="m-5 rounded-lg border border-[color:var(--ledger-danger)]/20 bg-[color:var(--ledger-danger)]/5 px-3 py-2 text-xs text-[var(--ledger-danger)]"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {loading || loadedWorkspaceId !== activeWorkspaceId ? (
            <FilesContentSkeleton />
          ) : activeSelected ? (
            <div className="flex min-h-full flex-col">
              <div className="flex flex-1 items-center justify-center bg-[var(--ledger-surface-muted)] p-8">
                <div className="w-full max-w-xl rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-10 text-center shadow-[var(--ledger-shadow)]">
                  <div className="mb-5 flex items-start justify-between gap-4 text-left">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-[var(--ledger-text-primary)]">
                        {activeSelected.kind === 'local'
                          ? activeSelected.file.name
                          : referenceTitle(activeSelected.reference)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                        {activeSelected.kind === 'local'
                          ? activeSelected.file.extension.toUpperCase()
                          : providerLabel(activeSelected.reference.provider)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void openSelected()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white"
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
                          className="inline-flex h-8 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] disabled:opacity-50"
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
                          className="inline-flex h-8 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] disabled:opacity-50"
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
                          className="inline-flex h-8 items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] disabled:opacity-50"
                        >
                          Edit cells
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {activeSelected.kind === 'local' && localPreviewLoading ? (
                    <p className="mt-4 text-sm text-[var(--ledger-text-muted)]">Loading preview…</p>
                  ) : activeSelected.kind === 'local' && localPreview?.kind === 'binary' ? (
                    <div className="mt-5 overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-white">
                      {localPreview.mimeType === 'application/pdf' ? (
                        <iframe
                          title={`Preview of ${activeSelected.file.name}`}
                          src={`${localPreview.fileUrl ?? localPreview.dataUrl}${
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
                            <LocalFileIcon extension={item.file.extension} size={16} className="text-[var(--ledger-accent)]" />
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
          !isRightPaneCollapsed ? (
            <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingRightPane(true);
              }}
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--ledger-surface-hover)] ${isResizingRightPane ? 'bg-[var(--ledger-border-strong)]' : ''}`}
              title="Drag to resize right panel"
            />
            <aside className={`ledger-pane-surface ledger-pane-right flex shrink-0 flex-col overflow-hidden border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] ${viewportWidth < modulePaneSizing.files.right.compactBreakpoint ? 'p-3' : 'p-4'}`} style={{ width: `${rightPaneWidth}px` }}>
              <div className="flex items-start justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] pb-4">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-nowrap text-xs font-medium text-[var(--ledger-text-muted)]">
                    Inspector
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                    {activeSelected.kind === 'local'
                      ? activeSelected.file.name
                      : referenceTitle(activeSelected.reference)}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--ledger-text-muted)]">
                    {activeSelected.kind === 'local'
                      ? `${activeSelected.file.extension.toUpperCase()} · On this device`
                      : providerLabel(activeSelected.reference.provider)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRightPaneCollapsed(true)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                  aria-label="Hide right panel"
                  title="Hide right panel"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="flex items-center border-b border-[color:var(--ledger-border-subtle)]">
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
                    {tab === 'details' ? 'Details' : 'Ask'}
                  </button>
                ))}
              </div>
              {inspectorTab === 'details' ? (
                <div className="divide-y divide-[color:var(--ledger-border-subtle)] text-xs">
                  <div className="py-4">
                    <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
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
                    <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                      Workspace
                    </p>
                    <p className="mt-2 text-[var(--ledger-text-primary)]">
                      {activeWorkspace?.name ?? 'Current workspace'}
                    </p>
                  </div>
                  <div className="py-4">
                    <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                      Used with
                    </p>
                    {linkedTargetDetailsLoading ? (
                      <div className="mt-2 space-y-2">
                        <SkeletonCompactRow />
                      </div>
                    ) : linkedTargetDetails.length ? (
                      <div className="mt-2 space-y-1">
                        {linkedTargetDetails.map((target) => (
                          <button
                            key={`${target.targetType}:${target.targetId}`}
                            type="button"
                            onClick={() => openLinkedTarget(target)}
                            disabled={target.targetType === 'ask_session'}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--ledger-surface-hover)] disabled:cursor-default disabled:hover:bg-transparent"
                            title={target.targetType === 'ask_session' ? 'Ask Ledger session' : `Open ${target.title}`}
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-[var(--ledger-text-primary)]">
                              {target.title}
                            </span>
                            <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
                              {linkedTargetLabel(target.targetType)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[var(--ledger-text-muted)]">Not linked to another Ledger item.</p>
                    )}
                  </div>
                  {activeSelected.kind === 'local' ? (
                    <button
                      type="button"
                      onClick={() => void removeSelectedLocalFile()}
                      disabled={busy !== null}
                      className="mt-4 flex h-8 w-fit items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-[var(--ledger-danger)] disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                      Remove local copy
                    </button>
                  ) : null}
                  {activeSelected.kind === 'local' && !editing && ['txt', 'md', 'csv'].includes(activeSelected.file.extension) ? (
                    <button
                      type="button"
                      onClick={() => void loadRevisions()}
                      className="mt-3 flex h-8 w-fit items-center rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs text-[var(--ledger-text-secondary)]"
                    >
                      History{revisions.length ? ` · ${revisions.length}` : ''}
                    </button>
                  ) : null}
                  {activeSelected.kind === 'local' && revisions.length > 0 ? (
                    <div className="mt-3 space-y-1 border-t border-[color:var(--ledger-border-subtle)] pt-3">
                      <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
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
                <div
                  key={`files-ask-${activeSelected.kind}:${
                    activeSelected.kind === 'local'
                      ? activeSelected.file.id
                      : activeSelected.reference.id
                  }`}
                  className="-mx-4 -mb-4 flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--ledger-surface-muted)] [&_.agent-ask-ledger-content]:gap-0 [&_.ask-ledger-composer]:min-h-[76px] [&_.ask-ledger-composer]:!rounded-none [&_.ask-ledger-composer]:px-3 [&_.ask-ledger-composer]:py-2 [&_textarea]:text-[13px] [&_textarea]:leading-5 [&_.ask-ledger-answer]:text-[13px]"
                >
                  {askSessionLoading ? (
                    <div className="flex flex-1 items-center justify-center p-4 text-xs text-[var(--ledger-text-muted)]">
                      Restoring this conversation…
                    </div>
                  ) : activeAskResource ? (
                    <AskLedgerPanel
                      workspaceId={activeWorkspaceId}
                      initialSession={askSession}
                      initialContext={{
                        resourceType: activeAskResource.resourceType,
                        resourceId: activeAskResource.resourceId,
                        title: activeAskResource.title,
                        workspaceId: activeWorkspaceId!,
                      }}
                      onSessionIdChange={(sessionId) => {
                        if (sessionId && activeAskResourceKey)
                          askSessionIdsRef.current.set(activeAskResourceKey, sessionId);
                      }}
                      onSessionSnapshot={setAskSession}
                      preferredGenerationTier="fast"
                      compact
                      hideModelSelector
                    />
                  ) : null}
                </div>
              )}
            </aside>
            </>
          ) : (
            <div className="ledger-pane-toggle ledger-pane-toggle-right absolute right-2 top-4 z-30">
              <button
                type="button"
                onClick={() => setIsRightPaneCollapsed(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                aria-label="Show right panel"
                title="Show right panel"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          )
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
      <ContextMenu
        open={Boolean(localFileContextMenu)}
        x={localFileContextMenu?.x ?? 0}
        y={localFileContextMenu?.y ?? 0}
        onClose={() => setLocalFileContextMenu(null)}
        ariaLabel="Local file actions"
        groups={[{
          items: [{
            id: 'remove-local-file',
            label: selectedLocalFiles.length > 1
              ? `Remove ${selectedLocalFiles.length} local copies`
              : 'Remove local copy',
            icon: <Trash2 size={14} />,
            destructive: true,
            onClick: () => {
              void removeLocalFiles(selectedLocalFiles);
            },
          }],
        }]}
      />
    </div>
  );
}
