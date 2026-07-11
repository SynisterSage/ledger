import {
  Archive,
  Calendar,
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  FileText,
  Funnel,
  Globe,
  FolderKanban,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  PanelRight,
  RefreshCw,
  Search,
  Sparkles,
  FilePenLine,
  Clock3,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import {
  ModuleHeaderActionButton,
  ModuleHeaderSegmentedGroup,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { useToast } from '../Common/ToastProvider';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { createPortal } from 'react-dom';
import { sidebarTheme } from '../Sidebar/sidebarTheme';

type InboxStatus = 'unprocessed' | 'converted' | 'snoozed' | 'archived';
type ConversionType = 'task' | 'note' | 'reminder' | 'event' | 'project';

type InboxItem = {
  id: string;
  source: string;
  source_provider?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  title: string;
  body?: string | null;
  raw_payload?: Record<string, unknown> | null;
  updated_by?: string | null;
  status: InboxStatus;
  suggested_type?: string | null;
  suggested_project_id?: string | null;
  suggested_assignee_id?: string | null;
  suggested_calendar_id?: string | null;
  suggested_note_section_id?: string | null;
  suggested_date?: string | null;
  suggested_due_at?: string | null;
  converted_type?: string | null;
  converted_id?: string | null;
  converted_at?: string | null;
  converted_by?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  channel_name?: string | null;
  author_name?: string | null;
  source_label?: string | null;
  snoozed_until?: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectOption = {
  id: string;
  name?: string | null;
  title?: string | null;
};

type CalendarOption = {
  id: string;
  name?: string | null;
};

type NoteOption = {
  id: string;
  title?: string | null;
};

type NoteSectionOption = {
  id: string;
  name?: string | null;
};

const conversionTypes: Array<{
  value: ConversionType;
  label: string;
  icon: typeof CheckSquare;
}> = [
  { value: 'task', label: 'Task', icon: CheckSquare },
  { value: 'note', label: 'Note', icon: FileText },
  { value: 'reminder', label: 'Reminder', icon: Bell },
  { value: 'event', label: 'Event', icon: CalendarDays },
  { value: 'project', label: 'Project', icon: FolderKanban },
];

const statusLabels: Array<{ value: InboxStatus; label: string }> = [
  { value: 'unprocessed', label: 'Needs review' },
  { value: 'converted', label: 'Accepted' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'archived', label: 'Archived' },
];

const inboxTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-none',
  contentShell: 'bg-[var(--ledger-background)]',
  iconButton:
    'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  row:
    'group border-b border-[color:var(--ledger-border-subtle)] px-1 py-4 transition',
  panel:
    'overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] shadow-[0_12px_32px_rgba(17,24,39,0.12)]',
  sectionHeading: 'text-sm font-semibold text-[var(--ledger-text-primary)]',
  mutedText: 'text-[var(--ledger-text-muted)]',
  bodyText: 'text-[var(--ledger-text-secondary)]',
  field:
    'h-10 w-full rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]',
  fieldSoft:
    'h-10 w-full rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]',
  footer:
    'flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-5 py-4',
  inspectorLabel: 'text-[11px] font-semibold text-[var(--ledger-text-muted)]',
  select:
    'h-10 w-full appearance-none rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 pr-9 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getDomain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || url;
  }
};

const getSlackLinkLabels = (text?: string | null) => {
  if (!text) return [];
  const labels: string[] = [];
  const pattern = /<([^>|]+)(?:\|([^>]+))?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const url = match[1]?.trim() ?? '';
    const label = match[2]?.trim() || getDomain(url);
    if (label) labels.push(label);
  }
  return labels;
};

const cleanSlackText = (text?: string | null) => {
  if (!text) return '';
  return text
    .replace(/<([^>|]+)\|([^>]+)>/g, (_match, _url, label) => label)
    .replace(/<([^>|]+)>/g, (_match, url) => getDomain(String(url)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
};

const stripTrailingSlackLinkLabel = (cleanText: string, rawText?: string | null) => {
  const labels = getSlackLinkLabels(rawText);
  if (labels.length === 0) return cleanText;
  const last = labels[labels.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleanText
    .replace(new RegExp(`\\s*[·-]?\\s*${last}\\s*$`, 'i'), '')
    .trim() || cleanText;
};

const summarizeSlackText = (rawText?: string | null) => {
  const clean = cleanSlackText(rawText);
  const labels = getSlackLinkLabels(rawText);
  if (labels.length === 0) return clean;
  const base = stripTrailingSlackLinkLabel(clean, rawText);
  return `${base} · ${labels[labels.length - 1]}`;
};

const getDisplayTitle = (item: InboxItem) => {
  const raw = item.title || item.body || '';
  if (item.source === 'slack') {
    return stripTrailingSlackLinkLabel(cleanSlackText(raw), raw) || 'Slack message';
  }
  return cleanSlackText(raw) || 'Intake item';
};

const getDisplayPreview = (item: InboxItem) => {
  const raw = item.body || item.title || '';
  if (item.source === 'slack') return summarizeSlackText(raw);
  return cleanSlackText(raw) || getItemReason(item) || '';
};

const getStatusLabel = (status: InboxStatus) =>
  statusLabels.find((entry) => entry.value === status)?.label ?? status;

const getSourceLabel = (item: InboxItem) => {
  if (item.source === 'slack') return 'Slack';
  return item.source_label || item.source.replace(/_/g, ' ');
};

const getSourceContext = (item: InboxItem) => {
  if (item.source === 'slack' && item.channel_name) return `#${item.channel_name}`;
  return item.source_id || '';
};

const defaultReminderAt = (seedText?: string) => {
  const parsed = parseLooseTime(seedText);
  const date = parsed ?? new Date();
  if (!parsed) {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
};

const defaultEventStart = (seedText?: string) => {
  const parsed = parseLooseTime(seedText);
  const date = parsed ?? new Date();
  if (!parsed) {
    date.setHours(date.getHours() + 1, 0, 0, 0);
  }
  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
};

const parseLooseTime = (text?: string | null) => {
  if (!text) return null;
  const match = text.match(/(?:@|\bat\s+)(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
};

const buildDefaultBody = (item: InboxItem) => {
  const title = getDisplayTitle(item);
  const preview = getDisplayPreview(item);
  const parts = [preview || title];
  const sourceParts = [getSourceLabel(item), getSourceContext(item), item.author_name].filter(Boolean);
  if (sourceParts.length > 0) parts.push(`Source: ${sourceParts.join(' · ')}`);
  const linkLabels = getSlackLinkLabels(item.body || item.title);
  if (linkLabels.length > 0) parts.push(`Link: ${linkLabels[linkLabels.length - 1]}`);
  return parts.join('\n');
};

const isValidExternalUrl = (value?: string | null) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const getResolvedOptionLabel = <T extends { id: string }>(
  id: string | null | undefined,
  optionsById: Map<string, T>,
  resolveLabel: (entry: T) => string | null | undefined,
  fallback = 'Not suggested'
) => {
  const requestedId = String(id ?? '').trim();
  if (!requestedId) return fallback;
  const entry = optionsById.get(requestedId);
  if (!entry) return 'Unavailable';
  return resolveLabel(entry)?.trim() || 'Unavailable';
};

type IntakeFilterState = {
  source: string;
  type: string;
  project: string;
  assignee: string;
  created: 'all' | 'today' | 'week' | 'older';
};

type IntakeDisplayState = {
  order: 'newest' | 'oldest';
  showSource: boolean;
  showStatus: boolean;
  showProject: boolean;
  showAssignee: boolean;
  showCreated: boolean;
};

type IntakeDraftState = {
  item: InboxItem;
  type: ConversionType;
};

type IntakeMenuState = {
  x: number;
  y: number;
  item: InboxItem;
};

type MenuAnchorState = {
  x: number;
  y: number;
};

type InspectorAction = {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
};

type WorkspaceMemberOption = {
  id: string;
  name: string;
  email: string | null;
};

type WorkspaceTeamOption = {
  id: string;
  name: string;
  identifier: string | null;
};

const defaultFilters: IntakeFilterState = {
  source: 'all',
  type: 'all',
  project: 'all',
  assignee: 'all',
  created: 'all',
};

const defaultDisplayState: IntakeDisplayState = {
  order: 'newest',
  showSource: true,
  showStatus: true,
  showProject: false,
  showAssignee: false,
  showCreated: true,
};

const normalizeForSearch = (value: unknown) => String(value ?? '').trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const getArrayFromPayload = (payload: unknown, key: string) => {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const candidate = payload[key];
  return Array.isArray(candidate) ? candidate : [];
};

const findDeepString = (value: unknown, keys: string[], depth = 0): string | null => {
  if (!value || depth > 2) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDeepString(entry, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }

  for (const candidate of Object.values(value)) {
    const found = findDeepString(candidate, keys, depth + 1);
    if (found) return found;
  }

  return null;
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const diffDays = Math.round(diffMs / 86_400_000);
  const absMinutes = Math.abs(diffMinutes);
  const absHours = Math.abs(diffHours);
  const absDays = Math.abs(diffDays);

  if (absMinutes < 60) {
    if (absMinutes <= 1) return diffMinutes >= 0 ? 'in 1m' : '1m ago';
    return diffMinutes >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }

  if (absHours < 24) {
    if (absHours === 1) return diffHours >= 0 ? 'in 1h' : '1h ago';
    return diffHours >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }

  if (absDays === 1) return diffDays >= 0 ? 'tomorrow' : 'yesterday';
  return diffDays >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
};

const getRawPayload = (item: InboxItem) => (isRecord(item.raw_payload) ? item.raw_payload : {});

const getSearchCorpus = (item: InboxItem) =>
  normalizeForSearch(
    [
      item.title,
      getDisplayTitle(item),
      getDisplayPreview(item),
      item.body,
      item.source,
      getSourceLabel(item),
      getSourceContext(item),
      item.source_label,
      item.source_id,
      item.source_url,
      item.suggested_type,
      item.converted_type,
      getTypeDisplayLabel(item),
      item.author_name,
      getItemCreatedByLabel(item),
      item.channel_name,
      getItemProjectLabel(item),
      getItemAssigneeLabel(item),
      getItemTeamLabel(item),
      getItemReason(item),
      formatDateTime(item.created_at),
      JSON.stringify(getRawPayload(item)),
    ]
      .filter(Boolean)
      .join(' ')
  );

const getItemSourceBucket = (item: InboxItem) => {
  const source = normalizeForSearch(item.source);
  if (source.includes('slack')) return 'slack later';
  if (source.includes('email')) return 'email later';
  if (source.includes('calendar') || source.includes('event')) return 'calendar';
  if (source.includes('meeting')) return 'meeting';
  if (source.includes('browser')) return 'browser';
  if (source.includes('manual') || source.includes('quick')) return 'manual';
  if (source.includes('capture')) return 'quick capture';
  return source || 'manual';
};

const getItemTypeBucket = (item: InboxItem) => {
  const candidates = [
    item.converted_type,
    item.suggested_type,
    findDeepString(getRawPayload(item), ['type', 'suggested_type', 'kind']),
  ]
    .map((value) => normalizeForSearch(value))
    .filter(Boolean);

  if (candidates.some((value) => value.includes('task'))) return 'task';
  if (candidates.some((value) => value.includes('note'))) return 'note';
  if (candidates.some((value) => value.includes('event'))) return 'event';
  if (candidates.some((value) => value.includes('reminder'))) return 'reminder';
  if (candidates.some((value) => value.includes('deadline'))) return 'deadline';
  if (candidates.some((value) => value.includes('milestone'))) return 'milestone';
  if (candidates.some((value) => value.includes('project'))) return 'project';
  if (candidates.some((value) => value.includes('capture'))) return 'capture';
  return item.source === 'browser' ? 'capture' : 'task';
};

const getItemProjectLabel = (item: InboxItem) =>
  findDeepString(getRawPayload(item), [
    'suggested_project_name',
    'project_name',
    'project_title',
    'linked_project_name',
    'project',
    'name',
  ]);

const getItemReason = (item: InboxItem) =>
  findDeepString(getRawPayload(item), ['reason', 'capture_reason', 'why', 'summary']) || null;

const getItemAssigneeLabel = (item: InboxItem) =>
  findDeepString(getRawPayload(item), [
    'assigned_to_name',
    'assigned_name',
    'assignee_name',
    'owner_name',
    'user_name',
    'member_name',
  ]);

const getItemTeamLabel = (item: InboxItem) =>
  findDeepString(getRawPayload(item), [
    'assigned_to_team_name',
    'team_name',
    'assigned_team_name',
    'owner_team_name',
  ]);

const getItemCreatedByLabel = (item: InboxItem) =>
  item.author_name ||
  findDeepString(getRawPayload(item), ['created_by_name', 'created_by', 'author_name', 'user_name']) ||
  null;

const matchesCreatedFilter = (value: string, createdAt: string) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return true;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday);
  startWeek.setDate(startWeek.getDate() - 6);

  if (value === 'today') return date >= startToday;
  if (value === 'week') return date >= startWeek;
  if (value === 'older') return date < startWeek;
  return true;
};

const getDefaultConversionType = (item: InboxItem): ConversionType => {
  const sourceBucket = getItemSourceBucket(item);
  const typeBucket = getItemTypeBucket(item);
  if (sourceBucket === 'browser' || sourceBucket === 'meeting') return 'note';
  if (sourceBucket === 'calendar' && typeBucket === 'deadline') return 'event';
  if (typeBucket === 'note') return 'note';
  if (typeBucket === 'event' || typeBucket === 'deadline') return 'event';
  if (typeBucket === 'reminder') return 'reminder';
  if (typeBucket === 'project') return 'project';
  return 'task';
};

const getTypeDisplayLabel = (item: InboxItem) => {
  const sourceBucket = getItemSourceBucket(item);
  const typeBucket = getItemTypeBucket(item);

  if (sourceBucket === 'browser') return 'Browser capture';
  if (sourceBucket === 'meeting') return 'Meeting output';
  if (sourceBucket === 'calendar') return typeBucket === 'deadline' ? 'Suggested deadline' : 'Calendar item';
  if (sourceBucket === 'slack later') return 'Slack import';
  if (sourceBucket === 'email later') return 'Email import';
  if (typeBucket === 'project') return 'Project draft';
  if (typeBucket === 'task') return 'Task capture';
  if (typeBucket === 'note') return 'Note capture';
  if (typeBucket === 'event') return 'Event capture';
  if (typeBucket === 'reminder') return 'Reminder capture';
  if (typeBucket === 'deadline') return 'Suggested deadline';
  if (typeBucket === 'milestone') return 'Suggested milestone';
  if (typeBucket === 'capture') return 'Capture';
  if (sourceBucket === 'manual') return 'Quick capture';
  return 'Suggested task';
};

const getRowIcon = (item: InboxItem) => {
  const sourceBucket = getItemSourceBucket(item);
  if (sourceBucket === 'browser') return Globe;
  if (sourceBucket === 'meeting') return Calendar;
  if (sourceBucket === 'calendar') return CalendarDays;
  if (sourceBucket === 'slack later') return MessageSquare;
  if (sourceBucket === 'email later') return Mail;
  if (getItemTypeBucket(item) === 'project') return FolderKanban;
  if (sourceBucket === 'manual' || sourceBucket === 'quick capture') return FilePenLine;
  return Sparkles;
};

const snoozeOffset = (mode: 'later-today' | 'tomorrow' | 'next-week' | 'pick-date', date?: string | null) => {
  const now = new Date();
  if (mode === 'later-today') {
    const target = new Date(now);
    target.setHours(17, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
    }
    return target.toISOString();
  }
  if (mode === 'tomorrow') {
    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return target.toISOString();
  }
  if (mode === 'next-week') {
    const target = new Date(now);
    target.setDate(target.getDate() + 7);
    target.setHours(9, 0, 0, 0);
    return target.toISOString();
  }
  const picked = date ? new Date(date) : new Date();
  if (Number.isNaN(picked.getTime())) return null;
  picked.setHours(9, 0, 0, 0);
  return picked.toISOString();
};

export default function IntakeWindow() {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const api = useApi();
  const toast = useToast();

  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStatus, setActiveStatus] = useState<InboxStatus>('unprocessed');
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<IntakeFilterState>(defaultFilters);
  const [display, setDisplay] = useState<IntakeDisplayState>(defaultDisplayState);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<IntakeDraftState | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<IntakeMenuState | null>(null);
  const [filterMenu, setFilterMenu] = useState<MenuAnchorState | null>(null);
  const [displayMenu, setDisplayMenu] = useState<MenuAnchorState | null>(null);
  const [snoozeMenu, setSnoozeMenu] = useState<{ x: number; y: number; item: InboxItem } | null>(null);
  const [snoozePicker, setSnoozePicker] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [notes, setNotes] = useState<NoteOption[]>([]);
  const [noteSections, setNoteSections] = useState<NoteSectionOption[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberOption[]>([]);
  const [workspaceTeams, setWorkspaceTeams] = useState<WorkspaceTeamOption[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const displayButtonRef = useRef<HTMLButtonElement | null>(null);
  const loadInboxInFlightRef = useRef(false);
  const loadInboxAtRef = useRef(0);
  const loadNotificationAtRef = useRef(0);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [selectedNoteSectionId, setSelectedNoteSectionId] = useState('');
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [showInToday, setShowInToday] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('10:00');
  const [eventDuration, setEventDuration] = useState('30');
  const [projectBrief, setProjectBrief] = useState('');
  const [projectStartDate, setProjectStartDate] = useState('');
  const [projectEndDate, setProjectEndDate] = useState('');
  const [projectStatus, setProjectStatus] = useState('not_started');
  const [projectOwnerTeamId, setProjectOwnerTeamId] = useState('');
  const [projectLeadId, setProjectLeadId] = useState('');

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects]
  );
  const membersById = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.id, member] as const)),
    [workspaceMembers]
  );
  const teamsById = useMemo(
    () => new Map(workspaceTeams.map((team) => [team.id, team] as const)),
    [workspaceTeams]
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar] as const)),
    [calendars]
  );
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.id, note] as const)),
    [notes]
  );
  const noteSectionsById = useMemo(
    () => new Map(noteSections.map((section) => [section.id, section] as const)),
    [noteSections]
  );

  const loadInbox = async (showSpinner = false, opts?: { force?: boolean }) => {
    if (!activeWorkspaceId) {
      setItems([]);
      setIsLoading(false);
      setError('Select a workspace to view Intake items.');
      return;
    }

    const now = Date.now();
    const inboxCooldownMs = 120_000;
    if (!opts?.force) {
      if (loadInboxInFlightRef.current) return;
      if (now - loadInboxAtRef.current < inboxCooldownMs) return;
    }
    loadInboxInFlightRef.current = true;
    loadInboxAtRef.current = now;

    if (showSpinner) setRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const [unprocessed, converted, snoozed, archived] = await Promise.all([
        api.getInboxItems({ status: 'unprocessed' }),
        api.getInboxItems({ status: 'converted' }),
        api.getInboxItems({ status: 'snoozed' }),
        api.getInboxItems({ status: 'archived' }),
      ]);
      setItems(
        [...(Array.isArray(unprocessed) ? unprocessed : []),
          ...(Array.isArray(converted) ? converted : []),
          ...(Array.isArray(snoozed) ? snoozed : []),
          ...(Array.isArray(archived) ? archived : [])] as InboxItem[]
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load Intake.");
    } finally {
      setIsLoading(false);
      setRefreshing(false);
      loadInboxInFlightRef.current = false;
    }
  };

  const loadNotificationSummary = async (opts?: { force?: boolean }) => {
    if (!user) {
      setNotificationCount(0);
      return;
    }

    const now = Date.now();
    const notificationCooldownMs = 60_000;
    if (!opts?.force && now - loadNotificationAtRef.current < notificationCooldownMs) {
      return;
    }
    loadNotificationAtRef.current = now;

    try {
      const payload = (await api.getNotificationCenterSummary()) as { counts?: { active?: number } };
      setNotificationCount(Number(payload?.counts?.active ?? 0));
    } catch {
      setNotificationCount(0);
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadInbox(false, { force: true });
  }, [activeWorkspaceId, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void loadNotificationSummary({ force: true });

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ activeCount?: number }>).detail;
      setNotificationCount(Number(detail?.activeCount ?? 0));
    };

    const handleNotificationsUpdated = () => {
      if (!cancelled) void loadNotificationSummary();
    };

    const refreshNotifications = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (cancelled) return;
      void loadNotificationSummary({ force: true });
    };

    window.addEventListener('ledger:notifications-summary', handleNotificationsSummary as EventListener);
    window.addEventListener('ledger:notifications-updated', handleNotificationsUpdated);
    window.addEventListener('focus', refreshNotifications);
    document.addEventListener('visibilitychange', refreshNotifications);

    return () => {
      cancelled = true;
      window.removeEventListener('ledger:notifications-summary', handleNotificationsSummary as EventListener);
      window.removeEventListener('ledger:notifications-updated', handleNotificationsUpdated);
      window.removeEventListener('focus', refreshNotifications);
      document.removeEventListener('visibilitychange', refreshNotifications);
    };
  }, [api, user]);

  useEffect(() => {
    if (!activeWorkspaceId || !user) return;
    let cancelled = false;

    const loadContext = async () => {
      try {
        const [projectPayload, calendarPayload, notePayload, sectionPayload, membersPayload, teamsPayload] =
          await Promise.allSettled([
            api.getProjects({ includeCompleted: false }),
            api.getCalendars(),
            api.getNotes(),
            api.getSections(),
            api.getWorkspaceMembers(activeWorkspaceId),
            api.getTeams(),
          ]);

        if (cancelled) return;

        setProjects(projectPayload.status === 'fulfilled' && Array.isArray(projectPayload.value) ? projectPayload.value : []);
        setCalendars(calendarPayload.status === 'fulfilled' && Array.isArray(calendarPayload.value) ? calendarPayload.value : []);
        setNotes(notePayload.status === 'fulfilled' && Array.isArray(notePayload.value) ? notePayload.value : []);
        setNoteSections(
          sectionPayload.status === 'fulfilled' && Array.isArray(sectionPayload.value)
            ? sectionPayload.value
                .map((section: any) => ({
                  id: String(section.id ?? ''),
                  name: String(section.name ?? section.title ?? '').trim() || null,
                }))
                .filter((section: NoteSectionOption) => section.id)
            : []
        );

        const mappedMembers =
          membersPayload.status === 'fulfilled' && Array.isArray((membersPayload.value as { members?: Array<Record<string, unknown>> })?.members)
            ? ((membersPayload.value as { members?: Array<Record<string, unknown>> }).members ?? []).map((member) => {
                const name = String(member.full_name ?? '').trim() || String(member.email ?? '').split('@')[0] || 'Workspace member';
                return {
                  id: String(member.user_id ?? ''),
                  name,
                  email: member.email ? String(member.email) : null,
                };
              }).filter((member) => member.id)
            : [];

        const mappedTeams =
          teamsPayload.status === 'fulfilled'
            ? getArrayFromPayload(teamsPayload.value, 'teams').map((team: any) => ({
                id: String(team.id ?? ''),
                name: String(team.name ?? 'Team'),
                identifier: team.identifier ? String(team.identifier) : null,
              })).filter((team) => team.id)
            : [];

        setWorkspaceMembers(mappedMembers);
        setWorkspaceTeams(mappedTeams);
      } catch {
        if (!cancelled) {
          setProjects([]);
          setCalendars([]);
          setNotes([]);
          setNoteSections([]);
          setWorkspaceMembers([]);
          setWorkspaceTeams([]);
        }
      }
    };

    void loadContext();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, user]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!activeWorkspaceId) return;
      if (document.visibilityState !== 'visible') return;
      void loadInbox(true);
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!contextMenu && !filterMenu && !displayMenu && !snoozeMenu) return;
    const closeMenus = () => {
      setContextMenu(null);
      setFilterMenu(null);
      setDisplayMenu(null);
      setSnoozeMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (snoozePicker) {
          setSnoozePicker(null);
          return;
        }
        closeMenus();
      }
    };
    window.addEventListener('mousedown', closeMenus);
    window.addEventListener('scroll', closeMenus, true);
    window.addEventListener('resize', closeMenus);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenus);
      window.removeEventListener('scroll', closeMenus, true);
      window.removeEventListener('resize', closeMenus);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, displayMenu, filterMenu, snoozeMenu, snoozePicker]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCmdF = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f';
      if (isCmdF) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
        return;
      }

      if (event.key === 'Escape' && searchQuery) {
        event.preventDefault();
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchQuery]);

  const counts = useMemo(() => {
    const statusCounts = statusLabels.reduce<Record<InboxStatus, number>>((acc, status) => {
      acc[status.value] = items.filter((item) => item.status === status.value).length;
      return acc;
    }, { unprocessed: 0, converted: 0, snoozed: 0, archived: 0 });
    return statusCounts;
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = normalizeForSearch(searchQuery);
    const currentUserId = user?.id ?? null;

    const itemsForStatus = query ? items : items.filter((item) => item.status === activeStatus);
    const result = itemsForStatus.filter((item) => {
      if (query && !getSearchCorpus(item).includes(query)) return false;

      if (filters.source !== 'all' && getItemSourceBucket(item) !== filters.source) return false;
      if (filters.type !== 'all' && getItemTypeBucket(item) !== filters.type) return false;

      if (filters.project !== 'all') {
        const project = projects.find((entry) => entry.id === filters.project);
        const projectText = normalizeForSearch([project?.name, project?.title, project?.id].filter(Boolean).join(' '));
        if (projectText && !getSearchCorpus(item).includes(projectText)) return false;
      }

      if (filters.assignee !== 'all') {
        if (filters.assignee === 'me') {
          const userMatch = workspaceMembers.find((member) => member.id === currentUserId);
          const meText = normalizeForSearch([userMatch?.name, userMatch?.email, currentUserId].filter(Boolean).join(' '));
          if (meText && !getSearchCorpus(item).includes(meText)) return false;
        } else if (filters.assignee === 'unassigned') {
          const assigneeText = [getItemAssigneeLabel(item), getItemTeamLabel(item)].filter(Boolean).join(' ');
          if (assigneeText) return false;
        } else if (filters.assignee.startsWith('member:')) {
          const memberId = filters.assignee.slice('member:'.length);
          const member = workspaceMembers.find((entry) => entry.id === memberId);
          const memberText = normalizeForSearch([member?.name, member?.email, member?.id].filter(Boolean).join(' '));
          if (memberText && !getSearchCorpus(item).includes(memberText)) return false;
        } else if (filters.assignee.startsWith('team:')) {
          const teamId = filters.assignee.slice('team:'.length);
          const team = workspaceTeams.find((entry) => entry.id === teamId);
          const teamText = normalizeForSearch([team?.name, team?.identifier, team?.id].filter(Boolean).join(' '));
          if (teamText && !getSearchCorpus(item).includes(teamText)) return false;
        }
      }

      return matchesCreatedFilter(filters.created, item.created_at);
    });

    return result.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return display.order === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }, [activeStatus, display.order, filters.assignee, filters.created, filters.project, filters.source, filters.type, items, projects, searchQuery, user?.id, workspaceMembers, workspaceTeams]);

  const selectedItem = useMemo(() => {
    if (selectedItemId) {
      const fromAll = items.find((item) => item.id === selectedItemId);
      if (fromAll && filteredItems.some((item) => item.id === fromAll.id)) return fromAll;
    }
    return filteredItems[0] ?? null;
  }, [filteredItems, items, selectedItemId]);

  useEffect(() => {
    if (!filteredItems.length) {
      if (selectedItemId && !items.some((item) => item.id === selectedItemId)) {
        setSelectedItemId(null);
      }
      return;
    }

    if (!selectedItemId || !filteredItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(filteredItems[0].id);
    }
  }, [filteredItems, items, selectedItemId]);

  const getProjectOptionLabel = (id?: string | null) =>
    getResolvedOptionLabel(id, projectsById, (project) => project.name || project.title || null);
  const getMemberOptionLabel = (id?: string | null) =>
    getResolvedOptionLabel(id, membersById, (member) => member.name || member.email || null);
  const getTeamOptionLabel = (id?: string | null) =>
    getResolvedOptionLabel(id, teamsById, (team) => team.name || team.identifier || null);
  const getCalendarOptionLabel = (id?: string | null) =>
    getResolvedOptionLabel(id, calendarsById, (calendar) => calendar.name || null);
  const getNoteSectionOptionLabel = (id?: string | null) =>
    getResolvedOptionLabel(id, noteSectionsById, (section) => section.name || null);

  const getInspectorSourceLabel = (item: InboxItem) => {
    const explicitLabel = String(item.source_label ?? '').trim();
    if (explicitLabel) return explicitLabel;
    const source = normalizeForSearch(item.source);
    const provider = normalizeForSearch(item.source_provider);
    if (source.includes('slack') || provider === 'slack') return 'Slack import';
    if (source.includes('browser')) return 'Browser save';
    if (source.includes('meeting') || provider === 'zoom' || provider === 'meet') return 'Meeting output';
    if (source.includes('calendar')) return 'Calendar import';
    if (source.includes('quick') || source.includes('manual')) return 'Quick capture';
    if (source.includes('team')) return 'Team submission';
    if (source.includes('email')) return 'Email import';
    if (source.includes('suggest')) return 'Suggested item';
    if (source) return titleCase(source.replace(/_/g, ' '));
    return '';
  };

  const getInspectorMetadata = (item: InboxItem) => {
    const parts: string[] = [];
    const source = normalizeForSearch(item.source);
    if (source.includes('slack') || item.source_provider === 'slack') {
      if (item.channel_name) parts.push(`#${item.channel_name}`);
      if (item.author_name) parts.push(item.author_name);
    } else if (source.includes('browser')) {
      if (item.source_url && isValidExternalUrl(item.source_url)) parts.push(getDomain(item.source_url));
      if (item.author_name) parts.push(item.author_name);
    } else if (source.includes('meeting')) {
      if (item.author_name) parts.push(item.author_name);
    } else if (item.author_name) {
      parts.push(item.author_name);
    }

    const createdAt = formatDateTime(item.created_at);
    if (createdAt) parts.push(createdAt);
    return parts;
  };

  const getInspectorPlacement = (item: InboxItem) => {
    const raw = getRawPayload(item);
    const fallback = 'Not suggested';

    const projectId =
      item.suggested_project_id ||
      findDeepString(raw, ['suggested_project_id', 'project_id', 'linked_project_id']);
    const ownerId =
      item.suggested_assignee_id ||
      findDeepString(raw, ['suggested_assignee_id', 'assigned_to_user_id', 'owner_id', 'assignee_id']);
    const teamId =
      findDeepString(raw, [
        'suggested_team_id',
        'suggested_owner_team_id',
        'assigned_to_team_id',
        'owner_team_id',
        'team_id',
      ]);
    const calendarId =
      item.suggested_calendar_id || findDeepString(raw, ['suggested_calendar_id', 'calendar_id']);
    const sectionId =
      item.suggested_note_section_id || findDeepString(raw, ['suggested_note_section_id', 'section_id', 'note_section_id']);
    const dueDate =
      item.suggested_due_at ||
      item.suggested_date ||
      findDeepString(raw, ['suggested_due_at', 'due_at', 'due_date', 'date']);
    const startDate = findDeepString(raw, ['start_date', 'project_start_date', 'start_at']);
    const targetDate = findDeepString(raw, ['end_date', 'project_end_date', 'target_date', 'end_at']);
    const projectName =
      findDeepString(raw, ['project_name', 'project_title', 'linked_project_name', 'project_label']) || fallback;
    const ownerName =
      findDeepString(raw, ['owner_name', 'assigned_to_name', 'assignee_name', 'user_name']) || fallback;
    const teamName =
      findDeepString(raw, ['team_name', 'owner_team_name', 'assigned_team_name']) || fallback;
    const calendarName =
      findDeepString(raw, ['calendar_name', 'calendar_title']) || fallback;
    const sectionName =
      findDeepString(raw, ['section_name', 'note_section_name']) || fallback;

    return {
      project: projectId ? getProjectOptionLabel(projectId) : projectName,
      owner: ownerId ? getMemberOptionLabel(ownerId) : ownerName,
      team: teamId ? getTeamOptionLabel(teamId) : teamName,
      calendar: calendarId ? getCalendarOptionLabel(calendarId) : calendarName,
      section: sectionId ? getNoteSectionOptionLabel(sectionId) : sectionName,
      dueDate: dueDate ? formatDateTime(dueDate) || dueDate : fallback,
      startDate: startDate ? formatDateTime(startDate) || startDate : fallback,
      targetDate: targetDate ? formatDateTime(targetDate) || targetDate : fallback,
    };
  };

  const openConversion = (item: InboxItem, type?: ConversionType) => {
    const nextType = type ?? getDefaultConversionType(item);
    const raw = getRawPayload(item);
    const seed = `${item.title}\n${item.body ?? ''}`;
    const reminderDefaults = defaultReminderAt(seed);
    const eventDefaults = defaultEventStart(seed);
    const projectId =
      item.suggested_project_id ||
      findDeepString(raw, ['suggested_project_id', 'project_id', 'linked_project_id']);
    const assigneeId =
      item.suggested_assignee_id ||
      findDeepString(raw, ['suggested_assignee_id', 'assigned_to_user_id', 'assignee_id', 'owner_id']);
    const teamId = findDeepString(raw, ['suggested_team_id', 'suggested_owner_team_id', 'assigned_to_team_id', 'owner_team_id']);
    const calendarId = item.suggested_calendar_id || findDeepString(raw, ['suggested_calendar_id', 'calendar_id']);
    const sectionId =
      item.suggested_note_section_id || findDeepString(raw, ['suggested_note_section_id', 'section_id', 'note_section_id']);
    const projectDefaults = {
      brief: cleanSlackText(item.body ?? '') || getItemReason(item) || '',
      startDate: findDeepString(raw, ['start_date', 'project_start_date']) || '',
      endDate: findDeepString(raw, ['end_date', 'project_end_date']) || '',
      status: normalizeForSearch(findDeepString(raw, ['status', 'project_status']) ?? '') || 'not_started',
      ownerTeamId: teamId && teamsById.has(teamId) ? teamId : '',
      leadId: assigneeId && membersById.has(assigneeId) ? assigneeId : '',
    };
    setDraft({
      item,
      type: nextType,
    });
    setDraftTitle(getDisplayTitle(item));
    setDraftBody(buildDefaultBody(item));
    setSelectedProjectId(projectId && projectsById.has(projectId) ? projectId : '');
    const noteId = findDeepString(raw, ['note_id', 'linked_note_id']) || '';
    setSelectedNoteId(noteId && notesById.has(noteId) ? noteId : '');
    setSelectedNoteSectionId(sectionId && noteSectionsById.has(sectionId) ? sectionId : '');
    setSelectedCalendarId(calendarId && calendarsById.has(calendarId) ? calendarId : '');
    setSelectedAssigneeId(assigneeId && membersById.has(assigneeId) ? assigneeId : '');
    setSelectedTeamId(teamId && teamsById.has(teamId) ? teamId : '');
    setShowInToday(false);
    setReminderDate(reminderDefaults.date);
    setReminderTime(reminderDefaults.time);
    setEventDate(eventDefaults.date);
    setEventTime(eventDefaults.time);
    setEventDuration('30');
    setProjectBrief(projectDefaults.brief);
    setProjectStartDate(projectDefaults.startDate);
    setProjectEndDate(projectDefaults.endDate);
    setProjectStatus(projectDefaults.status);
    setProjectOwnerTeamId(projectDefaults.ownerTeamId);
    setProjectLeadId(projectDefaults.leadId);
  };

  const closeConversion = () => {
    setDraft(null);
  };

  const emitInboxItemsUpdated = (delta?: number) => {
    if (typeof delta === 'number' && Number.isFinite(delta)) {
      window.ipcRenderer?.send('inbox:items-updated', { delta });
      return;
    }
    window.ipcRenderer?.send('inbox:items-updated');
  };

  const archiveItem = async (item: InboxItem) => {
    setActiveActionId(item.id);
    try {
      const updated = (await api.archiveIntakeItem(item.id)) as InboxItem;
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      emitInboxItemsUpdated(item.status === 'unprocessed' ? -1 : 0);
      toast.show('Archived intake item.', { variant: 'success' });
      if (selectedItemId === item.id) setSelectedItemId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not archive intake item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setActiveActionId(null);
    }
  };

  const snoozeItem = async (item: InboxItem, mode: 'later-today' | 'tomorrow' | 'next-week' | 'pick-date', date?: string | null) => {
    const snoozedUntil = snoozeOffset(mode, date);
    if (!snoozedUntil) return;
    setActiveActionId(item.id);
    try {
      const updated = (await api.snoozeIntakeItem(item.id, snoozedUntil)) as InboxItem;
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      setSnoozeMenu(null);
      setSnoozePicker(null);
      toast.show('Snoozed intake item.', { variant: 'success' });
      emitInboxItemsUpdated(item.status === 'unprocessed' ? -1 : 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not snooze intake item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setActiveActionId(null);
    }
  };

  const deleteItem = async (item: InboxItem) => {
    setActiveActionId(item.id);
    try {
      await api.deleteIntakeItem(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (selectedItemId === item.id) setSelectedItemId(null);
      emitInboxItemsUpdated(item.status === 'unprocessed' ? -1 : 0);
      toast.show('Deleted intake item.', { variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete intake item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setActiveActionId(null);
    }
  };

  const restoreItem = async (item: InboxItem) => {
    setActiveActionId(item.id);
    try {
      const updated = (await api.restoreIntakeItem(item.id)) as InboxItem;
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      setActiveStatus('unprocessed');
      setSelectedItemId(item.id);
      emitInboxItemsUpdated(item.status === 'archived' ? 1 : 0);
      toast.show('Restored intake item.', { variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not restore intake item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setActiveActionId(null);
    }
  };

  const submitConversion = async () => {
    if (!draft) return;
    setIsConverting(true);
    try {
      const body = draftBody.trim();
      const title = draftTitle.trim() || getDisplayTitle(draft.item);
      const projectId = selectedProjectId || null;
      const noteId = selectedNoteId || null;
      const calendarId = selectedCalendarId || null;
      const basePayload = {
        title,
        body,
        project_id: projectId,
        note_id: noteId || null,
        calendar_id: calendarId || null,
        assigned_to_user_id: selectedAssigneeId || null,
        assigned_to_team_id: selectedTeamId || null,
      };

      if (draft.type === 'project') {
        const projectDescription = projectBrief.trim() || body || null;
        await api.convertIntakeItem(draft.item.id, {
          ...basePayload,
          type: 'project',
          description: projectDescription,
          start_date: projectStartDate || null,
          end_date: projectEndDate || null,
          status: projectStatus,
          lead_id: projectLeadId || null,
          owner_team_id: projectOwnerTeamId || null,
        });
      } else if (draft.type === 'task') {
        await api.convertIntakeItem(draft.item.id, {
          ...basePayload,
          type: 'task',
          notes: body,
          show_in_today: showInToday,
          task_horizon: showInToday ? 'today' : 'long_term',
        });
      } else if (draft.type === 'note') {
        await api.convertIntakeItem(draft.item.id, {
          ...basePayload,
          type: 'note',
          body,
          section_id: selectedNoteSectionId || null,
        });
      } else if (draft.type === 'reminder') {
        if (!reminderDate || !reminderTime) throw new Error('Choose when to be reminded.');
        const remindAt = new Date(`${reminderDate}T${reminderTime}:00`).toISOString();
        await api.convertIntakeItem(draft.item.id, {
          ...basePayload,
          type: 'reminder',
          remind_at: remindAt,
          notes: body,
        });
      } else {
        if (!eventDate || !eventTime) throw new Error('Choose when the event starts.');
        const startAt = new Date(`${eventDate}T${eventTime}:00`).toISOString();
        const durationMinutes = Math.max(15, Number(eventDuration) || 30);
        const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60 * 1000).toISOString();
        await api.convertIntakeItem(draft.item.id, {
          ...basePayload,
          type: 'event',
          start_at: startAt,
          end_at: endAt,
          notes: body,
        });
      }

      await loadInbox(true, { force: true });
      setDraft(null);
      emitInboxItemsUpdated(draft.item.status === 'unprocessed' ? -1 : 0);
      toast.show(`Created ${draft.type} from ${getSourceLabel(draft.item)} intake item.`, { variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not convert intake item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setIsConverting(false);
    }
  };

  const openFilterMenu = () => {
    const rect = filterButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setFilterMenu({ x: rect.left, y: rect.bottom + 8 });
    setDisplayMenu(null);
  };

  const openDisplayMenu = () => {
    const rect = displayButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDisplayMenu({ x: rect.left, y: rect.bottom + 8 });
    setFilterMenu(null);
  };

  const intakeStatusTabs = (
    <ModuleHeaderSegmentedGroup compact>
      {statusLabels.map((status) => {
        const active = activeStatus === status.value;
        const StatusIcon =
          status.value === 'unprocessed'
            ? Inbox
            : status.value === 'converted'
            ? CheckSquare
            : status.value === 'snoozed'
              ? Clock3
              : Archive;
        return (
          <button
            key={status.value}
            type="button"
            onClick={() => {
              setActiveStatus(status.value);
              setSelectedItemId(null);
            }}
            title={`${status.label} (${counts[status.value]})`}
            aria-label={`${status.label} (${counts[status.value]})`}
            className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 ${
              active
                ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
            }`}
          >
            <StatusIcon size={11} />
            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-1 text-[9px] font-medium leading-4 text-[var(--ledger-text-muted)] shadow-[0_1px_1px_rgba(15,23,42,0.06)]">
              {counts[status.value]}
            </span>
          </button>
        );
      })}
    </ModuleHeaderSegmentedGroup>
  );

  const intakeSearchControl = (
    <div className="flex items-center gap-1.5">
      <label className="hidden h-7 min-w-[170px] items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2.5 text-xs text-[var(--ledger-text-muted)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:flex lg:min-w-[210px]">
        <Search size={12} className="shrink-0" />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search intake..."
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-text-muted)] focus:outline-none"
        />
      </label>
      <button
        type="button"
        onClick={() => searchInputRef.current?.focus()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] md:hidden"
        aria-label="Search intake"
        title="Search intake"
      >
        <Search size={12} />
      </button>
    </div>
  );

  const intakeFilterDisplayControls = (
    <div className="flex items-center gap-1.5">
      <ModuleHeaderActionButton
        variant="strip"
        iconOnly
        icon={<Funnel size={12} />}
        onClick={openFilterMenu}
        title="Filter intake"
        ariaLabel="Filter intake"
      >
        <></>
      </ModuleHeaderActionButton>
      <ModuleHeaderActionButton
        variant="strip"
        iconOnly
        icon={<PanelRight size={12} />}
        onClick={openDisplayMenu}
        title="Display intake"
        ariaLabel="Display intake"
      >
        <></>
      </ModuleHeaderActionButton>
    </div>
  );

  const renderRow = (item: InboxItem) => {
    const selected = item.id === selectedItem?.id;
    const sourceLabel = getTypeDisplayLabel(item);
    const title = getDisplayTitle(item);
    const isArchived = item.status === 'archived';
    const sourceBits = [
      display.showSource ? getSourceLabel(item) : null,
      display.showStatus ? getStatusLabel(item.status) : null,
      display.showProject ? getItemProjectLabel(item) || null : null,
      display.showAssignee ? getItemAssigneeLabel(item) || getItemTeamLabel(item) || null : null,
      display.showCreated ? formatRelativeTime(item.created_at) : null,
    ].filter(Boolean);
    const RowIcon = getRowIcon(item);

    return (
      <div
        key={item.id}
        onClick={() => setSelectedItemId(item.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelectedItemId(item.id);
          setContextMenu({ x: event.clientX, y: event.clientY, item });
        }}
        className={`group flex min-h-[44px] cursor-default items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 transition ${
          selected
            ? 'bg-[var(--ledger-surface-muted)]'
            : 'hover:bg-[var(--ledger-surface-muted)]'
        }`}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
          <RowIcon size={13} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate text-[13px] font-medium leading-5 text-[var(--ledger-text-primary)]">
                {title}
              </p>
            <p className="min-w-0 truncate text-[11px] leading-5 text-[var(--ledger-text-muted)]">
              {sourceBits.join(' · ') || sourceLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {isArchived ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void restoreItem(item);
                }}
                disabled={activeActionId === item.id}
                className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
              >
                {activeActionId === item.id ? <Loader2 size={10} className="animate-spin" /> : 'Restore'}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteItem(item);
                }}
                disabled={activeActionId === item.id}
                className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
              >
                {activeActionId === item.id ? <Loader2 size={10} className="animate-spin" /> : 'Delete'}
              </button>
            </>
          ) : (
            <>
              {item.status === 'unprocessed' && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openConversion(item, getDefaultConversionType(item));
                  }}
                  className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  Accept
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSnoozeMenu({ x: event.clientX, y: event.clientY, item });
                }}
                className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                Snooze
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void archiveItem(item);
                }}
                disabled={activeActionId === item.id}
                className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60"
              >
                {activeActionId === item.id ? <Loader2 size={10} className="animate-spin" /> : 'Archive'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const menuPortal = (state: MenuAnchorState | null, children: ReactNode, width = 260) =>
    state
      ? createPortal(
          <div
            className="fixed z-260"
            style={{
              left: Math.min(state.x, window.innerWidth - width - 12),
              top: Math.min(state.y, window.innerHeight - 12),
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className={sidebarTheme.menu} style={{ width }}>
              {children}
            </div>
          </div>,
          document.body
        )
      : null;

  const contextMenuPortal =
    contextMenu &&
    createPortal(
      <div
        className="fixed z-260"
        style={{
          left: Math.min(contextMenu.x, window.innerWidth - 220),
          top: Math.min(contextMenu.y, window.innerHeight - 12),
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className={sidebarTheme.menu} style={{ width: 220 }}>
          {getItemTypeBucket(contextMenu.item) === 'project' && (
            <button type="button" onClick={() => openConversion(contextMenu.item, 'project')} className={sidebarTheme.menuItem}>
              Turn into project
            </button>
          )}
          {contextMenu.item.source_url && (
            <button
              type="button"
              onClick={() => window.open(contextMenu.item.source_url ?? '', '_blank', 'noopener,noreferrer')}
              className={sidebarTheme.menuItem}
            >
              Open
            </button>
          )}
          {contextMenu.item.status === 'unprocessed' && (
            <button
              type="button"
              onClick={() => openConversion(contextMenu.item, getDefaultConversionType(contextMenu.item))}
              className={sidebarTheme.menuItem}
            >
              Accept
            </button>
          )}
          {contextMenu.item.status === 'archived' ? (
            <button type="button" onClick={() => void restoreItem(contextMenu.item)} className={sidebarTheme.menuItem}>
              Restore
            </button>
          ) : (
            <>
              <button type="button" onClick={() => openConversion(contextMenu.item, 'task')} className={sidebarTheme.menuItem}>
                Turn into task
              </button>
              <button type="button" onClick={() => openConversion(contextMenu.item, 'note')} className={sidebarTheme.menuItem}>
                Turn into note
              </button>
              <button
                type="button"
                onClick={() => setSnoozeMenu({ x: contextMenu.x, y: contextMenu.y, item: contextMenu.item })}
                className={sidebarTheme.menuItem}
              >
                Snooze
              </button>
              <button type="button" onClick={() => void archiveItem(contextMenu.item)} className={sidebarTheme.menuItem}>
                Archive
              </button>
            </>
          )}
          <button type="button" onClick={() => void deleteItem(contextMenu.item)} className={sidebarTheme.menuItemDanger}>
            Delete
          </button>
        </div>
      </div>,
      document.body
    );

  const filterMenuPortal = menuPortal(
    filterMenu,
    <div className="py-2">
      <MenuSectionLabel label="Source" />
      {['all', 'quick capture', 'browser', 'meeting', 'calendar', 'manual', 'slack later', 'email later'].map((value) => (
        <MenuOption
          key={value}
          label={value === 'all' ? 'All sources' : titleCase(value)}
          active={filters.source === value}
          onClick={() => setFilters((current) => ({ ...current, source: value }))}
        />
      ))}
      <MenuDivider />
      <MenuSectionLabel label="Type" />
      {['all', 'task', 'note', 'event', 'reminder', 'deadline', 'project', 'milestone', 'capture'].map((value) => (
        <MenuOption
          key={value}
          label={value === 'all' ? 'All types' : titleCase(value)}
          active={filters.type === value}
          onClick={() => setFilters((current) => ({ ...current, type: value }))}
        />
      ))}
      <MenuDivider />
      <MenuSectionLabel label="Project" />
      <MenuOption
        label="All projects"
        active={filters.project === 'all'}
        onClick={() => setFilters((current) => ({ ...current, project: 'all' }))}
      />
      {projects.map((project) => (
        <MenuOption
          key={project.id}
          label={project.name || project.title || 'Untitled project'}
          active={filters.project === project.id}
          onClick={() => setFilters((current) => ({ ...current, project: project.id }))}
        />
      ))}
      <MenuDivider />
      <MenuSectionLabel label="Assignee" />
      <MenuOption
        label="All assignees"
        active={filters.assignee === 'all'}
        onClick={() => setFilters((current) => ({ ...current, assignee: 'all' }))}
      />
      <MenuOption
        label="Me"
        active={filters.assignee === 'me'}
        onClick={() => setFilters((current) => ({ ...current, assignee: 'me' }))}
      />
      <MenuOption
        label="Unassigned"
        active={filters.assignee === 'unassigned'}
        onClick={() => setFilters((current) => ({ ...current, assignee: 'unassigned' }))}
      />
      {workspaceMembers.map((member) => (
        <MenuOption
          key={member.id}
          label={member.name}
          active={filters.assignee === `member:${member.id}`}
          onClick={() => setFilters((current) => ({ ...current, assignee: `member:${member.id}` }))}
        />
      ))}
      {workspaceTeams.map((team) => (
        <MenuOption
          key={team.id}
          label={team.name}
          active={filters.assignee === `team:${team.id}`}
          onClick={() => setFilters((current) => ({ ...current, assignee: `team:${team.id}` }))}
        />
      ))}
      <MenuDivider />
      <MenuSectionLabel label="Created" />
      {(['all', 'today', 'week', 'older'] as const).map((value) => (
        <MenuOption
          key={value}
          label={value === 'all' ? 'Any time' : titleCase(value)}
          active={filters.created === value}
          onClick={() => setFilters((current) => ({ ...current, created: value }))}
        />
      ))}
      <div className="mt-2 border-t border-[color:var(--ledger-border-subtle)] px-3 pt-2">
        <button
          type="button"
          onClick={() => setFilters(defaultFilters)}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          Clear filters
        </button>
      </div>
    </div>
  );

  const displayMenuPortal = menuPortal(
    displayMenu,
    <div className="py-2">
      <MenuSectionLabel label="Ordering" />
      <MenuOption
        label="Newest"
        active={display.order === 'newest'}
        onClick={() => setDisplay((current) => ({ ...current, order: 'newest' }))}
      />
      <MenuOption
        label="Oldest"
        active={display.order === 'oldest'}
        onClick={() => setDisplay((current) => ({ ...current, order: 'oldest' }))}
      />
      <MenuDivider />
      <MenuSectionLabel label="Show" />
      <ToggleOption
        label="Source"
        checked={display.showSource}
        onToggle={() => setDisplay((current) => ({ ...current, showSource: !current.showSource }))}
      />
      <ToggleOption
        label="Status"
        checked={display.showStatus}
        onToggle={() => setDisplay((current) => ({ ...current, showStatus: !current.showStatus }))}
      />
      <ToggleOption
        label="Project"
        checked={display.showProject}
        onToggle={() => setDisplay((current) => ({ ...current, showProject: !current.showProject }))}
      />
      <ToggleOption
        label="Assignee"
        checked={display.showAssignee}
        onToggle={() => setDisplay((current) => ({ ...current, showAssignee: !current.showAssignee }))}
      />
      <ToggleOption
        label="Created"
        checked={display.showCreated}
        onToggle={() => setDisplay((current) => ({ ...current, showCreated: !current.showCreated }))}
      />
      <div className="mt-2 border-t border-[color:var(--ledger-border-subtle)] px-3 pt-2">
        <button
          type="button"
          onClick={() => setDisplay(defaultDisplayState)}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          Reset display
        </button>
      </div>
    </div>
  );

  const snoozeMenuPortal =
    snoozeMenu &&
    createPortal(
      <div
        className="fixed z-260"
        style={{
          left: Math.min(snoozeMenu.x, window.innerWidth - 240),
          top: Math.min(snoozeMenu.y, window.innerHeight - 12),
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className={sidebarTheme.menu} style={{ width: 240 }}>
          <button type="button" className={sidebarTheme.menuItem} onClick={() => void snoozeItem(snoozeMenu.item, 'later-today')}>
            Later today
          </button>
          <button type="button" className={sidebarTheme.menuItem} onClick={() => void snoozeItem(snoozeMenu.item, 'tomorrow')}>
            Tomorrow
          </button>
          <button type="button" className={sidebarTheme.menuItem} onClick={() => void snoozeItem(snoozeMenu.item, 'next-week')}>
            Next week
          </button>
          <button
            type="button"
            className={sidebarTheme.menuItem}
            onClick={() => setSnoozePicker(snoozePicker === snoozeMenu.item.id ? null : snoozeMenu.item.id)}
          >
            Pick date
          </button>
          {snoozePicker === snoozeMenu.item.id && (
            <div className="border-t border-[color:var(--ledger-border-subtle)] px-3 py-3">
              <input
                type="date"
                className={inboxTheme.fieldSoft}
                onChange={(event) => void snoozeItem(snoozeMenu.item, 'pick-date', event.target.value)}
              />
            </div>
          )}
        </div>
      </div>,
      document.body
    );

  const conversionModal = draft && (
      <ModalOverlay
        isOpen
        onClose={closeConversion}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[620px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex h-[min(calc(100vh-4rem),700px)] min-h-0 w-full flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">Review item</p>
              <h2 className="mt-1.5 truncate text-[15px] font-semibold text-[var(--ledger-text-primary)]">
                {getDisplayTitle(draft.item)}
              </h2>
              <p className={`mt-1 text-sm ${inboxTheme.bodyText}`}>
                {[getSourceLabel(draft.item), getSourceContext(draft.item), draft.item.author_name].filter(Boolean).join(' · ')}
              </p>
            </div>
            <ModalCloseButton onClick={closeConversion} ariaLabel="Close convert modal" className="shrink-0" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-3">
              <div className="grid grid-cols-5 gap-1 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-1">
                {conversionTypes.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDraft((current) => (current ? { ...current, type: value } : current))}
                    className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-semibold transition ${
                      draft.type === value
                        ? 'bg-[var(--ledger-accent)] text-white'
                        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              <label className="block space-y-1">
                <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Title</span>
                <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className={inboxTheme.field} />
              </label>

              {draft.type === 'project' ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Workspace</span>
                      <input
                        value={activeWorkspace?.name ?? 'Current workspace'}
                        readOnly
                        className="h-10 w-full rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-secondary)] outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Status</span>
                      <div className="relative">
                        <select
                          value={projectStatus}
                          onChange={(event) => setProjectStatus(event.target.value)}
                          className={inboxTheme.select}
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="paused">Paused</option>
                          <option value="completed">Completed</option>
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Brief</span>
                    <textarea
                      value={projectBrief}
                      onChange={(event) => setProjectBrief(event.target.value)}
                      rows={4}
                      className="w-full resize-y rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 py-2.5 text-sm leading-6 text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Start date</span>
                      <input
                        type="date"
                        value={projectStartDate}
                        onChange={(event) => setProjectStartDate(event.target.value)}
                        className={inboxTheme.field}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>End date</span>
                      <input
                        type="date"
                        value={projectEndDate}
                        onChange={(event) => setProjectEndDate(event.target.value)}
                        className={inboxTheme.field}
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Owner team</span>
                      <div className="relative">
                        <select
                          value={projectOwnerTeamId}
                          onChange={(event) => setProjectOwnerTeamId(event.target.value)}
                          className={inboxTheme.select}
                        >
                          <option value="">No team</option>
                          {workspaceTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Lead</span>
                      <div className="relative">
                        <select
                          value={projectLeadId}
                          onChange={(event) => setProjectLeadId(event.target.value)}
                          className={inboxTheme.select}
                        >
                          <option value="">No lead</option>
                          {workspaceMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    </label>
                  </div>
                </div>
              ) : (
                <>
                  <label className="block space-y-1">
                    <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>{draft.type === 'note' ? 'Content' : 'Notes'}</span>
                    <textarea
                      value={draftBody}
                      onChange={(event) => setDraftBody(event.target.value)}
                      rows={draft.type === 'note' ? 5 : 4}
                      className="w-full resize-y rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 py-2.5 text-sm leading-6 text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Workspace</span>
                      <input
                        value={activeWorkspace?.name ?? 'Current workspace'}
                        readOnly
                        className="h-10 w-full rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-secondary)] outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Project</span>
                      <div className="relative">
                        <select
                          value={selectedProjectId}
                          onChange={(event) => setSelectedProjectId(event.target.value)}
                          className={inboxTheme.select}
                        >
                          <option value="">No project</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name || project.title || 'Untitled project'}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    </label>
                  </div>

                  {draft.type === 'note' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Section</span>
                        <div className="relative">
                          <select
                            value={selectedNoteSectionId}
                            onChange={(event) => setSelectedNoteSectionId(event.target.value)}
                            className={inboxTheme.select}
                          >
                            <option value="">No section</option>
                            {noteSections.map((section) => (
                              <option key={section.id} value={section.id}>
                                {section.name || 'Section'}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                          />
                        </div>
                      </label>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Assignee</span>
                      <div className="relative">
                        <select
                          value={selectedAssigneeId}
                          onChange={(event) => setSelectedAssigneeId(event.target.value)}
                          className={inboxTheme.select}
                        >
                          <option value="">No assignee</option>
                          {workspaceMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Team</span>
                      <div className="relative">
                        <select
                          value={selectedTeamId}
                          onChange={(event) => setSelectedTeamId(event.target.value)}
                          className={inboxTheme.select}
                        >
                          <option value="">No team</option>
                          {workspaceTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                        />
                      </div>
                    </label>
                  </div>

                  {(draft.type === 'reminder' || draft.type === 'event') && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Calendar</span>
                        <div className="relative">
                          <select
                            value={selectedCalendarId}
                            onChange={(event) => setSelectedCalendarId(event.target.value)}
                            className={inboxTheme.select}
                          >
                            <option value="">Default calendar</option>
                            {calendars.map((calendar) => (
                              <option key={calendar.id} value={calendar.id}>
                                {calendar.name || 'Calendar'}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                          />
                        </div>
                      </label>
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Linked note</span>
                        <div className="relative">
                          <select
                            value={selectedNoteId}
                            onChange={(event) => setSelectedNoteId(event.target.value)}
                            className={inboxTheme.select}
                          >
                            <option value="">No note</option>
                            {notes.map((note) => (
                              <option key={note.id} value={note.id}>
                                {note.title || 'Untitled note'}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
                          />
                        </div>
                      </label>
                    </div>
                  )}

                  {draft.type === 'task' && (
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ledger-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={showInToday}
                        onChange={(event) => setShowInToday(event.target.checked)}
                        className="h-4 w-4 rounded border-[color:var(--ledger-border-subtle)] text-[var(--ledger-accent)] focus:ring-[var(--ledger-accent)]"
                      />
                      Mark as Today
                    </label>
                  )}

                  {draft.type === 'reminder' && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Remind on</span>
                        <input type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} className={inboxTheme.field} />
                      </label>
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Time</span>
                        <input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} className={inboxTheme.field} />
                      </label>
                    </div>
                  )}

                  {draft.type === 'event' && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Date</span>
                        <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} className={inboxTheme.field} />
                      </label>
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Start</span>
                        <input type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} className={inboxTheme.field} />
                      </label>
                      <label className="block space-y-1">
                        <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Minutes</span>
                        <input type="number" min="15" step="15" value={eventDuration} onChange={(event) => setEventDuration(event.target.value)} className={inboxTheme.field} />
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className={inboxTheme.footer}>
            <p className={`text-xs ${inboxTheme.mutedText}`}>
              {draft.type === 'project'
                ? 'Project context is optional, but title is required.'
                : draft.type === 'reminder'
                ? 'Date and time are required for reminders.'
                : draft.type === 'event'
                  ? 'Date and start time are required for events.'
                  : 'Source context stays attached in the notes.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeConversion}
                className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-4 py-2 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitConversion()}
                disabled={isConverting}
                className="rounded-full bg-[var(--ledger-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
              >
                {isConverting ? 'Creating...' : `Create ${draft.type}`}
              </button>
            </div>
          </div>
        </div>
      </ModalOverlay>
    );

  const selectedItemSourceLabel = selectedItem ? getInspectorSourceLabel(selectedItem) : '';
  const selectedItemMetadata = selectedItem ? getInspectorMetadata(selectedItem) : [];
  const selectedItemPlacement = selectedItem ? getInspectorPlacement(selectedItem) : null;
  const selectedItemSourceUrl =
    selectedItem && isValidExternalUrl(selectedItem.source_url) ? selectedItem.source_url : null;
  const selectedItemStatusLabel = selectedItem ? getStatusLabel(selectedItem.status) : '';
  const selectedItemTypeLabel = selectedItem ? getTypeDisplayLabel(selectedItem) : '';
  const selectedItemOpenAction = selectedItem && selectedItem.status === 'converted'
    ? (() => {
        const convertedType = (selectedItem.converted_type || selectedItem.suggested_type || getDefaultConversionType(selectedItem)) as ConversionType;
        const convertedId = selectedItem.converted_id ?? '';
        if (!convertedId) return null;
        if (convertedType === 'project') {
          return {
            label: 'Open created item',
            onClick: () => void window.desktopWindow?.toggleModule('projects', { focusProjectId: convertedId }),
          };
        }
        if (convertedType === 'note') {
          return {
            label: 'Open created item',
            onClick: () => void window.desktopWindow?.toggleModule('notes', { focusNoteId: convertedId }),
          };
        }
        if (convertedType === 'task') {
          return {
            label: 'Open created item',
            onClick: () => void window.desktopWindow?.toggleModule('dashboard', { focusTaskId: convertedId }),
          };
        }
        if (convertedType === 'event') {
          return {
            label: 'Open created item',
            onClick: () =>
              void window.desktopWindow?.openModule('calendar', {
                kind: 'calendar',
                focusContext: `focus-event:${convertedId}`,
              } as any),
          };
        }
        if (convertedType === 'reminder') {
          return {
            label: 'Open created item',
            onClick: () =>
              void window.desktopWindow?.openModule('calendar', {
                kind: 'calendar',
                focusContext: `focus-reminder:${convertedId}`,
              } as any),
          };
        }
        return null;
      })()
    : null;
  const selectedItemPrimaryAction: InspectorAction | null = selectedItem
    ? selectedItem.status === 'archived'
      ? {
          label: 'Restore',
          onClick: () => void restoreItem(selectedItem),
          loading: activeActionId === selectedItem.id,
          disabled: activeActionId === selectedItem.id,
        }
      : selectedItem.status === 'converted'
      ? selectedItemOpenAction ?? {
          label: 'Open created item',
          onClick: () => undefined,
          disabled: true,
        }
      : {
          label: 'Accept',
          onClick: () => openConversion(selectedItem, getDefaultConversionType(selectedItem)),
        }
    : null;
  const selectedItemSecondaryActions: InspectorAction[] = selectedItem
    ? selectedItem.status === 'unprocessed'
      ? [
          {
            label: 'Snooze',
            onClick: () =>
              setSnoozeMenu({
                x: window.innerWidth - 340,
                y: 220,
                item: selectedItem,
              }),
          },
          {
            label: 'Archive',
            onClick: () => void archiveItem(selectedItem),
            loading: activeActionId === selectedItem.id,
            disabled: activeActionId === selectedItem.id,
          },
        ]
      : selectedItem.status === 'snoozed'
      ? [
          {
            label: 'Change snooze',
            onClick: () =>
              setSnoozeMenu({
                x: window.innerWidth - 340,
                y: 220,
                item: selectedItem,
              }),
          },
          {
            label: 'Archive',
            onClick: () => void archiveItem(selectedItem),
            loading: activeActionId === selectedItem.id,
            disabled: activeActionId === selectedItem.id,
          },
        ]
      : []
    : [];
  const selectedItemDangerAction: InspectorAction | null = selectedItem
    ? {
        label: 'Delete',
        onClick: () => void deleteItem(selectedItem),
        loading: activeActionId === selectedItem.id,
        disabled: activeActionId === selectedItem.id,
      }
    : null;
  const selectedItemPrimaryLoading = Boolean(
    selectedItemPrimaryAction && 'loading' in selectedItemPrimaryAction && selectedItemPrimaryAction.loading
  );
  const selectedItemPrimaryDisabled = Boolean(
    selectedItemPrimaryAction && 'disabled' in selectedItemPrimaryAction && selectedItemPrimaryAction.disabled
  );
  const selectedItemTypeBucket = selectedItem ? getItemTypeBucket(selectedItem) : null;
  const selectedItemPlacementRows = selectedItem
    ? (() => {
        const rows: Array<{ label: string; value: string }> = [{ label: 'Type', value: selectedItemTypeLabel }];
        if (selectedItemTypeBucket === 'project') {
          rows.push(
            { label: 'Owner', value: selectedItemPlacement?.owner ?? 'Not suggested' },
            { label: 'Team', value: selectedItemPlacement?.team ?? 'Not suggested' },
            { label: 'Start date', value: selectedItemPlacement?.startDate ?? 'Not suggested' },
            { label: 'Target date', value: selectedItemPlacement?.targetDate ?? 'Not suggested' }
          );
          return rows;
        }
        if (selectedItemTypeBucket === 'event') {
          rows.push(
            { label: 'Calendar', value: selectedItemPlacement?.calendar ?? 'Not suggested' },
            { label: 'Project', value: selectedItemPlacement?.project ?? 'Not suggested' },
            { label: 'Date', value: selectedItemPlacement?.dueDate ?? 'Not suggested' }
          );
          return rows;
        }
        if (selectedItemTypeBucket === 'note') {
          rows.push(
            { label: 'Section', value: selectedItemPlacement?.section ?? 'Not suggested' },
            { label: 'Project', value: selectedItemPlacement?.project ?? 'Not suggested' }
          );
          return rows;
        }
        if (selectedItemTypeBucket === 'reminder') {
          rows.push(
            { label: 'Project', value: selectedItemPlacement?.project ?? 'Not suggested' },
            { label: 'Due date', value: selectedItemPlacement?.dueDate ?? 'Not suggested' }
          );
          return rows;
        }
        rows.push(
          { label: 'Project', value: selectedItemPlacement?.project ?? 'Not suggested' },
          { label: 'Owner', value: selectedItemPlacement?.owner ?? 'Not suggested' },
          { label: 'Team', value: selectedItemPlacement?.team ?? 'Not suggested' },
          { label: 'Due date', value: selectedItemPlacement?.dueDate ?? 'Not suggested' }
        );
        return rows;
      })()
    : [];

  return (
    <div className={inboxTheme.shell} style={{ scrollbarGutter: 'auto' }}>
      <ModuleWindowHeader
        eyebrow="Ledger"
        title="Intake"
        stripTitle="Intake"
        icon={<Funnel size={20} className="text-[var(--ledger-accent)]" />}
        onClose={() => window.desktopWindow?.closeModule('inbox')}
        onMinimize={() => window.desktopWindow?.minimizeModule('inbox')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('inbox')}
        compact
        showBodyHeader={false}
        stripLeadingActions={(
          <div className="flex min-w-0 items-center gap-2">
            {intakeStatusTabs}
            {intakeFilterDisplayControls}
          </div>
        )}
        globalActions={
          <div className="flex items-center gap-1.5">
            <ModuleHeaderStripAction
              icon={refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              onClick={() => void loadInbox(true, { force: true })}
              title="Refresh Intake"
              ariaLabel="Refresh Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={12} />}
              count={notificationCount}
              onClick={() => window.desktopWindow?.openModule('notifications')}
              title="Open notifications center"
              ariaLabel="Open notifications center"
            />
          </div>
        }
      />

      <div className={`min-h-0 flex-1 overflow-hidden ${inboxTheme.contentShell}`}>
        <div className="flex h-full min-h-0 flex-col px-6 py-5">
          <div className="min-h-0 flex-1 overflow-hidden">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Loader2 size={20} className="mx-auto mb-2 animate-spin text-[var(--ledger-text-muted)]" />
                  <p className={`text-sm ${inboxTheme.mutedText}`}>Loading Intake...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className={`text-sm ${inboxTheme.bodyText}`}>{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadInbox(false, { force: true })}
                    className="mt-2 text-xs font-medium text-[var(--ledger-accent)] transition hover:text-[var(--ledger-accent-hover)]"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-none">
                <section className="min-h-0 overflow-hidden bg-[var(--ledger-surface-card)]">
                  <div className="flex h-12 items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-[var(--ledger-text-primary)]">Queue</span>
                      <span className="text-sm text-[var(--ledger-text-muted)]">{filteredItems.length}</span>
                    </div>
                    {intakeSearchControl}
                  </div>
                  <div className="min-h-0 overflow-y-auto">
                    {filteredItems.length > 0 ? (
                      filteredItems.map(renderRow)
                    ) : (
                      <div className="flex min-h-[280px] items-center justify-center px-6 text-center">
                        <div className="max-w-sm">
                          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-muted)]">
                            <Inbox size={16} />
                          </div>
                          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                            {searchQuery.trim()
                              ? 'No search results.'
                              : activeStatus === 'unprocessed'
                                ? 'No items need review.'
                                : `No ${getStatusLabel(activeStatus).toLowerCase()} items.`}
                          </p>
                          <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                            {searchQuery.trim()
                              ? 'Try a different keyword or clear the search to return to the current tab.'
                              : 'Captured notes, imports, and suggested actions appear here before they enter the workspace.'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <aside className="flex min-h-0 flex-col overflow-hidden border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-none">
                  <div className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4">
                    <span className="text-sm font-medium text-[var(--ledger-text-primary)]">Selected item</span>
                    {selectedItem && <span className="text-xs text-[var(--ledger-text-muted)]">{selectedItemStatusLabel}</span>}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    {selectedItem ? (
                      <div className="space-y-5">
                        <div>
                          <p className={inboxTheme.inspectorLabel}>{selectedItemSourceLabel || 'Intake item'}</p>
                          <div className="mt-1 flex items-start justify-between gap-3">
                            <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-6 text-[var(--ledger-text-primary)]">
                              {getDisplayTitle(selectedItem)}
                            </h2>
                            <span className="shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                              {selectedItemTypeLabel}
                            </span>
                          </div>
                          {selectedItemMetadata.length > 0 && (
                            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">{selectedItemMetadata.join(' · ')}</p>
                          )}
                        </div>

                        <section className="space-y-2">
                          <p className={inboxTheme.inspectorLabel}>Preview</p>
                          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ledger-text-secondary)]">
                            {getDisplayPreview(selectedItem) || 'No preview available.'}
                          </p>
                          {selectedItemSourceUrl ? (
                            <button
                              type="button"
                              onClick={() => window.open(selectedItemSourceUrl, '_blank', 'noopener,noreferrer')}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ledger-accent)] transition hover:text-[var(--ledger-accent-hover)]"
                            >
                              <ExternalLink size={12} />
                              Open source
                            </button>
                          ) : null}
                        </section>

                        <section className="space-y-2">
                          <p className={inboxTheme.inspectorLabel}>Suggested placement</p>
                          <div className="space-y-1">
                            {selectedItemPlacementRows.map((row) => (
                              <InspectorRow key={row.label} label={row.label} value={row.value} />
                            ))}
                          </div>
                        </section>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[240px] items-center justify-center text-center">
                        <div className="max-w-xs">
                          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-muted)]">
                            <Inbox size={15} />
                          </div>
                          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Select an item to review.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="sticky bottom-0 z-10 border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 py-3">
                    {selectedItem ? (
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          {selectedItemSecondaryActions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              onClick={action.onClick}
                              disabled={action.disabled}
                              className="inline-flex h-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {action.loading ? <Loader2 size={11} className="animate-spin" /> : action.label}
                            </button>
                          ))}
                          {selectedItemDangerAction && (
                            <button
                              type="button"
                              onClick={selectedItemDangerAction.onClick}
                              disabled={selectedItemDangerAction.disabled}
                              className="inline-flex h-8 items-center justify-center rounded-full border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] px-3 text-xs font-medium text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.12)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {selectedItemDangerAction.loading ? <Loader2 size={11} className="animate-spin" /> : selectedItemDangerAction.label}
                            </button>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          {selectedItemPrimaryAction && (
                            <button
                              type="button"
                              onClick={selectedItemPrimaryAction.onClick}
                              disabled={selectedItemPrimaryDisabled}
                              className={`inline-flex h-8 items-center justify-center rounded-full px-4 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                selectedItem.status === 'archived'
                                  ? 'border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                                  : 'bg-[var(--ledger-accent)] text-white hover:bg-[var(--ledger-accent-hover)]'
                              }`}
                            >
                              {selectedItemPrimaryLoading ? <Loader2 size={11} className="animate-spin" /> : selectedItemPrimaryAction.label}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--ledger-text-muted)]">Select an item to review.</div>
                    )}
                  </div>
                </aside>
              </div>
            )}
          </div>
        </div>
      </div>

      {filterMenuPortal}
      {displayMenuPortal}
      {snoozeMenuPortal}
      {contextMenuPortal}
      {conversionModal}
    </div>
  );
}

function MenuSectionLabel({ label }: { label: string }) {
  return <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">{label}</div>;
}

function MenuDivider() {
  return <div className="my-2 border-t border-[color:var(--ledger-border-subtle)]" />;
}

function MenuOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
        active
          ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
          : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
      }`}
    >
      <span>{label}</span>
      {active ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" /> : null}
    </button>
  );
}

function ToggleOption({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
    >
      <span>{label}</span>
      <span
        className={`inline-flex h-4 w-7 items-center rounded-full border px-0.5 transition ${
          checked
            ? 'border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)]'
            : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]'
        }`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full bg-white transition ${
            checked ? 'translate-x-2.5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] py-1.5 last:border-b-0">
      <span className="text-[12px] text-[var(--ledger-text-muted)]">{label}</span>
      <span className="min-w-0 truncate text-[12px] text-[var(--ledger-text-secondary)]">{value}</span>
    </div>
  );
}

function titleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
