import {
  Archive,
  Calendar,
  Bell,
  Check,
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
  LayoutList,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  FilePenLine,
  Clock3,
  User,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useSidebar } from '../../context/SidebarContext';
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
import { LinkedDesignsSection } from '../ExternalEmbeds/LinkedDesignsSection';
import { FigmaMark } from '../Common/FigmaMark';

type InboxStatus = 'unprocessed' | 'converted' | 'snoozed' | 'archived';
type ConversionType = 'task' | 'note' | 'reminder' | 'event' | 'project';
type DestinationType = 'task' | 'note' | 'event' | 'reminder';

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
  row: 'group border-b border-[color:var(--ledger-border-subtle)] px-1 py-4 transition',
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
    return (
      url
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0] || url
    );
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
  return cleanText.replace(new RegExp(`\\s*[·-]?\\s*${last}\\s*$`, 'i'), '').trim() || cleanText;
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

const getGithubLifecycleLabel = (item: InboxItem) => {
  const source = normalizeForSearch(item.source_provider || item.source);
  if (!source.includes('github')) return null;
  const raw = getRawPayload(item);
  const state = normalizeForSearch(findDeepString(raw, ['github_lifecycle_state', 'state', 'status']));
  if (state === 'closed') return 'Closed';
  if (state === 'merged') return 'Merged';
  if (state === 'open') return 'Open';
  if (state === 'draft') return 'Draft';
  return null;
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
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(
      2,
      '0'
    )}`,
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
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(
      2,
      '0'
    )}`,
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
  const sourceParts = [getSourceLabel(item), getSourceContext(item), item.author_name].filter(
    Boolean
  );
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

const normalizeForSearch = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

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
  const provider = normalizeForSearch(item.source_provider);
  if (provider.includes('figma') || source.includes('figma')) return 'figma';
  if (provider.includes('github') || source.includes('github')) return 'github';
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
  findDeepString(getRawPayload(item), [
    'created_by_name',
    'created_by',
    'author_name',
    'user_name',
  ]) ||
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
  if (sourceBucket === 'calendar')
    return typeBucket === 'deadline' ? 'Suggested deadline' : 'Calendar item';
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

const getNativeObjectTypeLabel = (item: InboxItem): string | null => {
  const raw = getRawPayload(item);
  const source = normalizeForSearch(item.source_provider || item.source);
  const explicitType = normalizeForSearch(
    findDeepString(raw, [
      'source_object_type',
      'object_type',
      'native_type',
      'resource_type',
      'item_type',
      'github_object_type',
      'node_type',
    ])
  );

  if (source.includes('github')) {
    if (explicitType.includes('pull') || explicitType.includes('pr')) return 'Pull request';
    if (explicitType.includes('discussion')) return 'Discussion';
    if (explicitType.includes('issue') || findDeepString(raw, ['issue_number', 'issue_id', 'issue_url'])) {
      return 'Issue';
    }
    if (findDeepString(raw, ['pull_request_number', 'pull_request_id', 'pull_request_url'])) {
      return 'Pull request';
    }
    return 'Issue';
  }

  if (source.includes('figma')) {
    if (explicitType.includes('prototype')) return 'Prototype';
    if (explicitType.includes('frame')) return 'Frame';
    if (explicitType.includes('page')) return 'Page';
    if (explicitType.includes('file') || findDeepString(raw, ['file_key', 'fileKey'])) return 'File';
    return null;
  }

  if (source.includes('calendar') || source.includes('event')) {
    const type = normalizeForSearch(findDeepString(raw, ['calendar_item_type', 'item_type', 'type', 'kind']));
    if (type.includes('reminder')) return 'Reminder';
    if (type.includes('event')) return 'Event';
    return null;
  }
  if (source.includes('email')) return 'Email';
  if (source.includes('form') || source.includes('submission')) return 'Submission';
  if (source.includes('manual') || source.includes('quick')) return 'Quick capture';
  if (explicitType && !['capture', 'task', 'note', 'event', 'reminder'].includes(explicitType)) {
    return titleCase(explicitType);
  }
  return null;
};

const stripRepeatedPreviewMetadata = (
  value: string,
  sourceMeta: Array<string | null | undefined>,
  isGithub: boolean
) => {
  const metadata = sourceMeta.filter((part): part is string => Boolean(part)).map((part) => normalizeForSearch(part));
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => {
      const normalized = normalizeForSearch(line);
      if (metadata.includes(normalized)) return false;
      if (isGithub && index === 0 && /\b(issue|pull request|discussion)\b/.test(normalized)) {
        return false;
      }
      return true;
    })
    .join('\n');
};

const GithubMark = ({ size = 13, className = '' }: { size?: number; className?: string }) => (
  <img
    src="/github-mark.svg"
    alt=""
    className={className}
    style={{ width: size, height: size }}
  />
);

const getRowIcon = (item: InboxItem) => {
  const sourceBucket = getItemSourceBucket(item);
  const figmaSource = normalizeForSearch(item.source_provider).includes('figma') || normalizeForSearch(item.source).includes('figma');
  const githubSource = normalizeForSearch(item.source_provider).includes('github') || normalizeForSearch(item.source).includes('github');
  if (githubSource) return GithubMark;
  if (figmaSource) return FigmaMark;
  if (sourceBucket === 'browser') return Globe;
  if (sourceBucket === 'meeting') return Calendar;
  if (sourceBucket === 'calendar') return CalendarDays;
  if (sourceBucket === 'slack later') return MessageSquare;
  if (sourceBucket === 'email later') return Mail;
  if (getItemTypeBucket(item) === 'project') return FolderKanban;
  if (sourceBucket === 'manual' || sourceBucket === 'quick capture') return FilePenLine;
  return Sparkles;
};

const snoozeOffset = (
  mode: 'later-today' | 'tomorrow' | 'next-week' | 'pick-date',
  date?: string | null
) => {
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

const INTAKE_CACHE_MAX_AGE = 45_000;
const intakeItemsCache = new Map<string, { updatedAt: number; items: InboxItem[] }>();

export default function IntakeWindow() {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const isPersonalWorkspace = Boolean(activeWorkspace?.is_personal);
  const { workspaceShellLayout } = useSidebar();
  const api = useApi();
  const toast = useToast();

  const initialFocusContext =
    new URLSearchParams(window.location.search).get('focusContext')?.trim() ?? '';
  const initialFocusSection =
    new URLSearchParams(window.location.search).get('section')?.trim() ?? '';
  const initialInboxStatus: InboxStatus = statusLabels.some(
    ({ value }) => value === initialFocusSection
  )
    ? (initialFocusSection as InboxStatus)
    : 'unprocessed';

  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStatus, setActiveStatus] = useState<InboxStatus>(initialInboxStatus);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<IntakeFilterState>(defaultFilters);
  const [display, setDisplay] = useState<IntakeDisplayState>(defaultDisplayState);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<IntakeDraftState | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [activePaneAction, setActivePaneAction] = useState<'primary' | 'archive' | 'delete' | null>(null);
  const [contextMenu, setContextMenu] = useState<IntakeMenuState | null>(null);
  const [filterMenu, setFilterMenu] = useState<MenuAnchorState | null>(null);
  const [displayMenu, setDisplayMenu] = useState<MenuAnchorState | null>(null);
  const [snoozeMenu, setSnoozeMenu] = useState<{ x: number; y: number; item: InboxItem } | null>(
    null
  );
  const [snoozePicker, setSnoozePicker] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [notes, setNotes] = useState<NoteOption[]>([]);
  const [selectedLinkedNoteIds, setSelectedLinkedNoteIds] = useState<string[]>([]);
  const [selectedLinkedProjectIds, setSelectedLinkedProjectIds] = useState<string[]>([]);
  const [noteSections, setNoteSections] = useState<NoteSectionOption[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberOption[]>([]);
  const [workspaceTeams, setWorkspaceTeams] = useState<WorkspaceTeamOption[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const displayButtonRef = useRef<HTMLButtonElement | null>(null);
  const intakePopoverRef = useRef<HTMLDivElement | null>(null);
  const intakePreferencesHydratedRef = useRef(false);
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
  const [destinationType, setDestinationType] = useState<DestinationType>('task');
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
  const [linkGithubRepositoryOnProject, setLinkGithubRepositoryOnProject] = useState(false);
  const [githubProjectRepositories, setGithubProjectRepositories] = useState<Array<{ id: string | number; github_repository_id: string; full_name: string; is_private?: boolean; is_archived?: boolean }>>([]);

  useEffect(() => {
    if (!isPersonalWorkspace) return;
    setFilters(defaultFilters);
    setDisplay((current) => ({ ...current, showAssignee: false }));
    setSelectedAssigneeId('');
    setSelectedTeamId('');
    setProjectLeadId('');
    setProjectOwnerTeamId('');
  }, [isPersonalWorkspace]);

  useEffect(() => {
    intakePreferencesHydratedRef.current = false;
    if (!activeWorkspaceId) {
      setFilters(defaultFilters);
      setDisplay(defaultDisplayState);
      return;
    }

    try {
      const stored = JSON.parse(
        window.localStorage.getItem(`ledger:intake:preferences:v1:${activeWorkspaceId}`) || 'null'
      ) as { filters?: Partial<IntakeFilterState>; display?: Partial<IntakeDisplayState> } | null;
      const nextFilters: IntakeFilterState = { ...defaultFilters, ...(stored?.filters ?? {}) };
      const nextDisplay: IntakeDisplayState = {
        ...defaultDisplayState,
        ...(stored?.display ?? {}),
      };
      if (!['all', 'today', 'week', 'older'].includes(nextFilters.created)) {
        nextFilters.created = 'all';
      }
      if (!['newest', 'oldest'].includes(nextDisplay.order)) {
        nextDisplay.order = 'newest';
      }
      setFilters(nextFilters);
      setDisplay(isPersonalWorkspace ? { ...nextDisplay, showAssignee: false } : nextDisplay);
    } catch {
      setFilters(defaultFilters);
      setDisplay(defaultDisplayState);
    } finally {
      intakePreferencesHydratedRef.current = true;
    }
  }, [activeWorkspaceId, isPersonalWorkspace]);

  useEffect(() => {
    if (!activeWorkspaceId || !intakePreferencesHydratedRef.current) return;
    try {
      window.localStorage.setItem(
        `ledger:intake:preferences:v1:${activeWorkspaceId}`,
        JSON.stringify({ filters, display })
      );
    } catch {
      // Keep Intake preferences usable when browser storage is unavailable.
    }
  }, [activeWorkspaceId, display, filters]);

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
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note] as const)), [notes]);
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
    const cached = intakeItemsCache.get(activeWorkspaceId);
    if (cached) {
      setItems(cached.items);
      if (!opts?.force && now - cached.updatedAt < INTAKE_CACHE_MAX_AGE) {
        setIsLoading(false);
        return;
      }
    }
    if (!opts?.force) {
      if (loadInboxInFlightRef.current) return;
      if (now - loadInboxAtRef.current < inboxCooldownMs) return;
    }
    loadInboxInFlightRef.current = true;
    loadInboxAtRef.current = now;

    if (showSpinner) setRefreshing(true);
    else if (!cached) setIsLoading(true);
    setError(null);

    try {
      const [unprocessed, converted, snoozed, archived] = await Promise.all([
        api.getInboxItems({ status: 'unprocessed' }),
        api.getInboxItems({ status: 'converted' }),
        api.getInboxItems({ status: 'snoozed' }),
        api.getInboxItems({ status: 'archived' }),
      ]);
      const nextItems = [
        ...(Array.isArray(unprocessed) ? unprocessed : []),
        ...(Array.isArray(converted) ? converted : []),
        ...(Array.isArray(snoozed) ? snoozed : []),
        ...(Array.isArray(archived) ? archived : []),
      ] as InboxItem[];
      intakeItemsCache.set(activeWorkspaceId, { updatedAt: Date.now(), items: nextItems });
      setItems(nextItems);
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
      const payload = (await api.getNotificationCenterSummary()) as {
        counts?: { active?: number };
      };
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

    window.addEventListener(
      'ledger:notifications-summary',
      handleNotificationsSummary as EventListener
    );
    window.addEventListener('ledger:notifications-updated', handleNotificationsUpdated);
    window.addEventListener('focus', refreshNotifications);
    document.addEventListener('visibilitychange', refreshNotifications);

    return () => {
      cancelled = true;
      window.removeEventListener(
        'ledger:notifications-summary',
        handleNotificationsSummary as EventListener
      );
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
        const [
          projectPayload,
          calendarPayload,
          notePayload,
          sectionPayload,
          membersPayload,
          teamsPayload,
        ] = await Promise.allSettled([
          api.getProjects({ includeCompleted: false }),
          api.getCalendars(),
          api.getNotes(),
          api.getSections(),
          api.getWorkspaceMembers(activeWorkspaceId),
          api.getTeams(),
        ]);

        if (cancelled) return;

        setProjects(
          projectPayload.status === 'fulfilled' && Array.isArray(projectPayload.value)
            ? projectPayload.value
            : []
        );
        setCalendars(
          calendarPayload.status === 'fulfilled' && Array.isArray(calendarPayload.value)
            ? calendarPayload.value
            : []
        );
        setNotes(
          notePayload.status === 'fulfilled' && Array.isArray(notePayload.value)
            ? notePayload.value
            : []
        );
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
          membersPayload.status === 'fulfilled' &&
          Array.isArray(
            (membersPayload.value as { members?: Array<Record<string, unknown>> })?.members
          )
            ? ((membersPayload.value as { members?: Array<Record<string, unknown>> }).members ?? [])
                .map((member) => {
                  const name =
                    String(member.full_name ?? '').trim() ||
                    String(member.email ?? '').split('@')[0] ||
                    'Workspace member';
                  return {
                    id: String(member.user_id ?? ''),
                    name,
                    email: member.email ? String(member.email) : null,
                  };
                })
                .filter((member) => member.id)
            : [];

        const mappedTeams =
          teamsPayload.status === 'fulfilled'
            ? getArrayFromPayload(teamsPayload.value, 'teams')
                .map((team: any) => ({
                  id: String(team.id ?? ''),
                  name: String(team.name ?? 'Team'),
                  identifier: team.identifier ? String(team.identifier) : null,
                }))
                .filter((team) => team.id)
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
    const applyFocusSection = (focusSection: string | null | undefined) => {
      if (!statusLabels.some(({ value }) => value === focusSection)) return;
      setActiveStatus(focusSection as InboxStatus);
      setSelectedItemId(null);
    };

    const applyTeamFocusContext = (focusContext: string | null | undefined) => {
      const raw = String(focusContext ?? '').trim();
      if (!raw.startsWith('team:')) return;
      const teamId = raw.slice('team:'.length).trim();
      if (!teamId) return;
      setActiveStatus('unprocessed');
      setFilters((current) => ({ ...current, assignee: `team:${teamId}` }));
      setSelectedItemId(null);
    };

    applyFocusSection(initialFocusSection);
    applyTeamFocusContext(initialFocusContext);

    const focusContextListener = (
      _event: unknown,
      payload: { kind?: string; focusContext?: string | null }
    ) => {
      if (payload?.kind !== 'inbox') return;
      applyTeamFocusContext(payload.focusContext);
    };

    window.ipcRenderer?.on('module:focus-context', focusContextListener);

    // `openModule` can target an already-open Intake window. The main process
    // forwards section changes through this event so the existing window still
    // lands on the requested queue.
    return () => {
      window.ipcRenderer?.off('module:focus-context', focusContextListener);
    };
  }, [initialFocusContext, initialFocusSection]);

  useEffect(() => {
    const focusSectionListener = (
      _event: unknown,
      payload: { kind?: string; focusSection?: string | null }
    ) => {
      if (payload?.kind !== 'inbox') return;
      if (!statusLabels.some(({ value }) => value === payload.focusSection)) return;
      setActiveStatus(payload.focusSection as InboxStatus);
      setSelectedItemId(null);
    };

    window.ipcRenderer?.on('module:focus-section', focusSectionListener);
    return () => {
      window.ipcRenderer?.off('module:focus-section', focusSectionListener);
    };
  }, []);

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
    const closeMenusOnScroll = (event: Event) => {
      if (intakePopoverRef.current?.contains(event.target as Node)) return;
      closeMenus();
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
    window.addEventListener('scroll', closeMenusOnScroll, true);
    window.addEventListener('resize', closeMenus);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenus);
      window.removeEventListener('scroll', closeMenusOnScroll, true);
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
    const statusCounts = statusLabels.reduce<Record<InboxStatus, number>>(
      (acc, status) => {
        acc[status.value] = items.filter((item) => item.status === status.value).length;
        return acc;
      },
      { unprocessed: 0, converted: 0, snoozed: 0, archived: 0 }
    );
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
        const projectText = normalizeForSearch(
          [project?.name, project?.title, project?.id].filter(Boolean).join(' ')
        );
        if (projectText && !getSearchCorpus(item).includes(projectText)) return false;
      }

      if (filters.assignee !== 'all') {
        if (filters.assignee === 'me') {
          const userMatch = workspaceMembers.find((member) => member.id === currentUserId);
          const meText = normalizeForSearch(
            [userMatch?.name, userMatch?.email, currentUserId].filter(Boolean).join(' ')
          );
          if (meText && !getSearchCorpus(item).includes(meText)) return false;
        } else if (filters.assignee === 'unassigned') {
          const assigneeText = [getItemAssigneeLabel(item), getItemTeamLabel(item)]
            .filter(Boolean)
            .join(' ');
          if (assigneeText) return false;
        } else if (filters.assignee.startsWith('member:')) {
          const memberId = filters.assignee.slice('member:'.length);
          const member = workspaceMembers.find((entry) => entry.id === memberId);
          const memberText = normalizeForSearch(
            [member?.name, member?.email, member?.id].filter(Boolean).join(' ')
          );
          if (memberText && !getSearchCorpus(item).includes(memberText)) return false;
        } else if (filters.assignee.startsWith('team:')) {
          const teamId = filters.assignee.slice('team:'.length);
          const team = workspaceTeams.find((entry) => entry.id === teamId);
          const teamText = normalizeForSearch(
            [team?.name, team?.identifier, team?.id].filter(Boolean).join(' ')
          );
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
  }, [
    activeStatus,
    display.order,
    filters.assignee,
    filters.created,
    filters.project,
    filters.source,
    filters.type,
    items,
    projects,
    searchQuery,
    user?.id,
    workspaceMembers,
    workspaceTeams,
  ]);

  const selectedItem = useMemo(() => {
    if (selectedItemId) {
      const fromAll = items.find((item) => item.id === selectedItemId);
      if (fromAll && filteredItems.some((item) => item.id === fromAll.id)) return fromAll;
    }
    return filteredItems[0] ?? null;
  }, [filteredItems, items, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    const raw = getRawPayload(selectedItem);
    const suggested = normalizeForSearch(selectedItem.suggested_type || '');
    const nextDestination: DestinationType = ['task', 'note', 'event', 'reminder'].includes(suggested)
      ? suggested as DestinationType
      : 'task';
    const projectId = selectedItem.suggested_project_id || findDeepString(raw, ['suggested_project_id', 'project_id', 'linked_project_id']) || '';
    const assigneeId = selectedItem.suggested_assignee_id || findDeepString(raw, ['suggested_assignee_id', 'assigned_to_user_id', 'assignee_id', 'owner_id']) || '';
    const teamId = findDeepString(raw, ['suggested_team_id', 'suggested_owner_team_id', 'assigned_to_team_id', 'owner_team_id']) || '';
    const calendarId = selectedItem.suggested_calendar_id || findDeepString(raw, ['suggested_calendar_id', 'calendar_id']) || '';
    const noteId = findDeepString(raw, ['note_id', 'linked_note_id']) || '';
    setDestinationType(nextDestination);
    setSelectedProjectId(projectId && projectsById.has(projectId) ? projectId : '');
    setSelectedAssigneeId(assigneeId && membersById.has(assigneeId) ? assigneeId : '');
    setSelectedTeamId(teamId && teamsById.has(teamId) ? teamId : '');
    setSelectedCalendarId(calendarId && calendarsById.has(calendarId) ? calendarId : '');
    setSelectedNoteId(noteId && notesById.has(noteId) ? noteId : '');
    setReminderDate(selectedItem.suggested_due_at?.slice(0, 10) || selectedItem.suggested_date?.slice(0, 10) || '');
    setEventDate(selectedItem.suggested_date?.slice(0, 10) || selectedItem.suggested_due_at?.slice(0, 10) || '');
  }, [selectedItem?.id, projectsById, membersById, teamsById, calendarsById, notesById]);

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

  const getInspectorSourceLabel = (item: InboxItem) => {
    const explicitLabel = String(item.source_label ?? '').trim();
    if (explicitLabel) return explicitLabel;
    const source = normalizeForSearch(item.source);
    const provider = normalizeForSearch(item.source_provider);
    if (source.includes('slack') || provider === 'slack') return 'Slack import';
    if (source.includes('browser')) return 'Browser save';
    if (source.includes('meeting') || provider === 'zoom' || provider === 'meet')
      return 'Meeting output';
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
      if (item.source_url && isValidExternalUrl(item.source_url))
        parts.push(getDomain(item.source_url));
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

  const openConversion = (item: InboxItem, type?: ConversionType) => {
    const nextType = type ?? getDefaultConversionType(item);
    const raw = getRawPayload(item);
    const githubRepositoryId = findDeepString(raw, ['githubRepositoryId', 'github_repository_id', 'repository_id']);
    const seed = `${item.title}\n${item.body ?? ''}`;
    const reminderDefaults = defaultReminderAt(seed);
    const eventDefaults = defaultEventStart(seed);
    const projectId =
      item.suggested_project_id ||
      findDeepString(raw, ['suggested_project_id', 'project_id', 'linked_project_id']);
    const assigneeId =
      item.suggested_assignee_id ||
      findDeepString(raw, [
        'suggested_assignee_id',
        'assigned_to_user_id',
        'assignee_id',
        'owner_id',
      ]);
    const teamId = findDeepString(raw, [
      'suggested_team_id',
      'suggested_owner_team_id',
      'assigned_to_team_id',
      'owner_team_id',
    ]);
    const calendarId =
      item.suggested_calendar_id || findDeepString(raw, ['suggested_calendar_id', 'calendar_id']);
    const sectionId =
      item.suggested_note_section_id ||
      findDeepString(raw, ['suggested_note_section_id', 'section_id', 'note_section_id']);
    const projectDefaults = {
      brief: cleanSlackText(item.body ?? '') || getItemReason(item) || '',
      startDate: findDeepString(raw, ['start_date', 'project_start_date']) || '',
      endDate: findDeepString(raw, ['end_date', 'project_end_date']) || '',
      status:
        normalizeForSearch(findDeepString(raw, ['status', 'project_status']) ?? '') ||
        'not_started',
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
    setLinkGithubRepositoryOnProject(Boolean(item.source_provider === 'github' || item.source === 'github') && Boolean(githubRepositoryId));
    if (item.source_provider === 'github' || item.source === 'github') {
      void api.getGithubRepositories().then((payload) => setGithubProjectRepositories(Array.isArray(payload) ? payload as typeof githubProjectRepositories : [])).catch(() => setGithubProjectRepositories([]));
    } else {
      setGithubProjectRepositories([]);
    }
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

  const snoozeItem = async (
    item: InboxItem,
    mode: 'later-today' | 'tomorrow' | 'next-week' | 'pick-date',
    date?: string | null
  ) => {
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
        assigned_to_user_id: isPersonalWorkspace ? null : selectedAssigneeId || null,
        assigned_to_team_id: isPersonalWorkspace ? null : selectedTeamId || null,
        github_repository_id: draft.type === 'project' && linkGithubRepositoryOnProject ? findDeepString(getRawPayload(draft.item), ['githubRepositoryId', 'github_repository_id', 'repository_id']) || null : null,
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
          lead_id: isPersonalWorkspace ? null : projectLeadId || null,
          owner_team_id: isPersonalWorkspace ? null : projectOwnerTeamId || null,
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
        const endAt = new Date(
          new Date(startAt).getTime() + durationMinutes * 60 * 1000
        ).toISOString();
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
      toast.show(`Created ${draft.type} from ${getSourceLabel(draft.item)} intake item.`, {
        variant: 'success',
      });
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
    setFilterMenu({ x: rect.right, y: rect.bottom + 8 });
    setDisplayMenu(null);
  };

  const openDisplayMenu = () => {
    const rect = displayButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDisplayMenu({ x: rect.right, y: rect.bottom + 8 });
    setFilterMenu(null);
  };

  const activeFilterCount = [
    filters.source !== 'all',
    filters.type !== 'all',
    filters.project !== 'all',
    filters.assignee !== 'all',
    filters.created !== 'all',
  ].filter(Boolean).length;
  const isDisplayCustomized =
    display.order !== defaultDisplayState.order ||
    display.showSource !== defaultDisplayState.showSource ||
    display.showStatus !== defaultDisplayState.showStatus ||
    display.showProject !== defaultDisplayState.showProject ||
    display.showAssignee !== defaultDisplayState.showAssignee ||
    display.showCreated !== defaultDisplayState.showCreated;

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
        buttonRef={filterButtonRef}
        icon={
          <span className="relative inline-flex">
            <SlidersHorizontal size={14} />
            {activeFilterCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-0.5 text-[9px] font-semibold leading-none text-white">
                {activeFilterCount > 9 ? '9+' : activeFilterCount}
              </span>
            )}
          </span>
        }
        onClick={openFilterMenu}
        active={activeFilterCount > 0}
        title="Filter intake"
        ariaLabel="Filter intake"
      >
        <></>
      </ModuleHeaderActionButton>
      <ModuleHeaderActionButton
        variant="strip"
        iconOnly
        buttonRef={displayButtonRef}
        icon={<LayoutList size={14} />}
        onClick={openDisplayMenu}
        active={isDisplayCustomized}
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
      getGithubLifecycleLabel(item),
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
          selected ? 'bg-[var(--ledger-surface-muted)]' : 'hover:bg-[var(--ledger-surface-muted)]'
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
                {activeActionId === item.id ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  'Restore'
                )}
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
                {activeActionId === item.id ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  'Delete'
                )}
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
                {activeActionId === item.id ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  'Archive'
                )}
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
              left: Math.min(Math.max(12, state.x - width), window.innerWidth - width - 12),
              top: Math.min(state.y, window.innerHeight - 12),
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div
              ref={intakePopoverRef}
              className="max-h-[min(560px,calc(100vh-24px))] overflow-y-auto overflow-x-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_14px_34px_rgba(15,23,42,0.12)]"
              style={{ width }}
            >
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
            <button
              type="button"
              onClick={() => openConversion(contextMenu.item, 'project')}
              className={sidebarTheme.menuItem}
            >
              Turn into project
            </button>
          )}
          {contextMenu.item.source_url && (
            <button
              type="button"
              onClick={() =>
                window.open(contextMenu.item.source_url ?? '', '_blank', 'noopener,noreferrer')
              }
              className={sidebarTheme.menuItem}
            >
              Open
            </button>
          )}
          {contextMenu.item.status === 'unprocessed' && (
            <button
              type="button"
              onClick={() =>
                openConversion(contextMenu.item, getDefaultConversionType(contextMenu.item))
              }
              className={sidebarTheme.menuItem}
            >
              Accept
            </button>
          )}
          {contextMenu.item.status === 'archived' ? (
            <button
              type="button"
              onClick={() => void restoreItem(contextMenu.item)}
              className={sidebarTheme.menuItem}
            >
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openConversion(contextMenu.item, 'task')}
                className={sidebarTheme.menuItem}
              >
                Turn into task
              </button>
              <button
                type="button"
                onClick={() => openConversion(contextMenu.item, 'note')}
                className={sidebarTheme.menuItem}
              >
                Turn into note
              </button>
              <button
                type="button"
                onClick={() =>
                  setSnoozeMenu({ x: contextMenu.x, y: contextMenu.y, item: contextMenu.item })
                }
                className={sidebarTheme.menuItem}
              >
                Snooze
              </button>
              <button
                type="button"
                onClick={() => void archiveItem(contextMenu.item)}
                className={sidebarTheme.menuItem}
              >
                Archive
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void deleteItem(contextMenu.item)}
            className={sidebarTheme.menuItemDanger}
          >
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
      {[
        'all',
        'quick capture',
        'browser',
        'meeting',
        'calendar',
        'figma',
        'github',
        'manual',
        'slack later',
        'email later',
      ].map((value) => (
        <MenuOption
          key={value}
          label={value === 'all' ? 'All sources' : titleCase(value)}
          active={filters.source === value}
          onClick={() => setFilters((current) => ({ ...current, source: value }))}
        />
      ))}
      <MenuDivider />
      <MenuSectionLabel label="Type" />
      {[
        'all',
        'task',
        'note',
        'event',
        'reminder',
        'deadline',
        'project',
        'milestone',
        'capture',
      ].map((value) => (
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
      {!isPersonalWorkspace && (
        <>
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
              onClick={() =>
                setFilters((current) => ({ ...current, assignee: `member:${member.id}` }))
              }
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
        </>
      )}
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
        onToggle={() =>
          setDisplay((current) => ({ ...current, showProject: !current.showProject }))
        }
      />
      {!isPersonalWorkspace && (
        <ToggleOption
          label="Assignee"
          checked={display.showAssignee}
          onToggle={() =>
            setDisplay((current) => ({ ...current, showAssignee: !current.showAssignee }))
          }
        />
      )}
      <ToggleOption
        label="Created"
        checked={display.showCreated}
        onToggle={() =>
          setDisplay((current) => ({ ...current, showCreated: !current.showCreated }))
        }
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
          <button
            type="button"
            className={sidebarTheme.menuItem}
            onClick={() => void snoozeItem(snoozeMenu.item, 'later-today')}
          >
            Later today
          </button>
          <button
            type="button"
            className={sidebarTheme.menuItem}
            onClick={() => void snoozeItem(snoozeMenu.item, 'tomorrow')}
          >
            Tomorrow
          </button>
          <button
            type="button"
            className={sidebarTheme.menuItem}
            onClick={() => void snoozeItem(snoozeMenu.item, 'next-week')}
          >
            Next week
          </button>
          <button
            type="button"
            className={sidebarTheme.menuItem}
            onClick={() =>
              setSnoozePicker(snoozePicker === snoozeMenu.item.id ? null : snoozeMenu.item.id)
            }
          >
            Pick date
          </button>
          {snoozePicker === snoozeMenu.item.id && (
            <div className="border-t border-[color:var(--ledger-border-subtle)] px-3 py-3">
              <input
                type="date"
                className={inboxTheme.fieldSoft}
                onChange={(event) =>
                  void snoozeItem(snoozeMenu.item, 'pick-date', event.target.value)
                }
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
              {[getSourceLabel(draft.item), getSourceContext(draft.item), draft.item.author_name]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <ModalCloseButton
            onClick={closeConversion}
            ariaLabel="Close convert modal"
            className="shrink-0"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="grid gap-3">
            <div className="grid grid-cols-5 gap-1 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-1">
              {conversionTypes.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setDraft((current) => (current ? { ...current, type: value } : current))
                  }
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
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className={inboxTheme.field}
              />
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

                {linkGithubRepositoryOnProject && githubProjectRepositories.length > 0 && (
                  <label className="flex items-start gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2.5 text-xs text-[var(--ledger-text-secondary)]">
                    <input type="checkbox" checked={linkGithubRepositoryOnProject} onChange={(event) => setLinkGithubRepositoryOnProject(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-[color:var(--ledger-border-subtle)] text-[var(--ledger-accent)]" />
                    <span>Link {githubProjectRepositories.find((repository) => String(repository.github_repository_id) === findDeepString(getRawPayload(draft.item), ['githubRepositoryId', 'github_repository_id', 'repository_id']))?.full_name ?? 'the GitHub repository'} as this project’s primary repository</span>
                  </label>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                      Start date
                    </span>
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

                {!isPersonalWorkspace && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                        Owner team
                      </span>
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
                )}
              </div>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                    {draft.type === 'note' ? 'Content' : 'Notes'}
                  </span>
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

                {!isPersonalWorkspace && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                        Assignee
                      </span>
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
                )}

                {(draft.type === 'reminder' || draft.type === 'event') && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                        Calendar
                      </span>
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
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                        Linked note
                      </span>
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
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>
                        Remind on
                      </span>
                      <input
                        type="date"
                        value={reminderDate}
                        onChange={(event) => setReminderDate(event.target.value)}
                        className={inboxTheme.field}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Time</span>
                      <input
                        type="time"
                        value={reminderTime}
                        onChange={(event) => setReminderTime(event.target.value)}
                        className={inboxTheme.field}
                      />
                    </label>
                  </div>
                )}

                {draft.type === 'event' && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Date</span>
                      <input
                        type="date"
                        value={eventDate}
                        onChange={(event) => setEventDate(event.target.value)}
                        className={inboxTheme.field}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Start</span>
                      <input
                        type="time"
                        value={eventTime}
                        onChange={(event) => setEventTime(event.target.value)}
                        className={inboxTheme.field}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={`text-xs font-medium ${inboxTheme.mutedText}`}>Minutes</span>
                      <input
                        type="number"
                        min="15"
                        step="15"
                        value={eventDuration}
                        onChange={(event) => setEventDuration(event.target.value)}
                        className={inboxTheme.field}
                      />
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
  const selectedItemSourceUrl =
    selectedItem && isValidExternalUrl(selectedItem.source_url) ? selectedItem.source_url : null;
  const selectedItemIsFigma = Boolean(
    selectedItem &&
      (normalizeForSearch(selectedItem.source_provider).includes('figma') ||
        normalizeForSearch(selectedItem.source).includes('figma'))
  );
  const selectedItemIsGithub = Boolean(
    selectedItem &&
      (normalizeForSearch(selectedItem.source_provider).includes('github') ||
        normalizeForSearch(selectedItem.source).includes('github'))
  );
  const selectedFigmaPayload = selectedItemIsFigma && selectedItem ? getRawPayload(selectedItem) : {};
  const selectedFigmaNodeName = findDeepString(selectedFigmaPayload, ['node_name', 'nodeName']);
  const selectedFigmaFileName = findDeepString(selectedFigmaPayload, ['file_name', 'fileName']);
  const selectedItemStatusLabel = selectedItem ? getStatusLabel(selectedItem.status) : '';
  const selectedItemGithubLifecycleLabel = selectedItem ? getGithubLifecycleLabel(selectedItem) : null;
  const selectedItemNativeTypeLabel = selectedItem ? getNativeObjectTypeLabel(selectedItem) : null;
  const destinationNeedsSchedule = destinationType === 'event' || destinationType === 'reminder';
  const destinationValidationError =
    destinationType === 'event' && (!eventDate || !eventTime)
      ? 'Choose an event date and start time.'
      : destinationType === 'reminder' && (!reminderDate || !reminderTime)
      ? 'Choose a reminder date and time.'
      : null;
  const selectedItemPreview = selectedItem
    ? (() => {
        const raw = getRawPayload(selectedItem);
        const source = normalizeForSearch(selectedItem.source_provider || selectedItem.source);
        const isGithubSource = source.includes('github');
        const isFigmaSource = source.includes('figma');
        const title = getDisplayTitle(selectedItem).replace(
          /^(github|figma)\s+(issue|pull request|repository|file|design)\s*[·:-]\s*/i,
          ''
        );
        const repository = findDeepString(raw, [
          'repository_full_name',
          'repositoryFullName',
          'full_name',
          'repository',
        ]);
        const rawNumber = findDeepString(raw, ['issue_number', 'pull_request_number', 'number']);
        const number = rawNumber && /^\d+$/.test(rawNumber) ? rawNumber : '';
        const state = findDeepString(raw, ['state', 'status']);
        const sourceMeta = isGithubSource
          ? [repository, number ? `#${number}` : '', state].filter(Boolean)
          : isFigmaSource
          ? [
              findDeepString(raw, ['file_name', 'fileName']),
              findDeepString(raw, ['page_name', 'pageName']),
              findDeepString(raw, ['node_name', 'nodeName']),
            ].filter(Boolean)
          : [getSourceContext(selectedItem), selectedItem.author_name].filter(Boolean);
        const rawDescription = cleanSlackText(
          selectedItem.body ||
            (isFigmaSource ? findDeepString(raw, ['description', 'details', 'text', 'message', 'content', 'node_description', 'nodeDescription']) : null) ||
            findDeepString(raw, ['description', 'text', 'message', 'content']) ||
            getItemReason(selectedItem) ||
            (isFigmaSource ? 'Figma resource linked from this intake item.' : '')
        );
        const description = stripRepeatedPreviewMetadata(rawDescription, sourceMeta, isGithubSource);
        return { title, sourceMeta, description };
      })()
    : null;
  const selectedItemOpenAction =
    selectedItem && selectedItem.status === 'converted'
      ? (() => {
          const convertedType = (selectedItem.converted_type ||
            selectedItem.suggested_type ||
            getDefaultConversionType(selectedItem)) as ConversionType;
          const convertedId = selectedItem.converted_id ?? '';
          if (!convertedId) return null;
          if (convertedType === 'project') {
            return {
              label: 'Open created item',
              onClick: () =>
                void window.desktopWindow?.toggleModule('projects', {
                  focusProjectId: convertedId,
                }),
            };
          }
          if (convertedType === 'note') {
            return {
              label: 'Open created item',
              onClick: () =>
                void window.desktopWindow?.toggleModule('notes', { focusNoteId: convertedId }),
            };
          }
          if (convertedType === 'task') {
            return {
              label: 'Open created item',
              onClick: () =>
                void window.desktopWindow?.toggleModule('dashboard', { focusTaskId: convertedId }),
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
  const acceptAsDestination = async (
    item: InboxItem,
    type: DestinationType
  ) => {
    setActiveActionId(item.id);
    try {
      const body = buildDefaultBody(item).trim();
      const basePayload = {
        title: getDisplayTitle(item),
        body,
        project_id: selectedProjectId || null,
        note_id: selectedNoteId || null,
        calendar_id: selectedCalendarId || null,
        assigned_to_user_id: isPersonalWorkspace ? null : selectedAssigneeId || null,
        assigned_to_team_id: isPersonalWorkspace ? null : selectedTeamId || null,
      };
      if (type === 'task') {
        await api.convertIntakeItem(item.id, {
          ...basePayload,
          type,
          notes: body,
          show_in_today: showInToday,
          task_horizon: showInToday ? 'today' : 'long_term',
        });
      } else if (type === 'note') {
        await api.convertIntakeItem(item.id, {
          ...basePayload,
          type,
          body,
          section_id: selectedNoteSectionId || null,
        });
      } else if (type === 'reminder') {
        if (!reminderDate || !reminderTime) throw new Error('Choose a reminder date and time.');
        await api.convertIntakeItem(item.id, {
          ...basePayload,
          type,
          remind_at: new Date(`${reminderDate}T${reminderTime}:00`).toISOString(),
          notes: body,
        });
      } else {
        if (!eventDate || !eventTime) throw new Error('Choose an event date and start time.');
        const startAt = new Date(`${eventDate}T${eventTime}:00`);
        await api.convertIntakeItem(item.id, {
          ...basePayload,
          type,
          start_at: startAt.toISOString(),
          end_at: new Date(startAt.getTime() + 30 * 60 * 1000).toISOString(),
          notes: body,
        });
      }
      await loadInbox(true, { force: true });
      emitInboxItemsUpdated(item.status === 'unprocessed' ? -1 : 0);
      toast.show(`Created ${type} from ${getSourceLabel(item)} intake item.`, { variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : `Could not create ${type}.`;
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setActiveActionId(null);
    }
  };
  const runPaneAction = (kind: 'primary' | 'archive' | 'delete', action: () => Promise<void>) => {
    setActivePaneAction(kind);
    void action().finally(() => setActivePaneAction(null));
  };
  const selectedItemPrimaryAction: InspectorAction | null = selectedItem
    ? selectedItem.status === 'archived'
      ? {
          label: 'Restore',
          onClick: () => runPaneAction('primary', () => restoreItem(selectedItem)),
          loading: activePaneAction === 'primary',
          disabled: activePaneAction !== null || activeActionId === selectedItem.id,
        }
      : selectedItem.status === 'converted'
      ? selectedItemOpenAction ?? {
          label: 'Open created item',
          onClick: () => undefined,
          disabled: true,
        }
      : {
          label: 'Accept',
          onClick: () => runPaneAction('primary', () => acceptAsDestination(selectedItem, destinationType)),
          loading: activePaneAction === 'primary',
          disabled: Boolean(destinationValidationError) || activePaneAction !== null || activeActionId === selectedItem.id,
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
            disabled: activePaneAction !== null || activeActionId === selectedItem.id,
          },
          {
            label: 'Archive',
            onClick: () => runPaneAction('archive', () => archiveItem(selectedItem)),
            loading: activePaneAction === 'archive',
            disabled: activePaneAction !== null || activeActionId === selectedItem.id,
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
            disabled: activePaneAction !== null || activeActionId === selectedItem.id,
          },
          {
            label: 'Archive',
            onClick: () => runPaneAction('archive', () => archiveItem(selectedItem)),
            loading: activePaneAction === 'archive',
            disabled: activePaneAction !== null || activeActionId === selectedItem.id,
          },
        ]
      : []
    : [];
  const selectedItemDangerAction: InspectorAction | null = selectedItem
    ? {
        label: 'Delete',
        onClick: () => runPaneAction('delete', () => deleteItem(selectedItem)),
        loading: activePaneAction === 'delete',
        disabled: activePaneAction !== null || activeActionId === selectedItem.id,
      }
    : null;
  const selectedItemPrimaryLoading = Boolean(
    selectedItemPrimaryAction &&
      'loading' in selectedItemPrimaryAction &&
      selectedItemPrimaryAction.loading
  );
  const selectedItemPrimaryDisabled = Boolean(
    selectedItemPrimaryAction &&
      'disabled' in selectedItemPrimaryAction &&
      selectedItemPrimaryAction.disabled
  );
  return (
    <div
      className={inboxTheme.shell}
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
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
        stripLeadingActions={
          <div className="flex min-w-0 items-center gap-2">
            {intakeStatusTabs}
            {intakeFilterDisplayControls}
          </div>
        }
        globalActions={
          <div className="flex items-center gap-1.5">
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
          </div>
        }
        secondaryActions={
          <ModuleHeaderStripAction
            icon={
              refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />
            }
            onClick={() => void loadInbox(true, { force: true })}
            title="Refresh Intake"
            ariaLabel="Refresh Intake"
          />
        }
      />

      <div className={`min-h-0 flex-1 overflow-hidden ${inboxTheme.contentShell}`}>
        <div className="flex h-full min-h-0 flex-col px-6 py-5">
          <div className="min-h-0 flex-1 overflow-hidden">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Loader2
                    size={20}
                    className="mx-auto mb-2 animate-spin text-[var(--ledger-text-muted)]"
                  />
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
                      <span className="text-sm font-medium text-[var(--ledger-text-primary)]">
                        {getStatusLabel(activeStatus)}
                      </span>
                      <span className="text-sm text-[var(--ledger-text-muted)]">
                        {filteredItems.length}
                      </span>
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
                    <span className="text-sm font-medium text-[var(--ledger-text-primary)]">
                      Selected item
                    </span>
                    {selectedItem && (
                      <span className="text-xs text-[var(--ledger-text-muted)]">
                        {selectedItemStatusLabel}
                      </span>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    {selectedItem ? (
                      <div className="space-y-5">
                        <div>
                          <p className={inboxTheme.inspectorLabel}>
                            {selectedItemSourceLabel || 'Intake item'}
                          </p>
                          <div className="mt-1 flex items-start justify-between gap-3">
                            <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-6 text-[var(--ledger-text-primary)]">
                              {selectedItemPreview?.title || getDisplayTitle(selectedItem)}
                            </h2>
                            {selectedItemNativeTypeLabel ? (
                              <span className="shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                                {selectedItemNativeTypeLabel}
                              </span>
                            ) : null}
                          </div>
                          {selectedItemMetadata.length > 0 && (
                            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                              {selectedItemMetadata.join(' · ')}
                            </p>
                          )}
                          {selectedItemGithubLifecycleLabel ? (
                            <p className="mt-1 text-xs text-[var(--ledger-text-secondary)]">
                              GitHub lifecycle · {selectedItemGithubLifecycleLabel}
                            </p>
                          ) : null}
                        </div>

                        <section className="space-y-2">
                          <p className={inboxTheme.inspectorLabel}>Preview</p>
                          {selectedItemPreview?.sourceMeta.length ? (
                            <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                              {selectedItemPreview.sourceMeta.join(' · ')}
                            </p>
                          ) : null}
                          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ledger-text-secondary)]">
                            {selectedItemPreview?.description ||
                              (selectedItemIsFigma
                                ? 'Figma resource linked from this intake item.'
                                : 'No preview available.')}
                          </p>
                          {selectedItemSourceUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(selectedItemSourceUrl, '_blank', 'noopener,noreferrer')
                              }
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                            >
                              {selectedItemIsFigma ? <FigmaMark size={14} /> : selectedItemIsGithub ? <img src="/github-mark.svg" alt="" className="h-3.5 w-3.5" /> : <ExternalLink size={12} />}
                              {selectedItemIsFigma ? 'Open in Figma' : selectedItemIsGithub ? 'Open in GitHub' : 'Open source'}
                            </button>
                          ) : null}
                        </section>

                        <section className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className={inboxTheme.inspectorLabel}>Destination</p>
                              <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">
                                Choose where this item should enter Ledger.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2.5">
                            <DestinationProperty
                              label="Create as"
                              icon={LayoutList}
                              value={destinationType}
                              onChange={(value) => setDestinationType(value as DestinationType)}
                              options={[
                                { value: 'task', label: 'Task' },
                                { value: 'note', label: 'Note' },
                                { value: 'event', label: 'Event' },
                                { value: 'reminder', label: 'Reminder' },
                              ]}
                            />

                            {(destinationType === 'task' || destinationType === 'note' || destinationNeedsSchedule) && (
                              <DestinationProperty
                                label="Project"
                                icon={FolderKanban}
                                value={selectedProjectId}
                                placeholder="No project"
                                onChange={setSelectedProjectId}
                                options={projects.map((project) => ({
                                  value: project.id,
                                  label: project.name || project.title || 'Untitled project',
                                }))}
                              />
                            )}

                            {destinationType === 'task' && !isPersonalWorkspace && (
                              <>
                                <DestinationProperty
                                  label="Owner"
                                  icon={User}
                                  value={selectedAssigneeId}
                                  placeholder="Unassigned"
                                  onChange={setSelectedAssigneeId}
                                  options={workspaceMembers.map((member) => ({ value: member.id, label: member.name }))}
                                />
                                <DestinationProperty
                                  label="Team"
                                  icon={Users}
                                  value={selectedTeamId}
                                  placeholder="Choose team"
                                  onChange={setSelectedTeamId}
                                  options={workspaceTeams.map((team) => ({ value: team.id, label: team.name }))}
                                />
                              </>
                            )}

                            {destinationType === 'note' && !isPersonalWorkspace && (
                              <DestinationProperty
                                label="Team"
                                icon={Users}
                                value={selectedTeamId}
                                placeholder="Choose team"
                                onChange={setSelectedTeamId}
                                options={workspaceTeams.map((team) => ({ value: team.id, label: team.name }))}
                              />
                            )}

                            {destinationNeedsSchedule && (
                              <div className="grid grid-cols-2 gap-2">
                                <DestinationInput
                                  label={destinationType === 'event' ? 'Date' : 'Remind on'}
                                  type="date"
                                  value={destinationType === 'event' ? eventDate : reminderDate}
                                  onChange={destinationType === 'event' ? setEventDate : setReminderDate}
                                />
                                <DestinationInput
                                  label="Time"
                                  type="time"
                                  value={destinationType === 'event' ? eventTime : reminderTime}
                                  onChange={destinationType === 'event' ? setEventTime : setReminderTime}
                                />
                              </div>
                            )}

                            {destinationNeedsSchedule && (
                              <DestinationProperty
                                label="Calendar"
                                icon={CalendarDays}
                                value={selectedCalendarId}
                                placeholder="Default calendar"
                                onChange={setSelectedCalendarId}
                                options={calendars.map((calendar) => ({ value: calendar.id, label: calendar.name || 'Calendar' }))}
                              />
                            )}

                            {(destinationType === 'note' || destinationNeedsSchedule) && notes.length > 0 && (
                              <DestinationProperty
                                label="Linked note"
                                icon={FileText}
                                value={selectedNoteId}
                                placeholder="No note"
                                onChange={setSelectedNoteId}
                                options={notes.map((note) => ({ value: note.id, label: note.title || 'Untitled note' }))}
                              />
                            )}
                          </div>
                          {destinationValidationError && (
                            <p className="text-xs text-[var(--ledger-danger)]">{destinationValidationError}</p>
                          )}
                        </section>
                        {activeWorkspaceId ? (
                          <LinkedDesignsSection
                            target={{ workspaceId: activeWorkspaceId, targetType: 'intake', targetId: selectedItem.id }}
                            canEdit={activeWorkspace?.role !== 'viewer'}
                            fallbackNodeName={selectedFigmaNodeName}
                            fallbackFileName={selectedFigmaFileName}
                            notes={notes.map((note) => ({ id: note.id, title: note.title ?? 'Untitled note', preview: '' }))}
                            selectedNoteIds={selectedLinkedNoteIds}
                            onToggleNote={(noteId) => setSelectedLinkedNoteIds((current) => current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId])}
                            onLinkNotes={async (noteIds) => {
                              for (const noteId of noteIds) await api.createContextLink('intake', selectedItem.id, 'note', noteId);
                              setSelectedLinkedNoteIds([]);
                            }}
                            projects={projects.map((project) => ({ id: project.id, name: project.name ?? project.title ?? 'Untitled project' }))}
                            selectedProjectIds={selectedLinkedProjectIds}
                            onToggleProject={(projectId) => setSelectedLinkedProjectIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])}
                            onLinkProjects={async (projectIds) => {
                              for (const projectId of projectIds) await api.createContextLink('intake', selectedItem.id, 'project', projectId);
                              setSelectedLinkedProjectIds([]);
                            }}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[240px] items-center justify-center text-center">
                        <div className="max-w-xs">
                          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-muted)]">
                            <Inbox size={15} />
                          </div>
                          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                            Select an item to review.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="sticky bottom-0 z-10 border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-4 py-3">
                    {selectedItem ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="flex min-w-0 w-full items-center gap-1.5">
                          {selectedItemPrimaryAction && (
                            <button
                              type="button"
                              onClick={selectedItemPrimaryAction.onClick}
                              disabled={selectedItemPrimaryDisabled}
                              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {selectedItemPrimaryLoading ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                selectedItemPrimaryAction.label
                              )}
                            </button>
                          )}
                          {selectedItemSecondaryActions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              onClick={action.onClick}
                              disabled={action.disabled}
                              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {action.loading ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                action.label
                              )}
                            </button>
                          ))}
                          {selectedItemDangerAction && (
                            <button
                              type="button"
                              onClick={selectedItemDangerAction.onClick}
                              disabled={selectedItemDangerAction.disabled}
                              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-md border border-[color:rgba(217,45,32,0.18)] bg-transparent px-2 text-xs font-medium text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {selectedItemDangerAction.loading ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                selectedItemDangerAction.label
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--ledger-text-muted)]">
                        Select an item to review.
                      </div>
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
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-[var(--ledger-text-muted)]">
      {label}
    </div>
  );
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
      role="menuitemradio"
      aria-checked={active}
      className={`flex h-8 w-full items-center justify-between rounded-md px-3 text-left text-[12px] font-medium transition ${
        active
          ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
          : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
      }`}
    >
      <span>{label}</span>
      {active ? <Check size={14} className="text-[var(--ledger-text-primary)]" /> : null}
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
      role="menuitemcheckbox"
      aria-checked={checked}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] font-medium transition ${
        checked
          ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
          : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
          checked
            ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)] text-white'
            : 'border-[color:var(--ledger-border-subtle)]'
        }`}
      >
        {checked && <Check size={10} />}
      </span>
      <span>{label}</span>
    </button>
  );
}

function DestinationProperty({
  label,
  icon: Icon = LayoutList,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  icon?: typeof CheckSquare;
  value: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[minmax(0,112px)_minmax(0,1fr)] items-center gap-3">
      <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--ledger-text-muted)]">
        <Icon size={14} strokeWidth={1.8} className="shrink-0 text-[var(--ledger-text-secondary)]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="relative min-w-0">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full appearance-none rounded-xl border border-transparent bg-[var(--ledger-surface-muted)] px-3 pr-8 text-left text-xs font-medium text-[var(--ledger-text-secondary)] outline-none transition hover:border-[color:var(--ledger-border-subtle)] focus:border-[color:var(--ledger-border-strong)] focus:text-[var(--ledger-text-primary)]"
        >
          <option value="">{placeholder || 'Choose'}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
        />
      </span>
    </label>
  );
}

function DestinationInput({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="block text-[11px] text-[var(--ledger-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-xs text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
      />
    </label>
  );
}

function titleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
