import {
  AlertCircle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Loader2,
  Mic,
  MoreHorizontal,
  PanelRightClose,
  Pause,
  PenLine,
  Play,
  Plus,
  Network,
  RotateCcw,
  Search,
  Settings2,
  Square,
  StickyNote,
  Trash2,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
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
import { useSearch } from '../../context/SearchContext';
import { usePins } from '../../context/PinsContext';
import { supabase } from '../../services/supabase';
import { createSignedStorageUrl } from '../../services/privateStorage';
import {
  ModuleHeaderActionButton,
  ModuleHeaderStatus,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { PinActionButton } from '../Common/PinActionButton';
import { SkeletonLoader, SkeletonNoteCard } from '../Common/Skeleton';
import { MindMapEditor } from './MindMapEditor';
import { RichTextEditor } from './RichTextEditor';
import type { SelectedContentPayload } from './editor/types/selectedContent';
import type {
  AttachmentRemoveRequest,
  AttachmentUploadRequest,
  AttachmentUploadResult,
} from './editor/types/blocks';
import type {
  EditorExternalEmbedRequest,
  EditorExternalEmbedResult,
} from './editor/types/externalEmbed';
import { htmlToPlainText, normalizeEditorHtml } from './editor/utils/html';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { useWorkspaceRouteHistory } from '../../hooks/useWorkspaceRouteHistory';
import { routeForCalendarEvent, routeForHome, routeForNote, usePlatform } from '../../platform';
import { openAskLedgerWithContext } from '../Common/askLedgerContext';
import { AskLedgerPanel } from '../Common/AskLedgerPanel';
import type { AskLedgerInitialContext } from '../../types/askLedgerContext';
import { CreateNoteModal } from './CreateNoteModal';
import { BulkExportModal } from './BulkExportModal';
import { VersionHistoryModal } from './VersionHistoryModal';
import {
  NotesSelectionComposerModal,
  type NotesSelectionComposerContext,
  type NotesSelectionComposerKind,
} from './NotesSelectionComposerModal';
import { bulkExportNotes, bulkExportMindMaps } from '../../utils/exportUtils';
import { isTeamOrientedTemplate, QUICK_TEMPLATE_DEFINITIONS } from './templateDefinitions';
import NotesHome, { notesAskSuggestions } from './NotesHome';
import type { NotesHomeTemplate, NotesHomeUpcomingMeeting } from './NotesHome';
import { createNotesHomeAskContext } from './notesHomeAskContext';
import { LinkedDesignsSection } from '../ExternalEmbeds/LinkedDesignsSection';
import { RelatedContextList } from '../Common/RelatedContextList';
import { LensCache } from '../../features/lens/lensCache';
import type {
  MeetingNoteMetadata,
  MeetingTranscriptionStatus,
  MeetingTranscriptLink,
  MeetingSpeakerIdentity,
  NoteMode,
  TranscriptSegment,
} from '../../types/notes';
import type { MeetingIntelligenceContext } from '../../types/notes';
import { resolveDeterministicSpeakerIdentity } from '../../types/meetingPeople';
import type { MeetingIdentitySuggestion } from '../../types/meetingPeople';
import type { MeetingPrepContext, MeetingPrepResult } from '../../types/meetingPrep';
import type {
  MeetingActionSuggestion,
  MeetingInsight,
  MeetingRecapDraft,
  MeetingRecapGenerationResult,
} from '../../types/meetingRecap';

type NoteRow = {
  id: string;
  workspace_id?: string;
  user_id?: string;
  updated_by?: string | null;
  title: string;
  content: string;
  content_html?: string | null;
  date: string;
  mood: string | null;
  source: string;
  parent_id?: string | null;
  section_id?: string | null;
  sort_order?: number;
  depth?: number;
  color?: string | null;
  mode?: NoteMode;
  mind_map_structure?: unknown;
  created_at: string;
  updated_at: string;
};

type MeetingSeriesOccurrence = {
  note_id: string;
  calendar_event_key: string | null;
  calendar_event_title: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  transcription_status: MeetingTranscriptionStatus;
  calendar_event_deleted: boolean;
  note?: { id: string; title: string; parent_id?: string | null; mode?: NoteMode } | null;
};

type MeetingAudioPermissionState =
  | 'not_requested'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'requires_restart'
  | 'unavailable';
type MeetingAudioPermissions = {
  microphone: MeetingAudioPermissionState;
  systemAudio: MeetingAudioPermissionState;
};
type MeetingAudioDevice = {
  id: string;
  name: string;
  kind: 'input';
  available: boolean;
  isBluetooth: boolean;
  isDefault: boolean;
  isOutputDefault: boolean;
  channelCount: number;
};
type MeetingAudioDeviceInfo = {
  devices: MeetingAudioDevice[];
  outputDevice: { id: string; name: string; isBluetooth: boolean } | null;
};
type MeetingAudioStatus = {
  state: 'idle' | 'recording' | 'paused' | 'stopped';
  sessionId: string | null;
  noteId: string | null;
  workspaceId: string | null;
  kind: 'meeting' | 'test' | null;
  sources: Array<{
    source: 'user_microphone' | 'system_audio';
    sampleRate: number;
    channels: number;
    active: boolean;
  }>;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  warnings: Array<{ source: 'user_microphone' | 'system_audio'; error: string }>;
  chunkCount: number;
  queueDepth: number;
  diskAvailableBytes: number;
};
type RecordingRecovery = {
  sessionId: string;
  noteId: string | null;
  workspaceId: string | null;
  kind: 'meeting' | 'test';
  startedAt: string;
  lastActivityAt: string;
  status: string;
  enabledSources: Array<'user_microphone' | 'system_audio'>;
  chunkCount: number;
  chunks: Array<{
    source: 'user_microphone' | 'system_audio';
    sequence: number;
    durationSeconds: number;
    finalized: boolean;
    sizeBytes: number;
  }>;
  durationSeconds: number;
  recoveryState: string;
  sourceErrors: Array<{ source: 'user_microphone' | 'system_audio'; error: string }>;
  warnings: string[];
  diskAvailableBytes: number;
};
type TranscriptionModelStatus = {
  installed: boolean;
  downloading: boolean;
  label: string;
  approximateBytes: number;
  bytesDownloaded: number;
  downloadSpeedBytesPerSecond: number;
  estimatedSecondsRemaining: number | null;
  error: string | null;
};
type TranscriptionJobStatus = {
  jobId: string;
  sessionId: string;
  noteId: string;
  workspaceId: string;
  status: 'queued' | 'preparing' | 'transcribing' | 'merging' | 'complete' | 'failed' | 'cancelled';
  progress: number;
  currentSource: 'user_microphone' | 'system_audio' | null;
  currentChunkSequence: number | null;
  completedChunks: number;
  totalChunks: number;
  error: string | null;
  segmentCount: number;
  queueDepth?: number;
};

const formatModelBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
};

const formatDownloadTime = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 'calculating time';
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} sec left`;
  return `about ${Math.ceil(seconds / 60)} min left`;
};

const formatDownloadSpeed = (bytesPerSecond: number) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
};

const meetingRecapCacheKey = (workspaceId: string, noteId: string) =>
  `${workspaceId}:${noteId}`;

const meetingRecapCacheFingerprint = (
  noteUpdatedAt: string | null | undefined,
  segments: TranscriptSegment[],
  template: MeetingNoteMetadata['meeting_template'],
  templateInstructions: string | null | undefined,
) =>
  JSON.stringify({
    noteUpdatedAt: noteUpdatedAt ?? null,
    template: template ?? 'auto',
    templateInstructions: templateInstructions ?? null,
    segments: segments.map((segment) => ({
      id: segment.id,
      updatedAt: segment.updated_at,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      text: segment.transcript_text,
    })),
  });

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

type MeetingRecapDraftCacheEntry = {
  draft: MeetingRecapDraft;
  tier: 'balanced' | 'fast' | null;
};

const POLL_INTERVAL_MS = 60000;
const NOTE_VIEWERS_POLL_MS = 30_000;
const LEFT_PANE_MIN_WIDTH = 260;
const LEFT_PANE_MAX_WIDTH = 380;
const RIGHT_PANE_MIN_WIDTH = 250;
const RIGHT_PANE_MAX_WIDTH = 360;
const NOTE_CONTEXT_MENU_HEIGHT = 352;
const meetingRecapDraftCache = new LensCache<MeetingRecapDraftCacheEntry>({
  storageKey: 'ledger:meeting-recap-draft-cache:v1',
  maxEntries: 24,
  maxAgeMs: 30 * 60 * 1000,
});
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

type NotesEmptySpaceMenuState = {
  x: number;
  y: number;
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

const todayKey = () => new Date().toISOString().slice(0, 10);

type SpellcheckAutocorrectResult = {
  title: string;
  content_html: string;
  count: number;
};

const autocorrectNoteContent = async (title: string, contentHtml: string) => {
  return window.ledgerIpc?.commands?.spellcheckAutocorrectNote({
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

const formatMeetingDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
        remainder
      ).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const transcriptSpeakerLabel = (segment: TranscriptSegment) =>
  segment.speaker_identity?.displayName?.trim() || segment.speaker_label?.trim() || (segment.audio_source === 'user_microphone' ? 'You' : 'Meeting');

const mergeTranscriptText = (first: string, second: string) => {
  const left = first.trimEnd();
  let right = second.trimStart();
  if (!left) return right;
  if (!right) return left;
  if (/[.!?]$/.test(left) && /^[.!?]/.test(right)) right = right.slice(1).trimStart();
  if (left.endsWith('\n') || right.startsWith('\n'))
    return `${left}${right}`.replace(/[ \t]+\n/g, '\n');
  if (/^[,.;:!?)]/.test(right) || /[(\[{]$/.test(left)) return `${left}${right}`;
  return `${left} ${right}`;
};

const getMeetingElapsedSeconds = (metadata: MeetingNoteMetadata | null, now = Date.now()) => {
  if (!metadata) return 0;
  const storedSeconds = Math.max(0, Number(metadata.duration_seconds) || 0);
  if (metadata.transcription_status !== 'recording' || !metadata.meeting_start_at) {
    return storedSeconds;
  }
  const startedAt = new Date(metadata.meeting_start_at).getTime();
  if (!Number.isFinite(startedAt)) return storedSeconds;
  return storedSeconds + Math.max(0, Math.floor((now - startedAt) / 1000));
};

// The API stores duration_seconds as an integer. Native capture durations can
// include fractional seconds, so normalize them before every metadata write.
const normalizeMeetingDurationSeconds = (value: unknown) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
};

const meetingStatusLabel = (status: MeetingTranscriptionStatus | null | undefined) => {
  if (status === 'recording') return 'Recording';
  if (status === 'paused') return 'Paused';
  if (status === 'processing') return 'Processing';
  if (status === 'complete') return 'Complete';
  if (status === 'failed') return 'Failed';
  return 'Ready';
};

const meetingStatusTone = (status: MeetingTranscriptionStatus | null | undefined) => {
  if (status === 'recording') return 'text-[var(--ledger-accent)]';
  if (status === 'processing') return 'text-amber-600';
  if (status === 'failed') return 'text-[var(--ledger-danger)]';
  if (status === 'complete') return 'text-emerald-600';
  return 'text-[var(--ledger-text-muted)]';
};

const meetingDateLabel = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const meetingAttendeeLabel = (attendees: unknown[] | null | undefined) => {
  const names = (attendees ?? []).map((attendee) => {
    if (typeof attendee === 'string') return attendee.trim();
    if (!attendee || typeof attendee !== 'object') return '';
    const value = attendee as Record<string, unknown>;
    return String(value.name ?? value.full_name ?? value.email ?? '').trim();
  }).filter(Boolean);
  if (!names.length) return null;
  return names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1}`;
};

const formatTranscriptTimestamp = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  return formatMeetingDuration(seconds);
};

const appendMeetingTranscriptReference = (
  html: string,
  section: string,
  quotedText: string,
  timestampMs: number,
  segmentId: string
) => {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ??
        character)
    );
  const reference = `<p data-transcript-segment-reference="${escape(
    segmentId
  )}"><strong>From transcript · ${formatTranscriptTimestamp(timestampMs)}</strong><br>${escape(
    quotedText
  )}</p>`;
  const heading = new RegExp(
    `(<h[1-6][^>]*>\\s*${section.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*</h[1-6]>)`,
    'i'
  );
  return heading.test(html) ? html.replace(heading, `$1${reference}`) : `${html}${reference}`;
};

const isRenderableTranscriptSegment = (segment: TranscriptSegment) =>
  Boolean(
    segment &&
      typeof segment.id === 'string' &&
      typeof segment.transcript_text === 'string' &&
      Number.isFinite(segment.start_ms) &&
      Number.isFinite(segment.end_ms) &&
      Number.isFinite(segment.segment_order)
  );

const safeMeetingExportName = (title: string) =>
  (title || 'meeting-notes')
    .replace(/[^a-z0-9\s_-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 100) || 'meeting-notes';

const NoteTypeIcon = ({
  mode,
  source,
  size = 13,
}: {
  mode?: NoteMode;
  source?: string;
  size?: number;
}) => {
  const iconClass = 'shrink-0 text-[var(--ledger-text-muted)]';
  if (mode !== 'meeting_note') {
    return <StickyNote size={size} className={iconClass} aria-hidden="true" />;
  }

  // Notes converted from an existing written note keep their original source,
  // so the sidebar can communicate that both note content and transcription
  // are available. Fresh meeting notes remain a single mic icon.
  if (source && source !== 'meeting') {
    return (
      <span
        className="relative inline-flex shrink-0"
        style={{ width: size + 3, height: size + 2 }}
        aria-label="Written note with transcription"
      >
        <StickyNote
          size={size}
          className={`${iconClass} absolute left-0 top-0`}
          aria-hidden="true"
        />
        <Mic
          size={Math.max(9, size - 2)}
          className={`${iconClass} absolute bottom-0 right-0 bg-[var(--ledger-surface-card)]`}
          aria-hidden="true"
        />
      </span>
    );
  }

  return <Mic size={size} className={iconClass} aria-hidden="true" />;
};

type MeetingTranscriptSectionProps = {
  metadata: MeetingNoteMetadata | null;
  segments: TranscriptSegment[];
  drafts: Record<string, string>;
  speakerDrafts: Record<string, string>;
  isLoading: boolean;
  onDraftChange: (segmentId: string, value: string) => void;
  onCommit: (segment: TranscriptSegment) => void;
  onSpeakerChange: (segment: TranscriptSegment, speakerLabel: string) => void;
  onSpeakerSelect: (segment: TranscriptSegment, speakerLabel: string) => void;
  onDelete: (segment: TranscriptSegment) => void;
  onMerge: (segment: TranscriptSegment, next: TranscriptSegment, speakerLabel?: string) => void;
  onSplit: (segment: TranscriptSegment, position: number) => void;
  isMutationBusy: boolean;
  deletedSegments: TranscriptSegment[];
  onRestore: (segment: TranscriptSegment) => void;
  onCreateLedgerItem: (
    kind: 'task' | 'reminder' | 'event' | 'intake',
    segment: TranscriptSegment,
    quotedText: string
  ) => void;
  onAddMeetingReference: (
    kind: 'action_item' | 'decision' | 'key_point' | 'meeting_note',
    segment: TranscriptSegment,
    quotedText: string
  ) => void;
  transcriptLinks: MeetingTranscriptLink[];
};

const MeetingTranscriptSection = ({
  metadata,
  segments,
  drafts,
  speakerDrafts,
  isLoading,
  onDraftChange,
  onCommit,
  onSpeakerChange,
  onSpeakerSelect,
  onDelete,
  onMerge,
  onSplit,
  isMutationBusy,
  deletedSegments,
  onRestore,
  onCreateLedgerItem,
  onAddMeetingReference,
}: MeetingTranscriptSectionProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectionById, setSelectionById] = useState<Record<string, number>>({});
  const [openSpeakerId, setOpenSpeakerId] = useState<string | null>(null);
  const [customSpeakers, setCustomSpeakers] = useState<string[]>([]);
  const [splitPreview, setSplitPreview] = useState<{
    segment: TranscriptSegment;
    position: number;
    firstText: string;
    secondText: string;
  } | null>(null);
  const [splitInstructionId, setSplitInstructionId] = useState<string | null>(null);
  const [mergePreviewId, setMergePreviewId] = useState<string | null>(null);
  const [mergeConfirmation, setMergeConfirmation] = useState<{
    segment: TranscriptSegment;
    next: TranscriptSegment;
    sourceConflict: boolean;
  } | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [speakerEditor, setSpeakerEditor] = useState<{
    segment: TranscriptSegment;
    value: string;
  } | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<'create' | 'meeting' | null>(null);
  const [selectionRangeById, setSelectionRangeById] = useState<
    Record<string, { start: number; end: number }>
  >({});
  const transcriptTextareasRef = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const resizeTranscriptTextarea = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  };
  const attendeeNames = useMemo(() => {
    const names = (metadata?.attendees ?? [])
      .map((attendee) => {
        if (typeof attendee === 'string') return attendee.trim();
        if (!attendee || typeof attendee !== 'object') return '';
        const value = attendee as Record<string, unknown>;
        return String(value.name ?? value.full_name ?? value.email ?? '').trim();
      })
      .filter(Boolean);
    return [...new Set(names)];
  }, [metadata?.attendees]);
  const speakerOptions = useMemo(
    () => [
      ...new Set([
        'You',
        'Meeting',
        'Unknown speaker',
        ...attendeeNames,
        ...customSpeakers,
        ...segments
          .filter(isRenderableTranscriptSegment)
          .map((segment) => segment.speaker_label?.trim() || '')
          .filter(Boolean),
      ]),
    ],
    [attendeeNames, customSpeakers, segments]
  );
  useEffect(() => {
    if (!openSpeakerId) return;
    const closeOnOutsideClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest('[data-speaker-menu]')) {
        setOpenSpeakerId(null);
        setSpeakerEditor(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSpeakerId(null);
        setSpeakerEditor(null);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openSpeakerId]);
  const saveSpeakerEdit = () => {
    const value = speakerEditor?.value.trim();
    if (!speakerEditor || !value) return;
    setCustomSpeakers((current) => [...new Set([...current, value])]);
    onSpeakerChange(speakerEditor.segment, value);
    onSpeakerSelect(speakerEditor.segment, value);
    setSpeakerEditor(null);
    setOpenSpeakerId(null);
  };
  const renderableSegments = useMemo(
    () => segments.filter(isRenderableTranscriptSegment),
    [segments]
  );
  useEffect(() => {
    Object.values(transcriptTextareasRef.current).forEach(resizeTranscriptTextarea);
  }, [drafts, renderableSegments]);
  const visibleSegments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return renderableSegments;
    return renderableSegments.filter((segment) => {
      const text = drafts[segment.id] ?? segment.transcript_text;
      return `${speakerLabelFor(segment)} ${text}`.toLowerCase().includes(query);
    });
  }, [drafts, renderableSegments, searchQuery]);
  useEffect(() => {
    if (!openActionsId) return;

    const closeMenu = () => setOpenActionsId(null);
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-transcript-actions]')) return;
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
  }, [openActionsId]);
  useEffect(() => {
    if (!openActionsId) setOpenSubmenu(null);
  }, [openActionsId]);
  const quotedTextFor = (segment: TranscriptSegment) => {
    const text = drafts[segment.id] ?? segment.transcript_text;
    const range = selectionRangeById[segment.id];
    return range && range.end > range.start
      ? text.slice(range.start, range.end).trim()
      : text.trim();
  };
  const speakerLabelFor = (segment: TranscriptSegment) =>
    segment.speaker_identity?.displayName?.trim() || segment.speaker_label?.trim() ||
    (segment.audio_source === 'user_microphone' ? 'You' : 'Meeting');
  const requestSplit = (segment: TranscriptSegment) => {
    if (isMutationBusy) return;
    const text = drafts[segment.id] ?? segment.transcript_text;
    const position = selectionById[segment.id];
    const textarea = transcriptTextareasRef.current[segment.id];
    if (
      position === undefined ||
      position <= 0 ||
      position >= text.length ||
      !text.slice(0, position).trim() ||
      !text.slice(position).trim()
    ) {
      textarea?.focus();
      setSplitInstructionId(segment.id);
      window.setTimeout(
        () => setSplitInstructionId((current) => (current === segment.id ? null : current)),
        2200
      );
      return;
    }
    setSplitInstructionId(null);
    setSplitPreview({
      segment,
      position,
      firstText: text.slice(0, position).trim(),
      secondText: text.slice(position).trim(),
    });
  };
  const requestMerge = (segment: TranscriptSegment, next: TranscriptSegment) => {
    if (isMutationBusy) return;
    setMergePreviewId(next.id);
    if (segment.audio_source !== next.audio_source) {
      setMergeConfirmation({ segment, next, sourceConflict: true });
      return;
    }
    if (speakerLabelFor(segment) !== speakerLabelFor(next)) {
      setMergeConfirmation({ segment, next, sourceConflict: false });
      return;
    }
    onMerge(segment, next, speakerLabelFor(segment));
  };
  const copyAllTranscript = () => {
    const text = renderableSegments
      .map(
        (segment) =>
          `[${formatTranscriptTimestamp(segment.start_ms)}] ${speakerLabelFor(segment)}: ${
            drafts[segment.id] ?? segment.transcript_text
          }`.trim()
      )
      .join('\n\n');
    void navigator.clipboard?.writeText(text);
  };
  const status = metadata?.transcription_status ?? 'idle';
  const statusMessage =
    status === 'recording'
      ? 'Transcript capture will appear here when processing is added.'
      : status === 'processing'
      ? 'Whisper is processing finalized audio locally.'
      : status === 'failed'
      ? metadata?.transcription_error || 'Transcription failed.'
      : status === 'complete'
      ? 'No transcript segments yet.'
      : 'No transcript yet.';
  return (
    <section className="overflow-visible rounded-2xl bg-[var(--ledger-surface-card)]" aria-label="Transcript">
      <div className="px-1 pb-3 pt-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--ledger-text-muted)]">
              <Loader2 size={13} className="animate-spin" /> Loading transcript…
            </div>
          ) : segments.length === 0 ? (
            <p className="text-xs leading-5 text-[var(--ledger-text-muted)]">{statusMessage}</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-1 text-[10px] text-[var(--ledger-text-muted)]">
                <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                  <Search size={11} aria-hidden="true" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search transcript…"
                    aria-label="Search transcript"
                    className="w-32 border-b border-[color:var(--ledger-border-subtle)]/60 bg-transparent py-0.5 outline-none placeholder:text-[var(--ledger-text-muted)] sm:w-40"
                  />
                </label>
                <button
                  type="button"
                  onClick={copyAllTranscript}
                  aria-label="Copy all transcript"
                  title="Copy all transcript"
                  className="rounded p-1 hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <Copy size={12} aria-hidden="true" />
                </button>
              </div>
              {deletedSegments.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-[var(--ledger-surface-muted)] px-2 py-1.5 text-[10px] text-[var(--ledger-text-muted)]">
                  <span>{deletedSegments.length} recently deleted</span>
                  <button
                    type="button"
                    onClick={() => onRestore(deletedSegments[deletedSegments.length - 1])}
                    className="font-medium text-[var(--ledger-accent)] hover:underline"
                  >
                    Restore latest
                  </button>
                </div>
              )}
              {mergeConfirmation && (
                <div
                  className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-2 text-[10px] text-[var(--ledger-text-secondary)]"
                  role="alertdialog"
                  aria-label="Confirm transcript merge"
                >
                  {mergeConfirmation.sourceConflict ? (
                    <p>
                      These segments came from different audio sources. They will stay separate so
                      source provenance is not lost.
                    </p>
                  ) : (
                    <>
                      <p>Choose the speaker label for the merged segment.</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onMerge(
                              mergeConfirmation.segment,
                              mergeConfirmation.next,
                              speakerLabelFor(mergeConfirmation.segment)
                            );
                            setMergeConfirmation(null);
                          }}
                          className="rounded border border-[color:var(--ledger-border-subtle)] px-2 py-1 hover:bg-[var(--ledger-surface-hover)]"
                        >
                          Keep {speakerLabelFor(mergeConfirmation.segment)}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onMerge(
                              mergeConfirmation.segment,
                              mergeConfirmation.next,
                              speakerLabelFor(mergeConfirmation.next)
                            );
                            setMergeConfirmation(null);
                          }}
                          className="rounded border border-[color:var(--ledger-border-subtle)] px-2 py-1 hover:bg-[var(--ledger-surface-hover)]"
                        >
                          Keep {speakerLabelFor(mergeConfirmation.next)}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const value = window.prompt(
                              'Speaker label for merged segment',
                              speakerLabelFor(mergeConfirmation.segment)
                            );
                            if (value?.trim()) {
                              setCustomSpeakers((current) => [
                                ...new Set([...current, value.trim()]),
                              ]);
                              onMerge(
                                mergeConfirmation.segment,
                                mergeConfirmation.next,
                                value.trim()
                              );
                              setMergeConfirmation(null);
                            }
                          }}
                          className="rounded border border-[color:var(--ledger-border-subtle)] px-2 py-1 hover:bg-[var(--ledger-surface-hover)]"
                        >
                          Choose label…
                        </button>
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setMergeConfirmation(null)}
                    className="mt-1.5 rounded px-1.5 py-0.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    Close
                  </button>
                </div>
              )}
              {visibleSegments.length === 0 ? (
                <div
                  className="flex min-h-24 flex-col items-center justify-center px-4 py-5 text-center"
                  role="status"
                >
                  <p className="text-xs font-medium text-[var(--ledger-text-secondary)]">
                    {searchQuery.trim() ? 'No matching transcript segments' : 'No transcript segments yet'}
                  </p>
                  <p className="mt-1 max-w-xs text-[10px] leading-4 text-[var(--ledger-text-muted)]">
                    {searchQuery.trim()
                      ? 'Try a different word or phrase.'
                      : 'Transcript segments will appear here when they are available.'}
                  </p>
                </div>
              ) : (
                visibleSegments.map((segment, visibleIndex) => {
                  const sourceLabel = speakerLabelFor(segment);
                  const isMicrophoneSegment = segment.audio_source === 'user_microphone';
                  const nextSegment = visibleSegments[visibleIndex + 1];
                  const mergeBlockedByFilter = false;
                  const isMergeTarget = mergePreviewId === segment.id;
                  const isMergeSource = Boolean(nextSegment && mergePreviewId === nextSegment.id);
                  return (
                    <div
                      key={segment.id}
                      data-transcript-segment={segment.id}
                      className={`group relative flex flex-col gap-1 ${
                        isMicrophoneSegment ? 'items-end' : 'items-start'
                      }`}
                      tabIndex={0}
                      aria-label={`Transcript segment ${visibleIndex + 1}`}
                    >
                      <div
                        className={`relative w-fit min-w-0 max-w-[65%] rounded-2xl px-3 py-2 ${
                          isMicrophoneSegment
                            ? 'bg-[var(--ledger-surface-selected)]'
                            : 'bg-[var(--ledger-surface-muted)]'
                        } ${isMergeTarget || isMergeSource ? 'ring-1 ring-[var(--ledger-accent)]/40' : ''}`}
                      >
                        <div className="relative mb-0.5 flex min-h-6 items-center gap-1.5 text-[10px] text-[var(--ledger-text-muted)]">
                          <span
                            title={
                              segment.audio_source === 'user_microphone'
                                ? 'Captured from microphone'
                                : 'Captured from system audio'
                            }
                            className="inline-flex shrink-0 opacity-70"
                            aria-label={
                              segment.audio_source === 'user_microphone'
                                ? 'Captured from microphone'
                                : 'Captured from system audio'
                            }
                          >
                            {segment.audio_source === 'user_microphone' ? (
                              <Mic size={11} />
                            ) : (
                              <Volume2 size={11} />
                            )}
                          </span>
                          <div className="relative" data-speaker-menu>
                            <button
                              type="button"
                              onClick={() =>
                                setOpenSpeakerId((current) =>
                                  current === segment.id ? null : segment.id
                                )
                              }
                              className="inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] focus:bg-[var(--ledger-surface-hover)] focus:outline-none"
                              aria-haspopup="menu"
                              aria-expanded={openSpeakerId === segment.id}
                              aria-label={`Speaker label: ${
                                speakerDrafts[segment.id] ?? sourceLabel
                              }`}
                            >
                              {speakerDrafts[segment.id] ?? sourceLabel}
                              <ChevronDown size={10} />
                            </button>
                            {openSpeakerId === segment.id && (
                              <div
                                role="menu"
                                className="absolute left-0 top-full z-20 mt-1 min-w-36 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
                              >
                                {speakerOptions.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      onSpeakerChange(segment, option);
                                      onSpeakerSelect(segment, option);
                                      setOpenSpeakerId(null);
                                    }}
                                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                  >
                                    {option}
                                  </button>
                                ))}
                                <div className="my-1 border-t border-[color:var(--ledger-border-subtle)]" />
                                {speakerEditor?.segment.id === segment.id ? (
                                  <div
                                    className="space-y-1.5 px-1 py-1"
                                    role="group"
                                    aria-label="Edit speaker name"
                                  >
                                    <input
                                      autoFocus
                                      value={speakerEditor.value}
                                      onChange={(event) =>
                                        setSpeakerEditor((current) =>
                                          current
                                            ? { ...current, value: event.target.value }
                                            : current
                                        )
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          saveSpeakerEdit();
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          setSpeakerEditor(null);
                                        }
                                      }}
                                      placeholder="Speaker name"
                                      aria-label="Speaker name"
                                      className="h-7 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2 text-[10px] text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-accent)]"
                                    />
                                    <div className="flex justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setSpeakerEditor(null)}
                                        className="rounded-md px-1.5 py-1 text-[10px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={saveSpeakerEdit}
                                        disabled={!speakerEditor.value.trim()}
                                        className="rounded-md bg-[var(--ledger-accent)] px-1.5 py-1 text-[10px] text-white disabled:opacity-40"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => setSpeakerEditor({ segment, value: '' })}
                                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                                    >
                                      Add speaker…
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() =>
                                        setSpeakerEditor({
                                          segment,
                                          value: speakerDrafts[segment.id] ?? sourceLabel,
                                        })
                                      }
                                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                                    >
                                      Rename speaker…
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div
                            className="relative ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            data-transcript-actions
                          >
                            <button
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                const textarea = transcriptTextareasRef.current[segment.id];
                                if (textarea)
                                  setSelectionRangeById((current) => ({
                                    ...current,
                                    [segment.id]: {
                                      start: textarea.selectionStart,
                                      end: textarea.selectionEnd,
                                    },
                                  }));
                              }}
                              onClick={() =>
                                setOpenActionsId((current) =>
                                  current === segment.id ? null : segment.id
                                )
                              }
                              className="rounded p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--ledger-accent)]"
                              aria-label="Transcript segment actions"
                              aria-haspopup="menu"
                              aria-expanded={openActionsId === segment.id}
                            >
                              <MoreHorizontal size={12} />
                            </button>
                            {openActionsId === segment.id && (
                              <div
                                role="menu"
                                className="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
                              >
                                <div className="relative">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() =>
                                      setOpenSubmenu((current) =>
                                        current === 'create' ? null : 'create'
                                      )
                                    }
                                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                  >
                                    Create in Ledger <ChevronRight size={11} />
                                  </button>
                                  {openSubmenu === 'create' && (
                                    <div
                                      className="absolute right-full top-0 mr-1 min-w-32 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
                                      role="menu"
                                    >
                                      {(['task', 'reminder', 'event', 'intake'] as const).map(
                                        (kind) => (
                                          <button
                                            key={kind}
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                              onCreateLedgerItem(
                                                kind,
                                                segment,
                                                quotedTextFor(segment)
                                              );
                                              setOpenActionsId(null);
                                            }}
                                            className="flex w-full rounded px-2 py-1.5 text-left text-[10px] capitalize text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                          >
                                            {kind === 'intake' ? 'Intake item' : kind}
                                          </button>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="relative">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() =>
                                      setOpenSubmenu((current) =>
                                        current === 'meeting' ? null : 'meeting'
                                      )
                                    }
                                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                  >
                                    Add to meeting <ChevronRight size={11} />
                                  </button>
                                  {openSubmenu === 'meeting' && (
                                    <div
                                      className="absolute right-full top-0 mr-1 min-w-36 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
                                      role="menu"
                                    >
                                      {(
                                        [
                                          ['action_item', 'Mark as action item'],
                                          ['decision', 'Mark as decision'],
                                          ['key_point', 'Mark as key point'],
                                          ['meeting_note', 'Add to meeting notes'],
                                        ] as const
                                      ).map(([kind, label]) => (
                                        <button
                                          key={kind}
                                          type="button"
                                          role="menuitem"
                                          onClick={() => {
                                            onAddMeetingReference(
                                              kind,
                                              segment,
                                              quotedTextFor(segment)
                                            );
                                            setOpenActionsId(null);
                                          }}
                                          className="flex w-full rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    requestSplit(segment);
                                    setOpenActionsId(null);
                                  }}
                                  disabled={isMutationBusy}
                                  className="flex w-full rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-40"
                                >
                                  Split
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  title={
                                    mergeBlockedByFilter
                                      ? 'Switch to All to merge across the full transcript'
                                      : undefined
                                  }
                                  onClick={() => {
                                    if (nextSegment && !mergeBlockedByFilter)
                                      requestMerge(segment, nextSegment);
                                    setOpenActionsId(null);
                                  }}
                                  disabled={!nextSegment || mergeBlockedByFilter || isMutationBusy}
                                  className="flex w-full rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-40"
                                >
                                  Merge next
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(quotedTextFor(segment));
                                    setOpenActionsId(null);
                                  }}
                                  className="flex w-full rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                >
                                  Copy text
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    const seconds = Math.max(
                                      0,
                                      Math.floor(segment.start_ms / 1000)
                                    );
                                    const timestamp = `${String(Math.floor(seconds / 60)).padStart(
                                      2,
                                      '0'
                                    )}:${String(seconds % 60).padStart(2, '0')}`;
                                    void navigator.clipboard?.writeText(
                                      `[${timestamp}] ${sourceLabel}: ${quotedTextFor(segment)}`
                                    );
                                    setOpenActionsId(null);
                                  }}
                                  className="flex w-full rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                                >
                                  Copy with timestamp
                                </button>
                                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    onDelete(segment);
                                    setOpenActionsId(null);
                                  }}
                                  className="flex w-full rounded px-2 py-1.5 text-left text-[10px] text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.06)]"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <textarea
                          ref={(element) => {
                            transcriptTextareasRef.current[segment.id] = element;
                            resizeTranscriptTextarea(element);
                          }}
                          value={drafts[segment.id] ?? segment.transcript_text}
                          onChange={(event) => {
                            resizeTranscriptTextarea(event.currentTarget);
                            onDraftChange(segment.id, event.target.value);
                          }}
                          onKeyDown={(event) => {
                            // Transcript editing is a native textarea interaction. Keep
                            // Backspace/Delete and caret navigation away from any
                            // window-level Notes shortcuts.
                            event.stopPropagation();
                          }}
                          onSelect={(event) => {
                            const target = event.target as HTMLTextAreaElement;
                            setSelectionById((current) => ({
                              ...current,
                              [segment.id]: target.selectionStart,
                            }));
                            setSelectionRangeById((current) => ({
                              ...current,
                              [segment.id]: {
                                start: target.selectionStart,
                                end: target.selectionEnd,
                              },
                            }));
                          }}
                          onKeyUp={(event) => {
                            const target = event.currentTarget;
                            setSelectionById((current) => ({
                              ...current,
                              [segment.id]: target.selectionStart,
                            }));
                            setSelectionRangeById((current) => ({
                              ...current,
                              [segment.id]: {
                                start: target.selectionStart,
                                end: target.selectionEnd,
                              },
                            }));
                          }}
                          onBlur={() => onCommit(segment)}
                          rows={1}
                          className="min-h-[1.25rem] w-full resize-none overflow-hidden bg-transparent text-xs leading-5 text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]"
                          aria-label={`Transcript from ${sourceLabel}`}
                        />
                        {splitInstructionId === segment.id && (
                          <p className="mt-1 text-[10px] text-[var(--ledger-text-muted)]">
                            Place the cursor where you want to split.
                          </p>
                        )}
                        {splitPreview?.segment.id === segment.id && (
                          <div
                            className="mt-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-1.5 text-[10px]"
                            role="dialog"
                            aria-label="Preview split"
                          >
                            <div className="grid gap-1 text-[var(--ledger-text-secondary)]">
                              <span>Before: {splitPreview.firstText}</span>
                              <span>After: {splitPreview.secondText}</span>
                            </div>
                            <div className="mt-1.5 flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onSplit(segment, splitPreview.position);
                                  setSplitPreview(null);
                                }}
                                disabled={isMutationBusy}
                                className="rounded bg-[var(--ledger-accent)] px-2 py-1 text-white disabled:opacity-40"
                              >
                                Split here
                              </button>
                              <button
                                type="button"
                                onClick={() => setSplitPreview(null)}
                                className="rounded px-2 py-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <span className="px-1 text-[10px] tabular-nums text-[var(--ledger-text-muted)]">
                        {formatTranscriptTimestamp(segment.start_ms)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
    </section>
  );
};

class MeetingTranscriptErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[meeting-notes] transcript panel crashed', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section
          className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 py-5 text-sm text-[var(--ledger-text-secondary)]"
          role="alert"
        >
          <p className="font-medium text-[var(--ledger-text-primary)]">
            Transcript could not be displayed.
          </p>
          <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
            Your recording and note are still safe. Reload the note to try again.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--ledger-surface-hover)]"
          >
            Try again
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}

const permissionLabel = (state: MeetingAudioPermissionState) => {
  switch (state) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'restricted':
      return 'Restricted';
    case 'requires_restart':
      return 'Restart Ledger';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Not requested';
  }
};

type MeetingAudioSetupProps = {
  permissions: MeetingAudioPermissions | null;
  devices: MeetingAudioDevice[];
  selectedMicrophoneId: string | null;
  outputDevice: MeetingAudioDeviceInfo['outputDevice'];
  onSelectMicrophone: (deviceId: string) => void;
  isBusy: boolean;
  testingSource: 'user_microphone' | 'system_audio' | null;
  onRequestPermissions: () => void;
  onTestSource: (source: 'user_microphone' | 'system_audio') => void;
  onStopTest: () => void;
  onOpenSettings: (area: 'microphone' | 'screen-recording') => void;
  audioError: string | null;
  onClose: () => void;
  isBrowser?: boolean;
  canCaptureMicrophone?: boolean;
};

const MeetingAudioSetup = ({
  permissions,
  devices,
  selectedMicrophoneId,
  outputDevice,
  onSelectMicrophone,
  isBusy,
  testingSource,
  onRequestPermissions,
  onTestSource,
  onStopTest,
  onOpenSettings,
  audioError,
  onClose,
  isBrowser = false,
  canCaptureMicrophone = false,
}: MeetingAudioSetupProps) => (
  <ModalOverlay
    isOpen
    onClose={onClose}
    closeOnBackdropClick={!isBusy}
    backdropBorderRadius="inherit"
    disablePortal
    manageWindowChrome={false}
    classNameContainer="w-full max-w-2xl overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
  >
    <div role="dialog" aria-modal="true" aria-label="Set up Meeting Notes audio">
      <div className="flex items-center justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:rgba(255,95,64,0.12)] text-[var(--ledger-accent)]">
            <Mic size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Meeting audio setup</h2>
            <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
              Choose what Ledger should hear. Audio stays on this computer.
            </p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} ariaLabel="Close audio setup" disabled={isBusy} />
      </div>
      <div className="px-5 py-4">
        {audioError && (
          <div
            className="mb-3 rounded-lg border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.06)] px-3 py-2 text-[10px] leading-4 text-[var(--ledger-danger)]"
            role="alert"
          >
            {audioError}
          </div>
        )}
        {!window.meetingAudio ? (
          <div className="space-y-3 rounded-lg bg-[color:rgba(217,45,32,0.06)] px-3 py-3 text-xs text-[var(--ledger-danger)]">
            <p>{isBrowser ? 'Ledger Web can check microphone permission, but native recording and system-audio capture require the desktop app.' : 'Meeting audio capture requires the packaged macOS Ledger app.'}</p>
            {isBrowser && canCaptureMicrophone && (
              <button type="button" onClick={onRequestPermissions} disabled={isBusy} className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-primary)] disabled:opacity-50">
                Check microphone permission
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-[10px] text-[var(--ledger-text-muted)]">
              <span className="font-medium text-[var(--ledger-text-secondary)]">Microphone</span>
              <select
                value={selectedMicrophoneId ?? ''}
                onChange={(event) => onSelectMicrophone(event.target.value)}
                className="max-w-48 rounded bg-transparent text-[10px] text-[var(--ledger-text-primary)] outline-none"
              >
                {devices.length === 0 ? (
                  <option value="">No input devices found</option>
                ) : (
                  devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                      {device.isBluetooth ? ' · Bluetooth' : ''}
                    </option>
                  ))
                )}
              </select>
              {outputDevice && <span className="ml-auto">Output: {outputDevice.name}</span>}
            </div>
            {selectedMicrophoneId &&
              devices.find((device) => device.id === selectedMicrophoneId)?.isBluetooth &&
              outputDevice?.isBluetooth && (
                <div
                  className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] text-amber-800"
                  role="status"
                >
                  <AlertCircle size={12} className="shrink-0" />
                  <span className="flex-1">
                    Headphone audio quality may decrease with this Bluetooth microphone.
                  </span>
                  {devices.find((device) => !device.isBluetooth) && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectMicrophone(devices.find((device) => !device.isBluetooth)!.id)
                      }
                      className="font-medium underline underline-offset-2"
                    >
                      Use another microphone
                    </button>
                  )}
                </div>
              )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  ['user_microphone', 'Microphone', 'microphone', Mic, 'Hear your voice.'],
                  [
                    'system_audio',
                    'System audio',
                    'screen-recording',
                    Volume2,
                    'Hear audio playing through your computer.',
                  ],
                ] as const
              ).map(([source, label, permissionKey, Icon, description]) => {
                const permission =
                  permissions?.[permissionKey === 'microphone' ? 'microphone' : 'systemAudio'] ??
                  'not_requested';
                const isTesting = testingSource === source;
                return (
                  <div
                    key={source}
                    className="flex min-h-28 flex-col justify-between rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon
                        size={16}
                        className="mt-0.5 shrink-0 text-[var(--ledger-text-secondary)]"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold">{label}</p>
                          <span
                            className={`text-[10px] ${
                              permission === 'granted'
                                ? 'text-emerald-600'
                                : permission === 'denied'
                                ? 'text-[var(--ledger-danger)]'
                                : 'text-[var(--ledger-text-muted)]'
                            }`}
                          >
                            {permissionLabel(permission)}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-[var(--ledger-text-muted)]">
                          {description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-1.5">
                      {permission !== 'granted' && permission !== 'unavailable' && (
                        <button
                          type="button"
                          onClick={() => onOpenSettings(permissionKey)}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                        >
                          <Settings2 size={12} /> Settings
                        </button>
                      )}
                      {permission === 'granted' && (
                        <button
                          type="button"
                          onClick={isTesting ? onStopTest : () => onTestSource(source)}
                          disabled={isBusy || Boolean(testingSource && !isTesting)}
                          className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--ledger-text-secondary)] disabled:opacity-40"
                        >
                          {isTesting ? 'Stop test' : 'Test source'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] leading-4 text-[var(--ledger-text-muted)]">
              {typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
                ? 'Windows captures audio from the active output device. Ledger captures audio, not video.'
                : 'macOS calls system-audio access “Screen &amp; System Audio Recording.” Ledger captures audio, not video. If it is missing from Settings, use + to add the packaged Ledger app, then restart if prompted.'}
            </p>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
        <span className="text-[10px] text-[var(--ledger-text-muted)]">
          Meeting consent may be required in your location.
        </span>
        <div className="flex items-center gap-2">
          {window.meetingAudio && (
            <button
              type="button"
              onClick={onRequestPermissions}
              disabled={isBusy}
              className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-[11px] font-medium text-white disabled:opacity-40"
            >
              {isBusy ? 'Checking…' : 'Check permissions'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] px-3 py-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  </ModalOverlay>
);

const MeetingTranscriptionSetup = ({
  model,
  isBusy,
  onInstall,
  onClose,
}: {
  model: TranscriptionModelStatus | null;
  isBusy: boolean;
  onInstall: () => void;
  onClose: () => void;
}) => (
  <ModalOverlay
    isOpen
    onClose={onClose}
    closeOnBackdropClick={!isBusy}
    backdropBorderRadius="inherit"
    disablePortal
    manageWindowChrome={false}
    classNameContainer="w-full max-w-[560px] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
  >
    <div role="dialog" aria-modal="true" aria-label="Set up local transcription" className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:rgba(255,95,64,0.12)] text-[var(--ledger-accent)]">
          <Download size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-[13px] font-semibold">{model?.label || 'Whisper model'}</h2>
            <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">
              {model?.downloading
                ? `${Math.round((model.bytesDownloaded / Math.max(1, model.approximateBytes)) * 100)}% · ${formatDownloadTime(model.estimatedSecondsRemaining)}`
                : 'Runs locally · no API key'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[var(--ledger-text-muted)]">
            {model?.downloading
              ? `${formatModelBytes(model.bytesDownloaded)} of ${formatModelBytes(model.approximateBytes)}${formatDownloadSpeed(model.downloadSpeedBytesPerSecond) ? ` · ${formatDownloadSpeed(model.downloadSpeedBytesPerSecond)}` : ''}`
              : model?.approximateBytes
              ? `About ${Math.round(model.approximateBytes / 1024 / 1024)} MB · stored on this computer`
              : 'Optional local speech-recognition model'}
          </p>
        </div>
        <button
          type="button"
          onClick={onInstall}
          disabled={isBusy || model?.downloading}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[var(--ledger-accent)] px-2.5 text-[10px] font-medium text-white disabled:opacity-40"
        >
          <Download size={12} />
          {model?.downloading ? 'Downloading…' : isBusy ? 'Preparing…' : 'Download'}
        </button>
        <ModalCloseButton onClick={onClose} ariaLabel="Close transcription setup" disabled={isBusy} />
      </div>
      {model?.downloading && (
        <div className="mt-2.5">
          <div
            className="h-1 overflow-hidden rounded-full bg-[var(--ledger-surface-muted)]"
            role="progressbar"
            aria-label="Whisper model download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round((model.bytesDownloaded / Math.max(1, model.approximateBytes)) * 100))}
          >
            <div
              className="h-full rounded-full bg-[var(--ledger-accent)] transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(2, (model.bytesDownloaded / Math.max(1, model.approximateBytes)) * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[9px] text-[var(--ledger-text-muted)]">Large one-time download · stays on this computer</p>
        </div>
      )}
      {model?.error && <p className="mt-2 text-[10px] text-[var(--ledger-danger)]">{model.error}</p>}
    </div>
  </ModalOverlay>
);

const RecordingRecoveryNotice = ({
  recoveries,
  activeWorkspaceId,
  isBusy,
  onRecover,
  onDiscard,
  onReveal,
}: {
  recoveries: RecordingRecovery[];
  activeWorkspaceId: string | null;
  isBusy: string | null;
  onRecover: (session: RecordingRecovery) => void;
  onDiscard: (session: RecordingRecovery) => void;
  onReveal: (session: RecordingRecovery) => void;
}) => {
  if (!recoveries.length) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
      <div className="flex items-start gap-2">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">An interrupted meeting recording was found.</p>
          <p className="mt-1 text-[11px] leading-5 text-amber-800">
            Review the available audio before attaching it to its original meeting note. Ledger will
            not attach it across workspaces.
          </p>
          <div className="mt-2 space-y-2">
            {recoveries.map((session) => {
              const canRecover = Boolean(
                session.noteId && session.workspaceId && session.workspaceId === activeWorkspaceId
              );
              return (
                <div
                  key={session.sessionId}
                  className="rounded-lg border border-amber-200 bg-white/60 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium">
                        {session.kind === 'test' ? 'Audio test' : 'Meeting recording'}
                      </p>
                      <p className="text-[10px] text-amber-800">
                        {session.chunkCount} chunks ·{' '}
                        {formatMeetingDuration(session.durationSeconds)} ·{' '}
                        {session.enabledSources.join(' + ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onReveal(session)}
                        disabled={Boolean(isBusy)}
                        className="rounded-md border border-amber-300 px-2 py-1 text-[10px] font-medium text-amber-900 disabled:opacity-40"
                      >
                        Open audio
                      </button>
                      <button
                        type="button"
                        onClick={() => onRecover(session)}
                        disabled={!canRecover || Boolean(isBusy)}
                        className="rounded-md bg-amber-700 px-2 py-1 text-[10px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          !canRecover
                            ? 'Switch to the original workspace to recover this recording'
                            : undefined
                        }
                      >
                        {isBusy === `recover:${session.sessionId}` ? 'Recovering…' : 'Recover'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDiscard(session)}
                        disabled={Boolean(isBusy)}
                        className="rounded-md border border-amber-300 px-2 py-1 text-[10px] font-medium text-amber-900 disabled:opacity-40"
                      >
                        {isBusy === `discard:${session.sessionId}` ? 'Discarding…' : 'Discard'}
                      </button>
                    </div>
                  </div>
                  {session.sourceErrors.length > 0 && (
                    <p className="mt-1 text-[10px] text-amber-800">
                      {session.sourceErrors[0].error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const MeetingRecapDraftSection = ({
  draft,
  onCitation,
  onCreateAction,
  onCreateReminder,
  onCreateEvent,
  onLinkProject,
  identitySuggestions,
  onConfirmIdentity,
  showWorkActions = false,
}: {
  draft: MeetingRecapDraft;
  onCitation: (segmentId: string) => void;
  onCreateAction: (action: MeetingActionSuggestion) => void;
  onCreateReminder: (action: MeetingActionSuggestion) => void;
  onCreateEvent: (action: MeetingActionSuggestion) => void;
  onLinkProject: () => void;
  identitySuggestions: MeetingIdentitySuggestion[];
  onConfirmIdentity: (suggestion: MeetingIdentitySuggestion) => void;
  showWorkActions?: boolean;
}) => {
  const citation = (item: MeetingInsight) =>
    item.sourceRefs.map((ref) => (
      <button
        key={`${ref.transcriptSegmentId}:${ref.timestampMs}`}
        type="button"
        onClick={() => onCitation(ref.transcriptSegmentId)}
        className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
        title="Open transcript evidence"
      >
        {formatTranscriptTimestamp(ref.timestampMs)} ↗
      </button>
    ));
  const section = (title: string, items: MeetingInsight[], action = false) =>
    items.length ? (
      <section className="mt-5" key={title}>
        <h3 className="mb-1.5 text-[11px] font-semibold text-[var(--ledger-text-primary)]">{title}</h3>
        <ul className="space-y-1.5 text-sm leading-6 text-[var(--ledger-text-secondary)]">
          {items.map((item, index) => {
            const actionItem = action ? (item as MeetingActionSuggestion) : null;
            return (
              <li key={`${title}-${index}`} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ledger-accent)]" />
                <span>
                  {actionItem?.ownerText ? `${actionItem.ownerText} — ` : ''}{item.text}
                  {actionItem?.dueDateText ? ` · ${actionItem.dueDateText}` : ''}
                  {citation(item)}
                  {showWorkActions && actionItem && (
                    <button
                      type="button"
                      onClick={() => onCreateAction(actionItem)}
                      className="ml-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                    >
                      Create task
                    </button>
                  )}
                  {showWorkActions && actionItem && <>
                    <button type="button" onClick={() => onCreateReminder(actionItem)} className="ml-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-1.5 py-0.5 text-[10px] font-medium">Reminder</button>
                    <button type="button" onClick={() => onCreateEvent(actionItem)} className="ml-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-1.5 py-0.5 text-[10px] font-medium">Event</button>
                    <button type="button" onClick={onLinkProject} className="ml-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-1.5 py-0.5 text-[10px] font-medium">Link project</button>
                  </>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;
  return (
    <section className="mb-6 space-y-5 text-[var(--ledger-text-secondary)]" data-meeting-recap-draft>
      <div className="space-y-5">
        {draft.overview.trim() && (
          <section>
            <h3 className="text-sm font-medium text-[var(--ledger-text-primary)]">Recap</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--ledger-text-secondary)]">{draft.overview}</p>
          </section>
        )}
        {identitySuggestions.length > 0 && (
          <section className="border-l-2 border-[color:var(--ledger-border-subtle)] pl-3">
            <h3 className="mb-1.5 text-xs font-medium text-[var(--ledger-text-primary)]">People to review</h3>
            <div className="space-y-1.5 text-sm text-[var(--ledger-text-secondary)]">
              {identitySuggestions.map((suggestion, index) => (
                <div key={`${suggestion.rawSpeakerId ?? 'unknown'}:${index}`} className="flex items-center justify-between gap-2 py-1">
                  <span>{suggestion.displayName ? `${suggestion.displayName}?` : 'Unknown speaker'} <span className="text-[10px] text-[var(--ledger-text-muted)]">suggested</span></span>
                  {suggestion.displayName && suggestion.rawSpeakerId && <button type="button" onClick={() => onConfirmIdentity(suggestion)} className="rounded-md border border-[color:var(--ledger-border-subtle)] px-1.5 py-0.5 text-[10px] font-medium">Confirm</button>}
                </div>
              ))}
            </div>
          </section>
        )}
        {section('Decisions', draft.decisions)}
        {section('Next actions', draft.actions, true)}
        {section('Open threads', draft.openThreads)}
      </div>
    </section>
  );
};

const MeetingRecapReviewBar = ({
  tier,
  onRegenerate,
  onAccept,
  isBusy,
}: {
  tier: 'balanced' | 'fast' | null;
  onRegenerate: () => void;
  onAccept: () => void;
  isBusy: boolean;
}) => (
  <div className="flex h-12 items-center gap-1 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 text-[10px] shadow-sm" data-meeting-recap-review-bar>
    <span className="px-2 text-[var(--ledger-text-muted)]">Draft · {tier === 'fast' ? 'Fast' : 'Balanced'}</span>
    <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onRegenerate} disabled={isBusy} aria-label="Regenerate recap" title="Regenerate recap" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--ledger-text-muted)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-40">
      <RotateCcw size={13} aria-hidden="true" />
    </button>
    <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onAccept} disabled={isBusy} aria-label="Accept recap" title="Accept recap" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--ledger-text-primary)] transition-colors hover:bg-[var(--ledger-surface-hover)] disabled:opacity-40">
      <CheckCircle2 size={14} aria-hidden="true" />
    </button>
  </div>
);

export const NotesWindow = ({ focusContext, initialView }: { focusContext?: string; initialView?: 'write' | 'outline' | 'map' | 'transcribe' } = {}) => {
  const platform = usePlatform();
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const { workspaceShellLayout, reduceMotion } = useSidebar();
  const api = useApi();
  const viewportWidth = useViewportWidth();
  const initialFocusNoteId = new URLSearchParams(window.location.search).get('focusNoteId');
  const initialFocusContext =
    focusContext?.trim() ||
    new URLSearchParams(window.location.search).get('focusContext')?.trim() ||
    '';
  const initialFocusNoteFromContext = initialFocusContext.startsWith('focus-note:')
    ? initialFocusContext.slice('focus-note:'.length).trim()
    : '';
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const savingIndicatorTimerRef = useRef<number | null>(null);
  const isEditingRef = useRef(false);
  const isDirtyRef = useRef(false);
  const hydrationNoteIdRef = useRef<string | null>(null);
  const selectionAnchorNoteIdRef = useRef<string | null>(null);
  const bulkSidebarSelectionRef = useRef(false);
  const selectedNoteIdRef = useRef<string | null>(null);
  const draftContentRef = useRef('');
  const attachmentCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const selectedNoteIdsRef = useRef<string[]>([]);
  const selectedNoteServerUpdatedAtRef = useRef<string | null>(null);
  const selectedNoteServerUpdatedByRef = useRef<string | null>(null);
  const remoteNoteUpdateToastIdRef = useRef<string | null>(null);
  const remoteNoteUpdatePendingRef = useRef(false);
  const intakeSubmissionRef = useRef(false);
  const noteNavigationRequestRef = useRef(0);
  const localNoteNavigationRef = useRef<{ noteId: string; at: number } | null>(null);
  const initialTryActionHandledRef = useRef(false);
  const noteViewerPollingDisabledForNoteRef = useRef<string | null>(null);
  const meetingPrepCacheRef = useRef<Map<string, MeetingPrepResult>>(new Map());
  const meetingPrepInFlightRef = useRef<Set<string>>(new Set());
  const meetingRecapInFlightRef = useRef(false);

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([]);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(initialFocusNoteId || initialFocusNoteFromContext || null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [meetingMetadata, setMeetingMetadata] = useState<MeetingNoteMetadata | null>(null);
  const [meetingSeriesOccurrences, setMeetingSeriesOccurrences] = useState<
    MeetingSeriesOccurrence[]
  >([]);
  const [meetingMetadataError, setMeetingMetadataError] = useState<string | null>(null);
  const [isLoadingMeetingMetadata, setIsLoadingMeetingMetadata] = useState(false);
  const [meetingBusyAction, setMeetingBusyAction] = useState<string | null>(null);
  const [isMeetingTemplateSaving, setIsMeetingTemplateSaving] = useState(false);
  const [customMeetingTemplateInstructions, setCustomMeetingTemplateInstructions] = useState('');
  const meetingStopInFlightRef = useRef(false);
  const transcriptionMergeInFlightRef = useRef<Set<string>>(new Set());
  const [meetingTimerTick, setMeetingTimerTick] = useState(0);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptLinks, setTranscriptLinks] = useState<MeetingTranscriptLink[]>([]);
  const [deletedTranscriptSegments, setDeletedTranscriptSegments] = useState<TranscriptSegment[]>(
    []
  );
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [transcriptSpeakerDrafts, setTranscriptSpeakerDrafts] = useState<Record<string, string>>(
    {}
  );
  const transcriptDraftsRef = useRef<Record<string, string>>({});
  const transcriptSpeakerDraftsRef = useRef<Record<string, string>>({});
  const transcriptAppendOffsetMsRef = useRef(0);
  const transcriptCommitVersionRef = useRef<Record<string, number>>({});
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [meetingRecapDraft, setMeetingRecapDraft] = useState<MeetingRecapDraft | null>(null);
  const [meetingRecapStatus, setMeetingRecapStatus] = useState<'idle' | 'generating' | 'ready' | 'unavailable'>('idle');
  const [meetingRecapStage, setMeetingRecapStage] = useState('Reviewing the conversation…');
  const [meetingRecapError, setMeetingRecapError] = useState<string | null>(null);
  const [meetingRecapTier, setMeetingRecapTier] = useState<'balanced' | 'fast' | null>(null);
  const [meetingRecapHasRun, setMeetingRecapHasRun] = useState(false);
  const [meetingRecapTemplateChanged, setMeetingRecapTemplateChanged] = useState(false);
  const [meetingIdentitySuggestions, setMeetingIdentitySuggestions] = useState<MeetingIdentitySuggestion[]>([]);
  const [meetingPrep, setMeetingPrep] = useState<MeetingPrepResult | null>(null);
  const [meetingPrepStatus, setMeetingPrepStatus] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [transcriptMutation, setTranscriptMutation] = useState<'split' | 'merge' | null>(null);
  const transcriptMutationRef = useRef(false);
  const transcriptUndoRef = useRef<{ noteId: string; undo: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (!error) return;
    const message = error;
    const timeout = window.setTimeout(() => {
      setError((current) => (current === message ? null : current));
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [error]);
  useEffect(() => {
    if (meetingMetadata?.meeting_template === 'custom') {
      setCustomMeetingTemplateInstructions(meetingMetadata.meeting_template_instructions ?? '');
    }
  }, [selectedNoteId, meetingMetadata?.meeting_template, meetingMetadata?.meeting_template_instructions]);
  useEffect(() => {
    transcriptDraftsRef.current = transcriptDrafts;
  }, [transcriptDrafts]);
  useEffect(() => {
    transcriptSpeakerDraftsRef.current = transcriptSpeakerDrafts;
  }, [transcriptSpeakerDrafts]);
  useEffect(() => {
    if (meetingRecapStatus !== 'generating') return;
    const stages = [
      'Reviewing the conversation…',
      'Connecting your notes…',
      'Looking for decisions…',
      'Finding follow-ups…',
      'Preparing your recap…',
    ];
    let index = 0;
    setMeetingRecapStage(stages[0]);
    const timer = window.setInterval(() => {
      index = (index + 1) % stages.length;
      setMeetingRecapStage(stages[index]);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [meetingRecapStatus]);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const [audioPermissions, setAudioPermissions] = useState<MeetingAudioPermissions | null>(null);
  const [audioDevices, setAudioDevices] = useState<MeetingAudioDeviceInfo>({
    devices: [],
    outputDevice: null,
  });
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem('ledger.meeting.microphone-device') || null;
    } catch {
      return null;
    }
  });
  const [audioDeviceWarning, setAudioDeviceWarning] = useState<string | null>(null);
  const [audioCaptureStatus, setAudioCaptureStatus] = useState<MeetingAudioStatus | null>(null);
  const [audioSessionInspection, setAudioSessionInspection] = useState<RecordingRecovery | null>(
    null
  );
  const [audioLevels, setAudioLevels] = useState<
    Record<'user_microphone' | 'system_audio', number>
  >({
    user_microphone: 0,
    system_audio: 0,
  });
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isAudioSetupOpen, setIsAudioSetupOpen] = useState(false);
  const [isAudioBusy, setIsAudioBusy] = useState(false);
  const [testingAudioSource, setTestingAudioSource] = useState<
    'user_microphone' | 'system_audio' | null
  >(null);
  const [recordingRecoveries, setRecordingRecoveries] = useState<RecordingRecovery[]>([]);
  const [recordingRecoveryBusy, setRecordingRecoveryBusy] = useState<string | null>(null);
  const [transcriptionModel, setTranscriptionModel] = useState<TranscriptionModelStatus | null>(
    null
  );
  const [transcriptionJob, setTranscriptionJob] = useState<TranscriptionJobStatus | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [isTranscriptionSetupOpen, setIsTranscriptionSetupOpen] = useState(false);
  const meetingRequestRef = useRef(0);
  const persistedLiveTranscriptChunksRef = useRef(new Set<string>());
  const pendingMeetingViewRef = useRef<{ noteId: string; view: 'write' | 'transcript' } | null>(
    null
  );
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [linkedExternalReference, setLinkedExternalReference] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const [linkedResourceBadge, setLinkedResourceBadge] = useState<{
    resourceType: 'project' | 'note' | 'task' | 'event' | 'reminder' | 'external';
    resourceId: string;
    title: string;
    url: string;
  } | null>(null);
  const [draftDate, setDraftDate] = useState(todayKey());
  const [draftMood, setDraftMood] = useState('');
  const [meetingCenterView, setMeetingCenterView] = useState<'write' | 'transcript'>('write');
  const [isMeetingRecorderExpanded, setIsMeetingRecorderExpanded] = useState(false);
  const [isLiveTranscriptOpen, setIsLiveTranscriptOpen] = useState(false);
  const transcriptDrawerScrollRef = useRef<HTMLDivElement | null>(null);
  const transcriptDrawerShouldFollowRef = useRef(true);
  const [meetingAskDraft, setMeetingAskDraft] = useState('');
  const [meetingAskSuggestionIndex, setMeetingAskSuggestionIndex] = useState(0);
  const meetingAskSuggestion = notesAskSuggestions[meetingAskSuggestionIndex % notesAskSuggestions.length];
  useEffect(() => {
    if (!isMeetingRecorderExpanded) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('[data-meeting-floating-controls]')) {
        setIsMeetingRecorderExpanded(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMeetingRecorderExpanded(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMeetingRecorderExpanded]);
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
  const [createNoteModalInitialStep, setCreateNoteModalInitialStep] = useState<'main' | 'gallery'>(
    'main'
  );
  const [createNoteModalTemplateId, setCreateNoteModalTemplateId] = useState<string | null>(null);
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
  const [rightPaneMode, setRightPaneMode] = useState<'inspector' | 'ask'>('inspector');
  const [meetingAskContext, setMeetingAskContext] = useState<AskLedgerInitialContext | null>(null);
  const [askPaneResetKey, setAskPaneResetKey] = useState(0);
  useEffect(() => {
    setRightPaneMode('inspector');
    setMeetingAskContext(null);
  }, [selectedNoteId]);
  const [isResizingLeftPane, setIsResizingLeftPane] = useState(false);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [noteContextMenu, setNoteContextMenu] = useState<NoteContextMenuState | null>(null);
  const [sectionContextMenu, setSectionContextMenu] = useState<SectionContextMenuState | null>(
    null
  );
  const [notesEmptySpaceMenu, setNotesEmptySpaceMenu] = useState<NotesEmptySpaceMenuState | null>(
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
  const [draftMode, setDraftMode] = useState<NoteMode>('text');
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
  const didApplyInitialFocusRef = useRef(false);
  const [lastOpenedAtById, setLastOpenedAtById] = useState<Record<string, number>>(() =>
    loadLastOpenedAtById(activeWorkspaceId)
  );
  const [workspaceTemplates, setWorkspaceTemplates] = useState<NotesHomeTemplate[]>([]);
  const [upcomingMeetings, setUpcomingMeetings] = useState<NotesHomeUpcomingMeeting[]>([]);
  const [workspaceProjectNoteLinks, setWorkspaceProjectNoteLinks] = useState<
    WorkspaceProjectNoteLink[]
  >([]);
  const [linkedContextOpenRequest, setLinkedContextOpenRequest] = useState(0);
  const [selectionComposerContext, setSelectionComposerContext] =
    useState<NotesSelectionComposerContext | null>(null);
  const [linkProjectTargetNoteId, setLinkProjectTargetNoteId] = useState<string | null>(null);
  const [linkableProjects, setLinkableProjects] = useState<ProjectLinkCandidate[]>([]);
  const [isLoadingLinkableProjects, setIsLoadingLinkableProjects] = useState(false);
  const [selectedLinkProjectIds, setSelectedLinkProjectIds] = useState<string[]>([]);
  const toast = useToast();
  const reportTranscriptionError = useCallback(
    (message: string) => {
      window.dispatchEvent(
        new CustomEvent('ledger:transcription-failure', {
          detail: {
            message: message || 'The recording is preserved so you can retry transcription.',
          },
        })
      );
    },
    []
  );
  const { pins, toggleObjectPin } = usePins();
  const { openSearch } = useSearch();
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const resolvedTranscriptSegments = useMemo(
    () =>
      transcriptSegments.map((segment) => {
        if (segment.speaker_identity?.confirmedByUser) return segment;
        const member = user?.id ? workspaceMembers.find((item) => item.user_id === user.id) : null;
        return {
          ...segment,
          speaker_identity: resolveDeterministicSpeakerIdentity({
            segment,
            metadata: meetingMetadata,
            currentUser: user ? { id: user.id, email: user.email } : null,
            currentUserName: member?.full_name || member?.email || user?.email || null,
          }),
        };
      }),
    [meetingMetadata, transcriptSegments, user, workspaceMembers]
  );
  const quickTemplates = QUICK_TEMPLATE_DEFINITIONS.map(({ name }) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
  }));

  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed;
  const isCompactLayout = viewportWidth < modulePaneSizing.notes.left.compactBreakpoint;

  useEffect(() => {
    if (initialTryActionHandledRef.current) return;
    if (
      initialFocusContext !== 'try:template' &&
      initialFocusContext !== 'try:team-meeting-template'
    ) {
      return;
    }

    initialTryActionHandledRef.current = true;
    setCreateNoteModalTemplateId(null);
    setCreateNoteModalInitialStep('gallery');
    setShowCreateNoteModal(true);
  }, [initialFocusContext]);

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
    noteNavigationRequestRef.current += 1;
    setNoteSortPreferences(loadNoteSortPreferences(activeWorkspaceId));
    setLastOpenedAtById(loadLastOpenedAtById(activeWorkspaceId));
    setSelectedNoteId(null);
    setSelectedNoteIds([]);
    selectionAnchorNoteIdRef.current = null;
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
  const isMeetingNote = selectedNote?.mode === 'meeting_note';
  const isMeetingComplete = isMeetingNote && meetingMetadata?.transcription_status === 'complete';
  const acceptedMeetingContent = `${draftContent}\n${selectedNote?.content_html ?? ''}\n${selectedNote?.content ?? ''}`;
  const hasAcceptedMeetingRecap = Boolean(
    isMeetingComplete && (
      /<h[1-3][^>]*>\s*Recap\s*<\/h[1-3]>/i.test(acceptedMeetingContent) ||
      /(?:^|\n)\s*Recap\s*(?:\n|$)/i.test(acceptedMeetingContent)
    )
  );
  useEffect(() => {
    if (
      !isMeetingNote ||
      !activeWorkspaceId ||
      !selectedNoteId ||
      meetingMetadata?.transcription_status !== 'complete' ||
      !transcriptSegments.length ||
      meetingRecapDraft ||
      meetingRecapStatus !== 'idle'
    )
      return;
    const cached = meetingRecapDraftCache.get(
      meetingRecapCacheKey(activeWorkspaceId, selectedNoteId),
      meetingRecapCacheFingerprint(
        selectedNote?.updated_at,
        transcriptSegments,
        meetingMetadata?.meeting_template,
        meetingMetadata?.meeting_template_instructions,
      )
    );
    if (!cached) return;
    setMeetingRecapDraft(cached.draft);
    setMeetingRecapTier(cached.tier);
    setMeetingRecapHasRun(true);
    setMeetingRecapStatus('ready');
  }, [
    activeWorkspaceId,
    isMeetingNote,
    meetingMetadata?.transcription_status,
    meetingMetadata?.meeting_template,
    meetingMetadata?.meeting_template_instructions,
    meetingRecapDraft,
    meetingRecapStatus,
    selectedNote?.updated_at,
    selectedNoteId,
    transcriptSegments,
  ]);
  const liveTranscriptAvailable = Boolean(
    isMeetingNote &&
      meetingMetadata &&
      (['recording', 'paused', 'processing'].includes(meetingMetadata.transcription_status) ||
        (meetingMetadata.transcription_status === 'complete' && resolvedTranscriptSegments.length > 0))
  );
  const isMeetingTranscriptionActive = Boolean(
    meetingMetadata && ['recording', 'processing'].includes(meetingMetadata.transcription_status)
  );
  useEffect(() => {
    if (!isLiveTranscriptOpen) return;
    if (!liveTranscriptAvailable) setIsLiveTranscriptOpen(false);
  }, [isLiveTranscriptOpen, liveTranscriptAvailable]);
  useEffect(() => {
    if (!isLiveTranscriptOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsLiveTranscriptOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isLiveTranscriptOpen]);
  useEffect(() => {
    if (!isLiveTranscriptOpen || !transcriptDrawerShouldFollowRef.current) return;
    const node = transcriptDrawerScrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [isLiveTranscriptOpen, resolvedTranscriptSegments.length]);
  useEffect(() => {
    setIsLiveTranscriptOpen(false);
  }, [selectedNoteId]);
  useEffect(() => {
    setMeetingAskSuggestionIndex(0);
  }, [selectedNoteId]);
  useEffect(() => {
    if (!isMeetingNote || !hasHydratedNote || isHydratingNote) return;
    const timer = window.setInterval(() => {
      setMeetingAskSuggestionIndex((current) => (current + 1) % notesAskSuggestions.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [hasHydratedNote, isHydratingNote, isMeetingNote]);
  const selectedMicrophone =
    audioDevices.devices.find((device) => device.id === selectedMicrophoneId) ?? null;
  const bluetoothMicWarning = Boolean(
    selectedMicrophone?.isBluetooth && audioDevices.outputDevice?.isBluetooth
  );
  const meetingAudioSessionId = useMemo(() => {
    const captureMatchesNote =
      audioCaptureStatus?.sessionId &&
      audioCaptureStatus.noteId === selectedNoteId &&
      audioCaptureStatus.workspaceId === activeWorkspaceId;
    const jobMatchesNote =
      transcriptionJob?.sessionId &&
      transcriptionJob.noteId === selectedNoteId &&
      transcriptionJob.workspaceId === activeWorkspaceId;
    return captureMatchesNote
      ? audioCaptureStatus.sessionId
      : jobMatchesNote
      ? transcriptionJob.sessionId
      : null;
  }, [activeWorkspaceId, audioCaptureStatus, selectedNoteId, transcriptionJob]);
  const audioSourceSummaries = useMemo(() => {
    const chunks = audioSessionInspection?.chunks ?? [];
    return (['user_microphone', 'system_audio'] as const).map((source) => {
      const sourceChunks = chunks.filter(
        (chunk) => chunk.source === source && chunk.finalized && chunk.sizeBytes > 44
      );
      return {
        source,
        chunkCount: sourceChunks.length,
        durationSeconds: sourceChunks.reduce(
          (total, chunk) => total + (Number(chunk.durationSeconds) || 0),
          0
        ),
        sizeBytes: sourceChunks.reduce((total, chunk) => total + (Number(chunk.sizeBytes) || 0), 0),
      };
    });
  }, [audioSessionInspection]);
  const meetingElapsedSeconds = useMemo(
    () => getMeetingElapsedSeconds(meetingMetadata),
    [meetingMetadata, meetingTimerTick]
  );

  useEffect(() => {
    if (isMeetingNote) return;
    setIsAudioSetupOpen(false);
    setTestingAudioSource(null);
  }, [isMeetingNote]);

  const refreshTranscriptionState = useCallback(async (jobId?: string) => {
    const transcription = window.meetingTranscription;
    if (!transcription) return;
    const [model, jobs] = await Promise.all([
      transcription.modelStatus(),
      transcription.status(jobId),
    ]);
    setTranscriptionModel(model as TranscriptionModelStatus);
    const candidate = Array.isArray(jobs)
      ? jobs.find((job) => job.noteId === selectedNoteIdRef.current)
      : jobs;
    setTranscriptionJob(candidate ? (candidate as TranscriptionJobStatus) : null);
  }, []);

  const refreshAudioDevices = useCallback(async () => {
    if (!window.meetingAudio?.devices) return null;
    const info = (await window.meetingAudio.devices()) as MeetingAudioDeviceInfo;
    const devices = Array.isArray(info.devices)
      ? info.devices.filter((device) => device.available)
      : [];
    const normalized = { devices, outputDevice: info.outputDevice ?? null };
    setAudioDevices(normalized);
    const saved = selectedMicrophoneId;
    const savedDevice = saved ? devices.find((device) => device.id === saved) : null;
    const captureActive =
      meetingMetadata?.transcription_status === 'recording' ||
      meetingMetadata?.transcription_status === 'paused';
    const preferred =
      savedDevice ??
      (!captureActive && normalized.outputDevice?.isBluetooth
        ? devices.find((device) => !device.isBluetooth)
        : null) ??
      (!captureActive ? devices.find((device) => device.isDefault) : null) ??
      (!captureActive ? devices[0] : null) ??
      null;
    if (preferred && preferred.id !== selectedMicrophoneId) {
      setSelectedMicrophoneId(preferred.id);
      try {
        window.localStorage.setItem('ledger.meeting.microphone-device', preferred.id);
      } catch {}
    }
    if (saved && !savedDevice) {
      setAudioDeviceWarning(
        meetingMetadata?.transcription_status === 'recording' || meetingMetadata?.transcription_status === 'paused'
          ? 'The selected microphone was disconnected. Ledger will not switch microphones during this recording.'
          : 'The saved microphone is unavailable. Ledger selected another available input.'
      );
    } else if (preferred?.isBluetooth && normalized.outputDevice?.isBluetooth) {
      setAudioDeviceWarning(
        'Headphone audio quality may decrease when using this Bluetooth microphone.'
      );
    } else {
      setAudioDeviceWarning(null);
    }
    return normalized;
  }, [meetingMetadata?.transcription_status, selectedMicrophoneId]);

  useEffect(() => {
    if (!isMeetingNote || !window.meetingAudio?.devices) return;
    void refreshAudioDevices().catch((error) =>
      setAudioError(error instanceof Error ? error.message : 'Could not load microphones.')
    );
  }, [isMeetingNote, refreshAudioDevices]);

  useEffect(() => {
    const transcription = window.meetingTranscription;
    if (!transcription) return;
    void refreshTranscriptionState();
    const offProgress = transcription.onProgress((event) => {
      const progress = event as TranscriptionJobStatus;
      if (progress.noteId && progress.noteId !== selectedNoteIdRef.current) return;
      setTranscriptionJob((current) =>
        current ? { ...current, ...progress } : (progress as TranscriptionJobStatus)
      );
    });
    const offModel = transcription.onModelChange((event) =>
      setTranscriptionModel(event as TranscriptionModelStatus)
    );
    return () => {
      offProgress();
      offModel();
    };
  }, [activeWorkspaceId, refreshTranscriptionState, selectedNoteId, toast]);

  useEffect(() => {
    const transcription = window.meetingTranscription;
    if (!transcription) return;
    const offSegments = transcription.onSegments((value) => {
      const event = value as {
        sessionId?: string;
        noteId?: string;
        workspaceId?: string;
        chunkKey?: string;
        finalizedAt?: string | null;
        segments?: Array<{
          id: string;
          audioSource: 'user_microphone' | 'system_audio';
          speakerLabel: string;
          startMs: number;
          endMs: number;
          text: string;
          confidence: number | null;
          segmentOrder: number;
          speakerIdentity?: TranscriptSegment['speaker_identity'];
        }>;
        metrics?: { audioDurationSeconds?: number; queueWaitMs?: number; whisperWallMs?: number; rtf?: number; queueDepth?: number };
      };
      if (!event.noteId || event.workspaceId !== activeWorkspaceId || (meetingAudioSessionId && event.sessionId !== meetingAudioSessionId) || event.noteId !== selectedNoteIdRef.current || !Array.isArray(event.segments) || !event.segments.length) return;
      const chunkKey = `${event.noteId}:${event.chunkKey || event.segments[0]?.id || ''}`;
      if (persistedLiveTranscriptChunksRef.current.has(chunkKey)) return;
      persistedLiveTranscriptChunksRef.current.add(chunkKey);
      const segments = event.segments.map((row) => ({
        id: row.id,
        audio_source: row.audioSource,
        speaker_label: row.speakerLabel,
        start_ms: row.startMs,
        end_ms: row.endMs,
        transcript_text: row.text,
        confidence: row.confidence,
        segment_order: row.segmentOrder,
        speaker_identity: row.speakerIdentity ? resolveDeterministicSpeakerIdentity({
          segment: {
            id: row.id,
            note_id: event.noteId!,
            workspace_id: event.workspaceId!,
            audio_source: row.audioSource,
            speaker_label: row.speakerLabel,
            speaker_identity: row.speakerIdentity,
            start_ms: row.startMs,
            end_ms: row.endMs,
            transcript_text: row.text,
            confidence: row.confidence,
            segment_order: row.segmentOrder,
            created_at: '',
            updated_at: '',
          },
          metadata: meetingMetadata,
          currentUser: user ? { id: user.id, email: user.email } : null,
        }) : undefined,
      }));
      const persistStartedAt = Date.now();
      void api.bulkCreateTranscriptSegments(event.noteId!, segments)
        .then(async () => {
          const visibleAt = Date.now();
          console.info('[transcription]', JSON.stringify({
            event: 'segments_visible',
            noteId: event.noteId,
            chunkKey: event.chunkKey,
            persistenceMs: visibleAt - persistStartedAt,
            finalizedToVisibleMs: event.finalizedAt ? Math.max(0, visibleAt - Date.parse(event.finalizedAt)) : null,
            queueDepth: event.metrics?.queueDepth ?? null,
          }));
          if (selectedNoteIdRef.current !== event.noteId) return;
          const stored = (await api.getTranscriptSegments(event.noteId!)) as TranscriptSegment[];
          const safeStored = Array.isArray(stored) ? stored : [];
          setTranscriptSegments(safeStored);
          setTranscriptDrafts(Object.fromEntries(safeStored.map((segment) => [segment.id, segment.transcript_text])));
          setTranscriptSpeakerDrafts(Object.fromEntries(safeStored.map((segment) => [segment.id, segment.speaker_identity?.displayName ?? segment.speaker_label ?? ''])));
        })
        .catch((error) => {
          persistedLiveTranscriptChunksRef.current.delete(chunkKey);
          console.error('[transcription]', JSON.stringify({ event: 'incremental_persistence_failed', noteId: event.noteId, chunkKey: event.chunkKey, error: error instanceof Error ? error.message : String(error) }));
        });
    });
    return () => offSegments();
  }, [activeWorkspaceId, api, meetingAudioSessionId]);

  useEffect(() => {
    const audio = window.meetingAudio;
    if (!audio) {
      setAudioPermissions(null);
      setAudioCaptureStatus(null);
      return;
    }
    let cancelled = false;
    void Promise.all([audio.permissions(), audio.status(), audio.recoveries()])
      .then(([permissions, status, recoveries]) => {
        if (cancelled) return;
        setAudioPermissions(permissions);
        setAudioCaptureStatus(status as MeetingAudioStatus);
        setRecordingRecoveries(
          Array.isArray(recoveries) ? (recoveries as RecordingRecovery[]) : []
        );
      })
      .catch((error) => {
        if (!cancelled)
          setAudioError(
            error instanceof Error ? error.message : 'Could not inspect audio capture.'
          );
      });
    const offLevel = audio.onLevel(({ source, level }) => {
      setAudioLevels((current) => ({ ...current, [source]: level }));
    });
    const offError = audio.onError(({ source, error }) => {
      setAudioError(`${source === 'user_microphone' ? 'Microphone' : 'System audio'}: ${error}`);
    });
    return () => {
      cancelled = true;
      offLevel();
      offError();
    };
  }, []);

  useEffect(() => {
    const audio = window.meetingAudio;
    if (!audio?.onDevicesChanged || !isMeetingNote) return;
    return audio.onDevicesChanged(() => {
      void refreshAudioDevices().catch((error) => {
        setAudioError(error instanceof Error ? error.message : 'Could not refresh audio devices.');
      });
    });
  }, [isMeetingNote, refreshAudioDevices]);

  useEffect(() => {
    const audio = window.meetingAudio;
    const sessionId = meetingAudioSessionId;
    if (!audio || !isMeetingNote || !sessionId) {
      setAudioSessionInspection(null);
      return;
    }
    let cancelled = false;
    void audio
      .inspect(sessionId)
      .then((value) => {
        const inspection = value as RecordingRecovery;
        if (cancelled) return;
        if (inspection.noteId !== selectedNoteId || inspection.workspaceId !== activeWorkspaceId) {
          setAudioSessionInspection(null);
          return;
        }
        setAudioSessionInspection(inspection);
      })
      .catch(() => {
        if (!cancelled) setAudioSessionInspection(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceId,
    audioCaptureStatus?.chunkCount,
    audioCaptureStatus?.state,
    isMeetingNote,
    meetingAudioSessionId,
    selectedNoteId,
    transcriptionJob?.status,
  ]);
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

  const buildMeetingIntelligenceContext = useCallback((): MeetingIntelligenceContext | null => {
    if (!selectedNote || !activeWorkspaceId || !meetingMetadata) return null;
    return {
      workspaceId: activeWorkspaceId,
      noteId: selectedNote.id,
      meeting: {
        title: selectedNote.title,
        calendarEventId: meetingMetadata.calendar_event_id,
        calendarSeriesId: meetingMetadata.calendar_series_id,
        scheduledStart: meetingMetadata.scheduled_start_at,
        scheduledEnd: meetingMetadata.scheduled_end_at,
        actualStart: meetingMetadata.meeting_start_at,
        actualEnd: meetingMetadata.meeting_end_at,
        attendees: meetingMetadata.attendees ?? [],
        calendarProvider: meetingMetadata.calendar_provider,
        calendarEventKey: meetingMetadata.calendar_event_key,
        calendarSeriesKey: meetingMetadata.calendar_series_key,
        template: meetingMetadata.meeting_template ?? 'auto',
        templateInstructions: meetingMetadata.meeting_template_instructions,
      },
      humanNotes: {
        contentHtml: normalizeEditorHtml(draftContent),
        contentText: htmlToPlainText(draftContent),
      },
      transcriptSegments: resolvedTranscriptSegments,
      transcriptLinks,
      relatedContext: {
        project: selectedNoteProjectLinks[0]
          ? {
              id: selectedNoteProjectLinks[0].project_id,
              title: selectedNoteProjectLinks[0].project_name ?? null,
            }
          : undefined,
        event: meetingMetadata.calendar_event_id
          ? {
              id: meetingMetadata.calendar_event_id,
              title: meetingMetadata.calendar_event_title,
            }
          : undefined,
      },
    };
  }, [activeWorkspaceId, draftContent, meetingMetadata, selectedNote, selectedNoteProjectLinks, transcriptLinks, resolvedTranscriptSegments]);

  const enhanceMeetingNote = useCallback(async () => {
    if (meetingRecapInFlightRef.current) return;
    const context = buildMeetingIntelligenceContext();
    if (!context || meetingMetadata?.transcription_status !== 'complete') return;
    if (!window.askLedger?.generateMeetingRecap) {
      setMeetingRecapStatus('unavailable');
      setMeetingRecapError('Local meeting intelligence is unavailable in this client.');
      return;
    }
    meetingRecapInFlightRef.current = true;
    setMeetingRecapStatus('generating');
    setMeetingRecapError(null);
    try {
      const result = (await window.askLedger.generateMeetingRecap(context)) as MeetingRecapGenerationResult;
      if (result.status !== 'ready') {
        setMeetingRecapStatus('unavailable');
        setMeetingRecapError(
          result.reason === 'model_unavailable'
            ? 'Install the Balanced or Fast local model to enhance this meeting.'
            : 'Ledger could not produce a grounded recap from this transcript.'
        );
        return;
      }
      setMeetingRecapDraft(result.draft);
      setMeetingRecapTier(result.tier);
      setMeetingRecapHasRun(true);
      if (activeWorkspaceId && selectedNoteId) {
        meetingRecapDraftCache.set(
          meetingRecapCacheKey(activeWorkspaceId, selectedNoteId),
          meetingRecapCacheFingerprint(
            selectedNote?.updated_at,
            transcriptSegments,
            meetingMetadata?.meeting_template,
            meetingMetadata?.meeting_template_instructions,
          ),
          { draft: result.draft, tier: result.tier }
        );
      }
      setMeetingRecapStatus('ready');
    } catch (error) {
      setMeetingRecapStatus('unavailable');
      setMeetingRecapError(error instanceof Error ? error.message : 'Could not enhance the meeting note.');
    } finally {
      meetingRecapInFlightRef.current = false;
    }
  }, [
    activeWorkspaceId,
    buildMeetingIntelligenceContext,
    meetingMetadata?.transcription_status,
    meetingMetadata?.meeting_template,
    meetingMetadata?.meeting_template_instructions,
    selectedNote?.updated_at,
    selectedNoteId,
    transcriptSegments,
  ]);

  const focusTranscriptSegment = useCallback((segmentId: string) => {
    setIsLiveTranscriptOpen(true);
    window.setTimeout(() => {
      const node = document.querySelector(`[data-transcript-segment="${CSS.escape(segmentId)}"]`);
      if (!(node instanceof HTMLElement)) return;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.add('ring-2', 'ring-[var(--ledger-accent)]');
      window.setTimeout(() => node.classList.remove('ring-2', 'ring-[var(--ledger-accent)]'), 1800);
    }, 80);
  }, []);

  const openMeetingAskInRightPane = useCallback((question: string) => {
    if (!selectedNote || !activeWorkspaceId) return;
    setMeetingAskContext({
      resourceType: 'note',
      resourceId: selectedNote.id,
      title: selectedNote.title,
      contextType: 'meeting',
      workspaceId: activeWorkspaceId,
      meetingNoteId: selectedNote.id,
      calendarSeriesId: meetingMetadata?.calendar_series_id ?? undefined,
      linkedProjectId: selectedNoteProjectLinks[0]?.project_id ?? undefined,
      initialQuestion: question,
    });
    setRightPaneMode('ask');
    setIsRightPaneCollapsed(false);
    setAskPaneResetKey((current) => current + 1);
  }, [activeWorkspaceId, meetingMetadata?.calendar_series_id, selectedNote, selectedNoteProjectLinks]);

  const openNoteAskInRightPane = useCallback((question: string) => {
    if (!selectedNote || !activeWorkspaceId) return;
    setMeetingAskContext({
      resourceType: 'note',
      resourceId: selectedNote.id,
      title: selectedNote.title,
      workspaceId: activeWorkspaceId,
      linkedProjectId: selectedNoteProjectLinks[0]?.project_id ?? undefined,
      initialQuestion: question,
    });
    setRightPaneMode('ask');
    setIsRightPaneCollapsed(false);
    setAskPaneResetKey((current) => current + 1);
  }, [activeWorkspaceId, selectedNote, selectedNoteProjectLinks]);

  const openNotesHomeAsk = useCallback((question: string) => {
    const context = createNotesHomeAskContext(activeWorkspaceId, question);
    if (!context) return;
    setMeetingAskContext(context);
    setRightPaneMode('ask');
    setIsRightPaneCollapsed(false);
    setAskPaneResetKey((current) => current + 1);
  }, [activeWorkspaceId]);

  const openLinkProjectModal = useCallback(
    async (noteId: string | null = selectedNoteId) => {
      if (!noteId) return;

      setNoteContextMenu(null);
      setIsNoteActionsOpen(false);
      setIsInspectorActionsOpen(false);
      setLinkProjectTargetNoteId(noteId);
      setLinkedContextOpenRequest((current) => current + 1);
      setSelectedLinkProjectIds([]);
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

  const toggleLinkProject = useCallback((projectId: string) => {
    setSelectedLinkProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }, []);

  const loadProjectsForLinkedContext = useCallback(async () => {
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
  }, [api]);

  const linkNoteToProject = useCallback(
    async (projectId: string, preserveTarget = false) => {
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
        if (!preserveTarget) setLinkProjectTargetNoteId(null);
      } catch (error) {
        console.error('Failed to link note to project:', error);
        toast.show(error instanceof Error ? error.message : 'Could not link note', {
          variant: 'error',
        });
      }
    },
    [activeWorkspaceId, api, linkProjectTargetNoteId, selectedNoteId, toast]
  );

  const linkSelectedProjectsToNote = useCallback(
    async (projectIds: string[]) => {
      for (const projectId of projectIds) {
        await linkNoteToProject(projectId, true);
      }
      setLinkProjectTargetNoteId(null);
      setSelectedLinkProjectIds([]);
    },
    [linkNoteToProject]
  );

  const openEditorOverviewComposer = useCallback(
    (
      kind: NotesSelectionComposerKind,
      selectedText: string,
      source?: Partial<NotesSelectionComposerContext>
    ) => {
      if (!selectedNoteId) return;
      setSelectionComposerContext({
        kind,
        text: selectedText,
        noteId: selectedNoteId,
        projectId: selectedNoteProjectLinks[0]?.project_id ?? null,
        sourceLabel: `Created from note “${selectedNote?.title ?? selectedNoteId}”`,
        ...source,
      });
    },
    [selectedNote, selectedNoteId, selectedNoteProjectLinks]
  );

  const createEditorExternalEmbed = useCallback(
    async ({
      noteId,
      targetType,
      provider,
      url,
    }: EditorExternalEmbedRequest): Promise<EditorExternalEmbedResult> => {
      const created = (await api.createExternalReference(provider, url)) as {
        id: string;
        normalized_url?: string;
        external_url?: string;
      };
      if (provider === 'github' || provider === 'google_drive') {
        await api.resolveExternalReference(created.id);
      }
      await api.linkExternalReferenceWithMetadata(
        created.id,
        targetType,
        noteId,
        undefined,
        'embed'
      );
      if (provider === 'figma') {
        await api.resolveExternalReference(created.id);
        await api.createExternalReferencePreview(created.id, targetType, noteId);
      }
      return {
        externalReferenceId: created.id,
        externalUrl: created.normalized_url || created.external_url || url,
      };
    },
    [api]
  );

  const uploadEditorAttachment = useCallback(
    async ({ noteId, file }: AttachmentUploadRequest): Promise<AttachmentUploadResult> => {
      if (!activeWorkspaceId) throw new Error('Select a workspace before uploading a file.');
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 180) || 'attachment';
      const random = Math.random().toString(36).slice(2, 9);
      const storagePath = `workspaces/${activeWorkspaceId}/notes/${noteId}/attachments/${Date.now()}-${random}-${safeName}`;
      const { error } = await supabase.storage.from('note-files').upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (error) throw error;
      const url = await createSignedStorageUrl('note-files', storagePath);
      return {
        storagePath,
        url,
        fileName: file.name || safeName,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      };
    },
    [activeWorkspaceId]
  );

  const removeEditorAttachment = useCallback(
    ({ noteId, storagePath, immediate = false }: AttachmentRemoveRequest) => {
      const safePath = String(storagePath ?? '').trim();
      if (!noteId || !safePath || !safePath.startsWith('workspaces/')) return;

      const timerKey = `${noteId}:${safePath}`;
      const existingTimer = attachmentCleanupTimersRef.current.get(timerKey);
      if (existingTimer) window.clearTimeout(existingTimer);

      const removeFromStorage = async () => {
        // A Backspace removal gets a grace period so undo can restore the
        // node. Never remove a path that is still present in the live draft.
        if (!immediate && selectedNoteIdRef.current === noteId) {
          const escapedPath = safePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(escapedPath).test(draftContentRef.current)) return;
        }
        const { error } = await supabase.storage.from('note-files').remove([safePath]);
        if (error) console.error('[notes] failed to remove attachment from storage', error);
        attachmentCleanupTimersRef.current.delete(timerKey);
      };

      if (immediate) {
        void removeFromStorage();
      } else {
        const timer = window.setTimeout(() => void removeFromStorage(), 30_000);
        attachmentCleanupTimersRef.current.set(timerKey, timer);
      }
    },
    []
  );

  const linkTranscriptToLedgerItem = useCallback(
    async (
      segment: TranscriptSegment,
      quotedText: string,
      type: 'task' | 'reminder' | 'event' | 'intake',
      itemId: string
    ) => {
      if (!selectedNoteId) return;
      try {
        const result = (await api.createMeetingTranscriptLink(selectedNoteId, segment.id, {
          link_type: 'ledger_item',
          ledger_item_type: type,
          ledger_item_id: itemId,
          quoted_text: quotedText,
          timestamp_ms: segment.start_ms,
          speaker_label: segment.speaker_label,
          audio_source: segment.audio_source,
        })) as { duplicate?: boolean };
        const links = await api.getMeetingTranscriptLinks(selectedNoteId);
        setTranscriptLinks(Array.isArray(links) ? (links as MeetingTranscriptLink[]) : []);
        if (!result?.duplicate) {
          setDraftContent((current) =>
            appendMeetingTranscriptReference(
              current,
              'Notes',
              quotedText,
              segment.start_ms,
              segment.id
            )
          );
          setIsDirty(true);
          isDirtyRef.current = true;
        }
        toast.show(
          result?.duplicate ? 'This transcript item is already linked.' : 'Linked to transcript.',
          { variant: 'success' }
        );
      } catch (error) {
        toast.show(error instanceof Error ? error.message : 'Could not link transcript item.', {
          variant: 'error',
        });
      }
    },
    [api, selectedNoteId, toast]
  );

  const createTranscriptLedgerItem = useCallback(
    (
      kind: 'task' | 'reminder' | 'event' | 'intake',
      segment: TranscriptSegment,
      quotedText: string
    ) => {
      if (!selectedNoteId || !activeWorkspaceId) return;
      if (kind === 'intake') {
        const title =
          quotedText
            .split('\n')
            .find((line) => line.trim())
            ?.trim()
            .slice(0, 120) || 'Transcript capture';
        void api
          .createIntakeItem({
            workspace_id: activeWorkspaceId,
            source: 'manual',
            source_provider: 'meeting_transcript',
            suggested_type: 'capture',
            title,
            body: quotedText,
            raw_content: quotedText,
            reason: `From transcript at ${Math.floor(segment.start_ms / 1000)}s`,
            source_object_type: 'meeting_transcript_segment',
            source_object_id: segment.id,
          })
          .then((created) => {
            const id = (created as { id?: string } | null)?.id;
            if (id) return linkTranscriptToLedgerItem(segment, quotedText, kind, id);
            throw new Error('Intake item was not created.');
          })
          .catch((error) =>
            toast.show(error instanceof Error ? error.message : 'Could not create Intake item.', {
              variant: 'error',
            })
          );
        return;
      }
      openEditorOverviewComposer(kind, quotedText, {
        transcriptSegmentId: segment.id,
        transcriptTimestampMs: segment.start_ms,
        transcriptSpeakerLabel: segment.speaker_label,
        transcriptAudioSource: segment.audio_source,
        sourceLabel: `Created from meeting note ${
          selectedNote?.title ? `“${selectedNote.title}”` : ''
        }`,
      });
    },
    [
      activeWorkspaceId,
      api,
      linkTranscriptToLedgerItem,
      openEditorOverviewComposer,
      selectedNote,
      selectedNoteId,
      toast,
    ]
  );

  const addTranscriptMeetingReference = useCallback(
    async (
      kind: 'action_item' | 'decision' | 'key_point' | 'meeting_note',
      segment: TranscriptSegment,
      quotedText: string
    ) => {
      if (!selectedNoteId) return;
      try {
        const result = (await api.createMeetingTranscriptLink(selectedNoteId, segment.id, {
          link_type: kind,
          quoted_text: quotedText,
          timestamp_ms: segment.start_ms,
          speaker_label: segment.speaker_label,
          audio_source: segment.audio_source,
        })) as { duplicate?: boolean };
        const links = await api.getMeetingTranscriptLinks(selectedNoteId);
        setTranscriptLinks(Array.isArray(links) ? (links as MeetingTranscriptLink[]) : []);
        if (!result?.duplicate) {
          const section =
            kind === 'action_item'
              ? 'Action Items'
              : kind === 'decision'
              ? 'Decisions'
              : kind === 'key_point'
              ? 'Key Points'
              : 'Notes';
          setDraftContent((current) =>
            appendMeetingTranscriptReference(
              current,
              section,
              quotedText,
              segment.start_ms,
              segment.id
            )
          );
          setIsDirty(true);
          isDirtyRef.current = true;
        }
        toast.show(
          result?.duplicate
            ? 'Already added to this meeting.'
            : `Added to ${kind === 'meeting_note' ? 'meeting notes' : kind.replace('_', ' ')}.`,
          { variant: 'success' }
        );
      } catch (error) {
        toast.show(error instanceof Error ? error.message : 'Could not add transcript reference.', {
          variant: 'error',
        });
      }
    },
    [api, selectedNoteId, toast]
  );

  const openSmartPersonTaskComposer = useCallback(
    (action: 'task' | 'follow-up', person: { id: string; name: string; sourceText: string }) => {
      if (!selectedNoteId) return;
      setSelectionComposerContext({
        kind: 'task',
        taskVariant: action,
        text: person.sourceText || person.name,
        noteId: selectedNoteId,
        projectId: selectedNoteProjectLinks[0]?.project_id ?? null,
        assigneeId: person.id,
      });
    },
    [selectedNoteId, selectedNoteProjectLinks]
  );

  const sendEditorSelectionToIntake = useCallback(
    async ({ noteId, plainText: selectedText }: SelectedContentPayload) => {
      if (
        !activeWorkspaceId ||
        !selectedNoteId ||
        noteId !== selectedNoteId ||
        !selectedText.trim() ||
        intakeSubmissionRef.current
      ) {
        return;
      }
      intakeSubmissionRef.current = true;
      try {
        const firstLine =
          selectedText
            .split('\n')
            .find((line) => line.trim())
            ?.trim() ?? selectedText.trim();
        const title = firstLine.replace(/^#\s*/, '').slice(0, 120);
        const data = await api.createIntakeItem({
          workspace_id: activeWorkspaceId,
          source: 'manual',
          source_provider: 'notes',
          suggested_type: 'capture',
          title,
          body: selectedText,
          raw_content: selectedText,
          reason: `Selected from note “${selectedNote?.title ?? noteId}”${
            selectedNoteProjectLinks[0]?.project_name
              ? ` · Project: ${selectedNoteProjectLinks[0].project_name}`
              : ''
          }`,
          source_object_type: 'note',
          source_object_id: noteId,
        });
        if (!data) throw new Error('intake_create_failed');
        window.ledgerIpc?.commands?.inboxItemsUpdated({ delta: 1 });
        toast.show('Sent to Intake.', { variant: 'success' });
      } catch (error) {
        console.error('Failed to send selected note text to Intake:', error);
        toast.show('Could not send to Intake.', { variant: 'error' });
      } finally {
        intakeSubmissionRef.current = false;
      }
    },
    [activeWorkspaceId, api, selectedNote, selectedNoteId, selectedNoteProjectLinks, toast]
  );

  const linkEditorSelectionToPerson = useCallback(
    async ({ noteId, plainText: selectedText }: SelectedContentPayload, personId: string) => {
      if (!selectedNoteId || noteId !== selectedNoteId) return;
      try {
        await api.upsertNotePersonLink(selectedNoteId, {
          person_user_id: personId,
          source_key: `person:${selectedText.trim().toLowerCase()}`,
          source_text: selectedText.trim(),
        });
        toast.show('Linked to person', { variant: 'success' });
      } catch (error) {
        console.error('Failed to link selected note text to person:', error);
        toast.show('Could not link person.', { variant: 'error' });
      }
    },
    [api, selectedNoteId, toast]
  );

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

  useEffect(() => {
    draftContentRef.current = draftContent;
  }, [draftContent]);

  useEffect(() => {
    return () => {
      attachmentCleanupTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      attachmentCleanupTimersRef.current.clear();
    };
  }, []);

  useWorkspaceRouteHistory(
    {
      kind: 'notes',
      focusNoteId: selectedNoteId,
      focusContext: selectedNoteId ? (initialView ? `note-view:${initialView}` : null) : 'home',
    },
    true
  );

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

    window.ledgerIpc?.events?.onInboxItemsUpdated(handleInboxItemsUpdated);
    window.addEventListener('focus', handleRefreshInboxCount);
    document.addEventListener('visibilitychange', handleRefreshInboxCount);

    const timer = window.setInterval(() => {
      void loadInboxCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.ledgerIpc?.events?.offInboxItemsUpdated(handleInboxItemsUpdated);
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
          counts?: { unread?: number };
        };
        if (!cancelled) {
          setNotificationCount(Number(payload?.counts?.unread ?? 0));
        }
      } catch {
        if (!cancelled) setNotificationCount(0);
      }
    };

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ unreadCount?: number; activeCount?: number }>).detail;
      setNotificationCount(Number(detail?.unreadCount ?? 0));
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
      const haystack = [note.title, htmlToPlainText(note.content ?? ''), note.mood ?? '', note.date]
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
    (
      noteId: string,
      modifiers?: {
        shiftKey?: boolean;
        metaKey?: boolean;
        ctrlKey?: boolean;
        activate?: boolean;
      }
    ) => {
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
      if (modifiers?.activate !== false) {
        localNoteNavigationRef.current = { noteId, at: Date.now() };
        setSelectedNoteId(noteId);
      }
      setSelectedNoteIds([noteId]);
    },
    [visibleNoteOrder]
  );

  const handleSidebarNoteContextMenu = useCallback(
    (note: NoteRow, event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();

      setNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: note.id,
      });
    },
    []
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

  const sectionById = useMemo(() => {
    return new Map(sections.map((section) => [section.id, section]));
  }, [sections]);

  const selectedSectionBreadcrumb = useMemo(() => {
    if (!selectedNote?.section_id) return [];
    const crumbs: Array<{ id: string; title: string }> = [];
    const seen = new Set<string>();
    let cursor = sectionById.get(selectedNote.section_id) ?? null;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      crumbs.unshift({ id: cursor.id, title: cursor.name || 'Untitled folder' });
      cursor = cursor.parent_id ? sectionById.get(cursor.parent_id) ?? null : null;
    }
    return crumbs;
  }, [sectionById, selectedNote?.section_id]);

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
    return [...selectedSectionBreadcrumb, ...crumbs];
  }, [nodeById, selectedNoteId, selectedSectionBreadcrumb]);

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

  const [, setNoteViewers] = useState<WorkspaceMember[]>([]);

  useEffect(() => {
    if (!selectedNoteId) {
      setNoteViewers([]);
      return;
    }

    let cancelled = false;

    const loadNoteViewers = async () => {
      if (!selectedNoteId || noteViewerPollingDisabledForNoteRef.current === selectedNoteId) return;
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
        const status = (e as { status?: number } | null)?.status;
        // Older deployments may not expose note versions yet, and a rate
        // limit should not turn the passive viewer indicator into a request
        // storm. Retry when the user opens a different note.
        if (status === 404 || status === 429) {
          noteViewerPollingDisabledForNoteRef.current = selectedNoteId;
        }
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
    // Rich editor state must hydrate from the canonical HTML column. The
    // legacy `content` field is plain-text compatibility data and can strip
    // custom node attributes such as a callout's persisted style.
    setDraftContent(normalizeEditorHtml(note.content_html ?? note.content ?? ''));
    setDraftDate(note.date || todayKey());
    setDraftMood(note.mood ?? '');
    setDraftMode(note.mode || 'text');
    setDraftMindMapStructure(note.mind_map_structure || null);
    setLastSavedAt(note.updated_at);
    isDirtyRef.current = false;
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

  useEffect(() => {
    const requestId = ++meetingRequestRef.current;
    const noteId = selectedNoteId;
    const shouldLoad = Boolean(activeWorkspaceId && noteId && isMeetingNote);
    setMeetingMetadata(null);
    const pendingView =
      noteId && pendingMeetingViewRef.current?.noteId === noteId
        ? pendingMeetingViewRef.current.view
        : 'write';
    if (noteId && pendingMeetingViewRef.current?.noteId === noteId) {
      pendingMeetingViewRef.current = null;
    }
    setMeetingCenterView(pendingView);
    setMeetingSeriesOccurrences([]);
    setMeetingMetadataError(null);
    setTranscriptSegments([]);
    setTranscriptLinks([]);
    setDeletedTranscriptSegments([]);
    setTranscriptDrafts({});
    setTranscriptSpeakerDrafts({});
    setTranscriptError(null);
    setMeetingRecapDraft(null);
    setMeetingIdentitySuggestions([]);
    setMeetingPrep(null);
    setMeetingPrepStatus('idle');
    setMeetingRecapStatus('idle');
    setMeetingRecapError(null);
    setMeetingRecapTier(null);
    setMeetingRecapHasRun(false);
    setMeetingRecapTemplateChanged(false);
    if (!shouldLoad || !noteId) {
      setIsLoadingMeetingMetadata(false);
      setIsLoadingTranscript(false);
      return;
    }

    let cancelled = false;
    setIsLoadingMeetingMetadata(true);
    setIsLoadingTranscript(true);

    const loadMeetingData = async () => {
      let metadata: MeetingNoteMetadata;
      try {
        metadata = (await api.getMeetingMetadata(noteId)) as MeetingNoteMetadata;
      } catch (error) {
        console.error('[meeting-notes] metadata load failed', {
          noteId,
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          metadata = (await api.createMeetingMetadata(noteId)) as MeetingNoteMetadata;
        } catch (error) {
          if (cancelled || meetingRequestRef.current !== requestId) return;
          setMeetingMetadataError(
            error instanceof Error ? error.message : 'Could not load meeting details.'
          );
          setIsLoadingMeetingMetadata(false);
          setIsLoadingTranscript(false);
          return;
        }
      }

      if (cancelled || meetingRequestRef.current !== requestId) return;
      setMeetingMetadata(metadata);
      setIsLoadingMeetingMetadata(false);

      try {
        const segments = (await api.getTranscriptSegments(noteId)) as TranscriptSegment[];
        if (cancelled || meetingRequestRef.current !== requestId) return;
        const safeSegments = Array.isArray(segments) ? segments : [];
        setTranscriptSegments(safeSegments);
        try {
          const links = await api.getMeetingTranscriptLinks(noteId);
          if (!cancelled && meetingRequestRef.current === requestId)
            setTranscriptLinks(Array.isArray(links) ? (links as MeetingTranscriptLink[]) : []);
        } catch (error) {
          console.warn('[meeting-notes] transcript links load failed', error);
        }
        setTranscriptDrafts(
          Object.fromEntries(safeSegments.map((segment) => [segment.id, segment.transcript_text]))
        );
        setTranscriptSpeakerDrafts(
          Object.fromEntries(
            safeSegments.map((segment) => [segment.id, segment.speaker_identity?.displayName ?? segment.speaker_label ?? ''])
          )
        );
        const focusSegmentId = initialFocusContext.startsWith('transcript-segment:')
          ? initialFocusContext.slice('transcript-segment:'.length).trim()
          : '';
        if (focusSegmentId && safeSegments.some((segment) => segment.id === focusSegmentId)) {
          window.setTimeout(() => {
            document
              .querySelector(`[data-transcript-segment="${focusSegmentId}"]`)
              ?.scrollIntoView({ block: 'center' });
          }, 50);
        }
      } catch (error) {
        if (cancelled || meetingRequestRef.current !== requestId) return;
        setTranscriptError(error instanceof Error ? error.message : 'Could not load transcript.');
      } finally {
        if (!cancelled && meetingRequestRef.current === requestId) {
          setIsLoadingTranscript(false);
        }
      }
    };

    void loadMeetingData();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, initialFocusContext, isMeetingNote, selectedNoteId]);

  useEffect(() => {
    const noteId = selectedNoteId;
    const requestId = meetingRequestRef.current;
    if (
      !isMeetingNote ||
      !noteId ||
      (!meetingMetadata?.calendar_series_key && !meetingMetadata?.calendar_series_id)
    ) {
      setMeetingSeriesOccurrences([]);
      return;
    }
    let cancelled = false;
    void api
      .getMeetingSeries(noteId)
      .then((rows) => {
        if (
          cancelled ||
          meetingRequestRef.current !== requestId ||
          selectedNoteIdRef.current !== noteId
        )
          return;
        setMeetingSeriesOccurrences(Array.isArray(rows) ? (rows as MeetingSeriesOccurrence[]) : []);
      })
      .catch(() => {
        if (!cancelled && meetingRequestRef.current === requestId) setMeetingSeriesOccurrences([]);
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    isMeetingNote,
    meetingMetadata?.calendar_series_id,
    meetingMetadata?.calendar_series_key,
    selectedNoteId,
  ]);

  useEffect(() => {
    const generatePrep = window.askLedger?.generateMeetingPrep;
    if (!isMeetingNote || !selectedNoteId || !meetingMetadata || meetingMetadata.transcription_status !== 'idle' || !activeWorkspaceId || !generatePrep) return;
    const cached = meetingPrepCacheRef.current.get(selectedNoteId);
    if (cached) { setMeetingPrep(cached); setMeetingPrepStatus(cached.status === 'ready' ? 'ready' : 'idle'); return; }
    if (meetingPrepInFlightRef.current.has(selectedNoteId)) return;
    let cancelled = false;
    const loadPrep = async () => {
      meetingPrepInFlightRef.current.add(selectedNoteId);
      try {
        const prior = meetingSeriesOccurrences
          .filter((occurrence) => occurrence.note_id !== selectedNoteId && !occurrence.calendar_event_deleted)
          .filter((occurrence) => !meetingMetadata.scheduled_start_at || !occurrence.scheduled_start_at || occurrence.scheduled_start_at < meetingMetadata.scheduled_start_at)
          .slice(-3);
        const priorNotes = await Promise.all(prior.map(async (occurrence) => {
          try {
            const note = (await api.getNoteById(occurrence.note_id)) as { id?: string; title?: string; content_html?: string; content?: string };
            const text = htmlToPlainText(note.content_html ?? note.content ?? '').slice(0, 1800);
            return { noteId: occurrence.note_id, title: note.title ?? occurrence.note?.title ?? 'Previous meeting', scheduledStart: occurrence.scheduled_start_at, summary: text, actions: text.match(/next actions?([\s\S]{0,500})/i)?.[1] ? [text.match(/next actions?([\s\S]{0,500})/i)?.[1] ?? ''] : [], decisions: text.match(/decisions?([\s\S]{0,500})/i)?.[1] ? [text.match(/decisions?([\s\S]{0,500})/i)?.[1] ?? ''] : [] };
          } catch { return { noteId: occurrence.note_id, title: occurrence.note?.title ?? 'Previous meeting', scheduledStart: occurrence.scheduled_start_at, summary: '' }; }
        }));
        const projectIds = new Set(selectedNoteProjectLinks.map((link) => link.project_id));
        const [projectsPayload, tasksPayload, remindersPayload] = projectIds.size
          ? await Promise.all([api.getProjects(), api.getTasks(), api.getReminders({ scope: 'current_workspace' })])
          : [[], [], []];
        const projects = Array.isArray(projectsPayload) ? projectsPayload as Array<Record<string, unknown>> : [];
        const tasks = Array.isArray(tasksPayload) ? tasksPayload as Array<Record<string, unknown>> : [];
        const reminders = Array.isArray(remindersPayload) ? remindersPayload as Array<Record<string, unknown>> : [];
        const linkedProjects = projects.filter((project) => projectIds.has(String(project.id))).map((project) => ({ id: String(project.id), title: String(project.name ?? project.title ?? 'Project'), status: project.status == null ? null : String(project.status), completeness: typeof project.completeness === 'number' ? project.completeness : null }));
        const relevantTasks = tasks.filter((task) => projectIds.has(String(task.project_id ?? '')));
        const relevantReminders = reminders.filter((reminder) => projectIds.has(String(reminder.project_id ?? '')));
        const hasPriorContext = priorNotes.some((meeting) => Boolean(meeting.summary?.trim() || meeting.actions?.length || meeting.decisions?.length));
        const hasMeaningfulContext = hasPriorContext || linkedProjects.length > 0 || relevantTasks.length > 0 || relevantReminders.length > 0;
        if (!hasMeaningfulContext) {
          if (!cancelled) {
            setMeetingPrep(null);
            setMeetingPrepStatus('idle');
          }
          return;
        }
        if (!cancelled) setMeetingPrepStatus('generating');
        const context: MeetingPrepContext = { workspaceId: activeWorkspaceId, noteId: selectedNoteId, currentMeeting: { title: selectedNote.title, scheduledStart: meetingMetadata.scheduled_start_at, attendees: meetingMetadata.attendees ?? [], calendarSeriesId: meetingMetadata.calendar_series_id, calendarSeriesKey: meetingMetadata.calendar_series_key }, priorMeetings: priorNotes, linkedProjects, currentProjectState: linkedProjects.map((project) => ({ ...project, openActions: relevantTasks.filter((task) => String(task.project_id ?? '') === project.id && String(task.status ?? '') !== 'completed').length, overdueActions: relevantTasks.filter((task) => String(task.project_id ?? '') === project.id && String(task.status ?? '') !== 'completed' && task.due_date && String(task.due_date) < new Date().toISOString().slice(0, 10)).length })), tasks: relevantTasks.map((task) => ({ id: String(task.id), title: String(task.title ?? ''), status: task.status == null ? null : String(task.status), dueDate: task.due_date == null ? null : String(task.due_date), projectId: task.project_id == null ? null : String(task.project_id) })), reminders: relevantReminders.map((reminder) => ({ id: String(reminder.id), title: String(reminder.title ?? ''), isDone: reminder.is_done === true, remindAt: reminder.remind_at == null ? null : String(reminder.remind_at), projectId: reminder.project_id == null ? null : String(reminder.project_id) })), unresolvedThreads: [] };
        const result = (await generatePrep(context)) as MeetingPrepResult;
        if (cancelled) return;
        meetingPrepCacheRef.current.set(selectedNoteId, result);
        setMeetingPrep(result);
        setMeetingPrepStatus(result.status === 'ready' ? 'ready' : 'idle');
      } catch {
        if (!cancelled) setMeetingPrepStatus('idle');
      } finally {
        meetingPrepInFlightRef.current.delete(selectedNoteId);
      }
    };
    void loadPrep();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, api, isMeetingNote, meetingMetadata, meetingSeriesOccurrences, selectedNote, selectedNoteId, selectedNoteProjectLinks]);

  useEffect(() => {
    if (meetingMetadata?.transcription_status !== 'recording') return;
    const timer = window.setInterval(() => setMeetingTimerTick((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [meetingMetadata?.transcription_status]);

  const updateMeetingMetadata = useCallback(
    async (patch: Parameters<typeof api.updateMeetingMetadata>[1]) => {
      const noteId = selectedNoteIdRef.current;
      if (!noteId || !isMeetingNote || !meetingMetadata) return null;
      setMeetingBusyAction('metadata');
      setMeetingMetadataError(null);
      try {
        const updated = (await api.updateMeetingMetadata(noteId, patch)) as MeetingNoteMetadata;
        // A metadata update can happen before the initial meeting-load request
        // has established a request token. The selected note is the real
        // stale-response guard; request counter zero must not discard the
        // successful local readback.
        if (selectedNoteIdRef.current !== noteId) return updated;
        setMeetingMetadata(updated);
        return updated;
      } catch (error) {
        console.error('[meeting-notes] metadata update failed', {
          noteId,
          patch,
          error: error instanceof Error ? error.message : String(error),
        });
        setMeetingMetadataError(
          error instanceof Error ? error.message : 'Could not update meeting details.'
        );
        return null;
      } finally {
        setMeetingBusyAction(null);
      }
    },
    [api, isMeetingNote, meetingMetadata]
  );

  const toggleMeetingSource = useCallback(
    async (source: 'microphone_enabled' | 'system_audio_enabled') => {
      if (!meetingMetadata || meetingMetadata.transcription_status !== 'idle') return;
      await updateMeetingMetadata({ [source]: !meetingMetadata[source] });
    },
    [meetingMetadata, updateMeetingMetadata]
  );

  const selectMeetingTemplate = useCallback(async (template: NonNullable<MeetingNoteMetadata['meeting_template']>) => {
    const previousMetadata = meetingMetadata;
    // Electron/WebView does not support window.prompt(). Keep Custom usable
    // without throwing from the native renderer; its instructions can be
    // edited through the existing meeting-intelligence flow later.
    const instructions = meetingMetadata?.meeting_template_instructions ?? null;
    if (template === 'custom') setCustomMeetingTemplateInstructions(instructions ?? '');
    const payload = { meeting_template: template, ...(template === 'custom' ? { meeting_template_instructions: instructions } : {}) };
    setIsMeetingTemplateSaving(true);
    setMeetingMetadata((current) => current ? {
      ...current,
      meeting_template: template,
      ...(template === 'custom' ? { meeting_template_instructions: instructions } : {}),
    } : current);
    try {
      const updated = await updateMeetingMetadata(payload);
      if (!updated && previousMetadata) setMeetingMetadata(previousMetadata);
      if (updated && activeWorkspaceId && selectedNoteId) {
        meetingRecapDraftCache.invalidate(meetingRecapCacheKey(activeWorkspaceId, selectedNoteId));
        setMeetingRecapDraft(null);
        setMeetingRecapTier(null);
        setMeetingRecapStatus('idle');
        setMeetingIdentitySuggestions([]);
        if (hasAcceptedMeetingRecap || meetingRecapHasRun) setMeetingRecapTemplateChanged(true);
      }
      if (selectedNote?.parent_id) {
        try {
          await api.updateMeetingMetadata(selectedNote.parent_id, payload);
        } catch (error) {
          console.warn('[meeting-notes] parent template update failed', error);
        }
      }
      meetingPrepCacheRef.current.delete(selectedNoteId ?? '');
    } finally {
      setIsMeetingTemplateSaving(false);
    }
  }, [activeWorkspaceId, api, hasAcceptedMeetingRecap, meetingMetadata, meetingRecapHasRun, selectedNote, selectedNoteId, updateMeetingMetadata]);

  const saveCustomMeetingTemplateInstructions = useCallback(async () => {
    if (!meetingMetadata || meetingMetadata.meeting_template !== 'custom') return;
    const instructions = customMeetingTemplateInstructions.trim() || null;
    if ((meetingMetadata.meeting_template_instructions ?? null) === instructions) return;
    setIsMeetingTemplateSaving(true);
    try {
      const payload = { meeting_template: 'custom' as const, meeting_template_instructions: instructions };
      const updated = await updateMeetingMetadata(payload);
      if (updated && selectedNote?.parent_id) {
        try {
          await api.updateMeetingMetadata(selectedNote.parent_id, payload);
        } catch (error) {
          console.warn('[meeting-notes] parent custom template update failed', error);
        }
      }
      if (updated && activeWorkspaceId && selectedNoteId) {
        meetingRecapDraftCache.invalidate(meetingRecapCacheKey(activeWorkspaceId, selectedNoteId));
        setMeetingRecapDraft(null);
        setMeetingRecapStatus('idle');
      }
    } finally {
      setIsMeetingTemplateSaving(false);
    }
  }, [activeWorkspaceId, api, customMeetingTemplateInstructions, meetingMetadata, selectedNote, selectedNoteId, updateMeetingMetadata]);

  const enableMeetingMode = useCallback(async () => {
    if (!selectedNote || isMeetingNote) return;
    // Meeting mode adds recording to the normal note. Do not send the user
    // into the evidence view just because they enabled the microphone.
    pendingMeetingViewRef.current = { noteId: selectedNote.id, view: 'write' };
    setMeetingBusyAction('enable');
    setError(null);
    try {
      const updated = (await api.updateNote(selectedNote.id, {
        mode: 'meeting_note',
      })) as NoteRow;
      const metadata = (await api.createMeetingMetadata(selectedNote.id, {
        microphone_enabled: true,
        system_audio_enabled: true,
      })) as MeetingNoteMetadata;
      setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      setNoteTree((current) => replaceNoteInTree(current, updated));
      setDraftMode('meeting_note');
      setMeetingMetadata(metadata);
      setMeetingCenterView('write');
    } catch (error) {
      pendingMeetingViewRef.current = null;
      // The note mode and meeting metadata are created separately by the API.
      // If metadata creation fails, restore the original note mode so the note
      // is not left looking like a broken meeting note.
      try {
        await api.updateNote(selectedNote.id, { mode: selectedNote.mode || 'text' });
        setNotes((current) => current.map((note) => (note.id === selectedNote.id ? selectedNote : note)));
        setNoteTree((current) => replaceNoteInTree(current, selectedNote));
        setDraftMode(selectedNote.mode || 'text');
      } catch (rollbackError) {
        console.error('[meeting-notes] failed to roll back meeting mode', rollbackError);
      }
      setError(
        error instanceof Error ? error.message : 'Could not enable transcription for this note.'
      );
    } finally {
      setMeetingBusyAction(null);
    }
  }, [api, isMeetingNote, selectedNote]);

  const requestAudioPermissions = useCallback(async () => {
    if (platform.kind === 'web') {
      const microphone = await platform.meetingAudio.requestMicrophone();
      setAudioPermissions({ microphone: microphone === 'granted' ? 'granted' : microphone === 'denied' ? 'denied' : 'unavailable', systemAudio: 'unavailable' });
      return;
    }
    if (!window.meetingAudio) return;
    setIsAudioBusy(true);
    setAudioError(null);
    try {
      setAudioPermissions(await window.meetingAudio.requestPermissions());
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : 'Could not request audio permissions.'
      );
    } finally {
      setIsAudioBusy(false);
    }
  }, [platform]);

  const openAudioSettings = useCallback(async (area: 'microphone' | 'screen-recording') => {
    if (!window.meetingAudio) return;
    try {
      await window.meetingAudio.openSystemSettings(area);
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : 'Could not open macOS System Settings.'
      );
    }
  }, []);

  const testAudioSource = useCallback(
    async (source: 'user_microphone' | 'system_audio') => {
      if (!window.meetingAudio) return;
      setIsAudioBusy(true);
      setAudioError(null);
      try {
        const status = (await window.meetingAudio.testSource(
          source,
          source === 'user_microphone' ? selectedMicrophoneId : null
        )) as MeetingAudioStatus;
        setTestingAudioSource(source);
        setAudioCaptureStatus(status);
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : 'Could not start the audio test.');
      } finally {
        setIsAudioBusy(false);
      }
    },
    [selectedMicrophoneId]
  );

  const stopAudioTest = useCallback(async () => {
    if (!window.meetingAudio) return;
    setIsAudioBusy(true);
    try {
      setAudioCaptureStatus((await window.meetingAudio.stop()) as MeetingAudioStatus);
      setTestingAudioSource(null);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Could not stop the audio test.');
    } finally {
      setIsAudioBusy(false);
    }
  }, []);

  const recoverRecording = useCallback(
    async (session: RecordingRecovery) => {
      if (
        !window.meetingAudio ||
        !session.noteId ||
        !session.workspaceId ||
        session.workspaceId !== activeWorkspaceId
      )
        return;
      setRecordingRecoveryBusy(`recover:${session.sessionId}`);
      try {
        const note = (await api.getNoteById(session.noteId)) as NoteRow;
        if (!note || note.workspace_id !== session.workspaceId)
          throw new Error('The original meeting note is not available in this workspace.');
        await window.meetingAudio.recover({
          sessionId: session.sessionId,
          noteId: session.noteId,
          workspaceId: session.workspaceId,
        });
        await api.updateMeetingMetadata(session.noteId, {
          transcription_status: 'processing',
          duration_seconds: normalizeMeetingDurationSeconds(session.durationSeconds),
          meeting_start_at: session.startedAt,
          meeting_end_at: session.lastActivityAt,
        });
        setRecordingRecoveries((current) =>
          current.filter((item) => item.sessionId !== session.sessionId)
        );
        setAudioError(null);
        toast.show('Recording recovered and ready for processing.', { variant: 'success' });
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : 'Could not recover the recording.');
      } finally {
        setRecordingRecoveryBusy(null);
      }
    },
    [activeWorkspaceId, api, toast]
  );

  const discardRecording = useCallback(
    async (session: RecordingRecovery) => {
      if (
        !window.meetingAudio ||
        !window.confirm('Discard this interrupted recording? This removes its temporary audio.')
      )
        return;
      setRecordingRecoveryBusy(`discard:${session.sessionId}`);
      try {
        await window.meetingAudio.discardRecovery(session.sessionId);
        setRecordingRecoveries((current) =>
          current.filter((item) => item.sessionId !== session.sessionId)
        );
        toast.show('Interrupted recording discarded.', { variant: 'success' });
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : 'Could not discard the recording.');
      } finally {
        setRecordingRecoveryBusy(null);
      }
    },
    [toast]
  );

  const revealRecovery = useCallback(async (session: RecordingRecovery) => {
    if (!window.meetingAudio) return;
    try {
      await window.meetingAudio.reveal({ sessionId: session.sessionId });
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Could not open the saved recording.');
    }
  }, []);

  const startMeeting = useCallback(async () => {
    if (!meetingMetadata || !['idle', 'complete'].includes(meetingMetadata.transcription_status)) return;
    if (!window.meetingAudio) {
      setIsAudioSetupOpen(true);
      return;
    }
    setMeetingBusyAction('start');
    setAudioError(null);
    const now = new Date().toISOString();
    const resumingCompletedMeeting = meetingMetadata.transcription_status === 'complete';
    const transcriptAppendOffsetMs = resumingCompletedMeeting
      ? Math.max(0, ...transcriptSegments.map((segment) => Number(segment.end_ms) || 0)) + 1000
      : 0;
    transcriptAppendOffsetMsRef.current = transcriptAppendOffsetMs;
    if (resumingCompletedMeeting) {
      setMeetingRecapDraft(null);
      setMeetingRecapStatus('idle');
      setMeetingRecapHasRun(false);
      setMeetingRecapError(null);
    }
    try {
      if (window.meetingTranscription) {
        const model = (await window.meetingTranscription.modelStatus()) as TranscriptionModelStatus;
        setTranscriptionModel(model);
        if (!model.installed) {
          setIsTranscriptionSetupOpen(true);
          return;
        }
      }
      const permissions = audioPermissions ?? (await window.meetingAudio.permissions());
      setAudioPermissions(permissions);
      if (meetingMetadata.microphone_enabled && permissions.microphone === 'not_requested') {
        setIsAudioSetupOpen(true);
        return;
      }
      const microphone = meetingMetadata.microphone_enabled && permissions.microphone === 'granted';
      // Screen & System Audio Recording can remain reported as denied by the
      // helper even after the packaged Ledger app is enabled in macOS
      // Settings. Let the native stream attempt start in that case; a real
      // capture failure is reported as a source warning instead of trapping
      // the user in the setup modal.
      const systemAudio =
        meetingMetadata.system_audio_enabled &&
        permissions.systemAudio !== 'restricted' &&
        permissions.systemAudio !== 'unavailable';
      if (!microphone && !systemAudio) {
        setAudioError(
          'No permitted audio source is available. Enable the microphone or system-audio permission and try again.'
        );
        setIsAudioSetupOpen(true);
        return;
      }
      const refreshedDevices = microphone ? await refreshAudioDevices() : null;
      const microphoneDeviceId = microphone
        ? refreshedDevices?.devices.find((device) => device.id === selectedMicrophoneId)?.id ??
          refreshedDevices?.devices.find((device) => device.isDefault)?.id ??
          refreshedDevices?.devices[0]?.id ??
          null
        : null;
      const capture = (await window.meetingAudio.start({
        noteId: selectedNoteIdRef.current!,
        workspaceId: activeWorkspaceId!,
        microphone,
        systemAudio,
        microphoneDeviceId,
        scheduledEndAt: meetingMetadata.scheduled_end_at ?? null,
        transcriptOffsetMs: transcriptAppendOffsetMs,
      })) as MeetingAudioStatus;
      setAudioCaptureStatus(capture);
      if (window.meetingTranscription && capture.sessionId && selectedNoteIdRef.current && activeWorkspaceId) {
        void window.meetingTranscription
          .prepare({ sessionId: capture.sessionId, noteId: selectedNoteIdRef.current, workspaceId: activeWorkspaceId })
          .catch((error) => console.warn('[transcription] runtime preparation failed', error));
      }
      const sources = new Set(capture.sources.map((source) => source.source));
      const updated = await updateMeetingMetadata({
        transcription_status: 'recording',
        meeting_start_at: resumingCompletedMeeting ? (meetingMetadata.meeting_start_at ?? capture.startedAt ?? now) : (capture.startedAt || now),
        meeting_end_at: null,
        duration_seconds: 0,
        microphone_enabled: sources.has('user_microphone'),
        system_audio_enabled: sources.has('system_audio'),
        transcription_error: null,
      });
      if (!updated) {
        await window.meetingAudio.stop();
        setAudioCaptureStatus(null);
      }
      if (capture.warnings.length)
        setAudioError(capture.warnings.map((warning) => warning.error).join(' '));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start audio capture.';
      setAudioError(message);
      if (/tcc|permission|screen.?capture|system.?audio.*denied|declined/i.test(message)) {
        // Keep permission failures in the existing setup flow so the user can
        // open the correct macOS settings page without leaving the meeting
        // controls in a dead or repeatedly prompting state.
        setIsAudioSetupOpen(true);
        try {
          setAudioPermissions(await window.meetingAudio.permissions());
        } catch {}
      }
    } finally {
      setMeetingBusyAction(null);
    }
  }, [
    activeWorkspaceId,
    audioPermissions,
    meetingMetadata,
    refreshAudioDevices,
    selectedMicrophoneId,
    transcriptSegments,
    updateMeetingMetadata,
  ]);

  const pauseMeeting = useCallback(async () => {
    if (!meetingMetadata || meetingMetadata.transcription_status !== 'recording') return;
    if (!window.meetingAudio) {
      setIsAudioSetupOpen(true);
      return;
    }
    setMeetingBusyAction('pause');
    try {
      const capture = (await window.meetingAudio.pause()) as MeetingAudioStatus;
      setAudioCaptureStatus(capture);
      if (capture.state !== 'paused') {
        const staleSessionId = audioCaptureStatus?.sessionId;
        let recoveredToProcessing = false;
        if (staleSessionId && activeWorkspaceId && window.meetingTranscription) {
          try {
            const inspection = (await window.meetingAudio.inspect(staleSessionId)) as RecordingRecovery;
            if (inspection.status === 'ready' && inspection.chunks.some((chunk) => chunk.finalized && chunk.sizeBytes > 44)) {
              const job = (await window.meetingTranscription.start({
                sessionId: staleSessionId,
                noteId: inspection.noteId || selectedNoteIdRef.current!,
                workspaceId: inspection.workspaceId || activeWorkspaceId,
              })) as TranscriptionJobStatus;
              setTranscriptionJob(job);
              await updateMeetingMetadata({ transcription_status: 'processing', transcription_error: null });
              recoveredToProcessing = true;
            }
          } catch (recoveryError) {
            console.warn('[meeting-notes] stale capture reconciliation failed', recoveryError);
          }
        }
        if (!recoveredToProcessing) {
          await updateMeetingMetadata({
            transcription_status: 'idle',
            transcription_error: 'The recording session was no longer active.',
          });
        }
        setAudioError(recoveredToProcessing ? 'Recording had already stopped; transcription is continuing.' : 'Recording had already stopped.');
        return;
      }
      await updateMeetingMetadata({
        transcription_status: 'paused',
        duration_seconds: getMeetingElapsedSeconds(meetingMetadata),
      });
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Could not pause audio capture.');
    } finally {
      setMeetingBusyAction(null);
    }
  }, [activeWorkspaceId, audioCaptureStatus?.sessionId, meetingMetadata, updateMeetingMetadata]);

  const resumeMeeting = useCallback(async () => {
    if (!meetingMetadata || meetingMetadata.transcription_status !== 'paused') return;
    if (!window.meetingAudio) {
      setIsAudioSetupOpen(true);
      return;
    }
    setMeetingBusyAction('resume');
    try {
      const capture = (await window.meetingAudio.resume()) as MeetingAudioStatus;
      setAudioCaptureStatus(capture);
      if (capture.state !== 'recording') {
        await updateMeetingMetadata({
          transcription_status: 'idle',
          transcription_error: 'The recording session was no longer active.',
        });
        setAudioError('Recording had already stopped.');
        return;
      }
      await updateMeetingMetadata({
        transcription_status: 'recording',
        meeting_end_at: null,
      });
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Could not resume audio capture.');
    } finally {
      setMeetingBusyAction(null);
    }
  }, [meetingMetadata, updateMeetingMetadata]);

  const stopMeeting = useCallback(async () => {
    if (
      !meetingMetadata ||
      !['recording', 'paused'].includes(meetingMetadata.transcription_status)
    ) {
      return;
    }
    if (!window.meetingAudio) {
      setIsAudioSetupOpen(true);
      return;
    }
    setIsLiveTranscriptOpen(false);
    setMeetingCenterView('write');
    if (meetingStopInFlightRef.current) return;
    meetingStopInFlightRef.current = true;
    setMeetingBusyAction('stop');
    const activeSessionId = audioCaptureStatus?.sessionId;
    try {
      const capture = (await window.meetingAudio.stop()) as MeetingAudioStatus;
      setAudioCaptureStatus(capture);
      const sessionId = capture?.sessionId || activeSessionId;
      const rawMeetingEndAt = capture?.endedAt || new Date().toISOString();
      const meetingStartMs = Date.parse(meetingMetadata.meeting_start_at || '');
      const meetingEndMs = Date.parse(rawMeetingEndAt);
      const meetingEndAt =
        Number.isFinite(meetingStartMs) &&
        Number.isFinite(meetingEndMs) &&
        meetingEndMs < meetingStartMs
          ? new Date(meetingStartMs).toISOString()
          : rawMeetingEndAt;
      const durationSeconds = normalizeMeetingDurationSeconds(
        capture?.durationSeconds || getMeetingElapsedSeconds(meetingMetadata)
      );
      if (window.meetingTranscription && sessionId) {
        try {
          const recordingNoteId = capture.noteId || selectedNoteIdRef.current;
          const recordingWorkspaceId = capture.workspaceId || activeWorkspaceId;
          if (!recordingNoteId || !recordingWorkspaceId)
            throw new Error('The finalized recording is missing its note workspace identity.');
          const job = (await window.meetingTranscription.start({
            sessionId,
            noteId: recordingNoteId,
            workspaceId: recordingWorkspaceId,
          })) as TranscriptionJobStatus;
          setTranscriptionJob(job);
          // The job is accepted before the metadata write. Keep the local
          // state in processing immediately so a second Stop cannot start the
          // same recording again if that write is slow or fails.
          setMeetingMetadata((current) =>
            current
              ? {
                  ...current,
                  transcription_status: 'processing',
                  duration_seconds: durationSeconds,
                  meeting_end_at: meetingEndAt,
                  transcription_error: null,
                }
              : current
          );
          const updated = await updateMeetingMetadata({
            transcription_status: 'processing',
            duration_seconds: durationSeconds,
            meeting_end_at: meetingEndAt,
            transcription_error: null,
          });
          if (!updated) setAudioError('Transcription started, but meeting status could not be saved.');
        } catch (transcriptionError) {
          const message =
            transcriptionError instanceof Error
              ? transcriptionError.message
              : 'Local transcription could not start.';
          reportTranscriptionError(message);
          await updateMeetingMetadata({
            transcription_status: 'failed',
            duration_seconds: durationSeconds,
            meeting_end_at: meetingEndAt,
            transcription_error: message,
          });
        }
      } else {
        throw new Error('The finalized recording session could not be identified.');
      }
      if (capture?.warnings.length)
        setAudioError(capture.warnings.map((warning) => warning.error).join(' '));
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Could not stop audio capture.');
    } finally {
      meetingStopInFlightRef.current = false;
      setMeetingBusyAction(null);
    }
  }, [activeWorkspaceId, audioCaptureStatus?.sessionId, meetingMetadata, reportTranscriptionError, updateMeetingMetadata]);

  useEffect(() => {
    const autoStop = window.meetingAutoStop;
    if (!autoStop) return;
    return autoStop.onStopRequested((event) => {
      if (event.noteId !== selectedNoteIdRef.current) return;
      void stopMeeting();
    });
  }, [stopMeeting]);

  useEffect(() => {
    const autoStop = window.meetingAutoStop;
    if (!autoStop) return;
    return autoStop.onCompleted((event) => {
      if (event.noteId !== selectedNoteIdRef.current) return;
      void stopMeeting();
    });
  }, [stopMeeting]);

  const installTranscriptionModel = useCallback(async () => {
    if (!window.meetingTranscription) return;
    setTranscriptionBusy(true);
    try {
      const model = (await window.meetingTranscription.downloadModel()) as TranscriptionModelStatus;
      setTranscriptionModel(model);
      if (model.installed) setIsTranscriptionSetupOpen(false);
      setAudioError(null);
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : 'Could not install the local Whisper model.'
      );
    } finally {
      setTranscriptionBusy(false);
    }
  }, []);

  const startTranscription = useCallback(
    async (force = false) => {
      const noteId = selectedNoteIdRef.current;
      const sessionId = audioCaptureStatus?.sessionId || transcriptionJob?.sessionId;
      if (!window.meetingTranscription || !noteId || !activeWorkspaceId || !sessionId) return;
      setTranscriptionBusy(true);
      try {
        const job = (await window.meetingTranscription.start({
          sessionId,
          noteId,
          workspaceId: activeWorkspaceId,
          force,
        })) as TranscriptionJobStatus;
        setTranscriptionJob(job);
        await updateMeetingMetadata({
          transcription_status: 'processing',
          transcription_error: null,
        });
        setAudioError(null);
      } catch (error) {
        reportTranscriptionError(
          error instanceof Error ? error.message : 'Could not start local transcription.'
        );
      } finally {
        setTranscriptionBusy(false);
      }
    },
    [
      activeWorkspaceId,
      audioCaptureStatus?.sessionId,
      reportTranscriptionError,
      transcriptionJob?.sessionId,
      updateMeetingMetadata,
    ]
  );

  const cancelTranscription = useCallback(async () => {
    if (!window.meetingTranscription || !transcriptionJob) return;
    setTranscriptionBusy(true);
    try {
      setTranscriptionJob(
        (await window.meetingTranscription.cancel(transcriptionJob.jobId)) as TranscriptionJobStatus
      );
      await updateMeetingMetadata({
        transcription_status: 'failed',
        transcription_error: 'Transcription cancelled. Finalized audio is available for retry.',
      });
    } catch (error) {
      reportTranscriptionError(error instanceof Error ? error.message : 'Could not cancel transcription.');
    } finally {
      setTranscriptionBusy(false);
    }
  }, [reportTranscriptionError, transcriptionJob, updateMeetingMetadata]);

  useEffect(() => {
    if (
      !isMeetingNote ||
      meetingMetadata?.transcription_status !== 'processing' ||
      !window.meetingTranscription
    )
      return;
    const timer = window.setInterval(
      () => void refreshTranscriptionState(transcriptionJob?.jobId),
      1500
    );
    return () => window.clearInterval(timer);
  }, [
    isMeetingNote,
    meetingMetadata?.transcription_status,
    refreshTranscriptionState,
    transcriptionJob?.jobId,
  ]);

  // A local worker failure is durable and retryable. Reflect it in the note
  // instead of leaving the cloud metadata in Processing forever.
  useEffect(() => {
    if (
      !isMeetingNote ||
      meetingMetadata?.transcription_status !== 'processing' ||
      transcriptionJob?.status !== 'failed' ||
      !transcriptionJob.error ||
      selectedNoteIdRef.current !== transcriptionJob.noteId
    ) return;
    void updateMeetingMetadata({
      transcription_status: 'failed',
      transcription_error: transcriptionJob.error,
    });
  }, [
    isMeetingNote,
    meetingMetadata?.transcription_status,
    transcriptionJob,
    updateMeetingMetadata,
  ]);

  useEffect(() => {
    const job = transcriptionJob;
    if (
      !job ||
      job.status !== 'merging' ||
      !window.meetingTranscription ||
      !meetingMetadata ||
      selectedNoteIdRef.current !== job.noteId
    )
      return;
    if (transcriptionMergeInFlightRef.current.has(job.jobId)) return;
    transcriptionMergeInFlightRef.current.add(job.jobId);
    let cancelled = false;
    const finish = async () => {
      try {
        const rows = (await window.meetingTranscription!.results(job.jobId)) as Array<{
          id: string;
          audioSource: 'user_microphone' | 'system_audio';
          speakerLabel: string;
          startMs: number;
          endMs: number;
          text: string;
          confidence: number | null;
          segmentOrder: number;
          speakerIdentity?: TranscriptSegment['speaker_identity'];
        }>;
        if (cancelled) return;
        const segments = rows.map((row) => ({
          id: row.id,
          audio_source: row.audioSource,
          speaker_label: row.speakerLabel,
          start_ms: row.startMs,
          end_ms: row.endMs,
          transcript_text: row.text,
          confidence: row.confidence,
          segment_order: row.segmentOrder,
          speaker_identity: row.speakerIdentity ? resolveDeterministicSpeakerIdentity({
            segment: {
              id: row.id,
              note_id: job.noteId,
              workspace_id: job.workspaceId,
              audio_source: row.audioSource,
              speaker_label: row.speakerLabel,
              speaker_identity: row.speakerIdentity,
              start_ms: row.startMs,
              end_ms: row.endMs,
              transcript_text: row.text,
              confidence: row.confidence,
              segment_order: row.segmentOrder,
              created_at: '',
              updated_at: '',
            },
            metadata: meetingMetadata,
            currentUser: user ? { id: user.id, email: user.email } : null,
          }) : undefined,
        }));
        const existingBeforeMerge = (await api.getTranscriptSegments(job.noteId)) as TranscriptSegment[];
        const existingIds = new Set(
          (Array.isArray(existingBeforeMerge) ? existingBeforeMerge : []).map((segment) => segment.id)
        );
        const missingSegments = segments.filter((segment) => !existingIds.has(segment.id));
        if (missingSegments.length) await api.bulkCreateTranscriptSegments(job.noteId, missingSegments);
        const stored = (await api.getTranscriptSegments(job.noteId)) as TranscriptSegment[];
        const safeStored = Array.isArray(stored) ? stored : [];
        if (segments.length && safeStored.length === 0) {
          throw new Error(
            'Transcript segments were not saved. The audio is preserved so you can retry.'
          );
        }
        if (cancelled || selectedNoteIdRef.current !== job.noteId) return;
        setTranscriptSegments(safeStored);
        setTranscriptDrafts(
          Object.fromEntries(safeStored.map((segment) => [segment.id, segment.transcript_text]))
        );
        const completedMetadata = await updateMeetingMetadata({
          transcription_status: 'complete',
          transcription_error: null,
        });
        if (!completedMetadata)
          throw new Error(
            'Meeting status could not be marked complete. The audio is preserved so you can retry.'
          );
        await window.meetingTranscription!.complete({
          jobId: job.jobId,
          retention: meetingMetadata.audio_retention,
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Transcript storage failed.';
        reportTranscriptionError(message);
        await window.meetingTranscription!.fail({ jobId: job.jobId, error: message });
        await updateMeetingMetadata({
          transcription_status: 'failed',
          transcription_error:
            'Transcript processing failed. The audio is preserved so you can retry.',
        });
      } finally {
        transcriptionMergeInFlightRef.current.delete(job.jobId);
      }
    };
    void finish();
    return () => {
      cancelled = true;
    };
  }, [api, meetingMetadata, reportTranscriptionError, transcriptionJob, updateMeetingMetadata]);

  const resetFailedMeeting = useCallback(async () => {
    if (!meetingMetadata || meetingMetadata.transcription_status !== 'failed') return;
    await updateMeetingMetadata({ transcription_status: 'idle', transcription_error: null });
  }, [meetingMetadata, updateMeetingMetadata]);

  const commitTranscriptSegment = useCallback(
    async (segment: TranscriptSegment, speakerLabelOverride?: string) => {
      const nextText = transcriptDraftsRef.current[segment.id] ?? segment.transcript_text;
      const nextSpeaker =
        speakerLabelOverride ??
        transcriptSpeakerDraftsRef.current[segment.id] ??
        segment.speaker_label ??
        '';
      const normalizedSpeaker = nextSpeaker.trim();
      const currentUserMember = user?.id ? workspaceMemberById.get(user.id) : null;
      const currentUserName = currentUserMember?.full_name || currentUserMember?.email || user?.email || null;
      const matchingMember = workspaceMembers.find(
        (member) => displayUserName(member).toLowerCase() === normalizedSpeaker.toLowerCase() || member.email?.toLowerCase() === normalizedSpeaker.toLowerCase()
      );
      const nextIdentity: MeetingSpeakerIdentity = {
        rawSpeakerId: segment.speaker_identity?.rawSpeakerId || `source:${segment.audio_source}`,
        personId: matchingMember?.user_id || (normalizedSpeaker === currentUserName ? user?.id : undefined),
        displayName: normalizedSpeaker || undefined,
        state: normalizedSpeaker && normalizedSpeaker !== 'Unknown speaker' ? 'known' : 'unknown',
        confidence: 1,
        source: 'user_confirmed',
        confirmedByUser: true,
      };
      if (nextText === segment.transcript_text && nextSpeaker === (segment.speaker_label ?? '') && JSON.stringify(segment.speaker_identity ?? null) === JSON.stringify(nextIdentity))
        return;
      if (!selectedNoteIdRef.current) return;
      if (!nextText.trim()) {
        setTranscriptDrafts((current) => ({ ...current, [segment.id]: segment.transcript_text }));
        setTranscriptError(
          'Transcript text cannot be empty. Delete the segment explicitly if you want to remove it.'
        );
        return;
      }
      const noteId = selectedNoteIdRef.current;
      const version = (transcriptCommitVersionRef.current[segment.id] ?? 0) + 1;
      transcriptCommitVersionRef.current[segment.id] = version;
      try {
        const updated = (await api.updateTranscriptSegment(noteId, segment.id, {
          transcript_text: nextText,
          speaker_label: normalizedSpeaker || null,
          speaker_identity: nextIdentity,
        })) as TranscriptSegment;
        if (!isRenderableTranscriptSegment(updated)) {
          throw new Error(
            'The transcript update returned an invalid segment. The original text is still safe.'
          );
        }
        if (
          selectedNoteIdRef.current !== noteId ||
          transcriptCommitVersionRef.current[segment.id] !== version
        )
          return;
        setTranscriptError(null);
        setTranscriptSegments((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        setTranscriptDrafts((current) => ({ ...current, [updated.id]: updated.transcript_text }));
      } catch (error) {
        if (
          selectedNoteIdRef.current !== noteId ||
          transcriptCommitVersionRef.current[segment.id] !== version
        )
          return;
        setTranscriptError(error instanceof Error ? error.message : 'Could not update transcript.');
      }
    },
    [api, user, workspaceMemberById, workspaceMembers]
  );

  const confirmMeetingIdentity = useCallback(async (suggestion: MeetingIdentitySuggestion) => {
    if (!suggestion.rawSpeakerId || !suggestion.displayName) return;
    const matching = resolvedTranscriptSegments.filter((segment) => segment.speaker_identity?.rawSpeakerId === suggestion.rawSpeakerId);
    for (const segment of matching) await commitTranscriptSegment(segment, suggestion.displayName);
    setMeetingIdentitySuggestions((current) => current.filter((item) => item !== suggestion));
  }, [commitTranscriptSegment, resolvedTranscriptSegments]);

  const openMeetingActionComposer = useCallback((kind: NotesSelectionComposerKind, action: MeetingActionSuggestion) => {
    const source = action.sourceRefs[0];
    const segment = transcriptSegments.find((item) => item.id === source?.transcriptSegmentId);
    if (!segment || !selectedNoteId) return;
    openEditorOverviewComposer(kind, action.text, {
      projectId: selectedNoteProjectLinks[0]?.project_id ?? null,
      assigneeId: user?.id ?? null,
      transcriptSegmentId: segment.id,
      transcriptTimestampMs: source.timestampMs,
      transcriptSpeakerLabel: segment.speaker_label,
      transcriptAudioSource: segment.audio_source,
      sourceLabel: `Created from meeting “${selectedNote?.title ?? selectedNoteId}”`,
    });
  }, [openEditorOverviewComposer, selectedNote, selectedNoteId, selectedNoteProjectLinks, transcriptSegments, user?.id]);

  const deleteTranscriptSegment = useCallback(
    async (segment: TranscriptSegment) => {
      const noteId = selectedNoteIdRef.current;
      if (!noteId) return;
      try {
        await api.deleteTranscriptSegment(noteId, segment.id);
        if (selectedNoteIdRef.current !== noteId) return;
        setTranscriptSegments((current) => current.filter((item) => item.id !== segment.id));
        setDeletedTranscriptSegments((current) =>
          [...current.filter((item) => item.id !== segment.id), segment].slice(-10)
        );
      } catch (error) {
        setTranscriptError(
          error instanceof Error ? error.message : 'Could not delete transcript segment.'
        );
      }
    },
    [api]
  );

  const restoreTranscriptSegment = useCallback(
    async (segment: TranscriptSegment) => {
      const noteId = selectedNoteIdRef.current;
      if (!noteId) return;
      try {
        const restored = await api.restoreTranscriptSegment(noteId, segment.id);
        if (selectedNoteIdRef.current !== noteId) return;
        setTranscriptSegments((current) =>
          [...current, restored].sort(
            (a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order
          )
        );
        setDeletedTranscriptSegments((current) => current.filter((item) => item.id !== segment.id));
      } catch (error) {
        setTranscriptError(
          error instanceof Error ? error.message : 'Could not restore transcript segment.'
        );
      }
    },
    [api]
  );

  const splitTranscriptSegment = useCallback(
    async (segment: TranscriptSegment, position: number) => {
      const noteId = selectedNoteIdRef.current;
      if (!noteId || transcriptMutationRef.current) return;
      const latest = transcriptSegments.find((item) => item.id === segment.id);
      if (!latest) return;
      const text = transcriptDrafts[latest.id] ?? latest.transcript_text;
      const splitAt = Math.floor(position);
      const firstText = text.slice(0, splitAt).trim();
      const secondText = text.slice(splitAt).trim();
      if (splitAt <= 0 || splitAt >= text.length || !firstText || !secondText) {
        setTranscriptError('Place the cursor between two non-empty parts of the transcript.');
        return;
      }

      transcriptMutationRef.current = true;
      setTranscriptMutation('split');
      setTranscriptError(null);
      const original = { ...latest };
      const duration = Math.max(0, latest.end_ms - latest.start_ms);
      const ratio = text.length > 0 ? splitAt / text.length : 0.5;
      const boundary =
        duration > 0
          ? Math.min(
              latest.end_ms,
              Math.max(latest.start_ms, latest.start_ms + Math.round(duration * ratio))
            )
          : latest.start_ms;
      try {
        const first = await api.updateTranscriptSegment(noteId, latest.id, {
          transcript_text: firstText,
          end_ms: boundary,
          segment_order: latest.segment_order,
        });
        let second: TranscriptSegment;
        try {
          second = await api.createTranscriptSegment(noteId, {
            audio_source: latest.audio_source,
            speaker_label: latest.speaker_label,
            start_ms: boundary,
            end_ms: latest.end_ms,
            transcript_text: secondText,
            confidence: latest.confidence,
            segment_order: latest.segment_order + 1,
          });
        } catch (error) {
          await api
            .updateTranscriptSegment(noteId, latest.id, {
              transcript_text: original.transcript_text,
              start_ms: original.start_ms,
              end_ms: original.end_ms,
              speaker_label: original.speaker_label,
              segment_order: original.segment_order,
            })
            .catch(() => undefined);
          throw error;
        }
        if (selectedNoteIdRef.current !== noteId) return;
        setTranscriptSegments((current) =>
          [...current.filter((item) => item.id !== latest.id), first, second].sort(
            (a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order
          )
        );
        setTranscriptDrafts((current) => ({
          ...current,
          [first.id]: first.transcript_text,
          [second.id]: second.transcript_text,
        }));
        const undo = async () => {
          if (transcriptMutationRef.current || selectedNoteIdRef.current !== noteId) return;
          transcriptMutationRef.current = true;
          setTranscriptMutation('split');
          try {
            const restored = await api.updateTranscriptSegment(noteId, original.id, {
              transcript_text: original.transcript_text,
              start_ms: original.start_ms,
              end_ms: original.end_ms,
              speaker_label: original.speaker_label,
              segment_order: original.segment_order,
            });
            await api.deleteTranscriptSegment(noteId, second.id);
            setTranscriptSegments((current) =>
              [
                ...current.filter((item) => item.id !== first.id && item.id !== second.id),
                restored,
              ].sort((a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order)
            );
            setTranscriptDrafts((current) => ({
              ...current,
              [restored.id]: restored.transcript_text,
            }));
            transcriptUndoRef.current = null;
          } catch (error) {
            setTranscriptError(
              error instanceof Error ? error.message : 'Could not undo the split.'
            );
          } finally {
            transcriptMutationRef.current = false;
            setTranscriptMutation(null);
          }
        };
        transcriptUndoRef.current = { noteId, undo };
        toast.show('Segment split', {
          variant: 'success',
          duration: 8000,
          actions: [{ label: 'Undo', onClick: undo }],
        });
      } catch (error) {
        setTranscriptError(
          error instanceof Error ? error.message : 'Could not split transcript segment.'
        );
      } finally {
        transcriptMutationRef.current = false;
        setTranscriptMutation(null);
      }
    },
    [api, toast, transcriptDrafts, transcriptSegments]
  );

  const mergeTranscriptSegments = useCallback(
    async (segment: TranscriptSegment, next: TranscriptSegment, speakerLabelOverride?: string) => {
      const noteId = selectedNoteIdRef.current;
      if (!noteId || transcriptMutationRef.current) return;
      const latest = transcriptSegments.find((item) => item.id === segment.id);
      const latestNext = transcriptSegments.find((item) => item.id === next.id);
      if (!latest || !latestNext) return;
      const sameSource = latest.audio_source === latestNext.audio_source;
      if (!sameSource) {
        setTranscriptError('Segments from different audio sources must remain separate.');
        return;
      }
      const sameSourceSegments = transcriptSegments
        .filter((item) => item.audio_source === latest.audio_source)
        .sort((a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order);
      const currentIndex = sameSourceSegments.findIndex((item) => item.id === latest.id);
      if (
        currentIndex < 0 ||
        sameSourceSegments[currentIndex + 1]?.id !== latestNext.id ||
        latestNext.end_ms < latest.start_ms
      ) {
        setTranscriptError(
          'That segment is no longer the next chronological segment. Refresh the transcript and try again.'
        );
        return;
      }
      const firstSpeaker = transcriptSpeakerLabel(latest);
      const nextSpeaker = transcriptSpeakerLabel(latestNext);
      if (!speakerLabelOverride && firstSpeaker !== nextSpeaker) {
        setTranscriptError('Choose which speaker label to keep before merging.');
        return;
      }
      transcriptMutationRef.current = true;
      setTranscriptMutation('merge');
      setTranscriptError(null);
      const original = { first: { ...latest }, next: { ...latestNext } };
      const firstText = transcriptDrafts[latest.id] ?? latest.transcript_text;
      const nextText = transcriptDrafts[latestNext.id] ?? latestNext.transcript_text;
      const mergedText = mergeTranscriptText(firstText, nextText);
      try {
        const merged = await api.updateTranscriptSegment(noteId, latest.id, {
          transcript_text: mergedText,
          speaker_label: (speakerLabelOverride || firstSpeaker).trim() || null,
          end_ms: latestNext.end_ms,
          segment_order: latest.segment_order,
        });
        try {
          await api.deleteTranscriptSegment(noteId, latestNext.id);
        } catch (error) {
          await api
            .updateTranscriptSegment(noteId, latest.id, {
              transcript_text: original.first.transcript_text,
              start_ms: original.first.start_ms,
              end_ms: original.first.end_ms,
              speaker_label: original.first.speaker_label,
              segment_order: original.first.segment_order,
            })
            .catch(() => undefined);
          throw error;
        }
        if (selectedNoteIdRef.current !== noteId) return;
        setTranscriptSegments((current) =>
          current
            .filter((item) => item.id !== latest.id && item.id !== latestNext.id)
            .concat(merged)
            .sort((a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order)
        );
        setTranscriptDrafts((current) => ({ ...current, [merged.id]: merged.transcript_text }));
        setDeletedTranscriptSegments((current) => [...current, latestNext].slice(-10));
        const undo = async () => {
          if (transcriptMutationRef.current || selectedNoteIdRef.current !== noteId) return;
          transcriptMutationRef.current = true;
          setTranscriptMutation('merge');
          try {
            const restoredFirst = await api.updateTranscriptSegment(noteId, original.first.id, {
              transcript_text: original.first.transcript_text,
              start_ms: original.first.start_ms,
              end_ms: original.first.end_ms,
              speaker_label: original.first.speaker_label,
              segment_order: original.first.segment_order,
            });
            const restoredNext = await api.restoreTranscriptSegment(noteId, original.next.id);
            setTranscriptSegments((current) =>
              [
                ...current.filter(
                  (item) => item.id !== original.first.id && item.id !== original.next.id
                ),
                restoredFirst,
                restoredNext,
              ].sort((a, b) => a.start_ms - b.start_ms || a.segment_order - b.segment_order)
            );
            setTranscriptDrafts((current) => ({
              ...current,
              [restoredFirst.id]: restoredFirst.transcript_text,
              [restoredNext.id]: restoredNext.transcript_text,
            }));
            setDeletedTranscriptSegments((current) =>
              current.filter((item) => item.id !== original.next.id)
            );
            transcriptUndoRef.current = null;
          } catch (error) {
            setTranscriptError(
              error instanceof Error ? error.message : 'Could not undo the merge.'
            );
          } finally {
            transcriptMutationRef.current = false;
            setTranscriptMutation(null);
          }
        };
        transcriptUndoRef.current = { noteId, undo };
        toast.show('Segments merged', {
          variant: 'success',
          duration: 8000,
          actions: [{ label: 'Undo', onClick: undo }],
        });
      } catch (error) {
        setTranscriptError(
          error instanceof Error ? error.message : 'Could not merge transcript segments.'
        );
      } finally {
        transcriptMutationRef.current = false;
        setTranscriptMutation(null);
      }
    },
    [api, toast, transcriptDrafts, transcriptSegments]
  );

  const clearMeetingTranscript = useCallback(async () => {
    const noteId = selectedNoteIdRef.current;
    if (
      !noteId ||
      !isMeetingNote ||
      !window.confirm('Clear this transcript? This cannot be undone.')
    ) {
      return;
    }
    setMeetingBusyAction('clear-transcript');
    try {
      await api.clearTranscript(noteId);
      if (selectedNoteIdRef.current !== noteId) return;
      setTranscriptSegments([]);
      setTranscriptDrafts({});
      setTranscriptError(null);
    } catch (error) {
      setTranscriptError(error instanceof Error ? error.message : 'Could not clear transcript.');
    } finally {
      setMeetingBusyAction(null);
    }
  }, [api, isMeetingNote]);

  const exportMeetingNote = useCallback(
    (format: 'txt' | 'md' | 'json' | 'html', includeTranscript = true) => {
      if (!selectedNote || !meetingMetadata) return;
      const title = draftTitle.trim() || selectedNote.title || 'Meeting notes';
      const transcript = includeTranscript
        ? transcriptSegments.map((segment) => ({
            speaker:
              segment.speaker_label ||
              (segment.audio_source === 'user_microphone' ? 'You' : 'Meeting'),
            source: segment.audio_source,
            timestamp: formatTranscriptTimestamp(segment.start_ms),
            text: segment.transcript_text,
          }))
        : [];
      const payload = {
        title,
        scheduled_start: meetingMetadata.scheduled_start_at,
        scheduled_end: meetingMetadata.scheduled_end_at,
        actual_start: meetingMetadata.meeting_start_at,
        actual_end: meetingMetadata.meeting_end_at,
        duration_seconds: meetingMetadata.duration_seconds,
        attendees: meetingMetadata.attendees,
        notes_html: draftContent,
        transcript,
      };
      const text =
        format === 'json'
          ? JSON.stringify(payload, null, 2)
          : format === 'md'
          ? [
              `# ${title}`,
              '',
              meetingMetadata.scheduled_start_at
                ? `Scheduled: ${formatCompactDateTime(meetingMetadata.scheduled_start_at)}`
                : '',
              meetingMetadata.attendees?.length
                ? `Attendees: ${meetingMetadata.attendees.join(', ')}`
                : '',
              '',
              '## Notes',
              htmlToPlainText(draftContent),
              ...(transcript.length
                ? [
                    '',
                    '## Transcript',
                    ...transcript.map(
                      (row) => `**${row.speaker}** · ${row.timestamp}\n\n${row.text}`
                    ),
                  ]
                : []),
            ]
              .filter(Boolean)
              .join('\n')
          : [
              title,
              '',
              htmlToPlainText(draftContent),
              ...(transcript.length
                ? [
                    '',
                    'Transcript',
                    ...transcript.map((row) => `${row.timestamp} · ${row.speaker}: ${row.text}`),
                  ]
                : []),
            ]
              .filter(Boolean)
              .join('\n');
      const body =
        format === 'html'
          ? `<!doctype html><meta charset="utf-8"><title>${title}</title><article><h1>${title}</h1><p>${htmlToPlainText(
              draftContent
            ).replace(/\n/g, '<br>')}</p>${
              transcript.length
                ? `<h2>Transcript</h2>${transcript
                    .map(
                      (row) =>
                        `<p><strong>${row.speaker}</strong> · ${row.timestamp}<br>${row.text}</p>`
                    )
                    .join('')}`
                : ''
            }</article>`
          : text;
      const blob = new Blob([body], {
        type:
          format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/plain',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeMeetingExportName(title)}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    },
    [draftContent, draftTitle, meetingMetadata, selectedNote, transcriptSegments]
  );

  const deleteRetainedAudio = useCallback(
    async (source?: 'user_microphone' | 'system_audio') => {
      const sessionId = meetingAudioSessionId;
      if (!sessionId || !window.meetingAudio?.deleteAudio) return;
      const label =
        source === 'user_microphone'
          ? 'microphone audio'
          : source === 'system_audio'
          ? 'system audio'
          : 'all retained audio';
      if (!window.confirm(`Delete ${label}? The transcript will be preserved.`)) return;
      try {
        await window.meetingAudio.deleteAudio({ sessionId, source });
        setAudioCaptureStatus((current) =>
          current
            ? {
                ...current,
                sources: source ? current.sources.filter((item) => item.source !== source) : [],
                chunkCount: source ? current.chunkCount : 0,
              }
            : current
        );
        const inspection = (await window.meetingAudio.inspect(sessionId)) as RecordingRecovery;
        if (
          inspection.noteId === selectedNoteIdRef.current &&
          inspection.workspaceId === activeWorkspaceId
        ) {
          setAudioSessionInspection(inspection);
        }
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : 'Could not delete retained audio.');
      }
    },
    [activeWorkspaceId, meetingAudioSessionId]
  );

  const playRetainedAudio = useCallback(
    async (source: 'user_microphone' | 'system_audio') => {
      const sessionId = meetingAudioSessionId;
      if (!sessionId || !window.meetingAudio?.play) return;
      try {
        await window.meetingAudio.play({ sessionId, source });
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : 'Could not open retained audio.');
      }
    },
    [meetingAudioSessionId]
  );

  const revealRetainedAudio = useCallback(async () => {
    if (!meetingAudioSessionId || !window.meetingAudio?.reveal) return;
    try {
      await window.meetingAudio.reveal({ sessionId: meetingAudioSessionId });
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : 'Could not reveal the recording folder.'
      );
    }
  }, [meetingAudioSessionId]);

  const stopAndDiscardRecordingForNote = useCallback(async (noteId: string) => {
    if (!window.meetingAudio) return;
    const status = (await window.meetingAudio.status()) as MeetingAudioStatus;
    if (status.noteId !== noteId || !['recording', 'paused'].includes(status.state)) return;
    const stopped = (await window.meetingAudio.stop()) as MeetingAudioStatus;
    if (stopped.sessionId) await window.meetingAudio.discardRecovery(stopped.sessionId);
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
        await stopAndDiscardRecordingForNote(note.id);
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
  }, [
    api,
    clearSidebarSelection,
    closeNoteContextMenu,
    notes,
    selectedNoteIds,
    stopAndDiscardRecordingForNote,
    syncDraftFromNote,
  ]);

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await api.getTemplates();
      const templates = Array.isArray(data) ? (data as NotesHomeTemplate[]) : [];
      setWorkspaceTemplates(
        activeWorkspace?.is_personal
          ? templates.filter((template) => !isTeamOrientedTemplate(template))
          : templates
      );
    } catch (e) {
      console.error('Failed to load templates:', e);
      setWorkspaceTemplates([]);
    }
  }, [activeWorkspace?.is_personal, api]);

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

  const useTemplateFromHome = useCallback(
    async (templateId: string) => {
      try {
        const note = await api.createNoteFromTemplate(templateId);
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
        if (!bulkSidebarSelectionRef.current) {
          setSelectedNoteIds([note.id]);
          selectionAnchorNoteIdRef.current = note.id;
        }
        syncDraftFromNote(note as NoteRow);
        setTimeout(() => titleRef.current?.focus(), 0);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not create note from template.');
      }
    },
    [api, syncDraftFromNote]
  );

  const toggleNotePin = useCallback(
    async (noteId: string) => {
      try {
        await toggleObjectPin({ objectType: 'note', objectId: noteId });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update pin.');
      }
    },
    [toggleObjectPin]
  );

  const toggleTemplatePin = useCallback(
    async (template: NotesHomeTemplate) => {
      try {
        await api.pinTemplate(template.id, !template.pinned);
        await refreshTemplates();
        try {
          window.dispatchEvent(new CustomEvent('templates:updated'));
        } catch (e) {}
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update template pin.');
      }
    },
    [api, refreshTemplates]
  );

  const duplicateTemplateFromHome = useCallback(
    async (template: NotesHomeTemplate) => {
      try {
        await api.duplicateTemplate(
          template.id,
          template.is_system ? { visibility: 'mine' } : undefined
        );
        await refreshTemplates();
        try {
          window.dispatchEvent(new CustomEvent('templates:updated'));
        } catch (e) {}
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not duplicate template.');
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

        throw new Error('Template is not available in this workspace');
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
        if (!hasLoadedOnceRef.current) {
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
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Could not load notes.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
      }
    },
    [api, activeWorkspaceId, initialFocusNoteId, syncDraftFromNote, user]
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
    async (
      override?: { title?: string; content?: string; date?: string; mood?: string },
      expectedNoteId?: string | null
    ) => {
      const saveNoteId = expectedNoteId ?? selectedNoteId;
      if (!saveNoteId) return null;
      if (selectedNoteIdRef.current !== saveNoteId || hydrationNoteIdRef.current !== saveNoteId) {
        return null;
      }

      const saveIsStillCurrent = () =>
        selectedNoteIdRef.current === saveNoteId && hydrationNoteIdRef.current === saveNoteId;

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
        if (!saveIsStillCurrent()) return null;
        // safety: create a checkpoint if update would be destructive
        try {
          const existing = notes.find((n) => n.id === saveNoteId);
          if (existing) {
            const oldPlain = htmlToPlainText(
              (existing as any).content_html ?? existing.content ?? ''
            );
            const newPlain = htmlToPlainText(noteContent);
            const oldLen = String(oldPlain).replace(/\s/g, '').length;
            const newLen = String(newPlain).replace(/\s/g, '').length;
            if (oldLen > 50 && newLen < Math.max(5, Math.floor(oldLen * 0.25))) {
              try {
                await api.createNoteVersion(saveNoteId, {
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
          const last = lastAutosaveCheckpointRef.current.get(saveNoteId) ?? 0;
          const TEN_MIN = 10 * 60 * 1000;
          if (!last || now - last >= TEN_MIN) {
            try {
              await api.createNoteVersion(saveNoteId, { reason: 'autosave_checkpoint' });
              lastAutosaveCheckpointRef.current.set(saveNoteId, now);
            } catch (e) {
              console.error('[notes] failed to create autosave checkpoint', e);
            }
          }
        } catch (e) {
          console.error('[notes] autosave checkpoint check failed', e);
        }

        if (!saveIsStillCurrent()) return null;
        const data = await api.updateNote(saveNoteId, {
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
        if (selectedNoteIdRef.current !== saveNoteId || hydrationNoteIdRef.current !== saveNoteId) {
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

  const acceptMeetingRecap = useCallback(async () => {
    if (!selectedNote || !meetingRecapDraft) return;
    const escapeHtml = (value: string) =>
      value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
    const renderInsight = (item: MeetingInsight) => {
      const action = item as MeetingActionSuggestion;
      const prefix = action.ownerText ? `${action.ownerText} — ` : '';
      const due = action.dueDateText ? ` · ${action.dueDateText}` : '';
      return `<li>${escapeHtml(`${prefix}${item.text}${due}`)}</li>`;
    };
    // On regeneration, keep only the actual user-authored content after the
    // final Your notes heading. Using the final marker also repairs notes that
    // were duplicated by the earlier recap replacement bug.
    const humanNotesMarkers = Array.from(
      draftContent.matchAll(/(?:<hr[^>]*>\s*)?<h[1-3][^>]*>\s*Your notes\s*<\/h[1-3]>/gi),
    );
    const existingHumanNotesMarker = humanNotesMarkers.at(-1);
    const existingHumanNotes = existingHumanNotesMarker
      ? draftContent.slice((existingHumanNotesMarker.index ?? 0) + existingHumanNotesMarker[0].length)
      : draftContent;
    const recapHtml = [
      '<h2>Recap</h2>',
      `<p>${escapeHtml(meetingRecapDraft.overview)}</p>`,
      meetingRecapDraft.decisions.length
        ? `<h2>Decisions</h2><ul>${meetingRecapDraft.decisions.map((item) => renderInsight(item)).join('')}</ul>`
        : '',
      meetingRecapDraft.actions.length
        ? `<h2>Next actions</h2><ul>${meetingRecapDraft.actions.map((item) => renderInsight(item)).join('')}</ul>`
        : '',
      meetingRecapDraft.openThreads.length
        ? `<h2>Open threads</h2><ul>${meetingRecapDraft.openThreads.map((item) => renderInsight(item)).join('')}</ul>`
        : '',
      '<h2>Your notes</h2>',
      normalizeEditorHtml(existingHumanNotes) || '<p></p>',
    ].join('');
    // Remove the temporary preview before replacing the editor content so
    // acceptance never renders the draft and the imported recap together.
    setMeetingRecapDraft(null);
    setMeetingRecapStatus('idle');
    setMeetingRecapHasRun(true);
    setMeetingRecapTemplateChanged(false);
    setDraftContent(recapHtml);
    draftContentRef.current = recapHtml;
    // The Lexical editor loads HTML by editorKey. Refresh it immediately so
    // accepted recap content appears without requiring a note reload; the
    // autosave below remains the canonical persistence path.
    setEditorRefreshTick((current) => current + 1);
    setIsDirty(true);
    isDirtyRef.current = true;
    // Confirm the visible Lexical update immediately; persistence and citation
    // linking can finish after the user has already returned to the note.
    toast.show('Recap added to your note.', { variant: 'success' });
    const saved = await flushAutosave({ content: recapHtml });
    if (!saved) {
      toast.show('The recap is visible, but could not be saved yet.', { variant: 'error' });
      return;
    }
    if (activeWorkspaceId) {
      meetingRecapDraftCache.invalidate(
        meetingRecapCacheKey(activeWorkspaceId, selectedNote.id)
      );
    }
    const linkGroups: Array<{ kind: 'meeting_note' | 'decision' | 'action_item' | 'key_point'; items: MeetingInsight[] }> = [
      { kind: 'meeting_note', items: [{ text: meetingRecapDraft.overview, sourceRefs: meetingRecapDraft.decisions.flatMap((item) => item.sourceRefs).slice(0, 4) }] },
      { kind: 'decision', items: meetingRecapDraft.decisions },
      { kind: 'action_item', items: meetingRecapDraft.actions },
      { kind: 'key_point', items: meetingRecapDraft.openThreads },
    ];
    const segmentById = new Map(transcriptSegments.map((segment) => [segment.id, segment]));
    try {
      await Promise.all(
        linkGroups.flatMap(({ kind, items }) => items.flatMap((item) => item.sourceRefs.map(async (ref) => {
          const segment = segmentById.get(ref.transcriptSegmentId);
          if (!segment) return;
          await api.createMeetingTranscriptLink(selectedNote.id, segment.id, {
            link_type: kind,
            quoted_text: segment.transcript_text,
            timestamp_ms: ref.timestampMs,
            speaker_label: segment.speaker_label,
            audio_source: segment.audio_source,
          });
        })))
      );
      const links = await api.getMeetingTranscriptLinks(selectedNote.id);
      setTranscriptLinks(Array.isArray(links) ? (links as MeetingTranscriptLink[]) : []);
    } catch (error) {
      toast.show('Recap saved, but some transcript references could not be attached.', { variant: 'error' });
    }
  }, [
    activeWorkspaceId,
    api,
    draftContent,
    flushAutosave,
    meetingRecapDraft,
    selectedNote,
    toast,
    transcriptSegments,
  ]);

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

  const startMeetingNotes = useCallback(
    async (sectionId: string | null = noteCreationSectionId) => {
      if (!user || isCreating) return;
      if (isDirty) {
        const saved = await flushAutosave();
        if (!saved) return;
      }

      setIsCreating(true);
      setError(null);
      try {
        const title = `Meeting — ${new Date().toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}`;
        const created = (await api.createNote(title, '', {
          content_html:
            '<h2>Agenda</h2><p></p><h2>Notes</h2><p></p><h2>Decisions</h2><p></p><h2>Action Items</h2><ul><li>[ ] </li></ul>',
          date: todayKey(),
          source: 'meeting',
          mode: 'meeting_note',
          section_id: sectionId,
          meeting_metadata: (() => {
            try {
              return {
                microphone_enabled: true,
                system_audio_enabled: true,
                audio_retention:
                  localStorage.getItem('ledger.meeting.default-retention') === 'retain'
                    ? ('retain' as const)
                    : ('delete_after_transcription' as const),
              };
            } catch {
              return { microphone_enabled: true, system_audio_enabled: true };
            }
          })(),
        })) as NoteRow;
        setNotes((prev) => [created, ...prev]);
        setNoteTree((prev) => [{ ...created, depth: created.depth ?? 0, children: [] }, ...prev]);
        setSelectedNoteId(created.id);
        setSelectedNoteIds([created.id]);
        selectionAnchorNoteIdRef.current = created.id;
        syncDraftFromNote(created);
        setTimeout(() => titleRef.current?.focus(), 0);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not start meeting notes.');
      } finally {
        setIsCreating(false);
      }
    },
    [api, flushAutosave, isCreating, isDirty, noteCreationSectionId, syncDraftFromNote, user]
  );

  const goToNotesHome = useCallback(async () => {
    const currentNoteId = selectedNoteIdRef.current;
    if (currentNoteId && isDirtyRef.current) {
      const saved = await flushAutosave(undefined, currentNoteId);
      if (!saved) return;
    }

    setShowVersionHistoryModal(false);
    setIsNoteActionsOpen(false);
    setIsInspectorActionsOpen(false);
    clearSidebarSelection();
  }, [clearSidebarSelection, flushAutosave]);

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
    if (draftMode === 'mind_map') return;

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
      if (
        selectedNoteId === note.id &&
        selectedNoteIdRef.current === note.id &&
        hydrationNoteIdRef.current === note.id
      ) {
        return;
      }
      const navigationRequest = ++noteNavigationRequestRef.current;
      const currentNoteId = selectedNoteIdRef.current;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (isDirtyRef.current && currentNoteId) {
        const saved = await flushAutosave(undefined, currentNoteId);
        if (navigationRequest !== noteNavigationRequestRef.current) return;
        if (!saved) return;
      }
      if (navigationRequest !== noteNavigationRequestRef.current) return;
      let noteToOpen = note;
      // The notes list is intentionally summary-only and some callers can
      // provide a legacy row with plain-text `content`. Custom Lexical nodes
      // (including callouts) only survive in `content_html`, so opening a row
      // without that canonical field must always hydrate by id first.
      if (typeof note.content_html !== 'string') {
        setIsHydratingNote(true);
        setHasHydratedNote(false);
        try {
          noteToOpen = (await api.getNoteById(note.id)) as NoteRow;
          if (navigationRequest !== noteNavigationRequestRef.current) return;
          setNotes((prev) => prev.map((row) => (row.id === noteToOpen.id ? noteToOpen : row)));
        } catch (error) {
          setIsHydratingNote(false);
          setError(error instanceof Error ? error.message : 'Could not load note.');
          return;
        }
      }
      setSelectedNoteId(note.id);
      if (!bulkSidebarSelectionRef.current) {
        setSelectedNoteIds([note.id]);
        selectionAnchorNoteIdRef.current = note.id;
      }
      syncDraftFromNote(noteToOpen);
      recordNoteOpened(note.id);
      if (!window.desktopWindow && activeWorkspaceId) {
        const notePath = `/app/w/${encodeURIComponent(activeWorkspaceId)}/notes/${encodeURIComponent(note.id)}`;
        if (window.location.pathname !== notePath) {
          platform.navigation.openRoute({
            kind: 'workspace',
            workspaceId: activeWorkspaceId,
            page: 'note',
            noteId: note.id,
            query: initialView ? { view: initialView } : undefined,
          });
        }
      }
    },
    [
      flushAutosave,
      isDirty,
      recordNoteOpened,
      selectedNoteId,
      api,
      selectedNoteIds.length,
      syncDraftFromNote,
      activeWorkspaceId,
      initialView,
      platform.navigation,
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
      const navigationRequest = ++noteNavigationRequestRef.current;
      const currentNoteId = selectedNoteIdRef.current;
      if (isDirtyRef.current && currentNoteId) {
        const saved = await flushAutosave(undefined, currentNoteId);
        if (navigationRequest !== noteNavigationRequestRef.current) return;
        if (!saved) return;
      }
      if (navigationRequest !== noteNavigationRequestRef.current) return;

      setIsHydratingNote(true);
      setHasHydratedNote(false);
      setHasUserEdited(false);
      hydrationNoteIdRef.current = noteId;

      try {
        const fetched = (await api.getNoteById(noteId)) as NoteRow;
        if (navigationRequest !== noteNavigationRequestRef.current) return;
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
      applySidebarSelection(note.id, { shiftKey, activate: shiftKey });
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

  const moveNoteToSection = useCallback(
    async (noteId: string, sectionId: string | null) => {
      const targetSortOrder = notes.reduce((max, note) => {
        const sameSection = (note.section_id ?? null) === (sectionId ?? null);
        if (!sameSection || note.parent_id) return max;
        return Math.max(max, toNonNegativeInt(note.sort_order));
      }, -1);
      await moveNote(noteId, {
        parent_id: null,
        section_id: sectionId,
        sort_order: targetSortOrder + 1,
      });
    },
    [moveNote, notes]
  );

  const moveSectionToParent = useCallback(
    async (sectionId: string, parentSectionId: string | null) => {
      try {
        await api.updateSection(sectionId, { parent_id: parentSectionId });
        await loadSections();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not move folder.');
      }
    },
    [api, loadSections]
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
    const deletedNoteId = selectedNote.id;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await stopAndDiscardRecordingForNote(selectedNote.id);
      await api.deleteNote(selectedNote.id);
      window.dispatchEvent(
        new CustomEvent('ledger:workspace-route-replaced', {
          detail: {
            from: { kind: 'notes', focusNoteId: deletedNoteId },
            to: { kind: 'notes', focusContext: 'home' },
          },
        })
      );
      // Deleting the open note returns to Notes Home. Do not select an
      // arbitrary sibling: its hydration can race with the deleted note's
      // in-flight effects and briefly render "Note not found".
      selectedNoteIdRef.current = null;
      hydrationNoteIdRef.current = null;
      setSelectedNoteId(null);
      setSelectedNoteIds([]);
      selectionAnchorNoteIdRef.current = null;
      setDraftTitle('');
      setDraftContent('');
      setDraftDate(todayKey());
      setDraftMood('');
      isDirtyRef.current = false;
      setIsDirty(false);
      setHasHydratedNote(false);
      setHasUserEdited(false);
      setIsHydratingNote(false);
      setNotes((prev) => prev.filter((note) => note.id !== selectedNote.id));
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
  }, [api, selectedNote, stopAndDiscardRecordingForNote]);

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
        await stopAndDiscardRecordingForNote(noteId);
        await api.deleteNote(noteId);
        const deletedOpenNote = selectedNoteIdRef.current === noteId;
        if (deletedOpenNote) {
          window.dispatchEvent(
            new CustomEvent('ledger:workspace-route-replaced', {
              detail: {
                from: { kind: 'notes', focusNoteId: noteId },
                to: { kind: 'notes', focusContext: 'home' },
              },
            })
          );
          selectedNoteIdRef.current = null;
          hydrationNoteIdRef.current = null;
          setSelectedNoteId(null);
          setSelectedNoteIds([]);
          selectionAnchorNoteIdRef.current = null;
          setDraftTitle('');
          setDraftContent('');
          setDraftDate(todayKey());
          setDraftMood('');
          isDirtyRef.current = false;
          setIsDirty(false);
          setHasHydratedNote(false);
          setHasUserEdited(false);
          setIsHydratingNote(false);
        }
        setNotes((prev) => prev.filter((note) => note.id !== noteId));
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
    [api, notes, stopAndDiscardRecordingForNote]
  );

  useEffect(() => {
    void loadNotes();
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
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

  useEffect(() => {
    let cancelled = false;
    if (!activeWorkspaceId) {
      setUpcomingMeetings([]);
      return () => {
        cancelled = true;
      };
    }
    void api
      .getUpcomingEvents({ scope: 'current_workspace' })
      .then((rows) => {
        if (!cancelled)
          setUpcomingMeetings(
            Array.isArray(rows) ? (rows.slice(0, 5) as NotesHomeUpcomingMeeting[]) : []
          );
      })
      .catch(() => {
        if (!cancelled) setUpcomingMeetings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);

  const createMeetingNoteFromUpcoming = useCallback(
    async (event: NotesHomeUpcomingMeeting) => {
      try {
        let retention: 'delete_after_transcription' | 'retain' = 'delete_after_transcription';
        try {
          if (localStorage.getItem('ledger.meeting.default-retention') === 'retain')
            retention = 'retain';
        } catch {}
        const result = (await api.createMeetingNoteFromCalendar({
          event_id: event.id,
          audio_retention: retention,
        })) as { note?: NoteRow; existing?: boolean };
        if (result.note) {
          if (result.existing)
            setError('This event already has Meeting Notes. Opening the existing note.');
          await openNote(result.note);
          setUpcomingMeetings((current) =>
            current.map((item) =>
              item.id === event.id
                ? { ...item, note_id: result.note!.id, note_title: result.note!.title }
                : item
            )
          );
        }
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Could not create meeting notes from this event.'
        );
      }
    },
    [api, openNote]
  );

  const openUpcomingCalendarEvent = useCallback((event: NotesHomeUpcomingMeeting) => {
    if (event.note_id) {
      if (activeWorkspaceId) platform.navigation.openRoute(routeForNote(activeWorkspaceId, event.note_id));
    } else if (activeWorkspaceId) {
      platform.navigation.openRoute(routeForCalendarEvent(activeWorkspaceId, event.id));
    }
  }, [activeWorkspaceId, platform]);

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

  const focusNoteHandlersRef = useRef({ openNote, openNoteById, goToNotesHome });
  focusNoteHandlersRef.current = { openNote, openNoteById, goToNotesHome };

  useEffect(() => {
    const focusNoteListener = (
      _event: unknown,
      payload: { kind?: string; focusNoteId?: string | null; focusContext?: string | null }
    ) => {
      if (payload?.kind !== 'notes') return;
      if (!payload.focusNoteId) {
        void focusNoteHandlersRef.current.goToNotesHome();
        return;
      }
      const localNavigation = localNoteNavigationRef.current;
      if (
        localNavigation &&
        Date.now() - localNavigation.at < 1500 &&
        localNavigation.noteId !== payload.focusNoteId
      ) {
        // A late route broadcast for the previously open meeting must not
        // undo a user's click on another note.
        return;
      }
      const target = notesRef.current.find((note) => note.id === payload.focusNoteId);
      if (target) {
        void focusNoteHandlersRef.current.openNote(target);
        return;
      }
      void focusNoteHandlersRef.current.openNoteById(payload.focusNoteId);
    };

    window.ledgerIpc?.events?.onModuleFocusNote(focusNoteListener);

    return () => {
      window.ledgerIpc?.events?.offModuleFocusNote(focusNoteListener);
    };
  }, []);

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
    if (!notesEmptySpaceMenu) return;
    const closeMenu = () => setNotesEmptySpaceMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [notesEmptySpaceMenu]);

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

  const transcriptPanel = (
    <MeetingTranscriptErrorBoundary>
      <MeetingTranscriptSection
        metadata={meetingMetadata}
        segments={resolvedTranscriptSegments}
        drafts={transcriptDrafts}
        speakerDrafts={transcriptSpeakerDrafts}
        isLoading={isLoadingTranscript}
        onDraftChange={(segmentId, value) => {
          transcriptDraftsRef.current = {
            ...transcriptDraftsRef.current,
            [segmentId]: value,
          };
          setTranscriptDrafts((current) => ({ ...current, [segmentId]: value }));
        }}
        onCommit={(segment) => void commitTranscriptSegment(segment)}
        onSpeakerChange={(segment, speakerLabel) =>
          setTranscriptSpeakerDrafts((current) => ({
            ...current,
            [segment.id]: speakerLabel,
          }))
        }
        onSpeakerSelect={(segment, speakerLabel) =>
          void commitTranscriptSegment(segment, speakerLabel)
        }
        onDelete={(segment) => void deleteTranscriptSegment(segment)}
        onMerge={(segment, next, speakerLabel) =>
          void mergeTranscriptSegments(segment, next, speakerLabel)
        }
        onSplit={(segment, position) => void splitTranscriptSegment(segment, position)}
        isMutationBusy={Boolean(transcriptMutation || meetingBusyAction)}
        deletedSegments={deletedTranscriptSegments}
        onRestore={(segment) => void restoreTranscriptSegment(segment)}
        onCreateLedgerItem={createTranscriptLedgerItem}
        onAddMeetingReference={addTranscriptMeetingReference}
        transcriptLinks={transcriptLinks}
      />
    </MeetingTranscriptErrorBoundary>
  );

  return (
    <div
      className="ledger-notes-shell relative flex h-screen flex-col overflow-hidden rounded-[var(--ledger-window-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none"
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
              webDestination="inbox"
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={12} />}
              count={notificationCount}
              notificationTrayToggle
              onClick={() =>
                window.dispatchEvent(new CustomEvent('ledger:toggle-notification-tray'))
              }
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
      <RecordingRecoveryNotice
        recoveries={recordingRecoveries}
        activeWorkspaceId={activeWorkspaceId}
        isBusy={recordingRecoveryBusy}
        onRecover={(session) => void recoverRecording(session)}
        onDiscard={(session) => void discardRecording(session)}
        onReveal={(session) => void revealRecovery(session)}
      />
      <div
        className="relative flex-1 flex overflow-hidden"
        data-reduce-motion={reduceMotion ? 'true' : 'false'}
      >
        {!isLeftPaneCollapsed && hasLoadedOnce ? (
          <>
            <aside
              className={`ledger-pane-surface ledger-pane-left flex shrink-0 flex-col overflow-hidden border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] ${
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
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:opacity-60"
                      title="Notes actions"
                    >
                      <MoreHorizontal size={13} />
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
                            void startMeetingNotes(noteCreationSectionId);
                          }}
                          className="w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                        >
                          Start meeting notes
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
                className={`ledger-pane-scrollbar flex-1 overflow-y-auto overflow-x-hidden ${
                  isCompactLayout ? 'p-2' : 'p-3'
                } space-y-0`}
                onClick={(event) => {
                  // Only the unused tree surface opens this quick-create menu.
                  // Note/folder rows and their controls handle their own clicks.
                  if (event.target !== event.currentTarget) return;
                  setNotesEmptySpaceMenu({ x: event.clientX, y: event.clientY });
                }}
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
                              ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                              : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <NoteTypeIcon mode={note.mode} source={note.source} size={12} />
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
                                            ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
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
                                            <NoteTypeIcon
                                              mode={note.mode}
                                              source={note.source}
                                              size={12}
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
                                                    ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                                    : 'bg-transparent hover:bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-secondary)]'
                                                } ${getDropPreviewClasses(dropPreview, child.id)}`}
                                              >
                                                <div className="flex items-center gap-2 min-w-0">
                                                  <NoteTypeIcon
                                                    mode={note.mode}
                                                    source={note.source}
                                                    size={11}
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
                      <div className="flex items-center gap-3 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2.5">
                        <StickyNote
                          size={15}
                          className="shrink-0 text-[var(--ledger-text-muted)]"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[var(--ledger-text-primary)]">
                            No notes yet
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--ledger-text-muted)]">
                            Create a note or drop one into a folder to start organizing.
                          </p>
                        </div>
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
                                            ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                            : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                        } ${getDropPreviewClasses(dropPreview, note.id)}`}
                                      >
                                        {childCount > 0 ? (
                                          <Folder
                                            size={13}
                                            className="shrink-0 text-[var(--ledger-text-muted)]"
                                          />
                                        ) : (
                                          <NoteTypeIcon
                                            mode={note.mode}
                                            source={note.source}
                                            size={13}
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
                                            htmlToPlainText(child.content ?? '').slice(0, 50) ||
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
                                                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                                  : 'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                              } ${getDropPreviewClasses(dropPreview, child.id)}`}
                                            >
                                              <NoteTypeIcon
                                                mode={child.mode}
                                                source={child.source}
                                                size={12}
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
          <div className="ledger-pane-toggle absolute left-2 top-4 z-30">
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
          className="flex-1 min-w-0 min-h-0"
        >
          <div className="flex h-full flex-col overflow-hidden bg-[var(--ledger-surface)]">
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
              <div className="notes-document-canvas relative flex flex-1 flex-col min-h-0">
                <div className="bg-[var(--ledger-surface)] px-6 pb-2 pt-6 sm:px-10 sm:pt-8">
                  <div className="mx-auto max-w-[800px]">
                    <div className="flex items-center justify-between gap-4">
                      <p className="flex h-7 min-w-0 items-center truncate text-[11px] leading-none text-[var(--ledger-text-muted)]">
                        <button
                          type="button"
                          onClick={() => void goToNotesHome()}
                          className={`transition hover:text-[var(--ledger-text-primary)] ${
                            selectedNote
                              ? 'text-[var(--ledger-text-secondary)]'
                              : 'text-[var(--ledger-text-primary)]'
                          }`}
                        >
                          Home
                        </button>
                        {selectedBreadcrumb.length > 0 && (
                          <>
                            <span className="mx-1 text-[var(--ledger-text-muted)]">›</span>
                            <span>{selectedBreadcrumb.map((crumb) => crumb.title).join(' › ')}</span>
                          </>
                        )}
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="flex h-7 items-center text-[11px] leading-none text-[var(--ledger-text-muted)]">
                          {saveStatus}
                        </span>
                        <div className="ml-1 flex items-center" aria-label="Note view">
                        <button
                          type="button"
                          onClick={() => {
                            if (isMeetingNote) setMeetingCenterView('write');
                            if (isMeetingNote) setIsLiveTranscriptOpen(false);
                            if (draftMode === 'mind_map') {
                              setDraftMode('text');
                              isDirtyRef.current = true;
                              setIsDirty(true);
                            }
                          }}
                          className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                            (!isMeetingNote || meetingCenterView === 'write') &&
                            draftMode !== 'mind_map'
                              ? 'bg-[var(--ledger-surface-selected)] text-[var(--ledger-text-primary)]'
                              : 'text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                          }`}
                          aria-label="Write"
                          aria-pressed={
                            (!isMeetingNote || meetingCenterView === 'write') &&
                            draftMode !== 'mind_map'
                          }
                          title="Write"
                        >
                          <PenLine size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (isMeetingNote) setMeetingCenterView('write');
                            if (isMeetingNote) setIsLiveTranscriptOpen(false);
                            setDraftMode('mind_map');
                            isDirtyRef.current = true;
                            setIsDirty(true);
                          }}
                          className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                            draftMode === 'mind_map'
                              ? 'bg-[var(--ledger-surface-selected)] text-[var(--ledger-text-primary)]'
                              : 'text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                          }`}
                          aria-label="Mind map"
                          aria-pressed={draftMode === 'mind_map'}
                          title="Mind map"
                        >
                          <Network size={13} />
                        </button>
                        {!isMeetingNote && (
                          <button
                            type="button"
                            onClick={() => void enableMeetingMode()}
                            disabled={Boolean(meetingBusyAction)}
                            title="Enable meeting transcription for this note"
                            aria-label="Enable meeting transcription"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Mic size={13} />
                          </button>
                        )}
                        </div>
                        <div className="relative" ref={noteActionsMenuRef}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setIsNoteActionsOpen((current) => !current);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
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
                              disabled={draftMode === 'mind_map'}
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
                    <div className="mt-7">
                      <textarea
                        ref={titleRef}
                        rows={1}
                        value={draftTitle}
                        onChange={(e) => {
                          setDraftTitle(e.target.value);
                          isDirtyRef.current = true;
                          setIsDirty(true);
                        }}
                        onFocus={() => {
                          isEditingRef.current = true;
                        }}
                        onBlur={() => {
                          isEditingRef.current = false;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.preventDefault();
                        }}
                        placeholder="Untitled note"
                        className="block w-full resize-none overflow-hidden break-words bg-transparent py-1 text-[clamp(2rem,5vw,2.5rem)] font-bold leading-[1.14] tracking-[-0.035em] text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-text-muted)] outline-none [field-sizing:content]"
                      />
                    </div>
                    {isMeetingNote && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ledger-text-muted)]" data-meeting-metadata>
                        {meetingDateLabel(meetingMetadata?.scheduled_start_at) && <span>{meetingDateLabel(meetingMetadata?.scheduled_start_at)}</span>}
                        {meetingDateLabel(meetingMetadata?.scheduled_start_at) && meetingAttendeeLabel(meetingMetadata?.attendees) && <span aria-hidden="true">·</span>}
                        {meetingAttendeeLabel(meetingMetadata?.attendees) && <span className="max-w-48 truncate">{meetingAttendeeLabel(meetingMetadata?.attendees)}</span>}
                        {meetingAttendeeLabel(meetingMetadata?.attendees) && selectedNoteProjectLinks[0]?.project_name && <span aria-hidden="true">·</span>}
                        {selectedNoteProjectLinks[0]?.project_name && <span className="max-w-52 truncate">{selectedNoteProjectLinks[0].project_name}</span>}
                        {(meetingDateLabel(meetingMetadata?.scheduled_start_at) || meetingAttendeeLabel(meetingMetadata?.attendees) || selectedNoteProjectLinks[0]?.project_name) && <span aria-hidden="true">·</span>}
                        <label className="inline-flex min-w-0 items-center text-[var(--ledger-text-secondary)] transition-colors hover:text-[var(--ledger-text-primary)]">
                          <select
                            value={meetingMetadata?.meeting_template ?? 'auto'}
                            onChange={(event) => void selectMeetingTemplate(event.target.value as NonNullable<MeetingNoteMetadata['meeting_template']>)}
                            disabled={isMeetingTemplateSaving}
                            className="max-w-36 cursor-pointer appearance-none bg-transparent pr-1 text-[11px] text-inherit outline-none disabled:cursor-wait disabled:opacity-50"
                            aria-label="Meeting template"
                          >
                            <option value="auto">Auto</option><option value="one_on_one">1:1</option><option value="team_sync">Team sync</option><option value="project_review">Project review</option><option value="customer_sales">Customer / sales</option><option value="interview">Interview</option><option value="custom">Custom…</option>
                          </select>
                          <ChevronDown size={10} aria-hidden="true" />
                        </label>
                        {meetingMetadata?.meeting_template === 'custom' && (
                          <div className="basis-full flex min-w-0 items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1">
                            <textarea
                              value={customMeetingTemplateInstructions}
                              onChange={(event) => setCustomMeetingTemplateInstructions(event.target.value.slice(0, 1000))}
                              onKeyDown={(event) => {
                                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveCustomMeetingTemplateInstructions();
                                }
                              }}
                              placeholder="What should this recap focus on?"
                              rows={1}
                              maxLength={1000}
                              disabled={isMeetingTemplateSaving}
                              aria-label="Custom meeting template instructions"
                              className="min-h-7 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-0.5 text-[11px] leading-5 text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] disabled:opacity-50"
                            />
                            {customMeetingTemplateInstructions.trim() !== (meetingMetadata.meeting_template_instructions ?? '').trim() && (
                              <button
                                type="button"
                                onClick={() => void saveCustomMeetingTemplateInstructions()}
                                disabled={isMeetingTemplateSaving}
                                className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--ledger-accent)] hover:bg-[color:var(--ledger-accent)]/10 disabled:opacity-50"
                              >
                                {isMeetingTemplateSaving ? 'Saving…' : 'Save'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {isMeetingNote && meetingCenterView === 'write' && (
                      <div
                        className="hidden"
                        data-meeting-recording-controls
                      >
                        <select
                          value={meetingMetadata?.meeting_template ?? 'auto'}
                          onChange={(event) => void selectMeetingTemplate(event.target.value as NonNullable<MeetingNoteMetadata['meeting_template']>)}
                          disabled={meetingMetadata?.transcription_status !== 'idle'}
                          className="max-w-28 rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-1.5 py-1 text-[10px] text-[var(--ledger-text-secondary)] disabled:opacity-50"
                          aria-label="Meeting template"
                        >
                          <option value="auto">Auto</option><option value="one_on_one">1:1</option><option value="team_sync">Team sync</option><option value="project_review">Project review</option><option value="customer_sales">Customer / sales</option><option value="interview">Interview</option><option value="custom">Custom…</option>
                        </select>
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${meetingStatusTone(
                            meetingMetadata?.transcription_status
                          )}`}
                        >
                          {meetingMetadata?.transcription_status === 'recording' ? (
                            <CircleDot size={12} />
                          ) : meetingMetadata?.transcription_status === 'processing' ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : meetingMetadata?.transcription_status === 'failed' ? (
                            <AlertCircle size={12} />
                          ) : (
                            <Mic size={12} />
                          )}
                          {isLoadingMeetingMetadata
                            ? 'Loading meeting…'
                            : meetingBusyAction === 'stop'
                            ? 'Stopping…'
                            : meetingStatusLabel(meetingMetadata?.transcription_status)}
                        </span>
                        <span className="text-[11px] tabular-nums text-[var(--ledger-text-muted)]">
                          {formatMeetingDuration(meetingElapsedSeconds)}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void startMeeting()}
                            disabled={
                              meetingMetadata?.transcription_status !== 'idle' ||
                              Boolean(meetingBusyAction)
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--ledger-accent)] text-white disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="Start recording"
                            title="Start recording"
                          >
                            <Play size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void pauseMeeting()}
                            disabled={
                              meetingMetadata?.transcription_status !== 'recording' ||
                              Boolean(meetingBusyAction)
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)] disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="Pause recording"
                            title="Pause recording"
                          >
                            <Pause size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void resumeMeeting()}
                            disabled={
                              meetingMetadata?.transcription_status !== 'paused' ||
                              Boolean(meetingBusyAction)
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)] disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="Resume recording"
                            title="Resume recording"
                          >
                            <Play size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void stopMeeting()}
                            disabled={
                              !['recording', 'paused'].includes(
                                meetingMetadata?.transcription_status ?? ''
                              ) || Boolean(meetingBusyAction)
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)] disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="Stop recording"
                            title="Stop recording"
                            aria-busy={meetingBusyAction === 'stop'}
                          >
                            <Square size={10} />
                          </button>
                        </div>
                        {audioError && (
                          <span className="max-w-[45%] truncate text-[10px] text-amber-700" role="status">
                            {audioError}
                          </span>
                        )}
                        {meetingRecapStatus === 'generating' && (
                          <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-[var(--ledger-text-muted)]" role="status">
                            <Loader2 size={11} className="animate-spin" /> {meetingRecapStage}
                          </span>
                        )}
                        {meetingRecapStatus === 'unavailable' && meetingRecapError && (
                          <span className="ml-1 max-w-[42%] truncate text-[10px] text-amber-700" role="status" title={meetingRecapError}>
                            {meetingRecapError}
                          </span>
                        )}
                      </div>
                    )}
                    {isMeetingNote && meetingCenterView === 'transcript' && (
                      <div className="hidden">
                      <div
                        className={`flex items-center gap-1.5 text-xs font-medium ${meetingStatusTone(
                          meetingMetadata?.transcription_status
                        )}`}
                      >
                        {meetingMetadata?.transcription_status === 'recording' ? (
                          <CircleDot size={13} />
                        ) : meetingMetadata?.transcription_status === 'processing' ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : meetingMetadata?.transcription_status === 'failed' ? (
                          <AlertCircle size={13} />
                        ) : (
                          <Mic size={13} />
                        )}
                        {isLoadingMeetingMetadata
                          ? 'Loading meeting…'
                          : meetingBusyAction === 'stop'
                          ? 'Stopping…'
                          : meetingStatusLabel(meetingMetadata?.transcription_status)}
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs tabular-nums text-[var(--ledger-text-secondary)]">
                        <Clock3 size={12} /> {formatMeetingDuration(meetingElapsedSeconds)}
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void startMeeting()}
                          disabled={
                            meetingMetadata?.transcription_status !== 'idle' ||
                            Boolean(meetingBusyAction)
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--ledger-accent)] text-white disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Start audio capture"
                          title="Start audio capture"
                        >
                          <Play size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void pauseMeeting()}
                          disabled={
                            meetingMetadata?.transcription_status !== 'recording' ||
                            Boolean(meetingBusyAction)
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Pause audio capture"
                          title="Pause audio capture"
                        >
                          <Pause size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void resumeMeeting()}
                          disabled={
                            meetingMetadata?.transcription_status !== 'paused' ||
                            Boolean(meetingBusyAction)
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Resume audio capture"
                          title="Resume audio capture"
                        >
                          <Play size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void stopMeeting()}
                          disabled={
                            !['recording', 'paused'].includes(
                              meetingMetadata?.transcription_status ?? ''
                            ) || Boolean(meetingBusyAction)
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Stop audio capture"
                          title="Stop audio capture and mark the meeting as processing"
                          aria-busy={meetingBusyAction === 'stop'}
                        >
                          <Square size={11} />
                        </button>
                      </div>
                      <div className="ml-auto flex items-center gap-3 text-[10px] text-[var(--ledger-text-muted)]">
                        <span
                          className="inline-flex items-center gap-1.5"
                          title="Microphone status"
                        >
                          <button
                            type="button"
                            onClick={() => void toggleMeetingSource('microphone_enabled')}
                            disabled={
                              meetingMetadata?.transcription_status !== 'idle' ||
                              Boolean(meetingBusyAction)
                            }
                            className="inline-flex items-center gap-1 rounded px-1 py-1 hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                            aria-pressed={meetingMetadata?.microphone_enabled === true}
                            title={
                              meetingMetadata?.microphone_enabled
                                ? 'Turn microphone off'
                                : 'Turn microphone on'
                            }
                          >
                            <Mic size={11} />{' '}
                            {meetingMetadata?.microphone_enabled ? 'Mic on' : 'Mic off'}
                          </button>
                          {meetingMetadata?.microphone_enabled &&
                            meetingMetadata.transcription_status === 'idle' &&
                            audioDevices.devices.length > 0 && (
                              <select
                                value={selectedMicrophoneId ?? ''}
                                onChange={(event) => {
                                  const value = event.target.value || null;
                                  setSelectedMicrophoneId(value);
                                  try {
                                    if (value)
                                      window.localStorage.setItem(
                                        'ledger.meeting.microphone-device',
                                        value
                                      );
                                    else
                                      window.localStorage.removeItem(
                                        'ledger.meeting.microphone-device'
                                      );
                                  } catch {}
                                  const device = audioDevices.devices.find(
                                    (item) => item.id === value
                                  );
                                  setAudioDeviceWarning(
                                    device?.isBluetooth && audioDevices.outputDevice?.isBluetooth
                                      ? 'Headphone audio quality may decrease when using this Bluetooth microphone.'
                                      : null
                                  );
                                }}
                                className="max-w-28 truncate rounded bg-transparent px-0.5 py-0.5 text-[10px] text-[var(--ledger-text-muted)] outline-none"
                                aria-label="Select microphone"
                                title={selectedMicrophone?.name || 'Select microphone'}
                              >
                                {audioDevices.devices.map((device) => (
                                  <option key={device.id} value={device.id}>
                                    {device.name}
                                    {device.isBluetooth ? ' · Bluetooth' : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                          <span
                            className="h-1.5 w-8 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]"
                            aria-label="Microphone level"
                          >
                            <span
                              className={`block h-full rounded-full transition-[width] ${
                                audioCaptureStatus?.sources.some(
                                  (item) => item.source === 'user_microphone' && item.active
                                )
                                  ? 'bg-emerald-500'
                                  : 'bg-[var(--ledger-text-muted)]'
                              }`}
                              style={{
                                width: `${Math.round((audioLevels.user_microphone || 0) * 100)}%`,
                              }}
                            />
                          </span>
                          {['recording', 'paused'].includes(meetingMetadata?.transcription_status ?? '') && (
                            <span className="text-[9px] text-[var(--ledger-text-muted)]">
                              {!audioCaptureStatus?.sources.some(
                                (item) => item.source === 'user_microphone' && item.active
                              )
                                ? 'Disconnected'
                                : (audioLevels.user_microphone || 0) > 0.01
                                ? 'Active'
                                : 'Listening'}
                            </span>
                          )}
                        </span>
                        <span
                          className="inline-flex items-center gap-1.5"
                          title="System audio status"
                        >
                          <button
                            type="button"
                            onClick={() => void toggleMeetingSource('system_audio_enabled')}
                            disabled={
                              meetingMetadata?.transcription_status !== 'idle' ||
                              Boolean(meetingBusyAction)
                            }
                            className="inline-flex items-center gap-1 rounded px-1 py-1 hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                            aria-pressed={meetingMetadata?.system_audio_enabled === true}
                            title={
                              meetingMetadata?.system_audio_enabled
                                ? 'Turn system audio off'
                                : 'Turn system audio on'
                            }
                          >
                            <Volume2 size={11} />{' '}
                            {meetingMetadata?.system_audio_enabled
                              ? 'System audio on'
                              : 'System audio off'}
                          </button>
                          <span
                            className="h-1.5 w-8 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]"
                            aria-label="System audio level"
                          >
                            <span
                              className={`block h-full rounded-full transition-[width] ${
                                audioCaptureStatus?.sources.some(
                                  (item) => item.source === 'system_audio' && item.active
                                )
                                  ? 'bg-emerald-500'
                                  : 'bg-[var(--ledger-text-muted)]'
                              }`}
                              style={{
                                width: `${Math.round((audioLevels.system_audio || 0) * 100)}%`,
                              }}
                            />
                          </span>
                          {['recording', 'paused'].includes(meetingMetadata?.transcription_status ?? '') && (
                            <span className="text-[9px] text-[var(--ledger-text-muted)]">
                              {!audioCaptureStatus?.sources.some(
                                (item) => item.source === 'system_audio' && item.active
                              )
                                ? 'Disconnected'
                                : (audioLevels.system_audio || 0) > 0.01
                                ? 'Active'
                                : 'Listening'}
                            </span>
                          )}
                        </span>
                      </div>
                      {meetingMetadata?.microphone_enabled &&
                        meetingMetadata.transcription_status === 'idle' &&
                        (bluetoothMicWarning || audioDeviceWarning) && (
                          <div
                            className="flex w-full items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800"
                            role="status"
                          >
                            <AlertCircle size={12} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              Headphone audio quality may decrease. Using this Bluetooth headset
                              microphone can switch playback into a lower-quality call mode.
                            </span>
                            {audioDevices.devices.some((device) => !device.isBluetooth) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const safer = audioDevices.devices.find(
                                    (device) => !device.isBluetooth
                                  );
                                  if (!safer) return;
                                  setSelectedMicrophoneId(safer.id);
                                  try {
                                    window.localStorage.setItem(
                                      'ledger.meeting.microphone-device',
                                      safer.id
                                    );
                                  } catch {}
                                  setAudioDeviceWarning(null);
                                }}
                                className="shrink-0 font-medium underline underline-offset-2"
                              >
                                Use Mac microphone
                              </button>
                            )}
                          </div>
                        )}
                      {audioError && (
                        <div
                          className="flex w-full items-start gap-1.5 text-[11px] text-amber-700"
                          role="status"
                        >
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                          <span>{audioError}</span>
                        </div>
                      )}
                      {['processing', 'failed'].includes(
                        meetingMetadata?.transcription_status ?? ''
                      ) &&
                        window.meetingTranscription &&
                        !transcriptionModel?.installed && (
                          <div
                            className="flex w-full items-center justify-between gap-3 rounded-md bg-[var(--ledger-surface-muted)] px-2.5 py-2 text-[11px] text-[var(--ledger-text-secondary)]"
                            role="status"
                          >
                            <span>
                              Install the local Whisper model to transcribe this recording.
                            </span>
                            <button
                              type="button"
                              onClick={() => void installTranscriptionModel()}
                              disabled={transcriptionBusy || transcriptionModel?.downloading}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 font-medium disabled:opacity-40"
                            >
                              <Download size={11} />{' '}
                              {transcriptionModel?.downloading ? 'Downloading…' : 'Install model'}
                            </button>
                          </div>
                        )}
                    </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto bg-[var(--ledger-surface)] px-6 pb-24 pt-0 sm:px-10 sm:pb-28">
                  <div className="mx-auto max-w-[800px] space-y-6">
                    {draftMode !== 'mind_map' ? (
                      <>
                      {isMeetingNote && meetingMetadata?.transcription_status === 'idle' && (meetingPrepStatus === 'generating' || Boolean(meetingPrep?.points?.length)) && (
                        <section className="rounded-lg border-b border-[color:var(--ledger-border-subtle)] pb-4" data-meeting-prep>
                          <div className="flex items-center justify-between gap-3">
                            <h2 className="text-[11px] font-semibold text-[var(--ledger-text-primary)]">Prep</h2>
                            {meetingPrep?.points?.length ? <button type="button" onClick={() => openMeetingAskInRightPane('What should I remember before this meeting?')} className="text-[10px] font-medium text-[var(--ledger-accent)]">Ask Ledger →</button> : null}
                          </div>
                          {meetingPrepStatus === 'generating' ? <p className="mt-2 text-sm text-[var(--ledger-text-muted)]">Preparing for this meeting…</p> : <ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--ledger-text-secondary)]">{meetingPrep?.points.map((point) => <li key={point}>• {point}</li>)}</ul>}
                        </section>
                      )}
                      <RichTextEditor
                        editorKey={`${selectedNote.id}:${editorRefreshTick}`}
                        noteId={selectedNote.id}
                        targetType={isMeetingNote ? 'meetingNote' : 'note'}
                        noteTitle={selectedNote.title}
                        noteProjectId={selectedNoteProjectLinks[0]?.project_id ?? null}
                        initialValue={draftContent}
                        onAutoCorrect={() => {
                          void runAutoCorrectSpelling();
                        }}
                        onCreateTask={({ plainText, smartDates }) =>
                          openEditorOverviewComposer('task', plainText, {
                            suggestedDate:
                              smartDates?.find((item) => item.state !== 'dismissed')?.date ?? null,
                          })
                        }
                        onPersonTaskAction={(action, person) =>
                          openSmartPersonTaskComposer(action, person)
                        }
                        onCreateReminder={({ plainText, smartDates }) =>
                          openEditorOverviewComposer('reminder', plainText, {
                            suggestedDate:
                              smartDates?.find((item) => item.state !== 'dismissed')?.date ?? null,
                          })
                        }
                        onCreateEvent={({ plainText, smartDates }) =>
                          openEditorOverviewComposer('event', plainText, {
                            suggestedDate:
                              smartDates?.find((item) => item.state !== 'dismissed')?.date ?? null,
                          })
                        }
                        onSendToIntake={sendEditorSelectionToIntake}
                        onLinkProject={({ noteId }) => {
                          void openLinkProjectModal(noteId);
                        }}
                        onLinkPerson={linkEditorSelectionToPerson}
                        onSearch={({ plainText }) => openSearch(plainText)}
                        onCreateExternalEmbed={createEditorExternalEmbed}
                        linkedExternalReference={linkedExternalReference}
                        onLinkedExternalReferenceInserted={() => setLinkedExternalReference(null)}
                        linkedResourceBadge={linkedResourceBadge}
                        onLinkedResourceBadgeInserted={() => setLinkedResourceBadge(null)}
                        onOpenLinkedResources={() => {
                          if (!selectedNote?.id) return;
                          setIsRightPaneCollapsed(false);
                          setLinkedContextOpenRequest((current) => current + 1);
                        }}
                        onUploadAttachment={uploadEditorAttachment}
                        onRemoveAttachment={removeEditorAttachment}
                        beforeContent={
                          isMeetingNote && meetingRecapStatus === 'ready' && meetingRecapDraft ? (
                            <MeetingRecapDraftSection
                              draft={meetingRecapDraft}
                              onCitation={focusTranscriptSegment}
                              identitySuggestions={meetingIdentitySuggestions}
                              onConfirmIdentity={(suggestion) => void confirmMeetingIdentity(suggestion)}
                              onCreateAction={(action) => openMeetingActionComposer('task', action)}
                              onCreateReminder={(action) => openMeetingActionComposer('reminder', action)}
                              onCreateEvent={(action) => openMeetingActionComposer('event', action)}
                              onLinkProject={() => void openLinkProjectModal(selectedNoteId)}
                              showWorkActions={false}
                            />
                          ) : null
                        }
                        showToolbar
                        onChange={(nextHtml) => {
                          // The old Lexical editor can emit a final change while
                          // it is unmounting (image nodes are especially prone
                          // to this). Never let that stale editor write into the
                          // newly selected note's draft.
                          if (
                            selectedNoteIdRef.current !== selectedNote.id ||
                            hydrationNoteIdRef.current !== selectedNote.id
                          ) {
                            return;
                          }
                          const normalizedNext = normalizeEditorHtml(nextHtml);
                          const normalizedCurrent = normalizeEditorHtml(draftContent);
                          if (normalizedNext === normalizedCurrent) return;
                          setDraftContent(normalizedNext);
                          isDirtyRef.current = true;
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
                          if (hydrationNoteIdRef.current !== selectedNote.id || isHydratingNote)
                            return;
                          void flushAutosave();
                        }}
                      />
                      </>
                    ) : (
                      <div
                        className="mt-4 h-[calc(100vh-330px)] min-h-[420px] w-full"
                        data-mindmap-id={selectedNote?.id}
                      >
                        <MindMapEditor
                          structure={draftMindMapStructure}
                          onToast={(message) => toast.show(message, { variant: 'success' })}
                          onChange={(structure) => {
                            setDraftMindMapStructure(structure);
                            isDirtyRef.current = true;
                            setIsDirty(true);
                          }}
                          isFullscreen={isMindMapFullscreen}
                          onToggleFullscreen={() => setIsMindMapFullscreen((current) => !current)}
                        />
                      </div>
                    )}
                    {isMeetingNote && transcriptError && (
                      <p className="text-xs text-[var(--ledger-danger)]">{transcriptError}</p>
                    )}
                  </div>
                </div>
                {isMeetingNote &&
                  hasHydratedNote &&
                  !isHydratingNote &&
                  meetingMetadata && (
                  <div className="ledger-meeting-dock pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 sm:bottom-5" data-meeting-floating-controls>
                    <div className="pointer-events-auto relative flex w-full max-w-[760px] flex-col items-stretch justify-center gap-2">
                      {isLiveTranscriptOpen && (
                        <div
                          ref={transcriptDrawerScrollRef}
                          onScroll={(event) => {
                            const node = event.currentTarget;
                            transcriptDrawerShouldFollowRef.current =
                              node.scrollHeight - node.scrollTop - node.clientHeight < 24;
                          }}
                          className="ledger-meeting-live-transcript pointer-events-auto absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 h-[min(52vh,640px)] min-h-0 overflow-y-auto rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]/95 p-3 shadow-[var(--ledger-shadow)] backdrop-blur-sm"
                          data-meeting-transcript-drawer
                          role="dialog"
                          aria-label="Transcript"
                        >
                          {transcriptPanel}
                        </div>
                      )}
                      <div className="ledger-meeting-dock-row flex w-full min-w-0 items-end justify-center gap-2">
                      <div className="relative flex shrink-0 items-center gap-2">
                        {isMeetingComplete ? (
                          meetingRecapStatus === 'generating' ? (
                            <div
                              className="flex h-12 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-[11px] text-[var(--ledger-text-secondary)] shadow-sm"
                              role="status"
                              aria-label="Enhancing meeting"
                              data-meeting-recap-processing
                            >
                              <Loader2 size={12} className="animate-spin text-[var(--ledger-text-muted)]" />
                              {meetingRecapStage || 'Enhancing…'}
                            </div>
                          ) : meetingRecapStatus === 'ready' && meetingRecapDraft ? (
                            <MeetingRecapReviewBar
                              tier={meetingRecapTier}
                              onRegenerate={() => void enhanceMeetingNote()}
                              onAccept={() => void acceptMeetingRecap()}
                              isBusy={false}
                            />
                          ) :
                          (hasAcceptedMeetingRecap || meetingRecapHasRun) && !meetingRecapTemplateChanged ? null : (
                          <div className="flex h-12 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 shadow-sm">
                            <button
                              type="button"
                              onClick={() => {
                                if ((hasAcceptedMeetingRecap || meetingRecapHasRun) && !meetingRecapTemplateChanged) {
                                  setIsLiveTranscriptOpen(true);
                                } else {
                                  void enhanceMeetingNote();
                                }
                              }}
                              disabled={transcriptSegments.length === 0}
                              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-wait disabled:opacity-45"
                              aria-label={
                                (hasAcceptedMeetingRecap || meetingRecapHasRun) && !meetingRecapTemplateChanged
                                  ? 'Open transcript'
                                  : meetingRecapTemplateChanged
                                  ? 'Regenerate recap'
                                  : 'Enhance meeting'
                              }
                            >
                              {(hasAcceptedMeetingRecap || meetingRecapHasRun) && !meetingRecapTemplateChanged ? (
                                <FileText size={12} />
                              ) : (
                                <Zap size={12} />
                              )}
                              {(hasAcceptedMeetingRecap || meetingRecapHasRun) && !meetingRecapTemplateChanged
                                ? 'Transcript'
                                : meetingRecapTemplateChanged
                                ? 'Regenerate'
                                : 'Enhance'}
                            </button>
                          </div>
                          )
                        ) : meetingMetadata?.transcription_status === 'processing' ? (
                          <div className="flex h-12 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-[11px] text-[var(--ledger-text-secondary)] shadow-sm" role="status">
                            <Loader2 size={12} className="animate-spin text-[var(--ledger-text-muted)]" />
                            Processing…
                          </div>
                        ) : (
                          <>
                        {isMeetingRecorderExpanded && (
                          <div className="absolute bottom-[calc(100%+8px)] left-0 w-64 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-3 shadow-sm">
                            <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] pb-2.5"><div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ledger-surface-hover)] ${meetingStatusTone(meetingMetadata?.transcription_status)}`}><CircleDot size={12} /></span><span className={`text-[11px] font-semibold ${meetingStatusTone(meetingMetadata?.transcription_status)}`}>{meetingStatusLabel(meetingMetadata?.transcription_status)}</span></div><span className="text-[11px] tabular-nums text-[var(--ledger-text-muted)]">{formatMeetingDuration(meetingElapsedSeconds)}</span></div>
                            <div className="mt-2 space-y-1">
                              <button type="button" onClick={() => void toggleMeetingSource('microphone_enabled')} disabled={meetingMetadata?.transcription_status !== 'idle'} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"><span className="flex items-center gap-2"><Mic size={13} />Microphone</span><span className="text-[10px] text-[var(--ledger-text-muted)]">{meetingMetadata?.microphone_enabled ? 'On' : 'Off'}</span></button>
                              <button type="button" onClick={() => void toggleMeetingSource('system_audio_enabled')} disabled={meetingMetadata?.transcription_status !== 'idle'} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"><span className="flex items-center gap-2"><Volume2 size={13} />System audio</span><span className="text-[10px] text-[var(--ledger-text-muted)]">{meetingMetadata?.system_audio_enabled ? 'On' : 'Off'}</span></button>
                              {meetingMetadata?.transcription_status === 'recording' ? <button type="button" onClick={() => void pauseMeeting()} disabled={Boolean(meetingBusyAction)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"><span className="flex items-center gap-2"><Pause size={13} />Pause recording</span><span className="text-[10px] text-[var(--ledger-text-muted)]">{formatMeetingDuration(meetingElapsedSeconds)}</span></button> : <button type="button" onClick={() => void resumeMeeting()} disabled={meetingMetadata?.transcription_status !== 'paused' || Boolean(meetingBusyAction)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"><Play size={13} />Resume recording</button>}
                            </div>
                            {(audioError || meetingMetadata?.transcription_status === 'failed') && <p className="mt-2 text-[10px] text-amber-600" role="status">{audioError || meetingMetadata?.transcription_error || 'Recording needs attention.'}</p>}
                          </div>
                        )}
                        <div className="flex h-12 items-center gap-1 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 shadow-sm">
                          <button type="button" onClick={() => setIsMeetingRecorderExpanded((current) => !current)} className="flex h-9 min-w-16 items-center justify-center gap-1.5 rounded-full px-2 text-[var(--ledger-text-secondary)] transition-colors hover:bg-[color:var(--ledger-accent)]/10 hover:text-[var(--ledger-text-primary)]" aria-label="Recording controls" aria-expanded={isMeetingRecorderExpanded}><span className="flex h-3 items-end gap-0.5" aria-hidden="true"><span className={`ledger-meeting-waveform-bar w-1 rounded-full bg-[var(--ledger-accent)] ${meetingMetadata?.transcription_status === 'recording' ? 'ledger-meeting-waveform-bar-active h-2' : 'h-1'}`} /><span className={`ledger-meeting-waveform-bar w-1 rounded-full bg-[var(--ledger-accent)] ${meetingMetadata?.transcription_status === 'recording' ? 'ledger-meeting-waveform-bar-active h-3' : 'h-2'}`} /><span className={`ledger-meeting-waveform-bar w-1 rounded-full bg-[var(--ledger-accent)] ${meetingMetadata?.transcription_status === 'recording' ? 'ledger-meeting-waveform-bar-active h-1.5' : 'h-1'}`} /></span><span className="text-[10px] tabular-nums">{meetingMetadata?.transcription_status === 'idle' ? 'Start' : formatMeetingDuration(meetingElapsedSeconds)}</span><ChevronDown size={12} className={`transition-transform duration-200 ${isMeetingRecorderExpanded ? 'rotate-180' : ''}`} /></button>
                          <button type="button" onClick={() => void (['recording', 'paused'].includes(meetingMetadata?.transcription_status ?? '') ? stopMeeting() : startMeeting())} disabled={Boolean(meetingBusyAction) || ['processing', 'complete', 'failed'].includes(meetingMetadata?.transcription_status ?? '')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" aria-label={['recording', 'paused'].includes(meetingMetadata?.transcription_status ?? '') ? 'Stop recording' : 'Start recording'}>{['recording', 'paused'].includes(meetingMetadata?.transcription_status ?? '') ? <Square size={11} /> : <Play size={11} />}</button>
                          <button
                            type="button"
                            onClick={() => setIsLiveTranscriptOpen((current) => !current)}
                            disabled={!liveTranscriptAvailable}
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ledger-text-muted)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-35 ${isLiveTranscriptOpen ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]' : ''}`}
                            aria-label={isLiveTranscriptOpen ? 'Close live transcript' : 'Open live transcript'}
                            aria-pressed={isLiveTranscriptOpen}
                            title={liveTranscriptAvailable ? 'Live transcript' : 'Transcript unavailable'}
                          >
                            <span className="flex h-3 items-end gap-0.5" aria-hidden="true">
                              <span className={`ledger-meeting-waveform-bar w-0.5 rounded-full bg-current h-1.5 ${isMeetingTranscriptionActive ? 'ledger-meeting-waveform-bar-active' : ''}`} />
                              <span className={`ledger-meeting-waveform-bar w-0.5 rounded-full bg-current h-3 ${isMeetingTranscriptionActive ? 'ledger-meeting-waveform-bar-active' : ''}`} />
                              <span className={`ledger-meeting-waveform-bar w-0.5 rounded-full bg-current h-2 ${isMeetingTranscriptionActive ? 'ledger-meeting-waveform-bar-active' : ''}`} />
                              <span className={`ledger-meeting-waveform-bar w-0.5 rounded-full bg-current h-1 ${isMeetingTranscriptionActive ? 'ledger-meeting-waveform-bar-active' : ''}`} />
                            </span>
                          </button>
                        </div>
                          </>
                        )}
                        {isMeetingComplete && (
                          <button
                            type="button"
                            onClick={() => setIsLiveTranscriptOpen((current) => !current)}
                            disabled={!liveTranscriptAvailable}
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-muted)] shadow-sm transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-35 ${isLiveTranscriptOpen ? 'text-[var(--ledger-text-primary)]' : ''}`}
                            aria-label={isLiveTranscriptOpen ? 'Close transcript' : 'Open transcript'}
                            aria-pressed={isLiveTranscriptOpen}
                            title={isLiveTranscriptOpen ? 'Close transcript' : 'Open transcript'}
                          >
                            <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
                              <span className="h-2 w-0.5 rounded-full bg-current" />
                              <span className="h-4 w-0.5 rounded-full bg-current" />
                              <span className="h-3 w-0.5 rounded-full bg-current" />
                              <span className="h-1.5 w-0.5 rounded-full bg-current" />
                            </span>
                          </button>
                        )}
                      </div>
                      <form className="ledger-meeting-ask-form flex min-w-0 flex-1 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 pl-4 shadow-sm" onSubmit={(event) => { event.preventDefault(); openMeetingAskInRightPane(meetingAskDraft.trim() || meetingAskSuggestion); setMeetingAskDraft(''); }}>
                        <input value={meetingAskDraft} onChange={(event) => setMeetingAskDraft(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]" placeholder="Ask about this meeting…" aria-label="Ask about this meeting" />
                        <button type="button" onClick={() => setMeetingAskDraft(meetingAskSuggestion)} className="hidden max-w-[45%] shrink-0 overflow-hidden rounded-full bg-[var(--ledger-surface-hover)] px-3 py-2 text-[11px] text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] sm:block"><span key={meetingAskSuggestion} className="ledger-meeting-suggestion block truncate">{meetingAskSuggestion}</span></button>
                        <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-accent)] text-white shadow-sm transition-colors hover:brightness-110" aria-label="Ask Ledger"><ChevronRight size={15} /></button>
                      </form>
                      </div>
                    </div>
                  </div>
                )}
                {!isMeetingNote &&
                  draftMode !== 'mind_map' &&
                  hasHydratedNote &&
                  !isHydratingNote && (
                  <div className="ledger-meeting-dock pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 sm:bottom-5" data-note-ask-dock>
                    <form
                      className="ledger-meeting-ask-form pointer-events-auto flex w-full max-w-[760px] min-w-0 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 pl-4 shadow-sm"
                      onSubmit={(event) => {
                        event.preventDefault();
                        openNoteAskInRightPane(meetingAskDraft.trim() || '');
                        setMeetingAskDraft('');
                      }}
                    >
                      <input
                        value={meetingAskDraft}
                        onChange={(event) => setMeetingAskDraft(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]"
                        placeholder="Ask about this note…"
                        aria-label="Ask about this note"
                      />
                      <button
                        type="submit"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-accent)] text-white shadow-sm transition-colors hover:brightness-110"
                        aria-label="Ask Ledger about this note"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <NotesHome
                notes={notes}
                sections={sections}
                templates={workspaceTemplates}
                pins={pins}
                workspaceId={activeWorkspaceId}
                userId={user?.id}
                currentSectionId={noteCreationSectionId}
                activeMeetingNoteId={null}
                activeMeetingStatus={null}
                upcomingMeetings={upcomingMeetings}
                onStartMeetingFromEvent={(event) => void createMeetingNoteFromUpcoming(event)}
                onOpenCalendarEvent={openUpcomingCalendarEvent}
                onOpenNote={(note) => {
                  void openNote(note as NoteRow);
                }}
                onAskLedger={openNotesHomeAsk}
                askLedgerOpen={rightPaneMode === 'ask' && !isRightPaneCollapsed}
                onNewNote={(sectionId) => {
                  setNoteCreationSectionId(sectionId ?? noteCreationSectionId);
                  setShowCreateNoteModal(true);
                }}
                onStartMeetingNotes={(sectionId) => {
                  void startMeetingNotes(sectionId ?? null);
                }}
                onBrowseTemplates={() => {
                  setCreateNoteModalTemplateId(null);
                  setCreateNoteModalInitialStep('gallery');
                  setShowCreateNoteModal(true);
                }}
                onOpenTemplate={(templateId) => {
                  setCreateNoteModalTemplateId(templateId);
                  setCreateNoteModalInitialStep('gallery');
                  setShowCreateNoteModal(true);
                }}
                onUseTemplate={(templateId) => {
                  void useTemplateFromHome(templateId);
                }}
                onViewAllRecent={() => {
                  setIsLeftPaneCollapsed(false);
                  setSearch('');
                }}
                onToggleNotePin={(noteId) => void toggleNotePin(noteId)}
                onMoveNoteToSection={(noteId, sectionId) =>
                  void moveNoteToSection(noteId, sectionId)
                }
                onRenameNote={(noteId) => beginInlineRename(noteId)}
                onCreateChildNote={(noteId) => void createChildNote(noteId)}
                onLinkNoteToProject={(noteId) => void openLinkProjectModal(noteId)}
                onMoveNoteToRoot={(noteId) => {
                  void api
                    .moveNoteParent(noteId, null)
                    .then(() => loadNotes({ silent: true }))
                    .catch(() => {});
                }}
                onDuplicateNote={(noteId) => void duplicateNoteById(noteId)}
                onSaveNoteAsTemplate={(noteId, name) => {
                  void handleSaveNoteAsTemplate(noteId, name ?? 'Untitled note');
                }}
                onDeleteNote={(noteId) => void deleteNoteById(noteId)}
                onRenameFolder={(sectionId) => beginInlineSectionRename(sectionId)}
                onCreateChildFolder={(sectionId) => {
                  void createSection('New folder', sectionId);
                }}
                onMoveFolder={(sectionId, parentSectionId) =>
                  void moveSectionToParent(sectionId, parentSectionId)
                }
                onDeleteFolder={(sectionId) => {
                  const target = sections.find((section) => section.id === sectionId);
                  if (!target) return;
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
                }}
                onToggleTemplatePin={(template) => void toggleTemplatePin(template)}
                onDuplicateTemplate={(template) => void duplicateTemplateFromHome(template)}
              />
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
              className={`ledger-pane-surface ledger-pane-right relative min-w-0 overflow-y-auto overflow-x-hidden border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] ${
                isCompactLayout ? 'p-3 space-y-3' : 'p-4 space-y-4'
              } shrink-0`}
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="min-w-0 space-y-5">
                <div className={`flex items-start justify-between gap-3 ${rightPaneMode === 'ask' ? 'border-b border-[color:var(--ledger-border-subtle)] pb-3' : 'pb-1'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-nowrap text-xs font-medium text-[var(--ledger-text-muted)]">{rightPaneMode === 'ask' ? 'Ask Ledger' : 'Inspector'}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[var(--ledger-text-primary)]">{rightPaneMode === 'ask' ? (meetingAskContext?.contextType === 'notes_home' ? 'Notes workspace' : 'Meeting chat') : selectedNote?.title || (selectedNote ? 'Untitled note' : 'Quick actions')}</p>
                    {rightPaneMode === 'ask' && selectedNote?.title && <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">{selectedNote.title}</p>}
                    {rightPaneMode !== 'ask' && <p className="mt-1 truncate text-xs text-[var(--ledger-text-muted)]">
                      {selectedNote
                        ? selectedBreadcrumb.length && selectedBreadcrumb[selectedBreadcrumb.length - 1]?.title !== selectedNote.title
                          ? selectedBreadcrumb.map((crumb) => crumb.title).join(' › ')
                          : 'Home'
                        : 'Quick actions and recent context'}
                    </p>}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {rightPaneMode === 'ask' && (
                      <button
                        type="button"
                        onClick={() => setRightPaneMode('inspector')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition-colors hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                        aria-label="Back to inspector"
                        title="Back to inspector"
                      >
                        <ChevronLeft size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsRightPaneCollapsed(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                      aria-label="Hide right panel"
                      title="Hide right panel"
                    >
                      <PanelRightClose size={14} />
                    </button>
                    {selectedNote && rightPaneMode !== 'ask' && (
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
                              disabled={draftMode === 'mind_map'}
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

                {rightPaneMode === 'ask' && (
                  <div className="notes-ask-ledger-pane absolute inset-x-0 bottom-0 top-[82px] z-10 overflow-hidden bg-[var(--ledger-surface-muted)] [&_.agent-ask-ledger-content]:gap-0 [&_.ask-ledger-composer]:min-h-[76px] [&_.ask-ledger-composer]:rounded-xl [&_.ask-ledger-composer]:px-3 [&_.ask-ledger-composer]:py-2 [&_textarea]:text-[13px] [&_textarea]:leading-5 [&_.ask-ledger-answer]:text-[13px]">
                    <AskLedgerPanel
                      workspaceId={activeWorkspaceId}
                      resetKey={askPaneResetKey}
                      initialContext={meetingAskContext}
                      preferredGenerationTier="fast"
                      compact
                      meetingChat={meetingAskContext?.contextType === 'meeting'}
                    />
                  </div>
                )}

                {selectedNote && activeWorkspaceId ? (
                  <LinkedDesignsSection
                    target={{
                      workspaceId: activeWorkspaceId,
                      targetType: /meeting/i.test(selectedNote.source ?? '')
                        ? 'meetingNote'
                        : 'note',
                      targetId: selectedNote.id,
                    }}
                    canEdit={activeWorkspace?.role !== 'viewer'}
                    canInsert
                    onInsert={(reference) => {
                      const item = {
                        resourceType: 'external',
                        resourceId: reference.id,
                        title: reference.title || reference.url,
                        url: reference.url,
                        provider: reference.provider,
                        externalType: reference.externalType,
                        metadata: reference.metadata,
                      } as const;
                      window.dispatchEvent(new CustomEvent('ledger:insert-linked-resource', { detail: item }));
                    }}
                    projects={linkableProjects}
                    isLoadingProjects={isLoadingLinkableProjects}
                    selectedProjectIds={selectedLinkProjectIds}
                    onToggleProject={toggleLinkProject}
                    onLinkProjects={async (projectIds) => {
                      await linkSelectedProjectsToNote(projectIds);
                      const project = linkableProjects.find((item) => item.id === projectIds[0]);
                      if (project) setLinkedResourceBadge({ resourceType: 'project', resourceId: project.id, title: project.name, url: `#project-${project.id}` });
                    }}
                    onLoadProjects={loadProjectsForLinkedContext}
                    openRequest={{ source: 'projects', token: linkedContextOpenRequest }}
                  />
                ) : null}

                {selectedNote && activeWorkspaceId ? (
                  <RelatedContextList
                    workspaceId={activeWorkspaceId}
                    resourceType="note"
                    resourceId={selectedNote.id}
                    title={isMeetingNote ? 'Meeting context' : 'Related context'}
                    emptyMessage={isMeetingNote ? 'No linked meeting context yet.' : 'No linked context yet.'}
                    maxItems={10}
                    className="border-t border-[color:var(--ledger-border-subtle)] pt-4"
                  />
                ) : null}

                {isMeetingNote && (
                  <div className="hidden min-w-0 space-y-3 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Meeting</p>
                      {meetingMetadata && (
                        <span className={`text-[11px] ${meetingStatusTone(meetingMetadata.transcription_status)}`}>
                          {meetingMetadata.transcription_status === 'idle'
                            ? 'Not started'
                            : meetingStatusLabel(meetingMetadata.transcription_status)}
                        </span>
                      )}
                    </div>
                    {isLoadingMeetingMetadata ? (
                      <p className="text-xs text-[var(--ledger-text-muted)]">Loading meeting details…</p>
                    ) : meetingMetadata ? (
                      <div className="space-y-2">
                        <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-[var(--ledger-text-primary)]">
                            {meetingMetadata.transcription_status === 'idle'
                              ? 'Not started'
                              : meetingStatusLabel(meetingMetadata.transcription_status)}
                          </span>
                          <span className="shrink-0 tabular-nums text-[var(--ledger-text-primary)]">
                            {formatMeetingDuration(meetingElapsedSeconds)}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
                          <span className="shrink-0 text-[var(--ledger-text-muted)]">Calendar event</span>
                          <span className="min-w-0 truncate text-right text-[var(--ledger-text-primary)]">
                            {meetingMetadata.calendar_event_id ? 'Linked' : 'No event linked'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-[var(--ledger-text-muted)]">Attendees</span>
                          <span className="truncate text-right text-[var(--ledger-text-primary)]">
                            {meetingMetadata.attendees?.length ? meetingMetadata.attendees.length : 'None'}
                          </span>
                        </div>
                        {meetingMetadata.transcription_status === 'idle' && (
                          <button type="button" onClick={() => void startMeeting()} disabled={Boolean(meetingBusyAction)} className="inline-flex max-w-full items-center rounded-md bg-[var(--ledger-accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                            Start transcription
                          </button>
                        )}
                        {meetingMetadata.transcription_status === 'recording' && (
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => void pauseMeeting()} disabled={Boolean(meetingBusyAction)} className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--ledger-text-secondary)] disabled:opacity-50">Pause</button>
                            <button type="button" onClick={() => void stopMeeting()} disabled={Boolean(meetingBusyAction)} className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--ledger-danger)] disabled:opacity-50">Stop</button>
                          </div>
                        )}
                        {meetingMetadata.transcription_status === 'paused' && (
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => void resumeMeeting()} disabled={Boolean(meetingBusyAction)} className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--ledger-text-secondary)] disabled:opacity-50">Resume</button>
                            <button type="button" onClick={() => void stopMeeting()} disabled={Boolean(meetingBusyAction)} className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--ledger-danger)] disabled:opacity-50">Stop</button>
                          </div>
                        )}
                        {meetingMetadata.transcription_status === 'processing' && <p className="text-xs text-[var(--ledger-text-muted)]">Transcribing…</p>}
                        {meetingMetadata.transcription_status === 'complete' && (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-[var(--ledger-text-muted)]">Transcript available</span>
                            <button type="button" onClick={() => void startMeeting()} disabled={Boolean(meetingBusyAction)} className="shrink-0 text-[var(--ledger-accent)] disabled:opacity-50">Resume</button>
                            {transcriptSegments.length > 0 && <button type="button" onClick={() => void clearMeetingTranscript()} disabled={Boolean(meetingBusyAction)} className="shrink-0 text-[var(--ledger-danger)] disabled:opacity-50">Clear transcript</button>}
                          </div>
                        )}
                        {meetingMetadata.transcription_error && <p className="text-xs text-[var(--ledger-danger)]">{meetingMetadata.transcription_error}</p>}
                      </div>
                    ) : null}
                  </div>
                )}

                {isMeetingNote && meetingMetadata && (Boolean(meetingMetadata.calendar_event_id) || Boolean(meetingMetadata.calendar_series_id) || Boolean(meetingMetadata.attendees?.length) || Boolean(selectedNoteProjectLinks[0]?.project_name)) && (
                  <div className="min-w-0 space-y-3 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Meeting details</p>
                      {meetingMetadata.calendar_series_id && <span className="text-[10px] text-[var(--ledger-text-muted)]">Recurring</span>}
                    </div>
                    <div className="space-y-2 text-xs">
                      {meetingMetadata.calendar_event_id && (
                        <button type="button" onClick={() => activeWorkspaceId && platform.navigation.openRoute(routeForCalendarEvent(activeWorkspaceId, meetingMetadata.calendar_event_id!))} className="flex w-full items-center justify-between gap-3 text-left hover:text-[var(--ledger-accent)]">
                          <span className="text-[var(--ledger-text-muted)]">Calendar event</span><span className="min-w-0 truncate text-right text-[var(--ledger-text-primary)]">{meetingMetadata.calendar_event_title || 'Linked event'}</span>
                        </button>
                      )}
                      {meetingMetadata.attendees?.length ? <div className="flex items-center justify-between gap-3"><span className="text-[var(--ledger-text-muted)]">Attendees</span><span className="text-[var(--ledger-text-primary)]">{meetingMetadata.attendees.length}</span></div> : null}
                      {selectedNoteProjectLinks[0]?.project_name && <div className="flex items-center justify-between gap-3"><span className="text-[var(--ledger-text-muted)]">Project</span><span className="min-w-0 truncate text-right text-[var(--ledger-text-primary)]">{selectedNoteProjectLinks[0].project_name}</span></div>}
                    </div>
                  </div>
                )}

                {meetingMetadata && isMeetingNote && (
                  <div className="hidden space-y-3 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Meeting</p>
                      {meetingMetadata && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] ${meetingStatusTone(
                            meetingMetadata.transcription_status
                          )}`}
                        >
                          {meetingMetadata.transcription_status === 'complete' && (
                            <CheckCircle2 size={11} />
                          )}
                          {meetingStatusLabel(meetingMetadata.transcription_status)}
                        </span>
                      )}
                    </div>
                    {isLoadingMeetingMetadata ? (
                      <div className="flex items-center gap-2 text-xs text-[var(--ledger-text-muted)]">
                        <Loader2 size={12} className="animate-spin" /> Loading meeting details…
                      </div>
                    ) : meetingMetadataError ? (
                      <div className="space-y-2 rounded-lg bg-[color:rgba(217,45,32,0.06)] px-2.5 py-2 text-xs text-[var(--ledger-danger)]">
                        <p>{meetingMetadataError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            const id = selectedNoteIdRef.current;
                            if (!id) return;
                            void api
                              .createMeetingMetadata(id)
                              .then((metadata) => {
                                setMeetingMetadata(metadata as MeetingNoteMetadata);
                                setMeetingMetadataError(null);
                              })
                              .catch((error) => {
                                setMeetingMetadataError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not initialize meeting details.'
                                );
                              });
                          }}
                          className="font-medium underline underline-offset-2"
                        >
                          Initialize meeting details
                        </button>
                      </div>
                    ) : meetingMetadata ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Duration</span>
                          <span className="tabular-nums text-[var(--ledger-text-primary)]">
                            {formatMeetingDuration(meetingElapsedSeconds)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Started</span>
                          <span className="text-right text-[var(--ledger-text-primary)]">
                            {meetingMetadata.meeting_start_at
                              ? formatCompactDateTime(meetingMetadata.meeting_start_at)
                              : 'Not started'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Ended</span>
                          <span className="text-right text-[var(--ledger-text-primary)]">
                            {meetingMetadata.meeting_end_at
                              ? formatCompactDateTime(meetingMetadata.meeting_end_at)
                              : 'In progress'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Calendar event</span>
                          {meetingMetadata.calendar_event_id ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (!activeWorkspaceId || !meetingMetadata.calendar_event_id) return;
                                platform.navigation.openRoute(
                                  routeForCalendarEvent(activeWorkspaceId, meetingMetadata.calendar_event_id)
                                );
                              }}
                              className="max-w-44 truncate text-right text-[var(--ledger-accent)] hover:underline"
                              title={
                                meetingMetadata.calendar_event_title ??
                                meetingMetadata.calendar_event_id
                              }
                            >
                              {meetingMetadata.calendar_event_title ||
                                `${meetingMetadata.calendar_event_id.slice(0, 8)}…`}
                            </button>
                          ) : (
                            <span className="text-[var(--ledger-text-primary)]">
                              {meetingMetadata.calendar_event_title || 'Not linked'}
                            </span>
                          )}
                        </div>
                        {(meetingMetadata.scheduled_start_at ||
                          meetingMetadata.scheduled_end_at ||
                          meetingMetadata.calendar_provider) && (
                          <>
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-[var(--ledger-text-muted)]">Scheduled</span>
                              <span className="text-right text-[var(--ledger-text-primary)]">
                                {meetingMetadata.scheduled_start_at
                                  ? formatCompactDateTime(meetingMetadata.scheduled_start_at)
                                  : 'Time not set'}
                                {meetingMetadata.scheduled_end_at
                                  ? ` – ${formatCompactDateTime(meetingMetadata.scheduled_end_at)}`
                                  : ''}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-[var(--ledger-text-muted)]">
                                Calendar source
                              </span>
                              <span className="text-[var(--ledger-text-primary)]">
                                {meetingMetadata.calendar_source_name ||
                                  meetingMetadata.calendar_provider ||
                                  'Ledger'}
                              </span>
                            </div>
                            {meetingMetadata.calendar_event_deleted && (
                              <div className="flex items-center gap-1.5 rounded-md bg-[color:rgba(217,45,32,0.06)] px-2 py-1.5 text-xs text-[var(--ledger-danger)]">
                                <AlertCircle size={12} /> The original calendar event is no longer
                                available. Meeting content is preserved.
                              </div>
                            )}
                          </>
                        )}
                        {meetingSeriesOccurrences.length > 1 && (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ledger-text-muted)]">
                              <CalendarDays size={12} /> Recurring meeting
                            </div>
                            <div className="space-y-0.5">
                              {meetingSeriesOccurrences.map((occurrence) => {
                                const occurrenceTitle =
                                  occurrence.note?.title ||
                                  occurrence.calendar_event_title ||
                                  'Meeting occurrence';
                                const isCurrent = occurrence.note_id === selectedNoteId;
                                return (
                                  <button
                                    key={occurrence.note_id}
                                    type="button"
                                    onClick={() =>
                                      occurrence.note && void openNote(occurrence.note as NoteRow)
                                    }
                                    disabled={!occurrence.note || isCurrent}
                                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                                      isCurrent
                                        ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                                        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                                    } disabled:cursor-default`}
                                  >
                                    <span className="min-w-0 truncate">{occurrenceTitle}</span>
                                    <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">
                                      {occurrence.scheduled_start_at
                                        ? formatCompactDateTime(occurrence.scheduled_start_at)
                                        : 'Unscheduled'}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Attendees</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {meetingMetadata.attendees?.length
                              ? meetingMetadata.attendees.length
                              : 'None added'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Microphone</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {meetingMetadata.microphone_enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">System audio</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {meetingMetadata.system_audio_enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Segments</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {transcriptSegments.length}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Audio chunks</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {audioCaptureStatus?.chunkCount ?? '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Capture queue</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {audioCaptureStatus?.queueDepth ?? 0}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Free storage</span>
                          <span className="text-[var(--ledger-text-primary)]">
                            {Number.isFinite(audioCaptureStatus?.diskAvailableBytes)
                              ? `${Math.round(
                                  audioCaptureStatus!.diskAvailableBytes / 1024 / 1024
                                )} MB`
                              : 'Unknown'}
                          </span>
                        </div>
                        {meetingAudioSessionId && (
                          <div className="rounded-md bg-[var(--ledger-surface-muted)] px-2.5 py-2 text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-[var(--ledger-text-secondary)]">
                                Audio
                              </span>
                              {audioSessionInspection?.status && (
                                <span className="text-[var(--ledger-text-muted)]">
                                  {audioSessionInspection.status === 'ready'
                                    ? 'Ready'
                                    : audioSessionInspection.status}
                                </span>
                              )}
                            </div>
                            {audioSourceSummaries.some((summary) => summary.chunkCount > 0) ? (
                              <div className="mt-1.5 space-y-1.5">
                                {audioSourceSummaries.map((summary) => (
                                  <div
                                    key={summary.source}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="min-w-0 truncate text-[var(--ledger-text-secondary)]">
                                      {summary.source === 'user_microphone'
                                        ? 'Microphone'
                                        : 'System audio'}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">
                                      {summary.chunkCount > 0
                                        ? `${formatMeetingDuration(summary.durationSeconds)} · ${
                                            summary.sizeBytes >= 1024 * 1024
                                              ? `${(summary.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                                              : `${Math.max(
                                                  1,
                                                  Math.round(summary.sizeBytes / 1024)
                                                )} KB`
                                          }`
                                        : 'Not recorded'}
                                    </span>
                                  </div>
                                ))}
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => void revealRetainedAudio()}
                                    disabled={
                                      meetingBusyAction === 'stop' ||
                                      audioCaptureStatus?.state === 'recording' ||
                                      audioCaptureStatus?.state === 'paused'
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[10px] text-[var(--ledger-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <FolderOpen size={11} /> Reveal in Finder
                                  </button>
                                  {meetingMetadata.audio_retention === 'retain' && (
                                    <>
                                      {audioSourceSummaries
                                        .filter((summary) => summary.chunkCount > 0)
                                        .map((summary) => (
                                          <span
                                            key={`actions-${summary.source}`}
                                            className="inline-flex gap-1"
                                          >
                                            <button
                                              type="button"
                                              onClick={() => void playRetainedAudio(summary.source)}
                                              className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[10px] text-[var(--ledger-text-secondary)]"
                                            >
                                              Play{' '}
                                              {summary.source === 'user_microphone'
                                                ? 'mic'
                                                : 'system'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void deleteRetainedAudio(summary.source)
                                              }
                                              className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[10px] text-[var(--ledger-danger)]"
                                            >
                                              Delete
                                            </button>
                                          </span>
                                        ))}
                                      <button
                                        type="button"
                                        onClick={() => void deleteRetainedAudio()}
                                        className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[10px] text-[var(--ledger-danger)]"
                                      >
                                        Delete all audio
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ) : meetingMetadata.transcription_status === 'complete' &&
                              meetingMetadata.audio_retention === 'delete_after_transcription' ? (
                              <p className="mt-1.5 text-[10px] text-[var(--ledger-text-muted)]">
                                Audio deleted after successful transcription.
                              </p>
                            ) : (
                              <p className="mt-1.5 text-[10px] text-[var(--ledger-text-muted)]">
                                Audio is not currently available.
                              </p>
                            )}
                          </div>
                        )}
                        <label className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--ledger-text-muted)]">Audio retention</span>
                          <select
                            value={meetingMetadata.audio_retention}
                            onChange={(event) =>
                              void updateMeetingMetadata({
                                audio_retention: event.target.value as
                                  | 'delete_after_transcription'
                                  | 'retain',
                              })
                            }
                            disabled={Boolean(meetingBusyAction)}
                            className="max-w-44 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 py-1 text-right text-xs text-[var(--ledger-text-primary)] outline-none"
                          >
                            <option value="delete_after_transcription">
                              Delete after transcription
                            </option>
                            <option value="retain">Retain</option>
                          </select>
                        </label>
                        {meetingMetadata.transcription_error && (
                          <div className="rounded-lg bg-[color:rgba(217,45,32,0.06)] px-2.5 py-2 text-xs text-[var(--ledger-danger)]">
                            {meetingMetadata.transcription_error}
                          </div>
                        )}
                        {meetingMetadata.transcription_status === 'processing' && (
                          <div className="space-y-2">
                            {transcriptionJob && (
                              <div className="space-y-1 text-[11px] text-[var(--ledger-text-muted)]">
                                <div className="flex items-center justify-between gap-2">
                                  <span>Local transcription</span>
                                  <span>
                                    {Math.round(transcriptionJob.progress * 100)}% ·{' '}
                                    {transcriptionJob.completedChunks}/
                                    {transcriptionJob.totalChunks} chunks
                                  </span>
                                </div>
                                <div className="h-1 overflow-hidden rounded-full bg-[var(--ledger-surface-hover)]">
                                  <div
                                    className="h-full rounded-full bg-[var(--ledger-accent)] transition-all"
                                    style={{
                                      width: `${Math.max(
                                        0,
                                        Math.min(100, transcriptionJob.progress * 100)
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {transcriptionJob?.status === 'transcribing' ||
                              transcriptionJob?.status === 'preparing' ? (
                                <button
                                  type="button"
                                  onClick={() => void cancelTranscription()}
                                  disabled={transcriptionBusy}
                                  className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-danger)] disabled:opacity-40"
                                >
                                  Cancel transcription
                                </button>
                              ) : null}
                              {transcriptionJob?.status === 'failed' ? (
                                <button
                                  type="button"
                                  onClick={() => void startTranscription()}
                                  disabled={transcriptionBusy || !transcriptionModel?.installed}
                                  className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] disabled:opacity-40"
                                >
                                  Retry transcription
                                </button>
                              ) : null}
                              {!transcriptionModel?.installed && (
                                <button
                                  type="button"
                                  onClick={() => void installTranscriptionModel()}
                                  disabled={transcriptionBusy || transcriptionModel?.downloading}
                                  className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] disabled:opacity-40"
                                >
                                  <Download size={11} /> Install Whisper model
                                </button>
                              )}
                            </div>
                            {transcriptionModel && (
                              <p>
                                {transcriptionModel.downloading
                                  ? `Downloading local model… ${Math.round(
                                      (transcriptionModel.bytesDownloaded /
                                        Math.max(1, transcriptionModel.approximateBytes)) *
                                        100
                                    )}% · ${formatDownloadTime(transcriptionModel.estimatedSecondsRemaining)}`
                                  : transcriptionModel.installed
                                  ? `${transcriptionModel.label} is installed and runs locally.`
                                  : 'Install the optional local Whisper model to process this recording. No API key is required.'}
                              </p>
                            )}
                          </div>
                        )}
                        {meetingMetadata.transcription_status === 'failed' && (
                          <div className="space-y-2">
                            {!transcriptionModel?.installed && (
                              <div className="rounded-md bg-[var(--ledger-surface-muted)] px-2.5 py-2 text-[11px] text-[var(--ledger-text-muted)]">
                                <p>
                                  Install the local Whisper model before retrying. The finalized
                                  audio is preserved.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void installTranscriptionModel()}
                                  disabled={transcriptionBusy || transcriptionModel?.downloading}
                                  className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] disabled:opacity-40"
                                >
                                  <Download size={11} />{' '}
                                  {transcriptionModel?.downloading
                                    ? 'Downloading model…'
                                    : 'Install Whisper model'}
                                </button>
                              </div>
                            )}
                            {transcriptionModel?.downloading && (
                              <p className="text-[11px] text-[var(--ledger-text-muted)]">
                                Downloading local model…{' '}
                                {Math.round(
                                  (transcriptionModel.bytesDownloaded /
                                    Math.max(1, transcriptionModel.approximateBytes)) *
                                    100
                                )}
                                % · {formatDownloadTime(transcriptionModel.estimatedSecondsRemaining)}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => void startTranscription()}
                                disabled={transcriptionBusy || !transcriptionModel?.installed}
                                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] disabled:opacity-40"
                              >
                                <RotateCcw size={11} /> Retry transcription
                              </button>
                              <button
                                type="button"
                                onClick={() => void resetFailedMeeting()}
                                disabled={Boolean(meetingBusyAction)}
                                className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-muted)] disabled:opacity-40"
                              >
                                Reset to idle
                              </button>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void clearMeetingTranscript()}
                          disabled={transcriptSegments.length === 0 || Boolean(meetingBusyAction)}
                          className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-[11px] text-[var(--ledger-danger)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 size={11} /> Clear transcript
                        </button>
                        <div className="border-t border-[color:var(--ledger-border-subtle)] pt-2">
                          <p className="mb-1 text-[10px] font-medium text-[var(--ledger-text-muted)]">
                            Export meeting note
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(['txt', 'md', 'json', 'html'] as const).map((format) => (
                              <button
                                key={format}
                                type="button"
                                onClick={() => exportMeetingNote(format)}
                                className="rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                              >
                                {format === 'txt'
                                  ? 'Plain text'
                                  : format === 'md'
                                  ? 'Markdown'
                                  : format === 'json'
                                  ? 'JSON'
                                  : 'Printable HTML'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

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
                    <div className="space-y-2">
                      <InspectorInfoRow label="Notes" value={String(notes.length)} />
                      <InspectorInfoRow
                        label="Updated this week"
                        value={String(
                          notes.filter(
                            (note) => Date.now() - new Date(note.updated_at).getTime() < 604800000
                          ).length
                        )}
                      />
                      <InspectorInfoRow
                        label="Pinned"
                        value={String(pins.filter((pin) => pin.object_type === 'note').length)}
                      />
                    </div>
                  )}
                </div>

                <div className={`space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4 ${selectedNote ? 'hidden' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                      {selectedNote ? 'Linked project' : 'Quick actions'}
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
                      <div className="px-1 py-1">
                        <p className="text-sm text-[var(--ledger-text-muted)]">No linked project</p>
                      </div>
                    )
                  ) : (
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setNoteCreationSectionId(null);
                          setCreateNoteModalInitialStep('main');
                          setShowCreateNoteModal(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        <Plus size={14} /> New note
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateNoteModalInitialStep('gallery');
                          setShowCreateNoteModal(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        <Zap size={14} /> From template
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Workspace</p>
                  {selectedNote ? (
                    <div className="space-y-2">
                      <div className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                        {activeWorkspace?.name?.trim() || 'Current workspace'}
                      </div>
                      {!activeWorkspace?.is_personal && (
                        <>
                          <InspectorInfoRow
                            label="Created by"
                            value={displayUserName(creatorMember)}
                          />
                          <InspectorInfoRow
                            label="Last edited by"
                            value={`${displayUserName(editorMember)} · ${formatRelativeFromNow(
                              selectedNote.updated_at
                            )}`}
                          />
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {activeWorkspace?.name?.trim() || 'Current workspace'}
                    </p>
                  )}
                </div>

                {false && <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4">
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
                </div>}
              </div>
            </aside>
          </>
        ) : (
          <div className="ledger-pane-toggle ledger-pane-toggle-right absolute right-2 top-4 z-30">
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
                onToast={(message) => toast.show(message, { variant: 'success' })}
                onChange={(structure) => {
                  setDraftMindMapStructure(structure);
                  isDirtyRef.current = true;
                  setIsDirty(true);
                }}
                isFullscreen
                onToggleFullscreen={exitMindMapFullscreen}
              />
            </div>
          </div>
        </div>
      )}

      {notesEmptySpaceMenu && (
        <div
          className="fixed z-210 min-w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
          style={{
            left: Math.max(8, Math.min(notesEmptySpaceMenu.x, window.innerWidth - 190)),
            top: Math.max(8, Math.min(notesEmptySpaceMenu.y, window.innerHeight - 110)),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          role="menu"
          aria-label="Create in Notes"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setNotesEmptySpaceMenu(null);
              setShowNewSectionPrompt(false);
              setNoteCreationSectionId(null);
              setShowCreateNoteModal(true);
            }}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <StickyNote size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <span>New note</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setNotesEmptySpaceMenu(null);
              setNewSectionName('');
              setShowNewSectionPrompt(true);
            }}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <Folder size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <span>New folder</span>
          </button>
        </div>
      )}

      {sectionContextMenu && (
        <div
          className="fixed z-210 min-w-40 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
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
              <div className="pointer-events-none absolute right-0 top-0 h-6 w-7 bg-linear-to-l from-[var(--ledger-surface-card)] to-transparent" />
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
                className="fixed z-210 min-w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
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
              className="fixed z-210 max-h-[calc(100vh-16px)] min-w-44 overflow-y-auto rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-0 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
              style={{
                left: Math.max(8, Math.min(noteContextMenu.x, window.innerWidth - 180)),
                top: Math.max(
                  8,
                  Math.min(noteContextMenu.y, window.innerHeight - NOTE_CONTEXT_MENU_HEIGHT)
                ),
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
                  const note = notes.find((item) => item.id === noteContextMenu.noteId);
                  if (note && activeWorkspaceId) openAskLedgerWithContext({ resourceType: 'note', resourceId: note.id, title: note.title || 'Untitled note' }, () => platform.navigation.openRoute(routeForHome(activeWorkspaceId)));
                  setNoteContextMenu(null);
                }}
                className="flex h-9 w-full items-center gap-3 rounded-none px-3 text-left text-sm transition hover:bg-[var(--ledger-surface-hover)]"
              >
                <Search size={14} className="shrink-0 text-[var(--ledger-text-secondary)]" />
                <span className="font-medium">Ask Ledger</span>
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
        initialStep={createNoteModalInitialStep}
        initialTemplateId={createNoteModalTemplateId}
        onClose={() => {
          setShowCreateNoteModal(false);
          setCreateNoteModalInitialStep('main');
          setCreateNoteModalTemplateId(null);
        }}
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

      <NotesSelectionComposerModal
        context={selectionComposerContext}
        members={workspaceMembers}
        onClose={() => setSelectionComposerContext(null)}
        onCreated={({ type, id }) => {
          const source = selectionComposerContext;
          if (!source?.transcriptSegmentId || !selectedNoteId) return;
          const segment = transcriptSegments.find((item) => item.id === source.transcriptSegmentId);
          if (!segment) return;
          void linkTranscriptToLedgerItem(segment, source.text, type, id);
        }}
      />
      {/* Legacy nested project picker replaced by the Projects source in AddLinkedContextModal.
      <ModalOverlay
        isOpen={false}
        onClose={() => {
          setIsLinkProjectModalOpen(false);
          setLinkProjectTargetNoteId(null);
        }}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
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
            className="h-9 w-full rounded-[var(--ledger-control-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
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
      </ModalOverlay> */}
      {isAudioSetupOpen && (
        <MeetingAudioSetup
          permissions={audioPermissions}
          devices={audioDevices.devices}
          selectedMicrophoneId={selectedMicrophoneId}
          outputDevice={audioDevices.outputDevice}
          onSelectMicrophone={(deviceId) => {
            setSelectedMicrophoneId(deviceId);
            try {
              window.localStorage.setItem('ledger.meeting.microphone-device', deviceId);
            } catch {}
            const device = audioDevices.devices.find((item) => item.id === deviceId);
            setAudioDeviceWarning(
              device?.isBluetooth && audioDevices.outputDevice?.isBluetooth
                ? 'Headphone audio quality may decrease.'
                : null
            );
          }}
          isBusy={isAudioBusy}
          testingSource={testingAudioSource}
          onRequestPermissions={() => void requestAudioPermissions()}
          onTestSource={(source) => void testAudioSource(source)}
          onStopTest={() => void stopAudioTest()}
          onOpenSettings={(area) => void openAudioSettings(area)}
          audioError={audioError}
          onClose={() => {
            if (testingAudioSource) void stopAudioTest();
            setIsAudioSetupOpen(false);
          }}
          isBrowser={platform.kind === 'web'}
          canCaptureMicrophone={platform.capabilities.canCaptureMicrophone}
        />
      )}
      {isTranscriptionSetupOpen && (
        <MeetingTranscriptionSetup
          model={transcriptionModel}
          isBusy={transcriptionBusy}
          onInstall={() => void installTranscriptionModel()}
          onClose={() => setIsTranscriptionSetupOpen(false)}
        />
      )}
    </div>
  );
};

export default NotesWindow;
