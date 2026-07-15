import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Folder,
  Inbox,
  MoreHorizontal,
  MoreVertical,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../Common/ToastProvider';
import { useAuthContext } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import {
  modulePaneSizing,
  clampPaneWidth,
  getPaneWidthForViewport,
} from '../../config/modulePaneSizes';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { supabase } from '../../services/supabase';
import {
  ModuleHeaderActionButton,
  ModuleHeaderStatus,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { PinActionButton } from '../Common/PinActionButton';
import { SkeletonLoader, SkeletonNoteCard } from '../Common/Skeleton';
import { MindMapEditor } from './MindMapEditor';
import { RichTextEditor } from './RichTextEditor';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { useWorkspaceRouteHistory } from '../../hooks/useWorkspaceRouteHistory';
import { CreateNoteModal } from './CreateNoteModal';
import { BulkExportModal } from './BulkExportModal';
import { VersionHistoryModal } from './VersionHistoryModal';
import { bulkExportNotes, bulkExportMindMaps } from '../../utils/exportUtils';

type NoteRow = {
  id: string;
  workspace_id?: string;
  user_id?: string;
  updated_by?: string | null;
  title: string;
  content: string;
  date: string;
  mood: string | null;
  source: string;
  parent_id?: string | null;
  section_id?: string | null;
  sort_order?: number;
  depth?: number;
  color?: string | null;
  mode?: 'text' | 'mind_map';
  mind_map_structure?: unknown;
  created_at: string;
  updated_at: string;
};

type WorkspaceMember = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

type NoteVersion = {
  id: string;
  note_id: string;
  versioned_by?: string | null;
  reason?: string | null;
  title: string;
  content_html?: string | null;
  created_at: string;
};

type NoteTreeNode = NoteRow & {
  depth: number;
  children: NoteTreeNode[];
};

type NoteSection = {
  id: string;
  name: string;
  color: string;
  parent_id?: string | null;
  sort_order: number;
  collapsed: boolean;
};

type ProjectLinkCandidate = {
  id: string;
  name: string;
  status?: string | null;
  completeness?: number | null;
  end_date?: string | null;
};

type WorkspaceProjectNoteLink = {
  id: string;
  note_id: string;
  project_id: string;
  project_name: string;
  project_status?: string | null;
  project_completeness?: number | null;
  project_end_date?: string | null;
  created_at: string;
};

const POLL_INTERVAL_MS = 15000;
const NOTE_VIEWERS_POLL_MS = 30_000;
const LEFT_PANE_MIN_WIDTH = 260;
const LEFT_PANE_MAX_WIDTH = 380;
const RIGHT_PANE_MIN_WIDTH = 250;
const RIGHT_PANE_MAX_WIDTH = 360;
type NoteContextMenuState = {
  x: number;
  y: number;
  noteId: string;
};

type SectionContextMenuState = {
  x: number;
  y: number;
  sectionId: string;
  sectionName: string;
};

type NoteSortField = 'created' | 'modified' | 'opened' | 'name';
type NoteSortDirection = 'asc' | 'desc';
type NoteSortPreference = {
  field: NoteSortField;
  direction: NoteSortDirection;
};
type NoteSortPreferences = {
  root: NoteSortPreference | null;
  sections: Record<string, NoteSortPreference>;
};

type SortMenuState = {
  x: number;
  y: number;
  scopeId: string;
  scopeName: string;
};

const ROOT_NOTE_SCOPE_ID = '__root__';
const NOTE_SORT_STORAGE_PREFIX = 'notes-sort-preferences:v1';
const NOTE_LAST_OPENED_STORAGE_PREFIX = 'notes-last-opened:v1';
const NOTE_LAST_SELECTED_STORAGE_PREFIX = 'notes-last-selected:v1';

const todayKey = () => new Date().toISOString().slice(0, 10);

const htmlToPlainText = (value: string) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeEditorHtml = (value: string) => {
  const trimmed = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!trimmed || trimmed === '<p><br></p>' || trimmed === '<p></p>') {
    return '<p></p>';
  }
  return String(value ?? '');
};

type SpellcheckAutocorrectResult = {
  title: string;
  content_html: string;
  count: number;
};

const autocorrectNoteContent = async (title: string, contentHtml: string) => {
  return window.ipcRenderer.invoke('spellcheck:autocorrect-note', {
    title,
    content_html: contentHtml,
  }) as Promise<SpellcheckAutocorrectResult>;
};

const wordCount = (text: string) =>
  htmlToPlainText(text).trim().split(/\s+/).filter(Boolean).length;

const validSectionColors = [
  'blue',
  'orange',
  'purple',
  'green',
  'pink',
  'gray',
  'red',
  'amber',
  'teal',
  'cyan',
  'indigo',
  'violet',
  'emerald',
  'rose',
  'slate',
] as const;
type ValidSectionColor = (typeof validSectionColors)[number];

const normalizeSectionColor = (color: string | null | undefined): ValidSectionColor => {
  if (!color) return 'gray';
  return (validSectionColors as readonly string[]).includes(color)
    ? (color as ValidSectionColor)
    : 'gray';
};

const getColorClasses = (color: string) => {
  const normalizedColor = normalizeSectionColor(color);
  const colorMap: Record<string, { dot: string; text: string; bg: string; border: string }> = {
    blue: {
      dot: 'bg-blue-500',
      text: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-l-2 border-blue-400',
    },
    orange: {
      dot: 'bg-orange-500',
      text: 'text-orange-600',
      bg: 'bg-orange-50',
      border: 'border-l-2 border-orange-400',
    },
    purple: {
      dot: 'bg-purple-500',
      text: 'text-purple-600',
      bg: 'bg-purple-50',
      border: 'border-l-2 border-purple-400',
    },
    green: {
      dot: 'bg-green-500',
      text: 'text-green-600',
      bg: 'bg-green-50',
      border: 'border-l-2 border-green-400',
    },
    pink: {
      dot: 'bg-pink-500',
      text: 'text-pink-600',
      bg: 'bg-pink-50',
      border: 'border-l-2 border-pink-400',
    },
    red: {
      dot: 'bg-red-500',
      text: 'text-red-600',
      bg: 'bg-red-50',
      border: 'border-l-2 border-red-400',
    },
    amber: {
      dot: 'bg-amber-500',
      text: 'text-amber-600',
      bg: 'bg-amber-50',
      border: 'border-l-2 border-amber-400',
    },
    teal: {
      dot: 'bg-teal-500',
      text: 'text-teal-600',
      bg: 'bg-teal-50',
      border: 'border-l-2 border-teal-400',
    },
    cyan: {
      dot: 'bg-cyan-500',
      text: 'text-cyan-600',
      bg: 'bg-cyan-50',
      border: 'border-l-2 border-cyan-400',
    },
    indigo: {
      dot: 'bg-indigo-500',
      text: 'text-indigo-600',
      bg: 'bg-indigo-50',
      border: 'border-l-2 border-indigo-400',
    },
    violet: {
      dot: 'bg-violet-500',
      text: 'text-violet-600',
      bg: 'bg-violet-50',
      border: 'border-l-2 border-violet-400',
    },
    emerald: {
      dot: 'bg-emerald-500',
      text: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-l-2 border-emerald-400',
    },
    rose: {
      dot: 'bg-rose-500',
      text: 'text-rose-600',
      bg: 'bg-rose-50',
      border: 'border-l-2 border-rose-400',
    },
    slate: {
      dot: 'bg-slate-500',
      text: 'text-slate-600',
      bg: 'bg-slate-50',
      border: 'border-l-2 border-slate-400',
    },
    gray: {
      dot: 'bg-[var(--ledger-text-muted)]',
      text: 'text-[var(--ledger-text-secondary)]',
      bg: 'bg-[var(--ledger-surface-muted)]',
      border: 'border-l-2 border-[color:var(--ledger-border-subtle)]',
    },
  };
  return colorMap[normalizedColor] || colorMap.gray;
};

const sectionColorOptions: Array<NoteSection['color']> = [
  'gray',
  'blue',
  'green',
  'purple',
  'pink',
  'red',
  'amber',
  'teal',
  'indigo',
  'emerald',
  'slate',
  'orange',
];

const formatCompactDateTime = (value: string) =>
  new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatSavedStatus = (savedAt: string | null, isSaving: boolean, isDirty: boolean) => {
  if (isSaving) return 'Saving...';
  if (!savedAt) return isDirty ? 'Unsaved' : 'Saved';

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(savedAt).getTime()) / 1000));
  if (elapsedSeconds < 2) return 'Saved';
  if (elapsedSeconds < 60) return `Saved ${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Saved ${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Saved ${elapsedHours}h ago`;
};

const formatRelativeFromNow = (value: string | null | undefined) => {
  if (!value) return 'just now';
  const delta = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (delta < 60) return `${delta}s ago`;
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const displayUserName = (member: WorkspaceMember | null | undefined) => {
  if (!member) return 'Unknown user';
  return member.full_name?.trim() || member.email?.trim() || 'Unknown user';
};

const displayFirstName = (value: string) => {
  const firstName = value.trim().split(/\s+/)[0] ?? '';
  return firstName || value.trim() || 'Unknown';
};

const InspectorInfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="py-1">
    <p className="text-[11px] text-[var(--ledger-text-muted)]">{label}</p>
    <p className="mt-0.5 text-sm font-medium text-[var(--ledger-text-primary)] wrap-break-word">
      {value}
    </p>
  </div>
);

const toNonNegativeInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const loadWorkspaceScopedJson = <T,>(storageKey: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return fallback;
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
};

const getNotesSortStorageKey = (workspaceId?: string | null) =>
  `${NOTE_SORT_STORAGE_PREFIX}:${workspaceId ?? 'default'}`;

const getLastOpenedStorageKey = (workspaceId?: string | null) =>
  `${NOTE_LAST_OPENED_STORAGE_PREFIX}:${workspaceId ?? 'default'}`;

const getLastSelectedStorageKey = (workspaceId?: string | null) =>
  `${NOTE_LAST_SELECTED_STORAGE_PREFIX}:${workspaceId ?? 'default'}`;

const normalizeNoteSortPreference = (value: unknown): NoteSortPreference | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<NoteSortPreference>;
  if (!['created', 'modified', 'opened', 'name'].includes(String(candidate.field))) return null;
  if (!['asc', 'desc'].includes(String(candidate.direction))) return null;
  return {
    field: candidate.field as NoteSortField,
    direction: candidate.direction as NoteSortDirection,
  };
};

const loadNoteSortPreferences = (workspaceId?: string | null): NoteSortPreferences => {
  const fallback: NoteSortPreferences = { root: null, sections: {} };
  const stored = loadWorkspaceScopedJson<unknown>(getNotesSortStorageKey(workspaceId), fallback);
  if (!stored || typeof stored !== 'object') return fallback;

  const candidate = stored as {
    root?: unknown;
    sections?: Record<string, unknown>;
  };

  const sections: Record<string, NoteSortPreference> = {};
  for (const [scopeId, pref] of Object.entries(candidate.sections ?? {})) {
    const normalized = normalizeNoteSortPreference(pref);
    if (normalized) sections[scopeId] = normalized;
  }

  return {
    root: normalizeNoteSortPreference(candidate.root),
    sections,
  };
};

const loadLastOpenedAtById = (workspaceId?: string | null) => {
  const stored = loadWorkspaceScopedJson<Record<string, number>>(
    getLastOpenedStorageKey(workspaceId),
    {}
  );
  const entries = Object.entries(stored ?? {}).filter(([, value]) =>
    Number.isFinite(Number(value))
  );
  return Object.fromEntries(entries.map(([id, value]) => [id, Number(value)]));
};

const loadLastSelectedNoteId = (workspaceId?: string | null) => {
  try {
    const stored = localStorage.getItem(getLastSelectedStorageKey(workspaceId));
    return stored?.trim() ? stored : null;
  } catch {
    return null;
  }
};

const formatNoteSortLabel = (pref: NoteSortPreference | null) => {
  if (!pref) return 'Folder order';

  const labelMap: Record<NoteSortField, string> = {
    created: 'Created',
    modified: 'Last modified',
    opened: 'Last opened',
    name: 'Name',
  };

  const directionLabel =
    pref.direction === 'asc'
      ? pref.field === 'name'
        ? 'A-Z'
        : 'Oldest first'
      : pref.field === 'name'
      ? 'Z-A'
      : 'Newest first';

  return `${labelMap[pref.field]} · ${directionLabel}`;
};

const NOTE_SORT_OPTIONS: Array<{ label: string; preference: NoteSortPreference | null }> = [
  { label: 'Folder order', preference: null },
  { label: 'Created · newest first', preference: { field: 'created', direction: 'desc' } },
  { label: 'Created · oldest first', preference: { field: 'created', direction: 'asc' } },
  { label: 'Last modified · newest first', preference: { field: 'modified', direction: 'desc' } },
  { label: 'Last modified · oldest first', preference: { field: 'modified', direction: 'asc' } },
  { label: 'Last opened · newest first', preference: { field: 'opened', direction: 'desc' } },
  { label: 'Last opened · oldest first', preference: { field: 'opened', direction: 'asc' } },
  { label: 'Name · A-Z', preference: { field: 'name', direction: 'asc' } },
  { label: 'Name · Z-A', preference: { field: 'name', direction: 'desc' } },
];

const removeNoteFromTree = (nodes: NoteTreeNode[], noteId: string): NoteTreeNode[] => {
  return nodes
    .filter((node) => node.id !== noteId)
    .map((node) => ({
      ...node,
      children: removeNoteFromTree(node.children ?? [], noteId),
    }));
};

const replaceNoteInTree = (nodes: NoteTreeNode[], updated: NoteRow): NoteTreeNode[] => {
  return nodes.map((node) => {
    if (node.id === updated.id) {
      return {
        ...node,
        ...updated,
        children: node.children ?? [],
      };
    }

    if (node.children?.length) {
      return {
        ...node,
        children: replaceNoteInTree(node.children, updated),
      };
    }

    return node;
  });
};

const insertChildIntoTree = (
  nodes: NoteTreeNode[],
  parentId: string,
  child: NoteTreeNode
): NoteTreeNode[] => {
  return nodes.map((node) => {
    if (node.id === parentId) {
      return {
        ...node,
        children: [...(node.children ?? []), child],
      };
    }
    if (node.children?.length) {
      return {
        ...node,
        children: insertChildIntoTree(node.children, parentId, child),
      };
    }
    return node;
  });
};

const insertRootIntoTree = (nodes: NoteTreeNode[], child: NoteTreeNode): NoteTreeNode[] => [
  child,
  ...nodes,
];

const getDropPreviewClasses = (
  preview: { targetId: string; position: 'inside' | 'before' | 'after' } | null,
  targetId: string
) => {
  if (!preview || preview.targetId !== targetId) return '';
  if (preview.position === 'inside')
    return 'bg-[var(--ledger-surface-hover)] border-l-[color:var(--ledger-border-strong)]';
  if (preview.position === 'before') return 'border-t border-[color:var(--ledger-border-subtle)]';
  return 'border-b border-[color:var(--ledger-border-subtle)]';
};

export const NotesWindow = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const { workspaceShellLayout } = useSidebar();
  const api = useApi();
  const viewportWidth = useViewportWidth();
  const initialFocusNoteId = new URLSearchParams(window.location.search).get('focusNoteId');
  const titleRef = useRef<HTMLInputElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const savingIndicatorTimerRef = useRef<number | null>(null);
  const isEditingRef = useRef(false);
  const isDirtyRef = useRef(false);
  const hydrationNoteIdRef = useRef<string | null>(null);
  const selectionAnchorNoteIdRef = useRef<string | null>(null);
  const bulkSidebarSelectionRef = useRef(false);
  const selectedNoteIdRef = useRef<string | null>(null);
  const selectedNoteIdsRef = useRef<string[]>([]);
  const selectedNoteServerUpdatedAtRef = useRef<string | null>(null);
  const selectedNoteServerUpdatedByRef = useRef<string | null>(null);
  const remoteNoteUpdateToastIdRef = useRef<string | null>(null);
  const remoteNoteUpdatePendingRef = useRef(false);

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([]);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(initialFocusNoteId);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftDate, setDraftDate] = useState(todayKey());
  const [draftMood, setDraftMood] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [showSavingIndicator, setShowSavingIndicator] = useState(false);
  const [isHydratingNote, setIsHydratingNote] = useState(false);
  const [hasHydratedNote, setHasHydratedNote] = useState(false);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveStatusTick, setSaveStatusTick] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportNoteIds, setExportNoteIds] = useState<string[] | null>(null);
  const [showVersionHistoryModal, setShowVersionHistoryModal] = useState(false);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isRestoringVersionId, setIsRestoringVersionId] = useState<string | null>(null);
  const [noteVersions, setNoteVersions] = useState<NoteVersion[]>([]);
  const sessionCheckpointMapRef = useRef<Map<string, boolean>>(new Map());
  const lastAutosaveCheckpointRef = useRef<Map<string, number>>(new Map());
  const [editorRefreshTick, setEditorRefreshTick] = useState(0);
  const [exportType, setExportType] = useState<'notes' | 'mindmaps'>('notes');
  const [noteCreationSectionId, setNoteCreationSectionId] = useState<string | null>(null);
  const [showNewSectionPrompt, setShowNewSectionPrompt] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.notes.left)
  );
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.notes.right)
  );
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(true);
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [noteContextMenu, setNoteContextMenu] = useState<NoteContextMenuState | null>(null);
  const [sectionContextMenu, setSectionContextMenu] = useState<SectionContextMenuState | null>(
    null
  );
  const [sortMenu, setSortMenu] = useState<SortMenuState | null>(null);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renamingSectionDraft, setRenamingSectionDraft] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [isInspectorActionsOpen, setIsInspectorActionsOpen] = useState(false);
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [sectionDropTargetId, setSectionDropTargetId] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<{
    targetId: string;
    position: 'inside' | 'before' | 'after';
  } | null>(null);
  const [draftMode, setDraftMode] = useState<'text' | 'mind_map'>('text');
  const [draftMindMapStructure, setDraftMindMapStructure] = useState<unknown>(null);
  const [isMindMapFullscreen, setIsMindMapFullscreen] = useState(false);
  const [isNoteActionsOpen, setIsNoteActionsOpen] = useState(false);
  const [isTemplatesExpanded, setIsTemplatesExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('notes-templates-expanded');
      return stored !== null ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });
  const [sections, setSections] = useState<NoteSection[]>(() => {
    try {
      const stored = localStorage.getItem('notes-sections');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    return [];
  });
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('notes-sections-collapsed');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set();
    }
  });
  const noteActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const inspectorActionsRef = useRef<HTMLDivElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameSectionInputRef = useRef<HTMLInputElement | null>(null);
  const [noteSortPreferences, setNoteSortPreferences] = useState<NoteSortPreferences>(() =>
    loadNoteSortPreferences(activeWorkspaceId)
  );
  const didRestoreInitialSelectionRef = useRef(false);
  const didApplyInitialFocusRef = useRef(false);
  const [lastOpenedAtById, setLastOpenedAtById] = useState<Record<string, number>>(() =>
    loadLastOpenedAtById(activeWorkspaceId)
  );
  const [workspaceTemplates, setWorkspaceTemplates] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [workspaceProjectNoteLinks, setWorkspaceProjectNoteLinks] = useState<
    WorkspaceProjectNoteLink[]
  >([]);
  const [isLinkProjectModalOpen, setIsLinkProjectModalOpen] = useState(false);
  const [linkProjectTargetNoteId, setLinkProjectTargetNoteId] = useState<string | null>(null);
  const [linkableProjects, setLinkableProjects] = useState<ProjectLinkCandidate[]>([]);
  const [isLoadingLinkableProjects, setIsLoadingLinkableProjects] = useState(false);
  const [linkProjectSearch, setLinkProjectSearch] = useState('');
  const toast = useToast();
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const quickTemplates = [
    { id: 'meeting-notes', name: 'Meeting Notes' },
    { id: 'project-brief', name: 'Project Brief' },
    { id: 'daily-reflection', name: 'Daily Reflection' },
    { id: 'book-notes', name: 'Book Notes' },
  ];
  const quickTemplateFallbacks: Record<string, { content: string; content_html: string }> = {
    'meeting notes': {
      content: 'Date\nAttendees\nAgenda\nDiscussion\nAction items',
      content_html: '<p>Date</p><p>Attendees</p><p>Agenda</p><p>Discussion</p><p>Action items</p>',
    },
    'project brief': {
      content: 'Project\nOwner\nDue\nObjective\nSuccess criteria',
      content_html: '<p>Project</p><p>Owner</p><p>Due</p><p>Objective</p><p>Success criteria</p>',
    },
    'daily reflection': {
      content: "Wins\nLessons\nBlockers\nTomorrow's focus\nMood",
      content_html: "<p>Wins</p><p>Lessons</p><p>Blockers</p><p>Tomorrow's focus</p><p>Mood</p>",
    },
    'book notes': {
      content: 'Title\nAuthor\nSummary\nKey takeaways\nQuotes',
      content_html: '<p>Title</p><p>Author</p><p>Summary</p><p>Key takeaways</p><p>Quotes</p>',
    },
  };

  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed;
  const isCompactLayout = viewportWidth < modulePaneSizing.notes.left.compactBreakpoint;

  useEffect(() => {
    const onHideSidePanelsShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() !== 'h') return;

      event.preventDefault();
      if (areSidePanelsCollapsed) {
        setIsLeftPaneCollapsed(false);
        setIsRightPaneCollapsed(false);
      } else {
        setIsLeftPaneCollapsed(true);
        setIsRightPaneCollapsed(true);
      }
    };

    window.addEventListener('keydown', onHideSidePanelsShortcut);
    return () => window.removeEventListener('keydown', onHideSidePanelsShortcut);
  }, [areSidePanelsCollapsed]);

  useEffect(() => {
    setNoteSortPreferences(loadNoteSortPreferences(activeWorkspaceId));
    setLastOpenedAtById(loadLastOpenedAtById(activeWorkspaceId));
    setSelectedNoteId(null);
    setSelectedNoteIds([]);
    selectionAnchorNoteIdRef.current = null;
    didRestoreInitialSelectionRef.current = false;
    didApplyInitialFocusRef.current = false;
  }, [activeWorkspaceId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getNotesSortStorageKey(activeWorkspaceId),
        JSON.stringify(noteSortPreferences)
      );
    } catch (error) {
      console.error('Failed to save notes sort preference:', error);
    }
  }, [activeWorkspaceId, noteSortPreferences]);

  useEffect(() => {
    try {
      localStorage.setItem(
        getLastOpenedStorageKey(activeWorkspaceId),
        JSON.stringify(lastOpenedAtById)
      );
    } catch (error) {
      console.error('Failed to save notes last opened state:', error);
    }
  }, [activeWorkspaceId, lastOpenedAtById]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );
  const selectedNoteIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);
  const selectedNoteProjectLinks = useMemo(() => {
    if (!selectedNoteId) return [];
    const seen = new Set<string>();
    return workspaceProjectNoteLinks.filter((link) => {
      if (link.note_id !== selectedNoteId) return false;
      if (seen.has(link.project_id)) return false;
      seen.add(link.project_id);
      return true;
    });
  }, [selectedNoteId, workspaceProjectNoteLinks]);

  const openLinkProjectModal = useCallback(
    async (noteId: string | null = selectedNoteId) => {
      if (!noteId) return;

      setNoteContextMenu(null);
      setIsNoteActionsOpen(false);
      setIsInspectorActionsOpen(false);
      setLinkProjectTargetNoteId(noteId);
      setLinkProjectSearch('');
      setIsLinkProjectModalOpen(true);
      setIsLoadingLinkableProjects(true);

      try {
        const projectsPayload = await api.getProjects();
        const projects = Array.isArray(projectsPayload)
          ? (projectsPayload as ProjectLinkCandidate[])
          : [];
        setLinkableProjects(
          projects.filter((project) => {
            const status = String(project.status ?? '').toLowerCase();
            return status !== 'completed' && status !== 'paused' && status !== 'archived';
          })
        );
      } catch (error) {
        console.error('Failed to load linkable projects:', error);
        setLinkableProjects([]);
      } finally {
        setIsLoadingLinkableProjects(false);
      }
    },
    [api, selectedNoteId]
  );

  const linkNoteToProject = useCallback(
    async (projectId: string) => {
      const noteId = linkProjectTargetNoteId ?? selectedNoteId;
      if (!noteId) return;

      try {
        await api.linkProjectNote(projectId, noteId);
        if (activeWorkspaceId) {
          try {
            const payload = (await api.getWorkspaceProjectNoteLinks(activeWorkspaceId)) as
              | { links?: WorkspaceProjectNoteLink[] }
              | WorkspaceProjectNoteLink[]
              | null;
            const links = Array.isArray(payload)
              ? payload
              : Array.isArray(payload?.links)
              ? payload.links
              : [];
            setWorkspaceProjectNoteLinks(
              links
                .filter((link) => link.note_id && link.project_id && link.project_name)
                .map((link) => ({
                  id: link.id,
                  note_id: link.note_id,
                  project_id: link.project_id,
                  project_name: link.project_name,
                  project_status: link.project_status ?? null,
                  project_completeness:
                    typeof link.project_completeness === 'number'
                      ? link.project_completeness
                      : null,
                  project_end_date: link.project_end_date ?? null,
                  created_at: link.created_at,
                }))
            );
          } catch (refreshError) {
            console.error('Failed to refresh project links after linking note:', refreshError);
          }
        }
        toast.show('Linked to project', {
          detail: 'The note is now connected to the selected project.',
          variant: 'success',
        });
        setIsLinkProjectModalOpen(false);
        setLinkProjectTargetNoteId(null);
      } catch (error) {
        console.error('Failed to link note to project:', error);
        toast.show(error instanceof Error ? error.message : 'Could not link note', {
          variant: 'error',
        });
      }
    },
    [activeWorkspaceId, api, linkProjectTargetNoteId, selectedNoteId, toast]
  );

  const filteredLinkableProjects = useMemo(() => {
    const query = linkProjectSearch.trim().toLowerCase();
    if (!query) return linkableProjects;
    return linkableProjects.filter((project) => {
      const haystack = `${project.name} ${project.status ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [linkProjectSearch, linkableProjects]);

  const getSortPreferenceForScope = useCallback(
    (scopeId: string) => {
      if (scopeId !== ROOT_NOTE_SCOPE_ID && noteSortPreferences.sections[scopeId]) {
        return noteSortPreferences.sections[scopeId];
      }
      return noteSortPreferences.root;
    },
    [noteSortPreferences]
  );

  const setSortPreferenceForScope = useCallback(
    (scopeId: string, preference: NoteSortPreference | null) => {
      setSortMenu(null);
      setSectionContextMenu(null);
      setNoteSortPreferences((current) => {
        if (scopeId === ROOT_NOTE_SCOPE_ID) {
          return { ...current, root: preference };
        }

        const nextSections = { ...current.sections };
        if (preference) nextSections[scopeId] = preference;
        else delete nextSections[scopeId];

        return { ...current, sections: nextSections };
      });
    },
    []
  );

  const recordNoteOpened = useCallback((noteId: string) => {
    const openedAt = Date.now();
    setLastOpenedAtById((current) => ({
      ...current,
      [noteId]: openedAt,
    }));
  }, []);

  const sortNotesForScope = useCallback(
    (items: NoteRow[], scopeId: string) => {
      const preference = getSortPreferenceForScope(scopeId);
      if (!preference) {
        return [...items].sort((left, right) => {
          const orderDiff = toNonNegativeInt(left.sort_order) - toNonNegativeInt(right.sort_order);
          if (orderDiff !== 0) return orderDiff;
          const dateDiff =
            new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
          if (dateDiff !== 0) return dateDiff;
          return String(left.title ?? '').localeCompare(String(right.title ?? ''));
        });
      }

      const getComparableValue = (note: NoteRow) => {
        if (preference.field === 'created') return new Date(note.created_at).getTime();
        if (preference.field === 'modified') return new Date(note.updated_at).getTime();
        if (preference.field === 'opened') return lastOpenedAtById[note.id] ?? 0;
        return String(note.title ?? '')
          .trim()
          .toLowerCase();
      };

      return [...items].sort((left, right) => {
        const leftValue = getComparableValue(left);
        const rightValue = getComparableValue(right);

        if (preference.field === 'name') {
          const nameDiff = String(leftValue).localeCompare(String(rightValue));
          if (nameDiff !== 0) {
            return preference.direction === 'asc' ? nameDiff : -nameDiff;
          }
        } else {
          const leftTime = Number(leftValue);
          const rightTime = Number(rightValue);
          const timeDiff = leftTime - rightTime;
          if (timeDiff !== 0) {
            return preference.direction === 'asc' ? timeDiff : -timeDiff;
          }
        }

        const orderDiff = toNonNegativeInt(left.sort_order) - toNonNegativeInt(right.sort_order);
        if (orderDiff !== 0) return orderDiff;
        return String(left.title ?? '').localeCompare(String(right.title ?? ''));
      });
    },
    [getSortPreferenceForScope, lastOpenedAtById]
  );

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  useWorkspaceRouteHistory(
    {
      kind: 'notes',
      focusNoteId: selectedNoteId,
    },
    true
  );

  useEffect(() => {
    try {
      const storageKey = getLastSelectedStorageKey(activeWorkspaceId);
      if (selectedNoteId) {
        localStorage.setItem(storageKey, selectedNoteId);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error('Failed to save last selected note:', error);
    }
  }, [activeWorkspaceId, selectedNoteId]);

  useEffect(() => {
    selectedNoteIdsRef.current = selectedNoteIds;
    bulkSidebarSelectionRef.current = selectedNoteIds.length > 1;
  }, [selectedNoteIds]);

  useEffect(() => {
    if (!user) {
      setInboxCount(0);
      return;
    }

    let cancelled = false;
    const loadInboxCount = async () => {
      try {
        const payload = (await api.getInboxCount()) as { count?: number };
        if (!cancelled) {
          setInboxCount(Math.max(0, Number(payload?.count ?? 0)));
        }
      } catch {
        if (!cancelled) setInboxCount(0);
      }
    };

    void loadInboxCount();

    const handleRefreshInboxCount = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void loadInboxCount();
    };

    const handleInboxItemsUpdated = (_event: unknown, payload?: { delta?: number }) => {
      if (typeof payload?.delta === 'number' && Number.isFinite(payload.delta)) {
        setInboxCount((current) => Math.max(0, current + payload.delta!));
        return;
      }

      void loadInboxCount();
    };

    window.ipcRenderer?.on('inbox:items-updated', handleInboxItemsUpdated);
    window.addEventListener('focus', handleRefreshInboxCount);
    document.addEventListener('visibilitychange', handleRefreshInboxCount);

    const timer = window.setInterval(() => {
      void loadInboxCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.ipcRenderer?.off('inbox:items-updated', handleInboxItemsUpdated);
      window.removeEventListener('focus', handleRefreshInboxCount);
      document.removeEventListener('visibilitychange', handleRefreshInboxCount);
    };
  }, [api, user]);

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }

    let cancelled = false;
    const loadNotificationCount = async () => {
      try {
        const payload = (await api.getNotificationCenterSummary()) as {
          counts?: { active?: number };
        };
        if (!cancelled) {
          setNotificationCount(Number(payload?.counts?.active ?? 0));
        }
      } catch {
        if (!cancelled) setNotificationCount(0);
      }
    };

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ activeCount?: number }>).detail;
      setNotificationCount(Number(detail?.activeCount ?? 0));
    };

    void loadNotificationCount();
    window.addEventListener(
      'ledger:notifications-summary',
      handleNotificationsSummary as EventListener
    );

    const timer = window.setInterval(() => {
      void loadNotificationCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(
        'ledger:notifications-summary',
        handleNotificationsSummary as EventListener
      );
    };
  }, [api, user]);

  const notesRef = useRef<NoteRow[]>(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const exitMindMapFullscreen = useCallback(() => {
    setIsMindMapFullscreen(false);
  }, []);

  const beginInlineRename = useCallback(
    (noteId: string) => {
      const note = notes.find((item) => item.id === noteId);
      if (!note) return;

      setRenamingNoteId(noteId);
      setRenameDraft(note.title || '');
      window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    },
    [notes]
  );

  const cancelInlineRename = useCallback(() => {
    setRenamingNoteId(null);
    setRenameDraft('');
  }, []);

  const beginInlineSectionRename = useCallback(
    (sectionId: string) => {
      const target = sections.find((section) => section.id === sectionId);
      if (!target) return;
      setRenamingSectionId(sectionId);
      setRenamingSectionDraft(target.name || 'Untitled folder');
      setSectionContextMenu(null);
      window.setTimeout(() => {
        renameSectionInputRef.current?.focus();
        renameSectionInputRef.current?.select();
      }, 0);
    },
    [sections]
  );

  const cancelInlineSectionRename = useCallback(() => {
    setRenamingSectionId(null);
    setRenamingSectionDraft('');
  }, []);

  const commitInlineRename = useCallback(async () => {
    if (!renamingNoteId) return;

    const trimmed = renameDraft.trim() || 'Untitled note';
    const existing = notes.find((item) => item.id === renamingNoteId);
    if (!existing) {
      cancelInlineRename();
      return;
    }
    if (trimmed === (existing.title || 'Untitled note')) {
      cancelInlineRename();
      return;
    }

    setNotes((prev) =>
      prev.map((item) => (item.id === renamingNoteId ? { ...item, title: trimmed } : item))
    );
    if (selectedNoteId === renamingNoteId) {
      setDraftTitle(trimmed);
    }

    try {
      const updated = (await api.updateNote(renamingNoteId, { title: trimmed })) as NoteRow;
      setNotes((prev) => prev.map((item) => (item.id === renamingNoteId ? updated : item)));
      setLastSavedAt(updated.updated_at);
      if (selectedNoteId === renamingNoteId) {
        setDraftTitle(updated.title || trimmed);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not rename note.');
      setNotes((prev) => prev.map((item) => (item.id === renamingNoteId ? existing : item)));
      if (selectedNoteId === renamingNoteId) {
        setDraftTitle(existing.title || '');
      }
    } finally {
      cancelInlineRename();
    }
  }, [api, cancelInlineRename, notes, renameDraft, renamingNoteId, selectedNoteId]);

  const commitInlineSectionRename = useCallback(async () => {
    if (!renamingSectionId) return;

    const trimmed = renamingSectionDraft.trim() || 'Untitled folder';
    const existing = sections.find((item) => item.id === renamingSectionId);
    if (!existing) {
      cancelInlineSectionRename();
      return;
    }
    if (trimmed === (existing.name || 'Untitled folder')) {
      cancelInlineSectionRename();
      return;
    }

    setSections((prev) =>
      prev.map((item) => (item.id === renamingSectionId ? { ...item, name: trimmed } : item))
    );

    try {
      const updated = (await api.updateSection(renamingSectionId, {
        name: trimmed,
      })) as NoteSection;
      setSections((prev) =>
        prev.map((item) => (item.id === renamingSectionId ? { ...item, ...updated } : item))
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not rename folder.');
      setSections((prev) => prev.map((item) => (item.id === renamingSectionId ? existing : item)));
    } finally {
      cancelInlineSectionRename();
    }
  }, [api, cancelInlineSectionRename, renamingSectionDraft, renamingSectionId, sections]);

  const visibleNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return notes;

    const filtered = notes.filter((note) => {
      const haystack = [note.title, htmlToPlainText(note.content), note.mood ?? '', note.date]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
    return sortNotesForScope(filtered, ROOT_NOTE_SCOPE_ID);
  }, [notes, search, sortNotesForScope]);

  const sectionDepthById = useMemo(() => {
    const depthById = new Map<string, number>();
    const byId = new Map(sections.map((section) => [section.id, section]));

    const resolveDepth = (sectionId: string, seen = new Set<string>()): number => {
      if (depthById.has(sectionId)) return depthById.get(sectionId) ?? 0;
      if (seen.has(sectionId)) return 0;
      seen.add(sectionId);
      const section = byId.get(sectionId);
      if (!section?.parent_id) {
        depthById.set(sectionId, 0);
        return 0;
      }
      const depth = 1 + resolveDepth(section.parent_id, seen);
      depthById.set(sectionId, Math.min(depth, 6));
      return depthById.get(sectionId) ?? 0;
    };

    for (const section of sections) {
      resolveDepth(section.id);
    }
    return depthById;
  }, [sections]);

  const orderedSections = useMemo(() => {
    const roots = sections
      .filter((section) => !section.parent_id)
      .sort((left, right) => left.sort_order - right.sort_order);

    const byParent = new Map<string, NoteSection[]>();
    for (const section of sections) {
      if (!section.parent_id) continue;
      const bucket = byParent.get(section.parent_id) ?? [];
      bucket.push(section);
      byParent.set(section.parent_id, bucket);
    }
    for (const bucket of byParent.values()) {
      bucket.sort((left, right) => left.sort_order - right.sort_order);
    }

    const result: NoteSection[] = [];
    const walk = (section: NoteSection) => {
      result.push(section);
      const children = byParent.get(section.id) ?? [];
      for (const child of children) walk(child);
    };
    for (const root of roots) walk(root);
    return result;
  }, [sections]);

  const visibleSections = useMemo(() => {
    if (!orderedSections.length) return orderedSections;
    const byId = new Map(orderedSections.map((section) => [section.id, section]));
    return orderedSections.filter((section) => {
      let cursor = section.parent_id ? byId.get(section.parent_id) ?? null : null;
      while (cursor) {
        if (collapsedSectionIds.has(cursor.id)) return false;
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) ?? null : null;
      }
      return true;
    });
  }, [collapsedSectionIds, orderedSections]);

  const sectionNoteCountById = useMemo(() => {
    if (!sections.length) return new Map<string, number>();

    const childrenByParent = new Map<string, string[]>();
    for (const section of sections) {
      if (!section.parent_id) continue;
      const bucket = childrenByParent.get(section.parent_id) ?? [];
      bucket.push(section.id);
      childrenByParent.set(section.parent_id, bucket);
    }

    const directCount = new Map<string, number>();
    for (const note of notes) {
      if (!note.section_id) continue;
      directCount.set(note.section_id, (directCount.get(note.section_id) ?? 0) + 1);
    }

    const totalCount = new Map<string, number>();
    const memo = new Map<string, number>();
    const countRecursive = (sectionId: string): number => {
      if (memo.has(sectionId)) return memo.get(sectionId) ?? 0;
      const own = directCount.get(sectionId) ?? 0;
      const children = childrenByParent.get(sectionId) ?? [];
      const childTotal = children.reduce((sum, childId) => sum + countRecursive(childId), 0);
      const total = own + childTotal;
      memo.set(sectionId, total);
      return total;
    };

    for (const section of sections) {
      totalCount.set(section.id, countRecursive(section.id));
    }
    return totalCount;
  }, [notes, sections]);

  const visibleNoteOrder = useMemo(() => {
    if (search.trim()) {
      return visibleNotes.map((note) => note.id);
    }

    const ordered: string[] = [];
    const visited = new Set<string>();
    const visibleSectionIds = new Set(visibleSections.map((section) => section.id));

    const pushNote = (note: NoteRow, scopeId: string) => {
      if (visited.has(note.id)) return;
      visited.add(note.id);
      ordered.push(note.id);

      if (!expandedNoteIds.has(note.id)) return;
      const children = sortNotesForScope(
        notes.filter((child) => child.parent_id === note.id),
        scopeId
      );
      for (const child of children) pushNote(child, scopeId);
    };

    for (const section of orderedSections) {
      if (!visibleSectionIds.has(section.id)) continue;
      const sectionRoots = sortNotesForScope(
        notes.filter((note) => note.section_id === section.id && !note.parent_id),
        section.id
      );
      for (const root of sectionRoots) pushNote(root, section.id);
    }

    const unsortedRoots = sortNotesForScope(
      notes.filter((note) => !note.section_id && !note.parent_id),
      ROOT_NOTE_SCOPE_ID
    );
    for (const root of unsortedRoots) pushNote(root, ROOT_NOTE_SCOPE_ID);

    return ordered;
  }, [
    expandedNoteIds,
    notes,
    orderedSections,
    search,
    sortNotesForScope,
    visibleNotes,
    visibleSections,
  ]);

  const applySidebarSelection = useCallback(
    (noteId: string, modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
      const orderedIds = visibleNoteOrder;
      const currentAnchor = selectionAnchorNoteIdRef.current ?? selectedNoteIdRef.current ?? noteId;
      const isToggle = Boolean(modifiers?.metaKey || modifiers?.ctrlKey);
      const isRange = Boolean(modifiers?.shiftKey);

      if (isRange && orderedIds.length > 0) {
        const anchorIndex = orderedIds.indexOf(currentAnchor);
        const targetIndex = orderedIds.indexOf(noteId);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] =
            anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
          const nextIds = orderedIds.slice(start, end + 1);
          bulkSidebarSelectionRef.current = nextIds.length > 1;
          setSelectedNoteIds(nextIds);
          return;
        }
      }

      if (isToggle) {
        setSelectedNoteIds((current) => {
          const next = current.includes(noteId)
            ? current.filter((id) => id !== noteId)
            : [...current, noteId];
          bulkSidebarSelectionRef.current = next.length > 1;
          if (next.length === 0) {
            bulkSidebarSelectionRef.current = false;
            selectionAnchorNoteIdRef.current = null;
            setSelectedNoteId(null);
            return next;
          }
          setSelectedNoteId(noteId);
          selectionAnchorNoteIdRef.current = noteId;
          return next;
        });
        return;
      }

      bulkSidebarSelectionRef.current = false;
      selectionAnchorNoteIdRef.current = noteId;
      setSelectedNoteId(noteId);
      setSelectedNoteIds([noteId]);
    },
    [visibleNoteOrder]
  );

  const handleSidebarNoteContextMenu = useCallback(
    (note: NoteRow, event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();

      if (!selectedNoteIdSet.has(note.id) || selectedNoteIds.length <= 1) {
        applySidebarSelection(note.id);
      }

      setNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: note.id,
      });
    },
    [applySidebarSelection, selectedNoteIdSet, selectedNoteIds.length]
  );

  const closeNoteContextMenu = useCallback(() => {
    setNoteContextMenu(null);
  }, []);

  const clearSidebarSelection = useCallback(() => {
    setSelectedNoteIds([]);
    setSelectedNoteId(null);
    selectionAnchorNoteIdRef.current = null;
    bulkSidebarSelectionRef.current = false;
  }, []);

  const handleBulkExportSelectedNotes = useCallback(() => {
    setExportNoteIds(selectedNoteIds.slice());
    setExportType('notes');
    setShowExportModal(true);
    closeNoteContextMenu();
  }, [closeNoteContextMenu, selectedNoteIds]);

  const nodeById = useMemo(() => {
    const map = new Map<string, NoteTreeNode>();
    const walk = (nodes: NoteTreeNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.children?.length) walk(node.children);
      }
    };
    walk(noteTree);
    return map;
  }, [noteTree]);

  const selectedBreadcrumb = useMemo(() => {
    if (!selectedNoteId) return [];
    const crumbs: Array<{ id: string; title: string }> = [];
    const seen = new Set<string>();
    let cursor = nodeById.get(selectedNoteId) ?? null;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      crumbs.unshift({ id: cursor.id, title: cursor.title || 'Untitled note' });
      cursor = cursor.parent_id ? nodeById.get(cursor.parent_id) ?? null : null;
    }
    return crumbs;
  }, [nodeById, selectedNoteId]);

  const recentNotes = useMemo(
    () =>
      [...notes]
        .sort(
          (left, right) =>
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
        )
        .slice(0, 5),
    [notes]
  );

  const workspaceMemberById = useMemo(() => {
    return new Map(workspaceMembers.map((member) => [member.user_id, member]));
  }, [workspaceMembers]);

  const creatorMember = useMemo(() => {
    if (!selectedNote?.user_id) return null;
    return workspaceMemberById.get(selectedNote.user_id) ?? null;
  }, [selectedNote?.user_id, workspaceMemberById]);

  const editorMember = creatorMember;

  const [noteViewers, setNoteViewers] = useState<WorkspaceMember[]>([]);

  useEffect(() => {
    if (!selectedNoteId) {
      setNoteViewers([]);
      return;
    }

    let cancelled = false;

    const loadNoteViewers = async () => {
      if (!selectedNoteId) return;
      try {
        const versions = (await api.getNoteVersions(selectedNoteId)) as NoteVersion[] | null;
        if (cancelled) return;
        const ids = Array.from(
          new Set(
            (Array.isArray(versions) ? versions : []).map((v) => v.versioned_by).filter(Boolean)
          )
        );
        const members = ids
          .map((id) => workspaceMemberById.get(String(id)))
          .filter(Boolean) as WorkspaceMember[];
        setNoteViewers(members);
      } catch (e) {
        if (!cancelled) setNoteViewers([]);
      }
    };

    // initial load
    void loadNoteViewers();

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (isDirty || isEditingRef.current) return;
      void loadNoteViewers();
    }, NOTE_VIEWERS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedNoteId, api, workspaceMemberById, isDirty]);

  const activeViewerNames = useMemo(() => {
    if (!selectedNoteId) return [];
    const membersWithoutCurrent = noteViewers.filter(
      (m) => String(m.user_id) !== String(user?.id ?? '')
    );
    const names = membersWithoutCurrent
      .map((member) => displayUserName(member).trim())
      .filter(Boolean)
      .map((n) => displayFirstName(n));

    const unique = Array.from(new Set(names));
    if (user?.id) {
      return ['You', ...unique];
    }
    return unique;
  }, [noteViewers, selectedNoteId, user?.id]);

  const viewingSummary = useMemo(() => {
    if (activeViewerNames.length === 0) return 'Only you';
    if (activeViewerNames.length === 1) return activeViewerNames[0];
    if (activeViewerNames.length === 2) return activeViewerNames.join(', ');
    return `${activeViewerNames.slice(0, 2).join(', ')} +${activeViewerNames.length - 2}`;
  }, [activeViewerNames]);

  const getNoteUpdatedByLabel = useCallback(
    (updatedById?: string | null) => {
      if (!updatedById) return null;
      const member = workspaceMemberById.get(updatedById) ?? null;
      return member ? displayUserName(member) : null;
    },
    [workspaceMemberById]
  );

  const saveStatus = useMemo(
    () => formatSavedStatus(lastSavedAt, showSavingIndicator, isDirty),
    [isDirty, lastSavedAt, saveStatusTick, showSavingIndicator]
  );

  const syncDraftFromNote = useCallback((note: NoteRow) => {
    hydrationNoteIdRef.current = note.id;
    setIsHydratingNote(true);
    setDraftTitle(note.title);
    setDraftContent(normalizeEditorHtml(note.content));
    setDraftDate(note.date || todayKey());
    setDraftMood(note.mood ?? '');
    setDraftMode(note.mode || 'text');
    setDraftMindMapStructure(note.mind_map_structure || null);
    setLastSavedAt(note.updated_at);
    setIsDirty(false);
    setHasUserEdited(false);
    setHasHydratedNote(true);
    setEditorRefreshTick((current) => current + 1);
    selectedNoteServerUpdatedAtRef.current = note.updated_at ?? null;
    selectedNoteServerUpdatedByRef.current = note.updated_by ?? note.user_id ?? null;
    remoteNoteUpdatePendingRef.current = false;
    if (remoteNoteUpdateToastIdRef.current) {
      toast.dismiss(remoteNoteUpdateToastIdRef.current);
      remoteNoteUpdateToastIdRef.current = null;
    }
    // mark that this note has no session checkpoint yet and clear autosave checkpoint timestamp
    try {
      sessionCheckpointMapRef.current.set(note.id, false);
      lastAutosaveCheckpointRef.current.delete(note.id);
    } catch (e) {
      // ignore
    }
    window.setTimeout(() => {
      if (hydrationNoteIdRef.current === note.id) {
        setIsHydratingNote(false);
      }
    }, 0);
  }, []);

  const handleBulkDeleteSelectedNotes = useCallback(async () => {
    if (selectedNoteIds.length === 0) return;

    const selectedSet = new Set(selectedNoteIds);
    const selectedNotes = notes
      .filter((note) => selectedSet.has(note.id))
      .slice()
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));

    setIsDeleting(true);
    setError(null);

    try {
      for (const note of selectedNotes) {
        await api.deleteNote(note.id);
      }

      setNotes((prev) => {
        const next = prev.filter((note) => !selectedSet.has(note.id));
        const fallback = next[0] ?? null;
        if (fallback) {
          setSelectedNoteId(fallback.id);
          setSelectedNoteIds([fallback.id]);
          selectionAnchorNoteIdRef.current = fallback.id;
          syncDraftFromNote(fallback);
        } else {
          clearSidebarSelection();
          setDraftTitle('');
          setDraftContent('');
          setDraftDate(todayKey());
          setDraftMood('');
          setIsDirty(false);
        }
        return next;
      });

      setNoteTree((prev) => {
        let next = prev;
        for (const note of selectedNotes) {
          next = removeNoteFromTree(next, note.id);
        }
        return next;
      });

      setExpandedNoteIds((prev) => {
        const next = new Set(prev);
        for (const noteId of selectedSet) {
          next.delete(noteId);
        }
        return next;
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete notes.');
    } finally {
      setIsDeleting(false);
      closeNoteContextMenu();
    }
  }, [api, clearSidebarSelection, closeNoteContextMenu, notes, selectedNoteIds, syncDraftFromNote]);

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await api.getTemplates();
      setWorkspaceTemplates(
        Array.isArray(data)
          ? data.map((template: { id: string; name: string }) => ({
              id: template.id,
              name: template.name,
            }))
          : []
      );
    } catch (e) {
      console.error('Failed to load templates:', e);
      setWorkspaceTemplates([]);
    }
  }, [api]);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates, activeWorkspaceId]);

  const handleSaveNoteAsTemplate = useCallback(
    async (noteId: string, name: string) => {
      try {
        await api.saveNoteAsTemplate(noteId, { name });
        await refreshTemplates();
        // notify other components (e.g., CreateNoteModal) that templates changed
        try {
          window.dispatchEvent(new CustomEvent('templates:updated'));
        } catch (e) {}

        toast.show('Saved as template', { variant: 'success', duration: 1600 });
      } catch (error) {
        console.error('Failed to save template:', error);
        setError(error instanceof Error ? error.message : 'Could not save template.');
      }
    },
    [api, refreshTemplates]
  );

  // no-op: useToast is used to show messages instead of window events

  useEffect(() => {
    let mounted = true;

    const loadWorkspaceMembers = async () => {
      if (!activeWorkspaceId) {
        if (mounted) setWorkspaceMembers([]);
        return;
      }

      try {
        const payload = (await api.getWorkspaceMembers(activeWorkspaceId)) as {
          members?: Array<{ user_id: string; email?: string | null; full_name?: string | null }>;
        };
        if (!mounted) return;
        const members = Array.isArray(payload?.members)
          ? payload.members.map((member) => ({
              user_id: member.user_id,
              email: member.email ?? null,
              full_name: member.full_name ?? null,
            }))
          : [];
        setWorkspaceMembers(members);
      } catch {
        if (mounted) setWorkspaceMembers([]);
      }
    };

    void loadWorkspaceMembers();
    return () => {
      mounted = false;
    };
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    let mounted = true;

    const loadProjectLinks = async () => {
      if (!activeWorkspaceId) {
        if (mounted) setWorkspaceProjectNoteLinks([]);
        return;
      }

      try {
        const payload = (await api.getWorkspaceProjectNoteLinks(activeWorkspaceId)) as
          | { links?: WorkspaceProjectNoteLink[] }
          | WorkspaceProjectNoteLink[]
          | null;
        if (!mounted) return;

        const links = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.links)
          ? payload.links
          : [];

        setWorkspaceProjectNoteLinks(
          links
            .filter((link) => link.note_id && link.project_id && link.project_name)
            .map((link) => ({
              id: link.id,
              note_id: link.note_id,
              project_id: link.project_id,
              project_name: link.project_name,
              project_status: link.project_status ?? null,
              project_completeness:
                typeof link.project_completeness === 'number' ? link.project_completeness : null,
              project_end_date: link.project_end_date ?? null,
              created_at: link.created_at,
            }))
        );
      } catch (error) {
        console.error('Failed to load project links for notes:', error);
        if (mounted) setWorkspaceProjectNoteLinks([]);
      }
    };

    void loadProjectLinks();
    return () => {
      mounted = false;
    };
  }, [activeWorkspaceId, api]);

  const resolveTemplateIdByName = useCallback(
    (name: string) => workspaceTemplates.find((template) => template.name === name)?.id ?? null,
    [workspaceTemplates]
  );

  const handleQuickTemplate = useCallback(
    async (templateName: string) => {
      if (isCreating) return;

      const resolvedTemplateId = resolveTemplateIdByName(templateName);
      setIsCreating(true);

      try {
        if (resolvedTemplateId) {
          const note = await api.createNoteFromTemplate(resolvedTemplateId);
          setNotes((prev) => [note as NoteRow, ...prev]);
          setNoteTree((prev) => [
            {
              ...(note as NoteRow),
              depth: (note as NoteRow).depth ?? 0,
              children: [],
            },
            ...prev,
          ]);
          setSelectedNoteId(note.id);
          syncDraftFromNote(note as NoteRow);
          setTimeout(() => titleRef.current?.focus(), 0);
          return;
        }

        const fallback = quickTemplateFallbacks[templateName.toLowerCase()];
        if (!fallback) {
          throw new Error('Template not found');
        }

        const note = await api.createNote(templateName, fallback.content, {
          content_html: fallback.content_html,
          source: 'template',
          mode: 'text',
        });
        setNotes((prev) => [note as NoteRow, ...prev]);
        setNoteTree((prev) => [
          {
            ...(note as NoteRow),
            depth: (note as NoteRow).depth ?? 0,
            children: [],
          },
          ...prev,
        ]);
        setSelectedNoteId(note.id);
        syncDraftFromNote(note as NoteRow);
        setTimeout(() => titleRef.current?.focus(), 0);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to create note');
      } finally {
        setIsCreating(false);
      }
    },
    [api, isCreating, resolveTemplateIdByName, syncDraftFromNote]
  );

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    if (isDirty) {
      setHasUserEdited(true);
    }
  }, [isDirty]);

  // On first real user edit after hydration, create a session checkpoint (pre-edit snapshot)
  useEffect(() => {
    if (!selectedNoteId) return;
    if (!hasHydratedNote) return;
    if (!hasUserEdited) return;
    const already = sessionCheckpointMapRef.current.get(selectedNoteId);
    if (already) return;
    void (async () => {
      try {
        await api.createNoteVersion(selectedNoteId, { reason: 'before_edit' });
      } catch (e) {
        console.error('[notes] failed to create session checkpoint', e);
      }
      sessionCheckpointMapRef.current.set(selectedNoteId, true);
      lastAutosaveCheckpointRef.current.set(selectedNoteId, Date.now());
    })();
  }, [api, hasHydratedNote, hasUserEdited, selectedNoteId]);

  useEffect(() => {
    if (selectedNoteId) return;
    hydrationNoteIdRef.current = null;
    setIsHydratingNote(false);
    setHasHydratedNote(false);
    setHasUserEdited(false);
  }, [selectedNoteId]);

  const loadNotes = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user || !activeWorkspaceId) {
        setNotes([]);
        setSelectedNoteId(null);
        setDraftTitle('');
        setDraftContent('');
        setDraftDate(todayKey());
        setDraftMood('');
        setIsDirty(false);
        setHasHydratedNote(false);
        setHasUserEdited(false);
        setIsHydratingNote(false);
        setIsLoading(false);
        return;
      }

      if (opts?.silent) {
        setIsRefreshing(true);
      } else {
        if (!hasLoadedOnce) {
          setIsLoading(true);
        }
      }

      setError(null);

      try {
        const data = await api.getNotes();
        const payload = data as { notes?: NoteRow[]; tree?: NoteTreeNode[] } | NoteRow[];
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.notes)
          ? payload.notes
          : [];
        const tree = Array.isArray(payload) ? [] : Array.isArray(payload?.tree) ? payload.tree : [];
        const currentEditorNoteId = selectedNoteIdRef.current;
        const selectedExists = currentEditorNoteId
          ? rows.some((note) => note.id === currentEditorNoteId)
          : false;
        const preservedSelection = selectedNoteIdsRef.current.filter((id) =>
          rows.some((note) => note.id === id)
        );
        setNotes(rows);
        setNoteTree(tree);
        setExpandedNoteIds(new Set());

        if (preservedSelection.length > 1) {
          const nextSelection = preservedSelection.slice();
          setSelectedNoteIds(nextSelection);
          const anchorId = nextSelection[nextSelection.length - 1] ?? nextSelection[0] ?? null;
          selectionAnchorNoteIdRef.current = anchorId;
          if (!selectedExists) {
            setSelectedNoteId(null);
          }
        } else {
          const currentSelected = currentEditorNoteId
            ? rows.find((note) => note.id === currentEditorNoteId) ?? null
            : null;
          if (currentSelected) {
            setSelectedNoteIds([currentSelected.id]);
            selectionAnchorNoteIdRef.current = currentSelected.id;
          } else {
            setSelectedNoteIds([]);
            selectionAnchorNoteIdRef.current = null;
            setSelectedNoteId(null);
          }
        }

        if (
          (rows.length === 0 || !selectedExists) &&
          !isEditingRef.current &&
          !isDirtyRef.current
        ) {
          setDraftTitle('');
          setDraftContent('');
          setDraftDate(todayKey());
          setDraftMood('');
          setLastSavedAt(null);
          setIsDirty(false);
          setHasHydratedNote(false);
          setHasUserEdited(false);
          setIsHydratingNote(false);
        }

        if (
          !didRestoreInitialSelectionRef.current &&
          !initialFocusNoteId &&
          !selectedExists &&
          !preservedSelection.length &&
          rows.length > 0
        ) {
          didRestoreInitialSelectionRef.current = true;
          const lastSelectedNoteId = loadLastSelectedNoteId(activeWorkspaceId);
          const lastSelectedNote = lastSelectedNoteId
            ? rows.find((note) => note.id === lastSelectedNoteId) ?? null
            : null;
          if (lastSelectedNote) {
            setSelectedNoteId(lastSelectedNote.id);
            setSelectedNoteIds([lastSelectedNote.id]);
            selectionAnchorNoteIdRef.current = lastSelectedNote.id;
            syncDraftFromNote(lastSelectedNote);
          }
        }
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Could not load notes.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setHasLoadedOnce(true);
      }
    },
    [api, activeWorkspaceId, hasLoadedOnce, initialFocusNoteId, syncDraftFromNote, user]
  );

  const refreshCurrentNoteFromServer = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (!user || !activeWorkspaceId) return false;

      if (opts?.silent) {
        setIsRefreshing(true);
      }

      try {
        await loadNotes({ silent: true });

        const currentNoteId = selectedNoteIdRef.current;
        if (!currentNoteId) return false;
        if (!opts?.force && (isEditingRef.current || isDirtyRef.current)) return false;

        const fetched = (await api.getNoteById(currentNoteId)) as NoteRow;
        setNotes((prev) => prev.map((note) => (note.id === fetched.id ? fetched : note)));
        setNoteTree((prev) => replaceNoteInTree(prev, fetched));
        syncDraftFromNote(fetched);
        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not sync note.');
        return false;
      } finally {
        if (opts?.silent) {
          setIsRefreshing(false);
        }
      }
    },
    [activeWorkspaceId, api, loadNotes, setError, setNoteTree, setNotes, syncDraftFromNote, user]
  );

  const dismissRemoteNoteUpdateToast = useCallback(() => {
    if (!remoteNoteUpdateToastIdRef.current) return;
    toast.dismiss(remoteNoteUpdateToastIdRef.current);
    remoteNoteUpdateToastIdRef.current = null;
  }, [toast]);

  const showRemoteNoteUpdateToast = useCallback(
    (detail: string) => {
      dismissRemoteNoteUpdateToast();
      remoteNoteUpdatePendingRef.current = true;
      remoteNoteUpdateToastIdRef.current = toast.show('New version available', {
        detail,
        variant: 'info',
        duration: 0,
        actions: [
          {
            label: 'Reload',
            onClick: () => {
              void (async () => {
                let reloaded = false;
                try {
                  reloaded = await refreshCurrentNoteFromServer({ silent: true });
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Could not reload note.');
                } finally {
                  remoteNoteUpdatePendingRef.current = !reloaded;
                  dismissRemoteNoteUpdateToast();
                }
              })();
            },
          },
          {
            label: 'Dismiss',
            onClick: () => {
              dismissRemoteNoteUpdateToast();
            },
          },
        ],
      });
    },
    [dismissRemoteNoteUpdateToast, refreshCurrentNoteFromServer, setError, toast]
  );

  useEffect(() => {
    if (selectedNoteId) return;
    remoteNoteUpdatePendingRef.current = false;
    selectedNoteServerUpdatedAtRef.current = null;
    selectedNoteServerUpdatedByRef.current = null;
    dismissRemoteNoteUpdateToast();
  }, [dismissRemoteNoteUpdateToast, selectedNoteId]);

  useEffect(() => {
    if (!user?.id || !activeWorkspaceId) return;

    const channel = supabase
      .channel(`notes-realtime-${activeWorkspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `workspace_id=eq.${activeWorkspaceId}`,
        },
        (payload) => {
          const incoming = (payload.new ?? null) as NoteRow | null;
          if (!incoming?.id) return;

          setNotes((prev) =>
            prev.some((note) => note.id === incoming.id)
              ? prev.map((note) => (note.id === incoming.id ? { ...note, ...incoming } : note))
              : prev
          );
          setNoteTree((prev) => replaceNoteInTree(prev, incoming));

          if (payload.eventType !== 'UPDATE' && payload.eventType !== 'INSERT') return;

          const selectedId = selectedNoteIdRef.current;
          if (selectedId !== incoming.id) return;

          const incomingUpdatedAt = incoming.updated_at ?? null;
          const incomingUpdatedBy = incoming.updated_by ?? null;
          const baseUpdatedAt = selectedNoteServerUpdatedAtRef.current;
          const currentUserId = user.id;

          if (incomingUpdatedBy && incomingUpdatedBy === currentUserId) {
            selectedNoteServerUpdatedAtRef.current = incomingUpdatedAt;
            selectedNoteServerUpdatedByRef.current = incomingUpdatedBy;
            return;
          }

          if (incomingUpdatedAt && incomingUpdatedAt !== baseUpdatedAt) {
            selectedNoteServerUpdatedByRef.current = incomingUpdatedBy;
            if (!remoteNoteUpdatePendingRef.current) {
              remoteNoteUpdatePendingRef.current = true;
              const updaterName = getNoteUpdatedByLabel(incomingUpdatedBy);
              showRemoteNoteUpdateToast(
                updaterName
                  ? `${updaterName} updated this note.`
                  : 'This note was updated elsewhere.'
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeWorkspaceId, getNoteUpdatedByLabel, showRemoteNoteUpdateToast, user?.id]);

  useEffect(() => {
    if (!selectedNoteId || !selectedNote) return;
    if (isDirty || isHydratingNote) return;

    const currentServerUpdatedAt = selectedNote.updated_at ?? null;
    const currentServerUpdatedBy = selectedNote.updated_by ?? null;
    const baseUpdatedAt = selectedNoteServerUpdatedAtRef.current;
    const currentUserId = user?.id ?? null;

    if (!currentServerUpdatedAt || !baseUpdatedAt) return;
    if (currentServerUpdatedAt === baseUpdatedAt) return;
    if (String(currentServerUpdatedBy ?? '') === String(currentUserId ?? '')) {
      selectedNoteServerUpdatedAtRef.current = currentServerUpdatedAt;
      selectedNoteServerUpdatedByRef.current = currentServerUpdatedBy;
      return;
    }

    selectedNoteServerUpdatedByRef.current = currentServerUpdatedBy;
    if (!remoteNoteUpdatePendingRef.current) {
      remoteNoteUpdatePendingRef.current = true;
      const updaterName = getNoteUpdatedByLabel(currentServerUpdatedBy);
      showRemoteNoteUpdateToast(
        updaterName ? `${updaterName} updated this note.` : 'This note was updated elsewhere.'
      );
    }
  }, [
    getNoteUpdatedByLabel,
    isDirty,
    isHydratingNote,
    selectedNote,
    selectedNoteId,
    showRemoteNoteUpdateToast,
    user?.id,
  ]);

  const loadSections = useCallback(async () => {
    try {
      const data = await api.getSections();
      const rows = Array.isArray(data) ? data : [];

      const normalizedRows = rows.map((section) => ({
        ...section,
        color: normalizeSectionColor(section.color),
      }));
      setSections(normalizedRows);
      localStorage.setItem('notes-sections', JSON.stringify(normalizedRows));
      const nextCollapsedIds = new Set<string>([
        '__unsorted__',
        ...rows.map((section) => section.id),
      ]);
      setCollapsedSectionIds(nextCollapsedIds);
      localStorage.setItem('notes-sections-collapsed', JSON.stringify([...nextCollapsedIds]));
      return normalizedRows;
    } catch (error) {
      console.error('Failed to load sections:', error);
      return [];
    }
  }, [activeWorkspaceId, api]);

  const updateSectionColor = useCallback(
    async (sectionId: string, color: NoteSection['color']) => {
      const safeColor = normalizeSectionColor(color);
      const previous = sections;
      const next = sections.map((section) =>
        section.id === sectionId ? { ...section, color: safeColor } : section
      );
      setSections(next);
      localStorage.setItem('notes-sections', JSON.stringify(next));

      try {
        const updated = await api.updateSection(sectionId, { color: safeColor });
        setSections((current) =>
          current.map((section) =>
            section.id === sectionId
              ? {
                  ...section,
                  ...(updated as Partial<NoteSection>),
                  color: normalizeSectionColor(
                    (updated as Partial<NoteSection>).color ?? safeColor
                  ),
                }
              : section
          )
        );
      } catch (error) {
        setSections(previous);
        localStorage.setItem('notes-sections', JSON.stringify(previous));
        setError(error instanceof Error ? error.message : 'Could not update folder color.');
      }
    },
    [api, sections]
  );

  const flushAutosave = useCallback(
    async (override?: { title?: string; content?: string; date?: string; mood?: string }) => {
      if (!selectedNoteId) return null;

      const noteTitle = (override?.title ?? draftTitle).trim() || 'Untitled note';
      const noteContent = normalizeEditorHtml(override?.content ?? draftContent);
      const noteDate = (override?.date ?? draftDate).trim() || todayKey();
      const noteMood = (override?.mood ?? draftMood).trim() || null;
      const meaningfulLength = `${noteTitle}${htmlToPlainText(noteContent)}`.replace(
        /\s/g,
        ''
      ).length;

      if (meaningfulLength < 2) {
        return null;
      }

      const currentServerUpdatedAt =
        selectedNote?.updated_at ?? selectedNoteServerUpdatedAtRef.current;
      const currentServerUpdatedBy =
        selectedNote?.updated_by ?? selectedNoteServerUpdatedByRef.current ?? null;
      const baseUpdatedAt = selectedNoteServerUpdatedAtRef.current;
      const currentUserId = user?.id ?? null;
      const isStaleRemoteUpdate =
        Boolean(baseUpdatedAt) &&
        Boolean(currentServerUpdatedAt) &&
        currentServerUpdatedAt !== baseUpdatedAt &&
        String(currentServerUpdatedBy ?? '') !== String(currentUserId ?? '');

      if (isStaleRemoteUpdate) {
        if (!remoteNoteUpdatePendingRef.current) {
          const updaterName = getNoteUpdatedByLabel(currentServerUpdatedBy);
          showRemoteNoteUpdateToast(
            updaterName ? `${updaterName} updated this note.` : 'This note was updated elsewhere.'
          );
        }
        setError('This note changed elsewhere. Reload latest before saving.');
        return null;
      }

      if (savingIndicatorTimerRef.current) {
        window.clearTimeout(savingIndicatorTimerRef.current);
      }
      savingIndicatorTimerRef.current = window.setTimeout(() => {
        setShowSavingIndicator(true);
      }, 350);
      setError(null);

      try {
        // safety: create a checkpoint if update would be destructive
        try {
          const existing = notes.find((n) => n.id === selectedNoteId);
          if (existing) {
            const oldPlain = htmlToPlainText(
              (existing as any).content_html ?? existing.content ?? ''
            );
            const newPlain = htmlToPlainText(noteContent);
            const oldLen = String(oldPlain).replace(/\s/g, '').length;
            const newLen = String(newPlain).replace(/\s/g, '').length;
            if (oldLen > 50 && newLen < Math.max(5, Math.floor(oldLen * 0.25))) {
              try {
                await api.createNoteVersion(selectedNoteId, {
                  reason: 'before_destructive_overwrite',
                });
              } catch (e) {
                console.error('[notes] failed to create destructive overwrite checkpoint', e);
              }
            }
          }
        } catch (e) {
          console.error('[notes] safety check failed', e);
        }

        // autosave checkpoint throttling: keep revision history calm in production
        try {
          const now = Date.now();
          const last = lastAutosaveCheckpointRef.current.get(selectedNoteId) ?? 0;
          const TEN_MIN = 10 * 60 * 1000;
          if (!last || now - last >= TEN_MIN) {
            try {
              await api.createNoteVersion(selectedNoteId, { reason: 'autosave_checkpoint' });
              lastAutosaveCheckpointRef.current.set(selectedNoteId, now);
            } catch (e) {
              console.error('[notes] failed to create autosave checkpoint', e);
            }
          }
        } catch (e) {
          console.error('[notes] autosave checkpoint check failed', e);
        }

        const data = await api.updateNote(selectedNoteId, {
          title: noteTitle,
          content_html: noteContent,
          date: noteDate,
          mood: noteMood,
          source: 'workspace',
          mode: draftMode,
          mind_map_structure: draftMindMapStructure,
        });
        const updated = data as NoteRow;
        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)));
        setNoteTree((prev) => replaceNoteInTree(prev, updated));
        // An older save may resolve after navigation. Do not let it mutate
        // dirty/saved state belonging to the newly selected note.
        if (
          selectedNoteIdRef.current !== selectedNoteId ||
          hydrationNoteIdRef.current !== selectedNoteId
        ) {
          return updated;
        }
        setIsDirty(false);
        setLastSavedAt(updated.updated_at);
        selectedNoteServerUpdatedAtRef.current = updated.updated_at ?? null;
        selectedNoteServerUpdatedByRef.current =
          updated.updated_by ?? updated.user_id ?? currentUserId;
        remoteNoteUpdatePendingRef.current = false;
        dismissRemoteNoteUpdateToast();
        return updated;
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save note.');
        return null;
      } finally {
        if (savingIndicatorTimerRef.current) {
          window.clearTimeout(savingIndicatorTimerRef.current);
          savingIndicatorTimerRef.current = null;
        }
        setShowSavingIndicator(false);
      }
    },
    [
      api,
      draftContent,
      draftDate,
      draftMood,
      draftMode,
      draftMindMapStructure,
      draftTitle,
      getNoteUpdatedByLabel,
      selectedNoteId,
      selectedNote,
      showRemoteNoteUpdateToast,
      dismissRemoteNoteUpdateToast,
      user?.id,
      notes,
    ]
  );

  const saveCurrentNoteAndRefresh = useCallback(async () => {
    const currentNoteId = selectedNoteIdRef.current;
    if (!currentNoteId) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    await flushAutosave();
    await refreshCurrentNoteFromServer({ silent: true, force: true });
  }, [flushAutosave, refreshCurrentNoteFromServer]);

  const runQuickAutosaveThen = useCallback(
    (after: () => void, timeoutMs = 120) => {
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        after();
      };
      window.setTimeout(finish, timeoutMs);
      void flushAutosave().finally(finish);
    },
    [flushAutosave]
  );

  const attemptCloseNotes = useCallback(() => {
    if (showSavingIndicator || isDirty) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('notes');
  }, [isDirty, showSavingIndicator]);

  const runAutoCorrectSpelling = useCallback(async () => {
    if (draftMode !== 'text') return;

    const currentTitle = String(draftTitle ?? '');
    const currentContent = normalizeEditorHtml(draftContent);
    const currentPlainTextLength = htmlToPlainText(currentContent).replace(/\s/g, '').length;
    const corrected = await autocorrectNoteContent(currentTitle, currentContent);
    const correctedTitle = String(corrected.title ?? currentTitle);
    const correctedContent = normalizeEditorHtml(String(corrected.content_html ?? currentContent));

    if (!correctedContent.trim() && currentPlainTextLength > 0) {
      setError('Autocorrect returned empty content, so the note was left unchanged.');
      return;
    }

    if (correctedTitle === currentTitle && correctedContent === currentContent) {
      return;
    }

    setDraftTitle(correctedTitle);
    setDraftContent(correctedContent);
    setIsDirty(true);
    setEditorRefreshTick((current) => current + 1);

    const saved = await flushAutosave({
      title: correctedTitle,
      content: correctedContent,
      date: draftDate,
      mood: draftMood,
    });

    if (saved) {
      setNotes((prev) => prev.map((note) => (note.id === saved.id ? saved : note)));
      syncDraftFromNote(saved);
    }
  }, [draftContent, draftDate, draftMode, draftMood, draftTitle, flushAutosave, syncDraftFromNote]);

  const restoreLatestVersion = useCallback(async () => {
    if (!selectedNoteId) return;
    try {
      const versions = (await api.getNoteVersions(selectedNoteId)) as Array<{ id: string }>;
      const latest = Array.isArray(versions) ? versions[0] : null;
      if (!latest?.id) {
        setError('No previous versions available for this note.');
        return;
      }
      const restored = (await api.restoreNoteVersion(selectedNoteId, latest.id)) as NoteRow;
      setNotes((prev) => prev.map((note) => (note.id === restored.id ? restored : note)));
      syncDraftFromNote(restored);
      setSelectedNoteId(restored.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not restore note version.');
    }
  }, [api, selectedNoteId, syncDraftFromNote]);

  const openVersionHistory = useCallback(
    (noteId?: string) => {
      const id = noteId ?? selectedNoteId;
      if (!id) return;
      if (selectedNoteId !== id) {
        setSelectedNoteId(id);
      }
      setShowVersionHistoryModal(true);
    },
    [selectedNoteId]
  );

  useEffect(() => {
    if (!showVersionHistoryModal || !selectedNoteId) return;
    let cancelled = false;
    setIsLoadingVersions(true);
    setError(null);
    void (async () => {
      try {
        const versions = (await api.getNoteVersions(selectedNoteId)) as NoteVersion[];
        if (cancelled) return;
        setNoteVersions(Array.isArray(versions) ? versions : []);
      } catch (error) {
        if (cancelled) return;
        setError(error instanceof Error ? error.message : 'Could not load version history.');
        setNoteVersions([]);
      } finally {
        if (!cancelled) setIsLoadingVersions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, selectedNoteId, showVersionHistoryModal]);

  const restoreVersionById = useCallback(
    async (versionId: string) => {
      if (!selectedNoteId) return;
      setIsRestoringVersionId(versionId);
      setError(null);
      try {
        const restored = (await api.restoreNoteVersion(selectedNoteId, versionId)) as NoteRow;
        setNotes((prev) => prev.map((note) => (note.id === restored.id ? restored : note)));
        syncDraftFromNote(restored);
        setSelectedNoteId(restored.id);
        if (!bulkSidebarSelectionRef.current) {
          setSelectedNoteIds([restored.id]);
          selectionAnchorNoteIdRef.current = restored.id;
        }
        const versions = (await api.getNoteVersions(selectedNoteId)) as NoteVersion[];
        setNoteVersions(Array.isArray(versions) ? versions : []);
        setShowVersionHistoryModal(false);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not restore selected version.');
      } finally {
        setIsRestoringVersionId(null);
      }
    },
    [api, selectedNoteId, selectedNoteIds.length, syncDraftFromNote]
  );

  const openNote = useCallback(
    async (note: NoteRow) => {
      if (selectedNoteId === note.id) return;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (isDirty) {
        const saved = await flushAutosave();
        if (!saved) return;
      }
      setSelectedNoteId(note.id);
      if (!bulkSidebarSelectionRef.current) {
        setSelectedNoteIds([note.id]);
        selectionAnchorNoteIdRef.current = note.id;
      }
      syncDraftFromNote(note);
      recordNoteOpened(note.id);
      titleRef.current?.focus();
    },
    [
      flushAutosave,
      isDirty,
      recordNoteOpened,
      selectedNoteId,
      selectedNoteIds.length,
      syncDraftFromNote,
    ]
  );

  const openNoteById = useCallback(
    async (noteId: string) => {
      const existing = notes.find((note) => note.id === noteId);
      if (existing) {
        await openNote(existing);
        return;
      }

      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (isDirty) {
        const saved = await flushAutosave();
        if (!saved) return;
      }

      setIsHydratingNote(true);
      setHasHydratedNote(false);
      setHasUserEdited(false);
      hydrationNoteIdRef.current = noteId;

      try {
        const fetched = (await api.getNoteById(noteId)) as NoteRow;
        setNotes((prev) => {
          const exists = prev.some((note) => note.id === fetched.id);
          if (exists) return prev.map((note) => (note.id === fetched.id ? fetched : note));
          return [fetched, ...prev];
        });
        setSelectedNoteId(fetched.id);
        if (!bulkSidebarSelectionRef.current) {
          setSelectedNoteIds([fetched.id]);
          selectionAnchorNoteIdRef.current = fetched.id;
        }
        syncDraftFromNote(fetched);
        recordNoteOpened(fetched.id);
      } catch (error) {
        setIsHydratingNote(false);
        setHasHydratedNote(false);
        setError(error instanceof Error ? error.message : 'Could not load note.');
      }
    },
    [
      api,
      flushAutosave,
      isDirty,
      notes,
      openNote,
      recordNoteOpened,
      selectedNoteIds.length,
      syncDraftFromNote,
    ]
  );

  const handleSidebarNoteClick = useCallback(
    async (note: NoteRow, shiftKey = false) => {
      applySidebarSelection(note.id, { shiftKey });
      if (!shiftKey) {
        await openNote(note);
      }
    },
    [applySidebarSelection, openNote]
  );

  const createChildNote = useCallback(
    async (parentId: string) => {
      if (!user || !parentId) return;
      if (isDirty) {
        const saved = await flushAutosave();
        if (!saved) return;
      }

      setIsCreating(true);
      setError(null);
      try {
        const created = (await api.createChildNote(parentId, {
          title: 'Untitled child note',
          content_html: '<p></p>',
          date: todayKey(),
          mood: null,
          source: 'workspace',
        })) as NoteRow;
        setNotes((prev) => [created, ...prev]);
        setNoteTree((prev) => {
          const childNode: NoteTreeNode = {
            ...created,
            depth: created.depth ?? 1,
            children: [],
          };
          if (!prev.length) return [childNode];
          return insertChildIntoTree(prev, parentId, childNode);
        });
        setSelectedNoteId(created.id);
        if (!bulkSidebarSelectionRef.current) {
          setSelectedNoteIds([created.id]);
          selectionAnchorNoteIdRef.current = created.id;
        }
        syncDraftFromNote(created);
        setExpandedNoteIds((current) => new Set(current).add(parentId));
        setTimeout(() => titleRef.current?.focus(), 0);
      } catch (createError) {
        setError(
          createError instanceof Error ? createError.message : 'Could not create child note.'
        );
      } finally {
        setIsCreating(false);
      }
    },
    [api, flushAutosave, isDirty, selectedNoteIds.length, syncDraftFromNote, user]
  );

  const createSection = useCallback(
    async (name: string, parentId: string | null = null) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setError(null);
      try {
        const created = await api.createSection({
          name: trimmed,
          color: 'gray',
          parent_id: parentId,
        });
        const nextSections = [...sections, created].sort(
          (left, right) => left.sort_order - right.sort_order
        );
        setSections(
          nextSections.map((section) => ({
            ...section,
            color: normalizeSectionColor(section.color),
          }))
        );
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Could not create section.');
      }
    },
    [api, sections]
  );

  const duplicateNoteById = useCallback(
    async (noteId: string) => {
      const source = notes.find((note) => note.id === noteId);
      if (!source) return;
      try {
        const duplicated = (await api.duplicateNote(noteId)) as NoteRow;
        setNotes((prev) => [duplicated, ...prev]);
        setNoteTree((prev) => {
          if (duplicated.parent_id) {
            return insertChildIntoTree(prev, duplicated.parent_id, {
              ...duplicated,
              depth: duplicated.depth ?? 0,
              children: [],
            });
          }
          return insertRootIntoTree(prev, {
            ...duplicated,
            depth: duplicated.depth ?? 0,
            children: [],
          });
        });
        setSelectedNoteId(duplicated.id);
        if (!bulkSidebarSelectionRef.current) {
          setSelectedNoteIds([duplicated.id]);
          selectionAnchorNoteIdRef.current = duplicated.id;
        }
        syncDraftFromNote(duplicated);
        void loadNotes({ silent: true });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not duplicate note.');
      }
    },
    [api, loadNotes, notes, selectedNoteIds.length, syncDraftFromNote]
  );

  const moveNote = useCallback(
    async (
      noteId: string,
      update: { parent_id?: string | null; section_id?: string | null; sort_order?: number }
    ) => {
      const source = notes.find((note) => note.id === noteId);
      if (!source) return null;

      try {
        const updated = (await api.updateNote(noteId, {
          parent_id: update.parent_id,
          section_id: update.section_id,
          sort_order: update.sort_order,
        })) as NoteRow;

        setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)));
        setNoteTree((prev) => {
          const removed = removeNoteFromTree(prev, updated.id);
          const movedNode: NoteTreeNode = { ...updated, depth: updated.depth ?? 0, children: [] };
          if (updated.parent_id) {
            return insertChildIntoTree(removed, updated.parent_id, movedNode);
          }
          return insertRootIntoTree(removed, movedNode);
        });
        if (updated.parent_id) {
          setExpandedNoteIds((current) => new Set(current).add(updated.parent_id!));
        }
        void loadNotes({ silent: true });
        return updated;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not move note.');
        return null;
      }
    },
    [api, notes]
  );

  const handleTreeDragStart = useCallback((noteId: string) => {
    if (draggedSectionId) return;
    setDraggedNoteId(noteId);
  }, []);

  const handleTreeDragEnd = useCallback(() => {
    setDraggedNoteId(null);
    setDropPreview(null);
  }, []);

  const handleSectionDragStart = useCallback(
    (sectionId: string, event?: DragEvent<HTMLElement>) => {
      if (draggedNoteId) return;
      setDraggedSectionId(sectionId);
      if (event?.dataTransfer) {
        event.dataTransfer.setData('application/x-ledger-section-id', sectionId);
        event.dataTransfer.effectAllowed = 'move';
      }
    },
    [draggedNoteId]
  );

  const handleSectionDrop = useCallback(
    async (
      targetSectionId: string,
      dropSectionId?: string | null,
      position: 'inside' | 'before' | 'after' = 'inside'
    ) => {
      const sourceSectionId = dropSectionId ?? draggedSectionId;
      if (!sourceSectionId || sourceSectionId === targetSectionId) return;
      const source = sections.find((section) => section.id === sourceSectionId);
      const target = sections.find((section) => section.id === targetSectionId);
      if (!source || !target) return;

      let optimistic: NoteSection[] = sections;
      if (position === 'inside') {
        const siblingTop = sections.reduce((max, section) => {
          if ((section.parent_id ?? null) !== targetSectionId) return max;
          return Math.max(max, toNonNegativeInt(section.sort_order));
        }, -1);
        const nextSortOrder = siblingTop + 1;
        optimistic = sections.map((section) =>
          section.id === sourceSectionId
            ? { ...section, parent_id: targetSectionId, sort_order: nextSortOrder }
            : section
        );
      } else {
        const siblingParentId = target.parent_id ?? null;
        const siblings = sections
          .filter(
            (section) =>
              (section.parent_id ?? null) === siblingParentId && section.id !== sourceSectionId
          )
          .sort((a, b) => toNonNegativeInt(a.sort_order) - toNonNegativeInt(b.sort_order));
        const targetIndex = siblings.findIndex((section) => section.id === targetSectionId);
        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
        const reorderedSiblings = [
          ...siblings.slice(0, insertIndex),
          { ...source, parent_id: siblingParentId },
          ...siblings.slice(insertIndex),
        ];
        const updatesById = new Map(
          reorderedSiblings.map((section, index) => [
            section.id,
            { sort_order: index, parent_id: siblingParentId },
          ])
        );
        optimistic = sections.map((section) => {
          const next = updatesById.get(section.id);
          if (!next) return section;
          return { ...section, sort_order: next.sort_order, parent_id: next.parent_id };
        });
      }

      setSections(optimistic);
      localStorage.setItem('notes-sections', JSON.stringify(optimistic));
      setDraggedSectionId(null);
      setSectionDropTargetId(null);

      try {
        if (position === 'inside') {
          const moved = optimistic.find((section) => section.id === sourceSectionId);
          await api.updateSection(sourceSectionId, {
            parent_id: targetSectionId,
            sort_order: moved?.sort_order ?? 0,
          });
        } else {
          const siblingParentId =
            optimistic.find((section) => section.id === targetSectionId)?.parent_id ?? null;
          const siblingPayload = optimistic
            .filter((section) => (section.parent_id ?? null) === siblingParentId)
            .sort((a, b) => toNonNegativeInt(a.sort_order) - toNonNegativeInt(b.sort_order))
            .map((section, index) => ({
              id: section.id,
              sort_order: index,
              parent_id: siblingParentId,
            }));
          await api.reorderSections(siblingPayload);
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not move folder.');
        void loadSections();
      }
    },
    [api, draggedSectionId, loadSections, sections]
  );

  const handleSectionDragEnd = useCallback(() => {
    setDraggedSectionId(null);
    setSectionDropTargetId(null);
  }, []);

  const handleDropOnSection = useCallback(
    async (sectionId: string | null) => {
      if (!draggedNoteId) return;
      const targetSortOrder = notes.reduce((max, note) => {
        const sameSection = (note.section_id ?? null) === (sectionId ?? null);
        if (!sameSection || note.parent_id) return max;
        return Math.max(max, toNonNegativeInt(note.sort_order));
      }, -1);

      await moveNote(draggedNoteId, {
        parent_id: null,
        section_id: sectionId,
        sort_order: targetSortOrder + 1,
      });
      handleTreeDragEnd();
    },
    [draggedNoteId, handleTreeDragEnd, moveNote, notes]
  );

  const handleDropOnNote = useCallback(
    async (target: NoteRow, position: 'inside' | 'before' | 'after') => {
      if (!draggedNoteId || draggedNoteId === target.id) return;
      const source = notes.find((note) => note.id === draggedNoteId);
      if (!source) return;

      if (position === 'inside') {
        const siblingTop = notes.reduce(
          (max, note) =>
            note.parent_id === target.id ? Math.max(max, toNonNegativeInt(note.sort_order)) : max,
          -1
        );
        await moveNote(draggedNoteId, {
          parent_id: target.id,
          section_id: target.section_id ?? null,
          sort_order: siblingTop + 1,
        });
        setExpandedNoteIds((current) => new Set(current).add(target.id));
        handleTreeDragEnd();
        return;
      }

      const siblingParentId = target.parent_id ?? null;
      const siblingSectionId = target.section_id ?? null;
      const nextSortOrder =
        position === 'before'
          ? toNonNegativeInt(target.sort_order)
          : toNonNegativeInt(target.sort_order) + 1;
      await moveNote(draggedNoteId, {
        parent_id: siblingParentId,
        section_id: siblingSectionId,
        sort_order: nextSortOrder,
      });
      handleTreeDragEnd();
    },
    [draggedNoteId, handleTreeDragEnd, moveNote, notes]
  );

  const handleTreeDropPreview = useCallback(
    (event: DragEvent, targetId: string) => {
      if (!draggedNoteId || draggedNoteId === targetId) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const relativeY = (event.clientY - rect.top) / Math.max(rect.height, 1);
      const position = relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside';
      setDropPreview({ targetId, position });
    },
    [draggedNoteId]
  );

  const getDropPosition = useCallback((event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const relativeY = (event.clientY - rect.top) / Math.max(rect.height, 1);
    return relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside';
  }, []);

  const handleBulkExport = useCallback(
    async (format: 'pdf' | 'png' | 'html' | 'txt', selectedIds: Set<string>) => {
      try {
        if (exportType === 'mindmaps') {
          const resolveMindMapElement = (noteId: string) => {
            const selector = `[data-mindmap-id="${noteId}"]`;
            const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            if (!candidates.length) return null;

            const visible = candidates.filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 20 && rect.height > 20;
            });
            const pool = visible.length ? visible : candidates;
            return pool.reduce((best, current) => {
              const bestRect = best.getBoundingClientRect();
              const currentRect = current.getBoundingClientRect();
              return currentRect.width * currentRect.height > bestRect.width * bestRect.height
                ? current
                : best;
            });
          };

          const mindMapsToExport = notes
            .filter((note) => selectedIds.has(note.id) && note.mode === 'mind_map')
            .map((note) => {
              const element = resolveMindMapElement(note.id);
              if (!element) {
                console.warn(`Mind map element not found for note ${note.id}`);
              }
              return {
                id: note.id,
                title: note.title || 'Untitled',
                element: element,
                created_at: note.created_at,
              };
            })
            .filter((item) => item.element !== null && item.element !== undefined);

          if (mindMapsToExport.length === 0) {
            setError('No mind maps found to export. Make sure the mind map is rendered on screen.');
            return;
          }

          await bulkExportMindMaps(mindMapsToExport as any, format as 'pdf' | 'png' | 'txt');
        } else {
          const notesToExport = notes
            .filter((note) => selectedIds.has(note.id))
            .map((note) => ({
              id: note.id,
              title: note.title || 'Untitled',
              content: note.content || '',
              date: note.date,
              created_at: note.created_at,
            }));
          await bulkExportNotes(notesToExport, format as 'pdf' | 'html' | 'txt');
        }
      } catch (error) {
        console.error('Bulk export failed:', error);
        setError('Export failed. Please try again.');
      }
    },
    [notes, exportType]
  );

  const deleteSelectedNote = useCallback(async () => {
    if (!selectedNote) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await api.deleteNote(selectedNote.id);
      setNotes((prev) => {
        const next = prev.filter((note) => note.id !== selectedNote.id);
        const fallback = next[0] ?? null;
        if (fallback) {
          setSelectedNoteId(fallback.id);
          setSelectedNoteIds([fallback.id]);
          selectionAnchorNoteIdRef.current = fallback.id;
          syncDraftFromNote(fallback);
        } else {
          setSelectedNoteId(null);
          setSelectedNoteIds([]);
          selectionAnchorNoteIdRef.current = null;
          setDraftTitle('');
          setDraftContent('');
          setDraftDate(todayKey());
          setDraftMood('');
          setIsDirty(false);
        }
        return next;
      });
      setNoteTree((prev) => removeNoteFromTree(prev, selectedNote.id));
      setExpandedNoteIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedNote.id);
        return next;
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete note.');
    } finally {
      setIsDeleting(false);
    }
  }, [api, selectedNote, syncDraftFromNote]);

  const deleteNoteById = useCallback(
    async (noteId: string) => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      const target = notes.find((note) => note.id === noteId);
      if (!target) return;

      setIsDeleting(true);
      setError(null);

      try {
        await api.deleteNote(noteId);
        setNotes((prev) => {
          const next = prev.filter((note) => note.id !== noteId);
          const fallback = next[0] ?? null;
          if (fallback) {
            setSelectedNoteId(fallback.id);
            setSelectedNoteIds([fallback.id]);
            selectionAnchorNoteIdRef.current = fallback.id;
            syncDraftFromNote(fallback);
          } else {
            setSelectedNoteId(null);
            setSelectedNoteIds([]);
            selectionAnchorNoteIdRef.current = null;
            setDraftTitle('');
            setDraftContent('');
            setDraftDate(todayKey());
            setDraftMood('');
            setIsDirty(false);
          }
          return next;
        });
        setNoteTree((prev) => removeNoteFromTree(prev, noteId));
        setExpandedNoteIds((prev) => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : 'Could not delete note.');
      } finally {
        setIsDeleting(false);
      }
    },
    [api, notes, syncDraftFromNote]
  );

  useEffect(() => {
    void loadNotes();
    const poll = window.setInterval(() => {
      if (isEditingRef.current || isDirty) return;
      void loadNotes({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(poll);
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      if (savingIndicatorTimerRef.current) {
        window.clearTimeout(savingIndicatorTimerRef.current);
      }
    };
  }, [loadNotes, activeWorkspaceId]);

  // Load sections from database when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      void loadSections();
    }
  }, [activeWorkspaceId, loadSections]);

  useEffect(() => {
    setLeftPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.notes.left)
    );
    setRightPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.notes.right)
    );
  }, [viewportWidth]);

  useEffect(() => {
    if (!selectedNoteId || !isDirty) return;
    if (isHydratingNote || !hasHydratedNote || !hasUserEdited) return;
    if (hydrationNoteIdRef.current !== selectedNoteId) return;

    const noteTitle = draftTitle.trim() || 'Untitled note';
    const noteContent = normalizeEditorHtml(draftContent);
    const meaningfulLength = `${noteTitle}${htmlToPlainText(noteContent)}`.replace(
      /\s/g,
      ''
    ).length;
    if (meaningfulLength < 2) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void flushAutosave();
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    draftContent,
    draftDate,
    draftMood,
    draftTitle,
    flushAutosave,
    hasHydratedNote,
    hasUserEdited,
    isDirty,
    isHydratingNote,
    selectedNoteId,
  ]);

  useEffect(() => {
    if (!isResizingLeftPane) return;

    const handleMove = (event: globalThis.MouseEvent) => {
      const next = Math.max(LEFT_PANE_MIN_WIDTH, Math.min(LEFT_PANE_MAX_WIDTH, event.clientX));
      setLeftPaneWidth(next);
    };

    const handleUp = () => setIsResizingLeftPane(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingLeftPane]);

  useEffect(() => {
    if (!isResizingRightPane) return;

    const handleMove = (event: globalThis.MouseEvent) => {
      const next = window.innerWidth - event.clientX;
      const clamped = Math.max(RIGHT_PANE_MIN_WIDTH, Math.min(RIGHT_PANE_MAX_WIDTH, next));
      setRightPaneWidth(clamped);
    };

    const handleUp = () => setIsResizingRightPane(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingRightPane]);

  useEffect(() => {
    if (!noteContextMenu) return;

    const closeMenu = () => setNoteContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [noteContextMenu]);

  useEffect(() => {
    if (!sectionContextMenu) return;

    const closeMenu = () => setSectionContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [sectionContextMenu]);

  useEffect(() => {
    if (!isInspectorActionsOpen) return;

    const closeMenu = () => setIsInspectorActionsOpen(false);
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (inspectorActionsRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isInspectorActionsOpen]);

  useEffect(() => {
    if (draftMode !== 'mind_map') {
      setIsMindMapFullscreen(false);
    }
  }, [draftMode, selectedNoteId]);

  useEffect(() => {
    if (!isMindMapFullscreen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        exitMindMapFullscreen();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitMindMapFullscreen, isMindMapFullscreen]);

  useEffect(() => {
    if (!initialFocusNoteId) return;
    if (didApplyInitialFocusRef.current) return;
    if (selectedNoteId === initialFocusNoteId) return;

    const target = notes.find((note) => note.id === initialFocusNoteId);
    didApplyInitialFocusRef.current = true;
    if (target) {
      void openNote(target);
      return;
    }
    void openNoteById(initialFocusNoteId);
  }, [initialFocusNoteId, notes, openNote, openNoteById, selectedNoteId]);

  useEffect(() => {
    if (!selectedNoteId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 's') return;

      event.preventDefault();
      event.stopPropagation();
      void saveCurrentNoteAndRefresh();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveCurrentNoteAndRefresh, selectedNoteId]);

  useEffect(() => {
    const focusNoteListener = (
      _event: unknown,
      payload: { kind?: string; focusNoteId?: string | null }
    ) => {
      if (payload?.kind !== 'notes' || !payload.focusNoteId) return;
      const target = notesRef.current.find((note) => note.id === payload.focusNoteId);
      if (target) {
        void openNote(target);
        return;
      }
      void openNoteById(payload.focusNoteId);
    };

    window.ipcRenderer?.on('module:focus-note', focusNoteListener);

    return () => {
      window.ipcRenderer?.off('module:focus-note', focusNoteListener);
    };
  }, [openNote, openNoteById]);

  useEffect(() => {
    if (!lastSavedAt || isDirty || showSavingIndicator) return;

    const timer = window.setInterval(() => {
      setSaveStatusTick((current) => current + 1);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [isDirty, lastSavedAt, showSavingIndicator]);

  useEffect(() => {
    if (!isNoteActionsOpen) return;

    const closeMenu = () => setIsNoteActionsOpen(false);
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (noteActionsMenuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isNoteActionsOpen]);

  useEffect(() => {
    if (!showNewMenu) return;

    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (newMenuRef.current?.contains(event.target as Node)) return;
      setShowNewMenu(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowNewMenu(false);
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [showNewMenu]);

  useEffect(() => {
    if (!sortMenu) return;

    const closeMenu = () => setSortMenu(null);
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (sortMenuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [sortMenu]);

  return (
    <div
      className="ledger-notes-shell relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none"
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
      <CloseGuardModal
        isOpen={showCloseGuardModal}
        isSaving={showSavingIndicator}
        hasUnsavedChanges={isDirty}
        onCancel={() => setShowCloseGuardModal(false)}
        onCloseWithoutSaving={() => {
          setShowCloseGuardModal(false);
          void window.desktopWindow?.closeModule('notes');
        }}
        onRetrySaveAndClose={() => {
          void (async () => {
            const saved = await flushAutosave();
            if (!saved && isDirty) return;
            setShowCloseGuardModal(false);
            void window.desktopWindow?.closeModule('notes');
          })();
        }}
      />
      <ModuleWindowHeader
        title="Notes"
        subtitle="Ideas, meetings, and workspace context"
        icon={<StickyNote size={18} className="text-[#FF5F40]" />}
        closeLabel="Close notes"
        minimizeLabel="Minimize notes"
        onMinimize={() => {
          runQuickAutosaveThen(() => {
            void window.desktopWindow?.minimizeModule('notes');
          }, 100);
        }}
        fullscreenLabel="Fullscreen notes"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('notes');
        }}
        onClose={attemptCloseNotes}
        showPanelToggle
        panelToggleLabel={areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
        onTogglePanels={() => {
          if (areSidePanelsCollapsed) {
            setIsLeftPaneCollapsed(false);
            setIsRightPaneCollapsed(false);
          } else {
            setIsLeftPaneCollapsed(true);
            setIsRightPaneCollapsed(true);
          }
        }}
        compact
        showBodyHeader={false}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={12} />}
              count={inboxCount}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={12} />}
              count={notificationCount}
              onClick={() => window.desktopWindow?.openModule('notifications')}
              title="Open notifications center"
              ariaLabel="Open notifications center"
            />
          </>
        }
        primaryActions={
          <div className="flex items-center gap-2">
            <ModuleHeaderActionButton
              onClick={() => {
                setNoteCreationSectionId(null);
                setShowCreateNoteModal(true);
              }}
              title="Create a new note"
              disabled={isCreating}
              icon={<Plus size={12} />}
              variant="strip"
            >
              {isCreating ? 'Creating...' : 'New note'}
            </ModuleHeaderActionButton>
            <ModuleHeaderActionButton
              onClick={() => {
                setExportType(selectedNote?.mode === 'mind_map' ? 'mindmaps' : 'notes');
                setShowExportModal(true);
              }}
              title="Export notes or mind maps"
              disabled={notes.length === 0}
              icon={<Download size={12} />}
              variant="strip"
            >
              Export
            </ModuleHeaderActionButton>
          </div>
        }
        syncStatus={
          <ModuleHeaderStatus
            label={isRefreshing ? 'Syncing' : 'Synced'}
            state={isRefreshing || showSavingIndicator ? 'syncing' : 'synced'}
            onClick={() => void refreshCurrentNoteFromServer({ silent: true })}
            title="Refresh notes"
          />
        }
      />
      {/* Toasts handled by global ToastProvider */}

      {error && (
        <div className="border-b border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] px-5 py-2 text-xs text-[var(--ledger-danger)]">
          {error}
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed && hasLoadedOnce ? (
          <>
            <aside
              className={`flex shrink-0 flex-col overflow-hidden border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] ${
                isCompactLayout ? 'text-sm' : ''
              }`}
              style={{ width: `${leftPaneWidth}px` }}
            >
              <div
                className={`${
                  isCompactLayout ? 'p-3' : 'p-4'
                } border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-xs font-medium text-[var(--ledger-text-muted)]">Notes</h2>
                    <button
                      onClick={() => setIsLeftPaneCollapsed(true)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                      title="Hide left panel"
                      aria-label="Hide left panel"
                    >
                      <ChevronLeft size={13} strokeWidth={2.25} className="-translate-x-px" />
                    </button>
                  </div>
                  <div className="relative" ref={newMenuRef}>
                    <button
                      onClick={() => setShowNewMenu((current) => !current)}
                      disabled={isCreating}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-accent)] transition hover:bg-[var(--ledger-surface-hover)] disabled:opacity-60"
                      title="Notes actions"
                    >
                      <MoreVertical size={13} />
                    </button>
                    {showNewMenu && (
                      <div className="absolute right-0 top-8 z-40 max-h-[60vh] min-w-48 overflow-y-auto rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewMenu(false);
                            setShowNewSectionPrompt(false);
                            setNoteCreationSectionId(null);
                            setShowCreateNoteModal(true);
                          }}
                          className="w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                        >
                          New note
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewMenu(false);
                            setShowNewSectionPrompt(true);
                          }}
                          className="w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                        >
                          New folder
                        </button>
                        <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                        <div className="px-2.5 pb-1 pt-0.5">
                          <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
                            Sort notes
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                            {formatNoteSortLabel(noteSortPreferences.root)}
                          </p>
                        </div>
                        <div className="mx-2 mb-1 h-px bg-[var(--ledger-border-subtle)]" />
                        {NOTE_SORT_OPTIONS.map((option) => {
                          const isActive =
                            JSON.stringify(option.preference) ===
                            JSON.stringify(noteSortPreferences.root);
                          return (
                            <button
                              key={option.label}
                              type="button"
                              onClick={() => {
                                setSortPreferenceForScope(ROOT_NOTE_SCOPE_ID, option.preference);
                                setShowNewMenu(false);
                              }}
                              className={`relative w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition ${
                                isActive
                                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                  : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                              }`}
                            >
                              {option.label}
                              {isActive && (
                                <span className="absolute inset-x-2.5 bottom-0 h-px bg-[var(--ledger-border-subtle)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search notes"
                    className="h-8 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pl-9 pr-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                  />
                </div>

                {showNewSectionPrompt && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-1.5">
                    <input
                      autoFocus
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      placeholder="Folder name"
                      className="min-w-0 flex-1 bg-transparent px-1.5 text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createSection(newSectionName).then(() => {
                            setNewSectionName('');
                            setShowNewSectionPrompt(false);
                          });
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setNewSectionName('');
                          setShowNewSectionPrompt(false);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        void createSection(newSectionName).then(() => {
                          setNewSectionName('');
                          setShowNewSectionPrompt(false);
                        });
                      }}
                      disabled={!newSectionName.trim()}
                      className="h-7 rounded-full bg-[var(--ledger-accent)] px-3 text-xs font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                )}
              </div>

              <div
                className={`flex-1 overflow-y-auto overflow-x-hidden ${
                  isCompactLayout ? 'p-2' : 'p-3'
                } space-y-0`}
              >
                {isLoading ? (
                  <div className="space-y-2 px-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <SkeletonNoteCard key={i} />
                    ))}
                  </div>
                ) : search.trim() ? (
                  // Search results - flat view
                  <div className="space-y-0.5">
                    {visibleNotes.map((note) => {
                      const active = selectedNoteIdSet.has(note.id);

                      return (
                        <button
                          key={note.id}
                          onMouseDown={(event) => {
                            if (event.shiftKey) event.preventDefault();
                          }}
                          onClick={(event) => void handleSidebarNoteClick(note, event.shiftKey)}
                          onContextMenu={(event) => handleSidebarNoteContextMenu(note, event)}
                          className={`w-full rounded px-3 py-1.5 text-left text-sm transition ${
                            active
                              ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                              : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <StickyNote
                              size={12}
                              className="shrink-0 text-[var(--ledger-text-muted)]"
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className="font-medium truncate text-sm leading-5"
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  beginInlineRename(note.id);
                                }}
                              >
                                {note.title || 'Untitled'}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  // Tree view with sections
                  <div className="space-y-1.5">
                    {visibleSections.map((section) => {
                      const sectionColor = getColorClasses(section.color);
                      const isSectionCollapsed = collapsedSectionIds.has(section.id);
                      const sectionNotes = sortNotesForScope(
                        notes.filter((n) => n.section_id === section.id && !n.parent_id),
                        section.id
                      );
                      const sectionTotalCount = sectionNoteCountById.get(section.id) ?? 0;
                      const sectionDepth = sectionDepthById.get(section.id) ?? 0;

                      return (
                        <div
                          key={section.id}
                          style={{ marginLeft: `${sectionDepth * 12}px` }}
                          onDragOver={(event) => {
                            const dropSectionId =
                              event.dataTransfer.getData('application/x-ledger-section-id') ||
                              draggedSectionId;
                            if (!dropSectionId) return;
                            event.preventDefault();
                            if (dropSectionId !== section.id) {
                              setSectionDropTargetId(section.id);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const dropSectionId =
                              event.dataTransfer.getData('application/x-ledger-section-id') ||
                              draggedSectionId;
                            if (!dropSectionId || dropSectionId === section.id) return;
                            const rect = (
                              event.currentTarget as HTMLElement
                            ).getBoundingClientRect();
                            const relativeY = (event.clientY - rect.top) / Math.max(rect.height, 1);
                            const position: 'inside' | 'before' | 'after' =
                              relativeY < 0.22 ? 'before' : relativeY > 0.78 ? 'after' : 'inside';
                            void handleSectionDrop(section.id, dropSectionId, position);
                          }}
                        >
                          {/* Section header */}
                          <button
                            draggable
                            onDragStart={(event) => handleSectionDragStart(section.id, event)}
                            onDragEnd={handleSectionDragEnd}
                            onClick={() => {
                              const next = new Set(collapsedSectionIds);
                              if (next.has(section.id)) next.delete(section.id);
                              else next.add(section.id);
                              setCollapsedSectionIds(next);
                              try {
                                localStorage.setItem(
                                  'notes-sections-collapsed',
                                  JSON.stringify([...next])
                                );
                              } catch (e) {
                                console.error('Failed to save section state:', e);
                              }
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (!draggedSectionId) {
                                setDropPreview({ targetId: section.id, position: 'inside' });
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const dropSectionId =
                                event.dataTransfer.getData('application/x-ledger-section-id') ||
                                draggedSectionId;
                              if (dropSectionId && dropSectionId !== section.id) {
                                const rect = (
                                  event.currentTarget as HTMLElement
                                ).getBoundingClientRect();
                                const relativeY =
                                  (event.clientY - rect.top) / Math.max(rect.height, 1);
                                const position: 'inside' | 'before' | 'after' =
                                  relativeY < 0.22
                                    ? 'before'
                                    : relativeY > 0.78
                                    ? 'after'
                                    : 'inside';
                                void handleSectionDrop(section.id, dropSectionId, position);
                                return;
                              }
                              void handleDropOnSection(section.id);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSectionContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                sectionId: section.id,
                                sectionName: section.name,
                              });
                            }}
                            className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[var(--ledger-text-secondary)] transition group hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] ${
                              sectionDropTargetId === section.id
                                ? 'border border-dashed border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                : draggedSectionId === section.id
                                ? 'bg-[var(--ledger-surface-hover)]/80 ring-1 ring-[color:var(--ledger-border-subtle)]'
                                : dropPreview?.targetId === section.id
                                ? 'bg-[var(--ledger-surface-hover)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                : ''
                            }`}
                          >
                            <div
                              className={`h-1.5 w-1.5 rounded-full shrink-0 ${sectionColor.dot}`}
                            />
                            <Folder
                              size={14}
                              className="shrink-0 text-[var(--ledger-text-muted)]"
                            />
                            <span
                              className="flex-1 truncate"
                              onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                beginInlineSectionRename(section.id);
                              }}
                            >
                              {renamingSectionId === section.id ? (
                                <input
                                  ref={renameSectionInputRef}
                                  value={renamingSectionDraft}
                                  onChange={(event) => setRenamingSectionDraft(event.target.value)}
                                  onBlur={() => {
                                    void commitInlineSectionRename();
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      void commitInlineSectionRename();
                                    } else if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelInlineSectionRename();
                                    }
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  className="w-full bg-transparent text-sm font-semibold text-[var(--ledger-text-primary)] outline-none"
                                />
                              ) : (
                                section.name
                              )}
                            </span>
                            <ChevronRight
                              size={14}
                              className={`shrink-0 text-[var(--ledger-text-muted)] transition-transform ${
                                !isSectionCollapsed ? 'rotate-90' : ''
                              }`}
                            />
                            <span className="mr-1 text-xs text-[var(--ledger-text-muted)]">
                              {sectionTotalCount}
                            </span>
                          </button>

                          {/* Section notes */}
                          {!isSectionCollapsed && (
                            <div className="mt-1 pl-4 space-y-0.5">
                              {sectionNotes.map((note) => {
                                const active = selectedNoteIdSet.has(note.id);
                                const isExpanded = expandedNoteIds.has(note.id);
                                const childNotes = sortNotesForScope(
                                  notes.filter((n) => n.parent_id === note.id),
                                  section.id
                                );
                                const childCount = childNotes.length;

                                return (
                                  <div key={note.id} className="space-y-1">
                                    {/* Note row */}
                                    <div className="flex items-center gap-1 min-w-0">
                                      <button
                                        onMouseDown={(event) => {
                                          if (event.shiftKey) event.preventDefault();
                                        }}
                                        onClick={(event) =>
                                          void handleSidebarNoteClick(note, event.shiftKey)
                                        }
                                        draggable
                                        onDragStart={() => handleTreeDragStart(note.id)}
                                        onDragEnd={handleTreeDragEnd}
                                        onDragOver={(event) => {
                                          event.preventDefault();
                                          handleTreeDropPreview(event, note.id);
                                        }}
                                        onDrop={(event) => {
                                          event.preventDefault();
                                          void handleDropOnNote(note, getDropPosition(event));
                                        }}
                                        onContextMenu={(event) =>
                                          handleSidebarNoteContextMenu(note, event)
                                        }
                                        className={`flex-1 min-w-0 rounded px-2.5 py-1 text-left text-sm transition ${
                                          active
                                            ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                            : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                        } ${getDropPreviewClasses(dropPreview, note.id)}`}
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          {childCount > 0 ? (
                                            <Folder
                                              size={12}
                                              className="shrink-0 text-[var(--ledger-text-muted)]"
                                            />
                                          ) : (
                                            <StickyNote
                                              size={12}
                                              className="shrink-0 text-[var(--ledger-text-muted)]"
                                            />
                                          )}
                                          <div className="min-w-0 flex-1">
                                            {renamingNoteId === note.id ? (
                                              <input
                                                ref={renameInputRef}
                                                value={renameDraft}
                                                onChange={(e) => setRenameDraft(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onBlur={() => {
                                                  void commitInlineRename();
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    void commitInlineRename();
                                                  } else if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    cancelInlineRename();
                                                  }
                                                }}
                                                className="w-full bg-transparent font-medium text-[var(--ledger-text-primary)] outline-none"
                                              />
                                            ) : (
                                              <p
                                                className="font-medium truncate text-sm leading-5"
                                                onDoubleClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  beginInlineRename(note.id);
                                                }}
                                              >
                                                {note.title || 'Untitled'}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      </button>
                                      {childCount > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedNoteIds((current) => {
                                              const next = new Set(current);
                                              if (next.has(note.id)) next.delete(note.id);
                                              else next.add(note.id);
                                              return next;
                                            });
                                          }}
                                          className="h-5 w-5 shrink-0 rounded text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                        >
                                          {isExpanded ? (
                                            <ChevronDown size={14} />
                                          ) : (
                                            <ChevronRight size={14} />
                                          )}
                                        </button>
                                      )}
                                    </div>

                                    {/* Child notes */}
                                    {isExpanded && childCount > 0 && (
                                      <div className="space-y-0.5 pl-4">
                                        {notes
                                          .filter((n) => n.parent_id === note.id)
                                          .map((child) => (
                                            <div
                                              key={child.id}
                                              className="flex items-center gap-1 min-w-0"
                                            >
                                              <div className="w-5 shrink-0" />
                                              <button
                                                onClick={(event) =>
                                                  void handleSidebarNoteClick(child, event.shiftKey)
                                                }
                                                draggable
                                                onDragStart={() => handleTreeDragStart(child.id)}
                                                onDragEnd={handleTreeDragEnd}
                                                onDragOver={(event) => {
                                                  event.preventDefault();
                                                  handleTreeDropPreview(event, child.id);
                                                }}
                                                onDrop={(event) => {
                                                  event.preventDefault();
                                                  void handleDropOnNote(
                                                    child,
                                                    getDropPosition(event)
                                                  );
                                                }}
                                                onContextMenu={(event) => {
                                                  event.preventDefault();
                                                  setNoteContextMenu({
                                                    x: event.clientX,
                                                    y: event.clientY,
                                                    noteId: child.id,
                                                  });
                                                }}
                                                className={`flex-1 min-w-0 px-2.5 py-1.5 rounded text-left text-xs transition ${
                                                  selectedNoteIdSet.has(child.id)
                                                    ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                                    : 'bg-transparent hover:bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-secondary)]'
                                                } ${getDropPreviewClasses(dropPreview, child.id)}`}
                                              >
                                                <div className="flex items-center gap-2 min-w-0">
                                                  <StickyNote
                                                    size={11}
                                                    className="text-[var(--ledger-text-muted)] shrink-0"
                                                  />
                                                  <p className="font-medium truncate leading-5">
                                                    {child.title || 'Untitled'}
                                                  </p>
                                                </div>
                                              </button>
                                            </div>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              {/* Add note button in section */}
                              <button
                                onClick={() => {
                                  // TODO: Open create note modal with section pre-selected
                                  setNoteCreationSectionId(section.id);
                                  setShowCreateNoteModal(true);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                              >
                                <Plus size={12} />
                                Add note
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {notes.length === 0 && (
                      <div className="px-3 py-5 text-center">
                        <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                          No notes yet
                        </p>
                        <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                          Create a note or drop one into a folder to start organizing.
                        </p>
                      </div>
                    )}

                    {/* Unsorted section for notes without a section */}
                    {(() => {
                      const unsortedNotes = sortNotesForScope(
                        notes.filter((n) => !n.section_id && !n.parent_id),
                        ROOT_NOTE_SCOPE_ID
                      );
                      if (unsortedNotes.length === 0) return null;

                      const isUnsortedCollapsed = collapsedSectionIds.has('__unsorted__');
                      const sectionColor = getColorClasses('gray');

                      return (
                        <div>
                          <button
                            onClick={() => {
                              const next = new Set(collapsedSectionIds);
                              if (next.has('__unsorted__')) next.delete('__unsorted__');
                              else next.add('__unsorted__');
                              setCollapsedSectionIds(next);
                              try {
                                localStorage.setItem(
                                  'notes-sections-collapsed',
                                  JSON.stringify([...next])
                                );
                              } catch (e) {
                                console.error('Failed to save section state:', e);
                              }
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setDropPreview({ targetId: '__unsorted__', position: 'inside' });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              void handleDropOnSection(null);
                            }}
                            className="w-full flex items-center gap-2 rounded-lg px-3 py-1 text-left text-sm font-semibold text-[var(--ledger-text-secondary)] transition group hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                          >
                            <div
                              className={`h-1.5 w-1.5 rounded-full shrink-0 ${sectionColor.dot}`}
                            />
                            <Folder
                              size={14}
                              className="shrink-0 text-[var(--ledger-text-muted)]"
                            />
                            <span className="flex-1 truncate">Unsorted</span>
                            <ChevronRight
                              size={14}
                              className={`shrink-0 text-[var(--ledger-text-muted)] transition-transform ${
                                !isUnsortedCollapsed ? 'rotate-90' : ''
                              }`}
                            />
                            <span className="mr-1 text-xs text-[var(--ledger-text-muted)]">
                              {unsortedNotes.length}
                            </span>
                          </button>

                          {!isUnsortedCollapsed && (
                            <div className="mt-1 pl-3.5 space-y-0.5">
                              {unsortedNotes.map((note) => {
                                const active = selectedNoteIdSet.has(note.id);
                                const isExpanded = expandedNoteIds.has(note.id);
                                const childNotes = sortNotesForScope(
                                  notes.filter((n) => n.parent_id === note.id),
                                  ROOT_NOTE_SCOPE_ID
                                );
                                const childCount = childNotes.length;

                                return (
                                  <div key={note.id} className="space-y-1">
                                    <div className="flex items-center gap-1 min-w-0">
                                      <button
                                        onClick={(event) =>
                                          void handleSidebarNoteClick(note, event.shiftKey)
                                        }
                                        draggable
                                        onDragStart={() => handleTreeDragStart(note.id)}
                                        onDragEnd={handleTreeDragEnd}
                                        onDragOver={(event) => {
                                          event.preventDefault();
                                          handleTreeDropPreview(event, note.id);
                                        }}
                                        onDrop={(event) => {
                                          event.preventDefault();
                                          void handleDropOnNote(note, getDropPosition(event));
                                        }}
                                        onContextMenu={(event) =>
                                          handleSidebarNoteContextMenu(note, event)
                                        }
                                        className={`flex-1 min-w-0 flex items-center gap-2 rounded px-2.5 py-1 text-left text-sm transition ${
                                          active
                                            ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                            : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                        } ${getDropPreviewClasses(dropPreview, note.id)}`}
                                      >
                                        {childCount > 0 ? (
                                          <Folder
                                            size={13}
                                            className="shrink-0 text-[var(--ledger-text-muted)]"
                                          />
                                        ) : (
                                          <StickyNote
                                            size={13}
                                            className="shrink-0 text-[var(--ledger-text-muted)]"
                                          />
                                        )}
                                        <div className="min-w-0 flex-1">
                                          {renamingNoteId === note.id ? (
                                            <input
                                              ref={renameInputRef}
                                              value={renameDraft}
                                              onChange={(e) => setRenameDraft(e.target.value)}
                                              onClick={(e) => e.stopPropagation()}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onBlur={() => {
                                                void commitInlineRename();
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  void commitInlineRename();
                                                } else if (e.key === 'Escape') {
                                                  e.preventDefault();
                                                  cancelInlineRename();
                                                }
                                              }}
                                              className="w-full bg-transparent font-medium text-[var(--ledger-text-primary)] outline-none"
                                            />
                                          ) : (
                                            <p
                                              className="font-medium truncate leading-5"
                                              onDoubleClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                beginInlineRename(note.id);
                                              }}
                                            >
                                              {note.title || 'Untitled'}
                                            </p>
                                          )}
                                        </div>
                                      </button>
                                      {childCount > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedNoteIds((current) => {
                                              const next = new Set(current);
                                              if (next.has(note.id)) next.delete(note.id);
                                              else next.add(note.id);
                                              return next;
                                            });
                                          }}
                                          className="h-5 w-5 shrink-0 rounded text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                        >
                                          {isExpanded ? (
                                            <ChevronDown size={14} />
                                          ) : (
                                            <ChevronRight size={14} />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                    {isExpanded && childCount > 0 && (
                                      <div className="space-y-1 pl-3.5">
                                        {childNotes.map((child) => {
                                          const childActive = selectedNoteIdSet.has(child.id);
                                          const childPreview =
                                            htmlToPlainText(child.content).slice(0, 50) ||
                                            'No content';
                                          return (
                                            <button
                                              key={child.id}
                                              onMouseDown={(event) => {
                                                if (event.shiftKey) event.preventDefault();
                                              }}
                                              onClick={(event) =>
                                                void handleSidebarNoteClick(child, event.shiftKey)
                                              }
                                              draggable
                                              onDragStart={() => handleTreeDragStart(child.id)}
                                              onDragEnd={handleTreeDragEnd}
                                              onDragOver={(event) => {
                                                event.preventDefault();
                                                handleTreeDropPreview(event, child.id);
                                              }}
                                              onDrop={(event) => {
                                                event.preventDefault();
                                                void handleDropOnNote(
                                                  child,
                                                  getDropPosition(event)
                                                );
                                              }}
                                              onContextMenu={(event) =>
                                                handleSidebarNoteContextMenu(child, event)
                                              }
                                              className={`w-full flex items-center gap-2 rounded px-2.5 py-1 text-left text-xs transition ${
                                                childActive
                                                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                                  : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                              } ${getDropPreviewClasses(dropPreview, child.id)}`}
                                            >
                                              <StickyNote
                                                size={12}
                                                className="shrink-0 text-[var(--ledger-text-muted)]"
                                              />
                                              <div className="min-w-0 flex-1">
                                                {renamingNoteId === child.id ? (
                                                  <input
                                                    ref={renameInputRef}
                                                    value={renameDraft}
                                                    onChange={(e) => setRenameDraft(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onBlur={() => {
                                                      void commitInlineRename();
                                                    }}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        void commitInlineRename();
                                                      } else if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        cancelInlineRename();
                                                      }
                                                    }}
                                                    className="w-full bg-transparent font-medium text-[var(--ledger-text-primary)] outline-none"
                                                  />
                                                ) : (
                                                  <p
                                                    className="font-medium truncate leading-5"
                                                    onDoubleClick={(event) => {
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      beginInlineRename(child.id);
                                                    }}
                                                  >
                                                    {child.title || 'Untitled'}
                                                  </p>
                                                )}
                                                <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                                                  {childPreview}
                                                </p>
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Collapsible Templates section */}
              <div className="border-t border-[color:var(--ledger-border-subtle)]">
                <button
                  onClick={() => {
                    const newState = !isTemplatesExpanded;
                    setIsTemplatesExpanded(newState);
                    try {
                      localStorage.setItem('notes-templates-expanded', JSON.stringify(newState));
                    } catch (e) {
                      console.error('Failed to save templates state:', e);
                    }
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <Zap size={13} className="text-[var(--ledger-text-muted)]" />
                    Templates
                  </span>
                  <ChevronRight
                    size={13}
                    className={`text-[var(--ledger-text-muted)] transition-transform ${
                      isTemplatesExpanded ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {isTemplatesExpanded && (
                  <div className="px-3 pt-2 pb-4 space-y-0.5 bg-transparent">
                    {quickTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={async () => {
                          if (isDirty) {
                            const saved = await flushAutosave();
                            if (!saved) return;
                          }
                          void handleQuickTemplate(template.name);
                        }}
                        className="w-full rounded px-2.5 py-1 text-left text-sm text-[var(--ledger-text-secondary)] transition truncate hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        {template.name}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setNoteCreationSectionId(null);
                        setShowCreateNoteModal(true);
                      }}
                      className="w-full rounded px-2.5 py-1.5 text-left text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    >
                      Browse All Templates
                    </button>
                  </div>
                )}
              </div>
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={() => setIsResizingLeftPane(true)}
              className="w-1.5 cursor-col-resize bg-transparent transition hover:bg-[color:rgba(255,255,255,0.06)]"
              title="Resize panels"
            />
          </>
        ) : (
          <div className="flex w-10 shrink-0 items-start justify-center border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pt-4">
            <button
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
              title="Show left panel"
              aria-label="Show left panel"
            >
              <ChevronRight size={14} strokeWidth={2.25} />
            </button>
          </div>
        )}

        <section
          className={`flex-1 min-w-0 ${
            areSidePanelsCollapsed ? 'p-4' : isCompactLayout ? 'p-2' : 'p-2.5'
          }`}
        >
          <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] shadow-none">
            {isLoading ? (
              <div className="flex-1 p-5 space-y-4">
                <SkeletonLoader />
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-20 animate-pulse rounded-2xl bg-[var(--ledger-surface-hover)]" />
                  <div className="h-20 animate-pulse rounded-2xl bg-[var(--ledger-surface-hover)]" />
                  <div className="h-20 animate-pulse rounded-2xl bg-[var(--ledger-surface-hover)]" />
                </div>
              </div>
            ) : selectedNote ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-6 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="truncate text-[11px] text-[var(--ledger-text-muted)]">
                      Home
                      {selectedBreadcrumb.length
                        ? ` > ${selectedBreadcrumb.map((crumb) => crumb.title).join(' > ')}`
                        : ''}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-[var(--ledger-text-muted)]">
                        {saveStatus}
                      </span>
                      <div className="relative" ref={noteActionsMenuRef}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setIsNoteActionsOpen((current) => !current);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                          aria-label="Note actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {isNoteActionsOpen && (
                          <div className="absolute right-0 top-9 z-40 min-w-44 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)]">
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                void createChildNote(selectedNote.id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Add child note
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                titleRef.current?.focus();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Rename
                            </button>
                            <button
                              disabled={draftMode !== 'text'}
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                runAutoCorrectSpelling();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:text-[var(--ledger-text-muted)]"
                            >
                              Auto-correct spelling
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                const firstSection = sections[0];
                                if (!firstSection) return;
                                void api
                                  .updateNote(selectedNote.id, { section_id: firstSection.id })
                                  .then((updated) => {
                                    const row = updated as NoteRow;
                                    setNotes((prev) =>
                                      prev.map((note) => (note.id === row.id ? row : note))
                                    );
                                  });
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Move to section...
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                void handleSaveNoteAsTemplate(
                                  selectedNote.id,
                                  draftTitle || selectedNote.title || 'Untitled note'
                                );
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Save as template
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                const id = selectedNote?.id ?? selectedNoteId;
                                if (!id) return;
                                setShowVersionHistoryModal(true);
                                void openVersionHistory(id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Version history
                            </button>
                            <button
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                void duplicateNoteById(selectedNote.id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Duplicate
                            </button>
                            <button
                              disabled={isDeleting}
                              onClick={() => {
                                setIsNoteActionsOpen(false);
                                void deleteSelectedNote();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-50"
                            >
                              {isDeleting ? 'Deleting...' : 'Delete note'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <input
                      ref={titleRef}
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value);
                        setIsDirty(true);
                      }}
                      onFocus={() => {
                        isEditingRef.current = true;
                      }}
                      onBlur={() => {
                        isEditingRef.current = false;
                      }}
                      placeholder="Untitled note"
                      className="block w-full bg-transparent py-1.5 text-4xl font-semibold leading-tight tracking-tight text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-text-muted)] focus:outline-none"
                    />
                    <div className="flex shrink-0 items-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftMode('text');
                          setIsDirty(true);
                        }}
                        className={`h-7 rounded-md px-2.5 text-xs font-medium ${
                          draftMode === 'text'
                            ? 'bg-[var(--ledger-accent)] text-white'
                            : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                        }`}
                      >
                        Write
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftMode('mind_map');
                          setIsDirty(true);
                        }}
                        className={`h-7 rounded-md px-2.5 text-xs font-medium ${
                          draftMode === 'mind_map'
                            ? 'bg-[var(--ledger-accent)] text-white'
                            : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                        }`}
                      >
                        Mind Map
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto bg-[var(--ledger-surface-muted)] p-6">
                  <div className="max-w-3xl mx-auto space-y-6">
                    {draftMode === 'text' ? (
                      <RichTextEditor
                        editorKey={`${selectedNote.id}:${editorRefreshTick}`}
                        noteId={selectedNote.id}
                        noteTitle={selectedNote.title}
                        noteProjectId={selectedNoteProjectLinks[0]?.project_id ?? null}
                        initialValue={draftContent}
                        onAutoCorrect={() => {
                          void runAutoCorrectSpelling();
                        }}
                        onChange={(nextHtml) => {
                          const normalizedNext = normalizeEditorHtml(nextHtml);
                          const normalizedCurrent = normalizeEditorHtml(draftContent);
                          if (normalizedNext === normalizedCurrent) return;
                          setDraftContent(normalizedNext);
                          setIsDirty(true);
                        }}
                        onFocus={() => {
                          isEditingRef.current = true;
                        }}
                        onBlur={() => {
                          isEditingRef.current = false;
                          // A note switch blurs the old editor after the
                          // selected note has changed. Never flush that old
                          // editor against the new draft.
                          if (hydrationNoteIdRef.current !== selectedNote.id || isHydratingNote) return;
                          void flushAutosave();
                        }}
                      />
                    ) : (
                      <div
                        className="w-full min-h-[calc(100vh-330px)] mt-4"
                        data-mindmap-id={selectedNote?.id}
                      >
                        <MindMapEditor
                          structure={draftMindMapStructure}
                          onChange={(structure) => {
                            setDraftMindMapStructure(structure);
                            setIsDirty(true);
                          }}
                          isFullscreen={isMindMapFullscreen}
                          onToggleFullscreen={() => setIsMindMapFullscreen((current) => !current)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)]">
                    <StickyNote size={22} className="text-[var(--ledger-accent)]" />
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-[var(--ledger-text-primary)]">
                    No note selected
                  </h2>
                  <p className="mt-2 text-sm text-[var(--ledger-text-secondary)]">
                    Create a note to start writing, planning, or dumping ideas.
                  </p>
                  <button
                    onClick={() => {
                      setNoteCreationSectionId(null);
                      setShowCreateNoteModal(true);
                    }}
                    className="mt-5 rounded-full bg-[var(--ledger-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
                  >
                    New note
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {!isRightPaneCollapsed ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={() => setIsResizingRightPane(true)}
              className="w-1.5 cursor-col-resize bg-[var(--ledger-border-subtle)] hover:bg-[var(--ledger-border-strong)] transition"
              title="Resize panels"
            />

            <aside
              className={`overflow-auto border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] ${
                isCompactLayout ? 'p-3 space-y-3' : 'p-4 space-y-4'
              } shrink-0`}
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Inspector</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                      {selectedNote ? 'Current note' : 'No note selected'}
                    </p>
                    <p className="mt-1 truncate text-xs text-[var(--ledger-text-muted)]">
                      {selectedNote
                        ? selectedBreadcrumb.length
                          ? selectedBreadcrumb.map((crumb) => crumb.title).join(' > ')
                          : 'Home'
                        : 'Click a note to view details'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsRightPaneCollapsed(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                      aria-label="Hide right panel"
                      title="Hide right panel"
                    >
                      <ChevronRight size={14} />
                    </button>
                    {selectedNote && (
                      <div className="relative shrink-0" ref={inspectorActionsRef}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setIsInspectorActionsOpen((current) => !current);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                          aria-label="Inspector actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>

                        {isInspectorActionsOpen && selectedNote && (
                          <div className="absolute right-0 top-10 z-40 min-w-52 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)]">
                            <PinActionButton
                              objectType="note"
                              objectId={selectedNote.id}
                              onClick={() => setIsInspectorActionsOpen(false)}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            />
                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                titleRef.current?.focus();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Rename
                            </button>
                            <button
                              disabled={draftMode !== 'text'}
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                runAutoCorrectSpelling();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:text-[var(--ledger-text-muted)]"
                            >
                              Auto-correct spelling
                            </button>
                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                void duplicateNoteById(selectedNote.id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Duplicate
                            </button>
                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                void handleSaveNoteAsTemplate(
                                  selectedNote.id,
                                  draftTitle || selectedNote.title || 'Untitled note'
                                );
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Save as template
                            </button>
                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                const id = selectedNote?.id ?? selectedNoteId;
                                if (!id) return;
                                setShowVersionHistoryModal(true);
                                void openVersionHistory(id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Version history
                            </button>

                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                void restoreLatestVersion();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                            >
                              Restore last version
                            </button>
                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                const firstSection = sections[0];
                                if (!firstSection) return;
                                void api
                                  .updateNote(selectedNote.id, { section_id: firstSection.id })
                                  .then((updated) => {
                                    const row = updated as NoteRow;
                                    setNotes((prev) =>
                                      prev.map((note) => (note.id === row.id ? row : note))
                                    );
                                  });
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                            >
                              Move to section...
                            </button>
                            <button
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                void createChildNote(selectedNote.id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                            >
                              Add child note
                            </button>
                            <button
                              onClick={() => {
                                void openLinkProjectModal(selectedNote.id);
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                            >
                              Link to project
                            </button>
                            <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                            <button
                              disabled={isDeleting}
                              onClick={() => {
                                setIsInspectorActionsOpen(false);
                                void deleteSelectedNote();
                              }}
                              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-50"
                            >
                              {isDeleting ? 'Deleting...' : 'Delete note'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Details</p>
                  {selectedNote ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--ledger-text-muted)]">Created</span>
                        <span className="text-[var(--ledger-text-primary)]">
                          {formatCompactDateTime(selectedNote.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--ledger-text-muted)]">Updated</span>
                        <span className="text-[var(--ledger-text-primary)]">
                          {formatCompactDateTime(selectedNote.updated_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--ledger-text-muted)]">Date</span>
                        <span className="text-[var(--ledger-text-primary)]">
                          {selectedNote.date || 'Not set'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--ledger-text-muted)]">Words</span>
                        <span className="text-[var(--ledger-text-primary)]">
                          {wordCount(selectedNote.content)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--ledger-text-muted)]">
                      No metadata to show until a note is selected.
                    </p>
                  )}
                </div>

                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                      Linked project
                    </p>
                    {selectedNote && (
                      <button
                        type="button"
                        onClick={() => {
                          void openLinkProjectModal(selectedNote.id);
                        }}
                        className="text-xs font-medium text-[var(--ledger-accent)] transition hover:text-[var(--ledger-accent-hover)]"
                      >
                        Link to project
                      </button>
                    )}
                  </div>
                  {selectedNote ? (
                    selectedNoteProjectLinks.length > 0 ? (
                      <div className="space-y-2">
                        {selectedNoteProjectLinks.slice(0, 3).map((link) => (
                          <div
                            key={link.id}
                            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                  {link.project_name}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-[var(--ledger-text-muted)]">
                                  {String(link.project_status ?? 'active')
                                    .split('_')
                                    .join(' ')}
                                  {typeof link.project_completeness === 'number'
                                    ? ` · ${Math.round(link.project_completeness)}%`
                                    : ''}
                                  {link.project_end_date
                                    ? ` · Due ${formatCompactDateTime(link.project_end_date)}`
                                    : ''}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                                Linked
                              </span>
                            </div>
                          </div>
                        ))}
                        {selectedNoteProjectLinks.length > 3 && (
                          <p className="px-1 text-xs text-[var(--ledger-text-muted)]">
                            +{selectedNoteProjectLinks.length - 3} more linked projects
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2">
                        <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                          No linked project
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">
                          Link this note to keep project context close by.
                        </p>
                      </div>
                    )
                  ) : (
                    <p className="text-sm text-[var(--ledger-text-muted)]">
                      Select a note to see linked project context.
                    </p>
                  )}
                </div>

                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Workspace</p>
                  {selectedNote ? (
                    <div className="space-y-2">
                      <div className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                        {activeWorkspace?.name?.trim() || 'Current workspace'}
                      </div>
                      <InspectorInfoRow label="Created by" value={displayUserName(creatorMember)} />
                      <InspectorInfoRow
                        label="Last edited by"
                        value={`${displayUserName(editorMember)} · ${formatRelativeFromNow(
                          selectedNote.updated_at
                        )}`}
                      />
                      <div className="py-1">
                        <p className="text-[11px] text-[var(--ledger-text-muted)]">Viewing</p>
                        <p className="mt-0.5 text-sm font-medium text-[var(--ledger-text-primary)]">
                          {viewingSummary}
                        </p>
                      </div>
                      <InspectorInfoRow label="Notes" value={String(notes.length)} />
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--ledger-text-muted)]">
                      Select a note to view workspace details.
                    </p>
                  )}
                </div>

                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                      Recent updates
                    </p>
                  </div>
                  {recentNotes.length > 0 ? (
                    <div className="space-y-1">
                      {recentNotes.map((note) => (
                        <button
                          key={note.id}
                          onMouseDown={(event) => {
                            if (event.shiftKey) event.preventDefault();
                          }}
                          onClick={(event) => void handleSidebarNoteClick(note, event.shiftKey)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg bg-[var(--ledger-surface-muted)] px-2 py-1.5 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)] active:bg-[var(--ledger-surface-hover)]"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[var(--ledger-text-primary)]">
                              {note.title || 'Untitled note'}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
                            {formatCompactDateTime(note.updated_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--ledger-text-muted)]">
                      No recent updates yet.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </>
        ) : (
          <div className="flex w-10 shrink-0 items-start justify-center border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pt-4">
            <button
              onClick={() => setIsRightPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
              title="Show right panel"
              aria-label="Show right panel"
            >
              <ChevronLeft size={13} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>

      {draftMode === 'mind_map' && isMindMapFullscreen && (
        <div className="fixed inset-0 z-80 bg-[var(--ledger-background)]">
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-5 py-4 shadow-none">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                  Mind map fullscreen
                </p>
                <h2 className="truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                  {draftTitle || 'Untitled note'}
                </h2>
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={exitMindMapFullscreen}
                className="rounded-full bg-[var(--ledger-accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
              >
                Exit fullscreen
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4" data-mindmap-id={selectedNote?.id}>
              <MindMapEditor
                structure={draftMindMapStructure}
                onChange={(structure) => {
                  setDraftMindMapStructure(structure);
                  setIsDirty(true);
                }}
                isFullscreen
                onToggleFullscreen={exitMindMapFullscreen}
              />
            </div>
          </div>
        </div>
      )}

      {sectionContextMenu && (
        <div
          className="fixed z-210 min-w-40 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
          style={{
            left: Math.max(8, Math.min(sectionContextMenu.x, window.innerWidth - 180)),
            top: Math.max(8, Math.min(sectionContextMenu.y, window.innerHeight - 220)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              beginInlineSectionRename(sectionContextMenu.sectionId);
            }}
            className="flex h-9 w-full items-center gap-3 rounded-none border-b border-[color:var(--ledger-border-subtle)] px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <span className="shrink-0 text-[var(--ledger-text-muted)]">Aa</span>
            <span className="font-medium">Rename folder</span>
          </button>
          <button
            onClick={() => {
              const parent = sections.find(
                (section) => section.id === sectionContextMenu.sectionId
              );
              if (!parent) return;
              setSectionContextMenu(null);
              void createSection('New folder', parent.id).then(() => {
                setCollapsedSectionIds((prev) => {
                  const next = new Set(prev);
                  next.delete(parent.id);
                  return next;
                });
              });
            }}
            className="flex h-9 w-full items-center gap-3 rounded-none border-b border-[color:var(--ledger-border-subtle)] px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <Plus size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <span className="font-medium">Create subfolder</span>
          </button>
          <div className="border-b border-[color:var(--ledger-border-subtle)] px-3 py-2">
            <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Folder color</p>
            <div className="relative mt-2">
              <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex items-center gap-1.5 w-max pr-8">
                  {sectionColorOptions.map((color) => {
                    const isActive =
                      sections.find((section) => section.id === sectionContextMenu.sectionId)
                        ?.color === color;
                    const swatch = getColorClasses(color);
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          void updateSectionColor(sectionContextMenu.sectionId, color);
                        }}
                        className={`h-5 w-5 rounded-full transition ${
                          isActive
                            ? 'border-2 border-[color:var(--ledger-text-muted)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                            : 'border border-[color:var(--ledger-border-subtle)] hover:border-[color:var(--ledger-border-strong)]'
                        }`}
                        title={`Set ${sectionContextMenu.sectionName} color to ${color}`}
                      >
                        <span className={`block h-full w-full rounded-full ${swatch.dot}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="pointer-events-none absolute right-0 top-0 h-6 w-7 bg-linear-to-l from-white to-transparent" />
            </div>
          </div>
          <button
            onClick={() => {
              const estimatedMenuWidth = 220;
              setSectionContextMenu(null);
              setSortMenu({
                x: Math.max(8, sectionContextMenu.x - estimatedMenuWidth - 12),
                y: sectionContextMenu.y,
                scopeId: sectionContextMenu.sectionId,
                scopeName: sectionContextMenu.sectionName,
              });
            }}
            className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <MoreHorizontal size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
            <span className="font-medium">Sort folder</span>
          </button>
          <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
          <button
            onClick={() => {
              const target = sections.find(
                (section) => section.id === sectionContextMenu.sectionId
              );
              if (target) {
                setShowNewSectionPrompt(false);
                void api
                  .deleteSection(target.id)
                  .then(() => {
                    setSections((prev) => prev.filter((section) => section.id !== target.id));
                    setCollapsedSectionIds((prev) => {
                      const next = new Set(prev);
                      next.delete(target.id);
                      return next;
                    });
                    void loadSections();
                    void loadNotes({ silent: true });
                  })
                  .catch((error) => {
                    setError(error instanceof Error ? error.message : 'Could not delete folder.');
                  });
              }
              setSectionContextMenu(null);
            }}
            className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[color:rgba(217,45,32,0.08)]"
          >
            <Trash2 size={14} className="shrink-0 text-[var(--ledger-danger)]" />
            <span className="font-medium text-[var(--ledger-danger)]">Delete folder</span>
          </button>
        </div>
      )}

      {sortMenu &&
        createPortal(
          <div
            ref={sortMenuRef}
            className="fixed z-210 min-w-52 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
            style={{
              left: Math.max(8, Math.min(sortMenu.x, window.innerWidth - 240)),
              top: Math.max(8, Math.min(sortMenu.y, window.innerHeight - 380)),
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[color:var(--ledger-border-subtle)] px-3 py-2">
              <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                Sort {sortMenu.scopeId === ROOT_NOTE_SCOPE_ID ? 'notes' : sortMenu.scopeName}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                {formatNoteSortLabel(getSortPreferenceForScope(sortMenu.scopeId))}
              </p>
            </div>
            {NOTE_SORT_OPTIONS.map((option) => {
              const isActive =
                JSON.stringify(option.preference) ===
                JSON.stringify(getSortPreferenceForScope(sortMenu.scopeId));
              return (
                <button
                  key={option.label}
                  onClick={() => {
                    setSortPreferenceForScope(sortMenu.scopeId, option.preference);
                  }}
                  className={`flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition ${
                    isActive
                      ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                      : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      isActive ? 'bg-[var(--ledger-accent)]' : 'bg-[var(--ledger-border-subtle)]'
                    }`}
                  />
                  <span className="font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}

      {noteContextMenu &&
        (() => {
          const isBulkSelection =
            selectedNoteIds.length > 1 && selectedNoteIdSet.has(noteContextMenu.noteId);
          const selectedCount = selectedNoteIds.length;

          if (isBulkSelection) {
            return (
              <div
                className="fixed z-210 min-w-44 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
                style={{
                  left: Math.max(8, Math.min(noteContextMenu.x, window.innerWidth - 180)),
                  top: Math.max(8, Math.min(noteContextMenu.y, window.innerHeight - 180)),
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="border-b border-[color:var(--ledger-border-subtle)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                    {selectedCount} selected
                  </p>
                </div>
                <button
                  onClick={() => {
                    handleBulkExportSelectedNotes();
                  }}
                  className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
                >
                  <Download size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                  <span className="font-medium">Export selected</span>
                </button>
                <button
                  onClick={() => {
                    clearSidebarSelection();
                    setNoteContextMenu(null);
                  }}
                  className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
                >
                  <X size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                  <span className="font-medium">Clear selection</span>
                </button>
                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                <button
                  onClick={() => {
                    void handleBulkDeleteSelectedNotes();
                  }}
                  className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[color:rgba(217,45,32,0.08)]"
                >
                  <Trash2 size={14} className="shrink-0 text-[var(--ledger-danger)]" />
                  <span className="font-medium text-[var(--ledger-danger)]">Delete selected</span>
                </button>
              </div>
            );
          }

          return (
            <div
              className="fixed z-210 min-w-44 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
              style={{
                left: Math.max(8, Math.min(noteContextMenu.x, window.innerWidth - 180)),
                top: Math.max(8, Math.min(noteContextMenu.y, window.innerHeight - 280)),
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* First group: Open, Rename, Create child */}
              <button
                onClick={() => {
                  const note = notes.find((item) => item.id === noteContextMenu.noteId);
                  if (note) void openNote(note);
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <StickyNote size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Open</span>
              </button>
              <button
                onClick={() => {
                  beginInlineRename(noteContextMenu.noteId);
                  setNoteContextMenu(null);
                }}
                className="w-full h-9 px-3 rounded-none text-left hover:bg-[var(--ledger-surface-hover)] flex items-center gap-3 text-sm transition"
              >
                <span className="shrink-0 text-[var(--ledger-text-muted)]">Aa</span>
                <span className="font-medium">Rename</span>
              </button>
              <button
                onClick={() => {
                  void createChildNote(noteContextMenu.noteId);
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <Plus size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Create child</span>
              </button>
              <button
                onClick={() => {
                  void openLinkProjectModal(noteContextMenu.noteId);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <Folder size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Link to project</span>
              </button>
              <button
                onClick={() => {
                  void api
                    .moveNoteParent(noteContextMenu.noteId, null)
                    .then(() => loadNotes({ silent: true }))
                    .catch(() => {});
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <Folder size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Move to root</span>
              </button>

              {/* Divider */}
              <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />

              {/* Second group: Duplicate, Save as template */}
              <button
                onClick={() => {
                  void duplicateNoteById(noteContextMenu.noteId);
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <Copy size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Duplicate</span>
              </button>
              <button
                onClick={() => {
                  const id = noteContextMenu?.noteId;
                  if (id) {
                    const target = notes.find((n) => n.id === id);
                    const name = target?.title || 'Untitled note';
                    void handleSaveNoteAsTemplate(id, name);
                  }
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <Zap size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Save as template</span>
              </button>

              {/* Divider */}
              <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />

              {/* Third group: Delete (destructive) */}
              <button
                onClick={() => {
                  void deleteNoteById(noteContextMenu.noteId);
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[color:rgba(217,45,32,0.08)]"
              >
                <Trash2 size={14} className="shrink-0 text-[var(--ledger-danger)]" />
                <span className="font-medium text-[var(--ledger-danger)]">Delete</span>
              </button>
            </div>
          );
        })()}

      <CreateNoteModal
        isOpen={showCreateNoteModal}
        onClose={() => setShowCreateNoteModal(false)}
        defaultSectionId={noteCreationSectionId}
        onNoteCreated={(note) => {
          if (isDirty) {
            void flushAutosave().then(() => {
              const created = note as NoteRow;
              setNotes((prev) => [created, ...prev]);
              setNoteTree((prev) => [
                {
                  ...created,
                  depth: created.depth ?? 0,
                  children: [],
                },
                ...prev,
              ]);
              setSelectedNoteId(created.id);
              syncDraftFromNote(created);
            });
          } else {
            const created = note as NoteRow;
            setNotes((prev) => [created, ...prev]);
            setNoteTree((prev) => [
              {
                ...created,
                depth: created.depth ?? 0,
                children: [],
              },
              ...prev,
            ]);
            setSelectedNoteId(created.id);
            syncDraftFromNote(created);
          }
        }}
      />

      <BulkExportModal
        isOpen={showExportModal}
        onClose={() => {
          setShowExportModal(false);
          setExportNoteIds(null);
        }}
        onExport={handleBulkExport}
        notes={exportNoteIds ? notes.filter((note) => exportNoteIds.includes(note.id)) : notes}
        isMindMapOnly={exportType === 'mindmaps'}
      />

      <VersionHistoryModal
        isOpen={showVersionHistoryModal}
        noteTitle={draftTitle || selectedNote?.title || 'Untitled note'}
        versions={noteVersions}
        isLoading={isLoadingVersions}
        restoringVersionId={isRestoringVersionId}
        onClose={() => setShowVersionHistoryModal(false)}
        onRestore={(versionId) => {
          void restoreVersionById(versionId);
        }}
        resolveActorName={(userId) =>
          displayUserName(workspaceMemberById.get(userId ?? '') ?? null)
        }
      />

      <ModalOverlay
        isOpen={isLinkProjectModalOpen}
        onClose={() => {
          setIsLinkProjectModalOpen(false);
          setLinkProjectTargetNoteId(null);
        }}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
              Link to project
            </p>
            <p className="mt-1 truncate text-sm text-[var(--ledger-text-secondary)]">
              {selectedNote?.title || 'Untitled note'}
            </p>
          </div>
          <ModalCloseButton
            onClick={() => {
              setIsLinkProjectModalOpen(false);
              setLinkProjectTargetNoteId(null);
            }}
            ariaLabel="Close project link modal"
          />
        </div>

        <div className="space-y-3 p-5">
          <input
            value={linkProjectSearch}
            onChange={(event) => setLinkProjectSearch(event.target.value)}
            placeholder="Search active projects..."
            className="h-9 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
          />

          <div className="max-h-[48vh] overflow-auto space-y-1 pr-1">
            {isLoadingLinkableProjects ? (
              <p className="px-1 py-2 text-sm text-[var(--ledger-text-muted)]">
                Loading projects...
              </p>
            ) : filteredLinkableProjects.length === 0 ? (
              <p className="px-1 py-2 text-sm text-[var(--ledger-text-muted)]">
                No active projects found.
              </p>
            ) : (
              filteredLinkableProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    void linkNoteToProject(project.id);
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {project.name}
                    </p>
                    <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                      {String(project.status ?? 'active')
                        .split('_')
                        .join(' ')}
                      {typeof project.completeness === 'number'
                        ? ` · ${Math.round(project.completeness)}%`
                        : ''}
                      {project.end_date ? ` · Due ${formatCompactDateTime(project.end_date)}` : ''}
                    </p>
                  </div>
                  <span className="ml-3 shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                    Select
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </ModalOverlay>
    </div>
  );
};

export default NotesWindow;
